"""
Summary service for LLM-powered summarization and translation.

This service handles LLM API calls for transcript summarization and translation,
and summary caching. It never assigns names to speakers.
"""
import json
import logging
import re
from typing import Any, Optional

import aiofiles
import aiofiles.os
import httpx
from config import Settings
from fastapi import HTTPException
from llm_prompts import QWEN3_NO_THINK, TRANSLATION_OUTPUT_CONTRACT, LlmPrompts

logger = logging.getLogger(__name__)


def _extract_translated_texts(content: str, count: int) -> Optional[list[str]]:
    """
    Extract an ordered list of translated strings from an LLM response.

    The model is asked to return a JSON array of ``{"i": <index>, "text": <translation>}``
    objects (rather than a bare array of strings) so a translation that legitimately
    contains stray punctuation or gets reordered by the model can still be matched back
    to its original segment by index. Tolerates answers fenced in a code block or
    wrapped in prose.

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


# Reasoning some servers leave inline in the answer; an unclosed block (the
# answer was cut off mid-thought) runs to the end.
_THINK_BLOCK = re.compile(r"<think>.*?(?:</think>|$)", re.DOTALL | re.IGNORECASE)


# A whole answer wrapped in one fenced code block (```markdown ... ```), which
# models produce despite being asked not to; the UI would show it as raw code.
_WHOLE_ANSWER_FENCE = re.compile(r"\A\s*```[\w-]*[ \t]*\n(.*?)\n?[ \t]*```\s*\Z", re.DOTALL)


def _unwrap_code_fence(text: str) -> str:
    """Returns the content of an answer that is entirely one fenced code block."""
    match = _WHOLE_ANSWER_FENCE.match(text)
    return match.group(1).strip() if match else text


def _without_thinking(model_name: str, user_prompt: str) -> str:
    """Appends Qwen3's no-think switch to the user prompt for Qwen3 models."""
    if "qwen3" in (model_name or "").lower():
        return f"{user_prompt}\n\n{QWEN3_NO_THINK}"
    return user_prompt


def _read_completion(data: dict) -> tuple[str, Optional[str]]:
    """The answer text (reasoning removed) and finish reason of a chat completion."""
    choice = data["choices"][0]
    content = choice.get("message", {}).get("content") or ""
    return _THINK_BLOCK.sub("", content).strip(), choice.get("finish_reason")


def _unusable_answer_reason(content: str, finish_reason: Optional[str]) -> str:
    """Why a model answer could not be used, in words a user can act on."""
    if finish_reason == "length":
        return (
            "the model's answer was cut off because it reached its output limit "
            "before finishing"
        )
    if not content:
        return "the model returned an empty answer"
    return "the model's answer was not in the expected format"


def _describe_llm_error(error: Exception, timeout: float) -> str:
    """
    Turn an LLM request failure into a message a user can act on.

    httpx timeouts usually carry no message at all, which used to surface as a
    bare "Speaker identification failed: " with nothing after the colon.
    """
    if isinstance(error, httpx.TimeoutException):
        return (
            f"The language model did not respond within {timeout:g} seconds. "
            "Increase LLM_TIMEOUT if it needs more time."
        )
    return str(error) or type(error).__name__


class SummaryService:
    """Service for LLM-based summarization and translation."""

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        settings: Settings,
        runtime_settings: Optional[Any] = None,
    ):
        """
        Initialize SummaryService.

        Args:
            http_client: Async HTTP client for LLM API calls
            settings: Application settings
            runtime_settings: Source of the admin-edited prompts (anything
                with an async ``get()`` returning ``RuntimeSettings``); the
                default prompts are used without one.
        """
        self.http_client = http_client
        self.settings = settings
        self.runtime_settings = runtime_settings

    async def _prompts(self) -> LlmPrompts:
        """The prompts in effect now, read per request so edits apply at once."""
        if self.runtime_settings is None:
            return LlmPrompts()
        return (await self.runtime_settings.get()).llm_prompts()

    async def summarize(  # pylint: disable=too-many-locals
        self,
        transcript: str,
        custom_prompt: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Summarize transcript using LLM, always in European Portuguese.

        Args:
            transcript: The transcript text to summarize
            custom_prompt: Optional custom user prompt
            system_prompt: Optional custom system prompt (the language
                rule is always appended to it)

        Returns:
            Summary text in markdown format

        Raises:
            HTTPException: If LLM service is unavailable
        """
        # Validate transcript content quality
        transcript_text = transcript.strip()
        if not transcript_text:
            return (
                "# Sem conteúdo disponível\n\n"
                "A gravação parece estar vazia ou não foi possível transcrevê-la."
            )

        # Check for meaningful content
        words = transcript_text.split()
        unique_words = set(word.lower().strip('.,!?;:') for word in words)

        if len(words) < 10 or len(unique_words) < 5:
            spoken_content = ' '.join(words)
            return f"""# Resumo de gravação breve

## Conteúdo
Esta gravação parece ser muito curta e ter pouco conteúdo.

**Conteúdo transcrito:** "{spoken_content}"

## Nota
A gravação é demasiado curta para gerar um resumo detalhado da reunião."""

        base_url = self.settings.llm_api_url
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        model_name = self.settings.llm_model_name

        prompts = await self._prompts()
        final_system_prompt = (
            f"{system_prompt or prompts.summary_system_prompt}\n\n{prompts.language_rule}"
        )

        request = custom_prompt or prompts.summary_request
        final_user_prompt = (
            f"{request}\n\n{transcript}\n\n{prompts.language_reminder}"
        )
        final_user_prompt = _without_thinking(model_name, final_user_prompt)

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
            summary, finish_reason = _read_completion(response.json())
            summary = _unwrap_code_fence(summary)
            if not summary:
                reason = _unusable_answer_reason(summary, finish_reason)
                logger.error("Summary unusable (finish_reason=%s): %s", finish_reason, reason)
                raise HTTPException(
                    status_code=502, detail=f"Could not generate the summary: {reason}."
                )
            return summary

        except httpx.HTTPError as e:
            reason = _describe_llm_error(e, self.settings.llm_timeout)
            logger.error("LLM service error: %s", reason)
            raise HTTPException(
                status_code=503,
                detail=f"Summary service unavailable: {reason}"
            ) from e

    async def translate_segments(self, segments: list[dict]) -> list[dict]:
        """
        Translate transcript segment text into European Portuguese using the LLM.

        Only the `text` field of each segment is translated; `speaker`, `start`, and
        `end` are preserved as-is so the translated transcript stays aligned with the
        audio and with speaker attribution.

        Args:
            segments: List of transcript segment dicts (speaker, text, start, end).

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

        prompts = await self._prompts()
        system_prompt = (
            f"{prompts.translation_instructions} {TRANSLATION_OUTPUT_CONTRACT}\n\n"
            f"{prompts.language_rule}"
        )
        numbered_segments = [{"i": i, "text": text} for i, text in enumerate(texts)]
        user_prompt = _without_thinking(
            model_name, json.dumps(numbered_segments, ensure_ascii=False)
        )

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
            content, finish_reason = _read_completion(response.json())

            translated_texts = _extract_translated_texts(content, len(texts))
            if translated_texts is None:
                reason = _unusable_answer_reason(content, finish_reason)
                logger.error(
                    "Translation unusable (finish_reason=%s, %d chars): %s",
                    finish_reason, len(content), reason
                )
                logger.debug("Unparseable translation content: %r", content)
                raise HTTPException(
                    status_code=502,
                    detail=f"Could not read the translated transcript: {reason}."
                )

            return [
                {**segment, "text": translated_text}
                for segment, translated_text in zip(segments, translated_texts)
            ]

        except httpx.HTTPError as e:
            reason = _describe_llm_error(e, self.settings.llm_timeout)
            logger.error("LLM service error during translation: %s", reason)
            raise HTTPException(
                status_code=503,
                detail=f"Translation service unavailable: {reason}"
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
                # Summaries cached before fences were removed display correctly too.
                return _unwrap_code_fence(await f.read())

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
