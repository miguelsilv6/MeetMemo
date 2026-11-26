"""
The call record of an intercepted audio: the ``TranslatedPRI.xml`` that sits
next to it (in the product folder, above ``__CLIENT__`` with the audio).

Its root ``Produto`` element holds the product's fields as attributes (case,
target, product id, start and end, caller and callee, ...), named in
Portuguese, and its children the participants, the cells, the events
("etiquetas") and the product's files. Every attribute and element is kept
as it is; a summary of the main fields is worked out from them (the duration
from the start and end, when the call was answered from its events).

The XML comes from another system, so it is parsed without a DTD (no
entities, no external references) and its size is bounded. Times are kept as
the file writes them: it gives no time zone.
"""
import hashlib
import re
from datetime import datetime
from typing import Optional

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import ParseError, fromstring

ROOT_TAG = "Produto"
FILE_NAME = "TranslatedPRI.xml"
# The ones seen are a few KB; this leaves plenty of room for long calls.
MAX_BYTES = 1024 * 1024
TIME_FORMAT = "%d-%m-%Y %H:%M:%S"

# The summary's fields and the root attribute each comes from.
SUMMARY_FIELDS = {
    "product_id": "ID_do_Produto",
    "target_product_number": "Número_de_produto_do_alvo",
    "product_type": "Tipo_de_Produto",
    "product_subtype": "Subtipo_do_produto",
    "protocol": "Tipo_de_protocolo",
    "start": "Hora_de_início",
    "end": "Hora_de_fim",
    "direction": "Direção",
    "caller": "De",
    "callee": "Para",
    "recorded": "Conteúdo_Gravado",
    "end_reason": "Motivo_do_fim",
    "case": "Caso",
    "subcase": "Subcaso",
    "target": "Alvo",
    "target_number": "Número_do_alvo",
    "interception_id": "ID_da_Interceção",
    "interception_criterion": "Critério_de_interceção",
    "guid": "GUID",
}


class CallRecordError(ValueError):
    """The file is not a call record that can be read."""


def _time(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.strptime(value, TIME_FORMAT) if value else None
    except ValueError:
        return None


def _summary(attributes: dict, elements: list[dict]) -> dict:
    summary = {key: attributes.get(name) or None for key, name in SUMMARY_FIELDS.items()}
    start, end = _time(summary["start"]), _time(summary["end"])
    summary["duration_seconds"] = (
        int((end - start).total_seconds()) if start and end and end >= start else None
    )
    answered = next(
        (element["attributes"].get("Hora") for element in elements
         if element["tag"] == "Etiqueta" and element["attributes"].get("Tipo") == "Atendida"),
        None,
    )
    summary["answered_at"] = answered or None
    return summary


def parse_call_record(content: bytes) -> dict:
    """
    Read a ``TranslatedPRI.xml``: its root's attributes, every child element
    (tag and attributes, in file order), and a summary of the main fields.

    Raises:
        CallRecordError: Too big, not well-formed XML, a DTD or entities, or
            not a product (the root is not ``Produto``).
    """
    if len(content) > MAX_BYTES:
        raise CallRecordError(f"The file is larger than {MAX_BYTES // 1024} KB")
    try:
        root = fromstring(content, forbid_dtd=True, forbid_entities=True,
                          forbid_external=True)
    except (ParseError, DefusedXmlException) as e:
        raise CallRecordError(f"Not a readable XML file: {e}") from e
    if root.tag != ROOT_TAG:
        raise CallRecordError(
            f"Not a TranslatedPRI.xml: its root is <{root.tag}>, not <{ROOT_TAG}>"
        )
    attributes = dict(root.attrib)
    elements = [{"tag": child.tag, "attributes": dict(child.attrib)} for child in root]
    return {
        "attributes": attributes,
        "elements": elements,
        "summary": _summary(attributes, elements),
    }


def sha256(content: bytes) -> str:
    """The file's SHA-256, to show it is the one imported."""
    return hashlib.sha256(content).hexdigest()


def guid_matches_audio(guid: Optional[str], audio_file_name: str) -> Optional[bool]:
    """
    Whether the record's GUID names the audio: the audio in ``__CLIENT__`` is
    named after it, with dashes (``e153c371-f8fc-...``). None when there is no
    GUID to compare.
    """
    if not guid:
        return None
    digits = re.sub(r"[^0-9a-f]", "", audio_file_name.lower())
    return re.sub(r"[^0-9a-f]", "", guid.lower()) in digits
