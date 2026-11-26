"""
Reading the call record (TranslatedPRI.xml) of an intercepted audio: every
field is kept, the main ones are summed up, and a file that is not one, or
that tries XML tricks, is refused.
"""
from pathlib import Path

import pytest
from services.call_record import (
    MAX_BYTES,
    CallRecordError,
    guid_matches_audio,
    parse_call_record,
    sha256,
)

SAMPLE = (Path(__file__).parent / "fixtures" / "TranslatedPRI.xml").read_bytes()


def test_the_main_fields_are_summed_up():
    summary = parse_call_record(SAMPLE)["summary"]

    assert summary["product_id"] == "987391358095330748"
    assert summary["target_product_number"] == "2414"
    assert (summary["product_type"], summary["protocol"]) == ("Voz", "VOIP")
    assert (summary["start"], summary["end"]) == ("17-11-2026 20:31:50", "17-11-2026 20:32:48")
    assert summary["duration_seconds"] == 58
    assert summary["answered_at"] == "17-11-2026 20:32:10"  # the "Atendida" event
    assert (summary["caller"], summary["callee"]) == ("351912052349", "+351915592482")
    assert (summary["case"], summary["target"]) == ("00000-25.0JGLSB", "111222333")
    assert summary["interception_id"] == "147277040"
    assert summary["guid"] == "E153C371F8FC8B168A67E7DA3347B76D"


def test_every_attribute_and_element_is_kept_in_order():
    record = parse_call_record(SAMPLE)

    assert len(record["attributes"]) == 44
    assert record["attributes"]["Caminho_do_produto"] == "\\\\aaaaaa"
    assert [e["tag"] for e in record["elements"]] == (
        ["Participantes_do_produto"] * 2 + ["Ficheiros_de_produtos"] * 4 + ["Dados_em_bruto"]
        + ["Coordenadas_da_célula"] * 2 + ["Etiqueta"] * 5)
    cell = record["elements"][7]["attributes"]
    assert (cell["Coordenada_X_da_célula"], cell["Coordenada_Y_da_célula"]) == (
        "-9.32859", "38.68433")


def test_missing_or_odd_times_give_no_duration():
    xml = '<Produto Hora_de_início="17-11-2026 20:32:48" Hora_de_fim="ontem"/>'.encode()
    summary = parse_call_record(xml)["summary"]
    assert summary["duration_seconds"] is None
    assert summary["answered_at"] is None and summary["caller"] is None


@pytest.mark.parametrize("content, message", [
    (b"not xml at all", "Not a readable XML"),
    (b'<?xml version="1.0"?><Product ID="1"/>', "its root is <Product>"),
    # Entities, internal or external, are refused before anything is expanded.
    (b'<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "xxxxxxxx">]><Produto De="&x;"/>',
     "Not a readable XML"),
    (b'<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
     b'<Produto De="&x;"/>', "Not a readable XML"),
    (b"<Produto " + b'a="' + b"x" * MAX_BYTES + b'"/>', "larger than"),
])
def test_what_is_not_a_call_record_is_refused(content, message):
    with pytest.raises(CallRecordError, match=message):
        parse_call_record(content)


def test_the_audio_named_after_the_guid_matches():
    guid = "E153C371F8FC8B168A67E7DA3347B76D"
    assert guid_matches_audio(guid, "e153c371-f8fc-8b16-8a67-e7da3347b76d.wav") is True
    assert guid_matches_audio(guid, "e153c371-f8fc-8b16-8a67-e7da3347b76d_1.wav") is True
    assert guid_matches_audio(guid, "ffdbc3e0-99fc-8b16-a14b-e008484a1e55.wav") is False
    assert guid_matches_audio(None, "call.wav") is None


def test_the_hash_is_of_the_bytes_as_imported():
    assert sha256(SAMPLE) == sha256(bytes(SAMPLE))
    assert len(sha256(SAMPLE)) == 64 and sha256(SAMPLE) != sha256(SAMPLE + b" ")
