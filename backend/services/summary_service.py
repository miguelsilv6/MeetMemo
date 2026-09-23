"""
Summary service for LLM-powered summarization and speaker identification.

This service handles LLM API calls for transcript summarization, speaker identification,
and summary caching.
"""
import json
import logging
from typing import Optional

import aiofiles
import httpx
from config import Settings
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Language name mapping for common languages
LANGUAGE_NAMES = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean', 'pt': 'Portuguese',
    'ru': 'Russian', 'ar': 'Arabic', 'hi': 'Hindi', 'it': 'Italian',
    'nl': 'Dutch', 'pl': 'Polish', 'tr': 'Turkish', 'vi': 'Vietnamese',
    'sv': 'Swedish', 'id': 'Indonesian', 'th': 'Thai', 'uk': 'Ukrainian'
}


def _extract_speaker_mapping(content: str) -> Optional[dict]:
    """
    Extract a speaker->name mapping from an LLM response.

    LLMs do not reliably return a bare JSON object: the mapping may be fenced in
    a markdown code block, or embedded in surrounding prose. This tolerantly
    recovers the first valid JSON object and validates it is a flat mapping of
    string labels to string names.

    Args:
        content: Raw assistant message content.

    Returns:
        A dict of speaker label -> suggested name, or None if no valid mapping
        could be parsed.
    """
    if not content:
        return None

    candidates = []

    # 1) Fenced code block (```json ... ``` or ``` ... ```), if present.
    if "```" in content:
        fenced = content.split("```", 2)
        if len(fenced) >= 2:
            block = fenced[1]
            if block.lstrip().lower().startswith("json"):
                block = block.lstrip()[len("json"):]
            candidates.append(block.strip())

    # 2) The whole (stripped) string.
    candidates.append(content.strip())

    # 3) Every balanced {...} object found in the text, in order. Scanning all
    #    of them (not just the first) means a leading non-mapping object does
    #    not hide a valid mapping that appears later in the prose.
    depth = 0
    obj_start = -1
    for i, ch in enumerate(content):
        if ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and obj_start != -1:
                candidates.append(content[obj_start:i + 1])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        # Only accept a flat mapping of string -> string.
        if isinstance(parsed, dict) and parsed and all(
            isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
        ):
            return parsed

    return None


def _extract_translated_texts(content: str, count: int) -> Optional[list[str]]:
    """
    Extract an ordered list of translated strings from an LLM response.

    The model is asked to return a JSON array of ``{"i": <index>, "text": <translation>}``
    objects (rather than a bare array of strings) so a translation that legitimately
    contains stray punctuation or gets reordered by the model can still be matched back
    to its original segment by index. Tolerates the same fenced/prose-wrapped shapes as
    ``_extract_speaker_mapping``.

    Args:
        content: Raw assistant message content.
        count: Expected number of segments (and highest valid index + 1).

    Returns:
        A list of `count` translated strings in original segment order, or None if no
        valid, complete translation could be parsed.
    """
    if not content:
        return None

    candidates = []

    if "```" in content:
        fenced = content.split("```", 2)
        if len(fenced) >= 2:
            block = fenced[1]
            if block.lstrip().lower().startswith("json"):
                block = block.lstrip()[len("json"):]
            candidates.append(block.strip())

    candidates.append(content.strip())

    # Every balanced [...] array found in the text, in order.
    depth = 0
    arr_start = -1
    for i, ch in enumerate(content):
        if ch == "[":
            if depth == 0:
                arr_start = i
            depth += 1
        elif ch == "]" and depth > 0:
            depth -= 1
            if depth == 0 and arr_start != -1:
                candidates.append(content[arr_start:i + 1])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if not isinstance(parsed, list) or len(parsed) != count:
            continue

        try:
            by_index = {}
            for item in parsed:
                if not isinstance(item, dict):
                    raise ValueError("item is not an object")
                index = int(item["i"])
                by_index[index] = str(item["text"])
            if set(by_index.keys()) != set(range(count)):
                raise ValueError("indices do not cover the full range")
        except (ValueError, TypeError, KeyError):
            continue

        return [by_index[i] for i in range(count)]

    return None


class SummaryService:
    """Service for LLM-based summarization and speaker identification."""

    def __init__(self, http_client: httpx.AsyncClient, settings: Settings):
        """
        Initialize SummaryService.

        Args:
            http_client: Async HTTP client for LLM API calls
            settings: Application settings
        """
        self.http_client = http_client
        self.settings = settings

    async def summarize(  # pylint: disable=too-many-locals
        self,
        transcript: str,
        custom_prompt: Optional[str] = None,
        system_prompt: Optional[str] = None,
        language: Optional[str] = None
    ) -> str:
        """
        Summarize transcript using LLM.

        Args:
            transcript: The transcript text to summarize
            custom_prompt: Optional custom user prompt
            system_prompt: Optional custom system prompt
            language: ISO 639-1 language code or 'auto' for auto-detection

        Returns:
            Summary text in markdown format

        Raises:
            HTTPException: If LLM service is unavailable
        """
        # Validate transcript content quality
        transcript_text = transcript.strip()
        if not transcript_text:
            return (
                "# No Content Available\n\n"
                "The recording appears to be empty or could not be transcribed."
            )

        # Check for meaningful content
        words = transcript_text.split()
        unique_words = set(word.lower().strip('.,!?;:') for word in words)

        if len(words) < 10 or len(unique_words) < 5:
            spoken_content = ' '.join(words)
            return f"""# Brief Recording Summary

## Content
This appears to be a very short recording with limited content.

**Transcribed content:** "{spoken_content}"

## Note
The recording was too brief to generate a detailed meeting summary."""

        base_url = self.settings.llm_api_url
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        model_name = self.settings.llm_model_name

        # Determine language instruction
        language_instruction = ""
        if language and language != 'auto':
            lang_name = LANGUAGE_NAMES.get(language, language)
            language_instruction = (
                f"Generate the summary in {lang_name}, matching the language of the transcript. "
            )
        else:
            language_instruction = "Generate the summary in the same language as the transcript. "

        # Default prompts
        default_system_prompt = (
            "You are a helpful assistant that summarizes meeting transcripts. "
            "You will give a concise summary of the key points, decisions made, "
            "and any action items, outputting it in markdown format. "
            f"{language_instruction}"
            "IMPORTANT: Always use the exact speaker names provided in the transcript. "
            "Never change, substitute, or invent different names for speakers. "
            "CRITICAL: Only summarize what is actually present in the transcript. "
            "Do not invent or hallucinate content, participants, decisions, or action items."
        )

        default_user_prompt = (
            "Analyze the following transcript and provide an appropriate summary. "
            "Use exact speaker names as they appear. "
            "Only include sections that have actual content from the transcript. "
            "Use markdown format without code blocks.\n\n"
        )

        final_system_prompt = system_prompt if system_prompt else default_system_prompt

        if custom_prompt:
            final_user_prompt = custom_prompt + "\n\n" + transcript
        else:
            final_user_prompt = default_user_prompt + transcript

        payload = {
            "model": model_name,
            "temperature": 0.3,
            "max_tokens": 5000,
            "messages": [
                {"role": "system", "content": final_system_prompt},
                {"role": "user", "content": final_user_prompt},
            ],
        }

        try:
            headers = {"Content-Type": "application/json"}
            if self.settings.llm_api_key:
                headers["Authorization"] = f"Bearer {self.settings.llm_api_key}"

            response = await self.http_client.post(
                url,
                headers=headers,
                json=payload,
                timeout=self.settings.llm_timeout
            )
            response.raise_for_status()
            data = response.json()
            summary = data["choices"][0]["message"]["content"].strip()
            return summary

        except httpx.HTTPError as e:
            logger.error("LLM service error: %s", e)
            raise HTTPException(
                status_code=503,
                detail="Summary service temporarily unavailable"
            ) from e

    async def identify_speakers(  # pylint: disable=too-many-locals
        self,
        transcript: str,
        context: Optional[str] = None
    ) -> dict:
        """
        Identify speakers using LLM based on transcript content.

        Args:
            transcript: Formatted transcript text
            context: Optional meeting context

        Returns:
            Dict with status and speaker name suggestions

        Raises:
            HTTPException: If LLM service is unavailable
        """
        base_url = self.settings.llm_api_url
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        model_name = self.settings.llm_model_name

        system_prompt = (
            "You are a helpful assistant that identifies speakers in meeting transcripts. "
            "Based on the conversation content, suggest likely names or roles for each speaker. "
            "Return ONLY a JSON object mapping speaker labels to suggested names."
        )

        context_text = f"\nContext: {context}\n\n" if context else "\n\n"
        user_prompt = (
            "Analyze this transcript and suggest names or roles for each speaker. "
            f"{context_text}Transcript:\n{transcript}\n\n"
            "Return a JSON object like: "
            '{\"SPEAKER_00\": \"John (CEO)\", \"SPEAKER_01\": \"Sarah (CTO)\"}'
        )

        payload = {
            "model": model_name,
            "temperature": 0.2,
            "max_tokens": 500,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        # Request a JSON object where the serving stack supports it. Servers
        # that ignore the field still work (the response is parsed defensively
        # below); the toggle exists for servers that reject unknown fields.
        if self.settings.llm_json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            headers = {"Content-Type": "application/json"}
            if self.settings.llm_api_key:
                headers["Authorization"] = f"Bearer {self.settings.llm_api_key}"

            response = await self.http_client.post(
                url,
                headers=headers,
                json=payload,
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()

            suggestions = _extract_speaker_mapping(content)
            if suggestions is None:
                logger.error(
                    "Speaker identification could not parse a speaker mapping from LLM output"
                )
                logger.debug("Unparseable speaker-identification content: %r", content)
                return {
                    "status": "error",
                    "message": "Could not parse speaker suggestions from the model response."
                }
            return {"status": "success", "suggestions": suggestions}

        except Exception as e:  # pylint: disable=broad-exception-caught
            logger.error("Speaker identification failed: %s", e, exc_info=True)
            return {
                "status": "error",
                "message": f"Speaker identification failed: {str(e)}"
            }

    async def translate_segments(
        self,
        segments: list[dict],
        target_language: str = "pt"
    ) -> list[dict]:
        """
        Translate transcript segment text into another language using the LLM.

        Only the `text` field of each segment is translated; `speaker`, `start`, and
        `end` are preserved as-is so the translated transcript stays aligned with the
        audio and with speaker attribution.

        Args:
            segments: List of transcript segment dicts (speaker, text, start, end).
            target_language: ISO 639-1 code of the language to translate into.

        Returns:
            A new list of segment dicts with `text` replaced by its translation.

        Raises:
            HTTPException: If the LLM service is unavailable or its response could
                not be parsed into a complete translation.
        """
        texts = [segment.get("text", "") for segment in segments]

        if not any(text.strip() for text in texts):
            return list(segments)

        base_url = self.settings.llm_api_url
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        model_name = self.settings.llm_model_name
        lang_name = LANGUAGE_NAMES.get(target_language, target_language)

        system_prompt = (
            f"You are a professional meeting transcript translator. Translate the "
            f"\"text\" field of every object in the given JSON array into {lang_name}. "
            "Preserve meaning, tone, and register; do not summarize or omit content. "
            "Keep the same number of objects, in the same order, with the same \"i\" "
            "values. Never merge, split, add, or remove entries. "
            "Return ONLY a JSON array of objects shaped like "
            '{"i": <index>, "text": "<translation>"}, nothing else.'
        )
        numbered_segments = [{"i": i, "text": text} for i, text in enumerate(texts)]
        user_prompt = json.dumps(numbered_segments, ensure_ascii=False)

        payload = {
            "model": model_name,
            "temperature": 0.2,
            "max_tokens": 5000,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        try:
            headers = {"Content-Type": "application/json"}
            if self.settings.llm_api_key:
                headers["Authorization"] = f"Bearer {self.settings.llm_api_key}"

            response = await self.http_client.post(
                url,
                headers=headers,
                json=payload,
                timeout=self.settings.llm_timeout
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()

            translated_texts = _extract_translated_texts(content, len(texts))
            if translated_texts is None:
                logger.error(
                    "Translation could not parse a complete segment list from LLM output"
                )
                logger.debug("Unparseable translation content: %r", content)
                raise HTTPException(
                    status_code=502,
                    detail="Could not parse the translated transcript from the model response."
                )

            return [
                {**segment, "text": translated_text}
                for segment, translated_text in zip(segments, translated_texts)
            ]

        except httpx.HTTPError as e:
            logger.error("LLM service error during translation: %s", e)
            raise HTTPException(
                status_code=503,
                detail="Translation service temporarily unavailable"
            ) from e

    async def get_cached_summary(self, job_uuid: str) -> Optional[str]:
        """
        Get cached summary from filesystem.

        Args:
            job_uuid: Job UUID

        Returns:
            Cached summary text or None if not found
        """
        summary_path = self.settings.summary_path / f"{job_uuid}.txt"

        if await aiofiles.os.path.exists(str(summary_path)):
            async with aiofiles.open(summary_path, "r", encoding="utf-8") as f:
                return await f.read()

        return None

    async def save_summary(self, job_uuid: str, summary: str) -> None:
        """
        Save summary to filesystem cache.

        Args:
            job_uuid: Job UUID
            summary: Summary text to save
        """
        summary_path = self.settings.summary_path / f"{job_uuid}.txt"

        async with aiofiles.open(summary_path, "w", encoding="utf-8") as f:
            await f.write(summary)

    async def delete_summary(self, job_uuid: str) -> bool:
        """
        Delete cached summary.

        Args:
            job_uuid: Job UUID

        Returns:
            True if summary was deleted, False if it didn't exist
        """
        summary_path = self.settings.summary_path / f"{job_uuid}.txt"

        if await aiofiles.os.path.exists(str(summary_path)):
            await aiofiles.os.remove(str(summary_path))
            return True

        return False
