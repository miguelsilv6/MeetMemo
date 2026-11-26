"""
The main fields of an audio's call record (see services/call_record.py), as
text for the exports and the summary.
"""
from typing import Optional

TITLE = "Dados da chamada"

# (label, summary field), in the order shown.
FIELDS = (
    ("Produto", "product_id"),
    ("Nº de produto do alvo", "target_product_number"),
    ("Tipo", "product_type"),
    ("Protocolo", "protocol"),
    ("Início", "start"),
    ("Fim", "end"),
    ("Duração", "duration_seconds"),
    ("Atendida às", "answered_at"),
    ("De", "caller"),
    ("Para", "callee"),
    ("Direção", "direction"),
    ("Caso", "case"),
    ("Subcaso", "subcase"),
    ("Alvo", "target"),
    ("Número do alvo", "target_number"),
    ("ID da interceção", "interception_id"),
)


def format_duration(seconds: Optional[int]) -> Optional[str]:
    """58 → "0:58"; 3725 → "1:02:05"."""
    if seconds is None:
        return None
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def call_record_lines(summary: Optional[dict]) -> list[tuple[str, str]]:
    """(label, value) for every main field the record has."""
    if not summary:
        return []
    lines = []
    for label, key in FIELDS:
        value = summary.get(key)
        if key == "duration_seconds":
            value = format_duration(value)
        if value not in (None, ""):
            lines.append((label, str(value)))
    return lines


def _escape_markdown(text: str) -> str:
    for char in "\\`*_[]<>|":
        text = text.replace(char, "\\" + char)
    return text


def call_record_markdown(summary: Optional[dict]) -> str:
    """The section the Markdown exports start with ('' without a record)."""
    lines = call_record_lines(summary)
    if not lines:
        return ""
    items = "".join(f"- **{label}:** {_escape_markdown(value)}\n" for label, value in lines)
    return f"## {TITLE}\n\n{items}\n"


def call_record_prompt(summary: Optional[dict]) -> str:
    """
    What the summary is told about the call: who called whom, when and for
    how long (not the case, the target, the interception or the cells).
    """
    if not summary:
        return ""
    parts = [
        ("De", summary.get("caller")),
        ("Para", summary.get("callee")),
        ("Início", summary.get("start")),
        ("Duração", format_duration(summary.get("duration_seconds"))),
    ]
    known = [f"{label}: {value}" for label, value in parts if value]
    return ("Dados da chamada — " + "; ".join(known) + ".") if known else ""
