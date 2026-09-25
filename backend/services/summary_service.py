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

# Summaries and translations are always written in European Portuguese. Small
# models drift into Brazilian Portuguese unless told otherwise explicitly, so
# the rule names the variant and gives concrete contrasting examples. It is
# appended to every summary/translation system prompt (custom ones included).
EUROPEAN_PORTUGUESE_RULE = (
    "IDIOMA OBRIGATÓRIO: escreve sempre em português europeu (português de Portugal), "
    "seja qual for o idioma da transcrição. Nunca uses português do Brasil. "
    "Usa o vocabulário, a gramática e a ortografia de Portugal, por exemplo: "
    "equipa (e não time), ficheiro (e não arquivo), utilizador (e não usuário), "
    "telemóvel (e não celular), ecrã (e não tela), contacto (e não contato), "
    "facto (e não fato), receção (e não recepção), "
    "\"estou a fazer\" (e não \"estou fazendo\"), \"tu fazes\" ou \"o senhor faz\" "
    "(e não \"você faz\" como tratamento genérico)."
)

# Final reminder placed after the transcript: small models weigh the end of
# the prompt heavily, and a long transcript can push the system prompt out of
# their attention.
EUROPEAN_PORTUGUESE_REMINDER = "Responde apenas em português de Portugal."


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
    ) -> str:
        """
        Summarize transcript using LLM, always in European Portuguese.

        Args:
            transcript: The transcript text to summarize
            custom_prompt: Optional custom user prompt
            system_prompt: Optional custom system prompt (the European
                Portuguese rule is always appended to it)

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

        default_system_prompt = (
            "És um assistente que resume transcrições de reuniões e chamadas. "
            "Faz um resumo conciso dos pontos principais, das decisões tomadas "
            "e das ações a realizar, em formato Markdown. "
            "IMPORTANTE: usa sempre os nomes exatos dos interlocutores tal como "
            "aparecem na transcrição; nunca os alteres, substituas ou inventes. "
            "CRÍTICO: resume apenas o que está efetivamente na transcrição. "
            "Não inventes conteúdo, participantes, decisões nem ações."
        )

        default_user_prompt = (
            "Analisa a transcrição seguinte e faz um resumo adequado. "
            "Usa os nomes dos interlocutores exatamente como aparecem. "
            "Inclui apenas as secções que tenham conteúdo real da transcrição. "
            "Usa formato Markdown, sem blocos de código.\n\n"
        )

        final_system_prompt = (
            f"{system_prompt or default_system_prompt}\n\n{EUROPEAN_PORTUGUESE_RULE}"
        )

        if custom_prompt:
            final_user_prompt = custom_prompt + "\n\n" + transcript
        else:
            final_user_prompt = default_user_prompt + transcript
        final_user_prompt += f"\n\n{EUROPEAN_PORTUGUESE_REMINDER}"

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
                timeout=self.settings.llm_timeout
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
            reason = _describe_llm_error(e, self.settings.llm_timeout)
            logger.error("Speaker identification failed: %s", reason, exc_info=True)
            return {
                "status": "error",
                "message": f"Speaker identification failed: {reason}"
            }

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

        system_prompt = (
            "You are a professional meeting transcript translator. Translate the "
            "\"text\" field of every object in the given JSON array into European "
            "Portuguese (Portugal). "
            "Preserve meaning, tone, and register; do not summarize or omit content. "
            "Keep the same number of objects, in the same order, with the same \"i\" "
            "values. Never merge, split, add, or remove entries. "
            "Return ONLY a JSON array of objects shaped like "
            '{"i": <index>, "text": "<translation>"}, nothing else.\n\n'
            f"{EUROPEAN_PORTUGUESE_RULE}"
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
