"""
Prompts sent to the LLM for summaries and translations.

The defaults live here; the admin panel can replace each editable prompt
(``runtime_settings.RuntimeSettings``). Two parts stay fixed because the code
depends on them: the JSON shape a translation must come back in, and Qwen3's
switch that turns its thinking phase off.
"""
from dataclasses import dataclass

DEFAULT_SUMMARY_SYSTEM_PROMPT = (
    "És um assistente que resume transcrições de reuniões e chamadas. "
    "Faz um resumo conciso dos pontos principais, das decisões tomadas "
    "e das ações a realizar, em formato Markdown. "
    "IMPORTANTE: usa sempre os nomes exatos dos interlocutores tal como "
    "aparecem na transcrição; nunca os alteres, substituas ou inventes. "
    "CRÍTICO: resume apenas o que está efetivamente na transcrição. "
    "Não inventes conteúdo, participantes, decisões nem ações."
)

# Placed before the transcript in the user message.
DEFAULT_SUMMARY_REQUEST = (
    "Analisa a transcrição seguinte e faz um resumo adequado. "
    "Usa os nomes dos interlocutores exatamente como aparecem. "
    "Inclui apenas as secções que tenham conteúdo real da transcrição. "
    "Usa formato Markdown, sem blocos de código."
)

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

DEFAULT_TRANSLATION_INSTRUCTIONS = (
    "You are a professional meeting transcript translator. Translate the "
    "\"text\" field of every object in the given JSON array into European "
    "Portuguese (Portugal). "
    "Preserve meaning, tone, and register; do not summarize or omit content."
)

# Fixed: the translation is matched back to its segments by these indices.
TRANSLATION_OUTPUT_CONTRACT = (
    "Keep the same number of objects, in the same order, with the same \"i\" "
    "values. Never merge, split, add, or remove entries. "
    "Return ONLY a JSON array of objects shaped like "
    '{"i": <index>, "text": "<translation>"}, nothing else.'
)

# Fixed: Qwen3's documented soft switch that turns off its "thinking" phase
# for one request. Left on, a small Qwen3 can spend its whole token budget
# reasoning (Ollama returns that separately, as `reasoning`) and answer with
# nothing.
QWEN3_NO_THINK = "/no_think"


@dataclass(frozen=True)
class LlmPrompts:
    """The editable prompts in effect for one request."""

    summary_system_prompt: str = DEFAULT_SUMMARY_SYSTEM_PROMPT
    summary_request: str = DEFAULT_SUMMARY_REQUEST
    language_rule: str = EUROPEAN_PORTUGUESE_RULE
    language_reminder: str = EUROPEAN_PORTUGUESE_REMINDER
    translation_instructions: str = DEFAULT_TRANSLATION_INSTRUCTIONS
