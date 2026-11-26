"""
The call record's main fields as text: at the top of the Markdown and Word
exports, and the little the AI summary is told (who called whom, when, how
long; not the case, the target or the cells).
"""
import asyncio
from pathlib import Path
from types import SimpleNamespace

from docx import Document
from services.call_record import parse_call_record
from utils.call_record_text import (
    call_record_lines,
    call_record_markdown,
    call_record_prompt,
    format_duration,
)
from utils.docx_generator import generate_transcript_docx
from utils.markdown_generator import generate_summary_markdown, generate_transcript_markdown

SUMMARY = parse_call_record(
    (Path(__file__).parent / "fixtures" / "TranslatedPRI.xml").read_bytes()
)["summary"]
SETTINGS = SimpleNamespace(timezone=None)
TRANSCRIPT = [{"speaker": "SPEAKER_00", "text": "Estou?", "start": 0.0, "end": 1.0}]


def test_durations_read_like_a_clock():
    assert format_duration(58) == "0:58"
    assert format_duration(3725) == "1:02:05"
    assert format_duration(None) is None


def test_the_lines_follow_the_record_and_skip_what_it_lacks():
    lines = dict(call_record_lines(SUMMARY))
    assert lines["De"] == "351912052349" and lines["Para"] == "+351915592482"
    assert lines["Duração"] == "0:58" and lines["Atendida às"] == "17-11-2026 20:32:10"
    assert lines["Caso"] == "00000-25.0JGLSB"
    assert call_record_lines({"caller": "1", "callee": None}) == [("De", "1")]
    assert not call_record_lines(None)


def test_the_markdown_section_escapes_what_could_be_markup():
    section = call_record_markdown({"caller": "*351*", "case": "a_b|c"})
    assert section.startswith("## Dados da chamada\n\n")
    assert "- **De:** \\*351\\*" in section
    assert "- **Caso:** a\\_b\\|c" in section
    assert not call_record_markdown(None)


def test_the_exports_start_with_the_call():
    transcript = generate_transcript_markdown(
        "call.wav", TRANSCRIPT, "hoje", SETTINGS, call_record=SUMMARY).getvalue().decode()
    assert transcript.index("## Dados da chamada") < transcript.index("## Transcript")
    assert "- **De:** 351912052349" in transcript
    summary = generate_summary_markdown(
        "call.wav", "Resumo.", TRANSCRIPT, "hoje", SETTINGS, call_record=SUMMARY
    ).getvalue().decode()
    assert summary.index("## Dados da chamada") < summary.index("## Summary")
    # Without a record, as before.
    plain = generate_transcript_markdown("call.wav", TRANSCRIPT, "hoje", SETTINGS)
    assert "Dados da chamada" not in plain.getvalue().decode()


def test_the_word_export_has_a_table_of_the_call():
    document = Document(generate_transcript_docx(
        "call.wav", TRANSCRIPT, "hoje", SETTINGS, call_record=SUMMARY))
    headings = [p.text for p in document.paragraphs if p.style.name.startswith("Heading")]
    assert "Dados da chamada" in headings
    [table] = document.tables
    rows = {row.cells[0].text: row.cells[1].text for row in table.rows}
    assert rows["Para"] == "+351915592482" and rows["Duração"] == "0:58"
    assert not Document(generate_transcript_docx(
        "call.wav", TRANSCRIPT, "hoje", SETTINGS)).tables


def test_the_summary_is_told_only_who_called_whom_when_and_how_long():
    prompt = call_record_prompt(SUMMARY)
    assert prompt == ("Dados da chamada — De: 351912052349; Para: +351915592482; "
                      "Início: 17-11-2026 20:31:50; Duração: 0:58.")
    for kept_out in ("00000-25.0JGLSB", "111222333", "147277040", "268-01"):
        assert kept_out not in prompt
    assert call_record_prompt(None) == "" and call_record_prompt({}) == ""


def test_the_summary_prompt_carries_the_call_before_the_transcript():
    # pylint: disable=import-outside-toplevel
    from services.summary_service import SummaryService

    from tests.test_european_portuguese import TRANSCRIPT as TEXT
    from tests.test_european_portuguese import _fake_settings, _FakeClient, _messages

    client = _FakeClient()
    asyncio.run(SummaryService(client, _fake_settings()).summarize(
        TEXT, call_context=call_record_prompt(SUMMARY)))
    _, user = _messages(client)
    assert user.index("De: 351912052349") < user.index(TEXT)

    asyncio.run(SummaryService(client, _fake_settings()).summarize(TEXT))
    _, user = _messages(client)
    assert "Dados da chamada" not in user


def test_a_summary_task_passes_the_audios_call_on(monkeypatch):
    # pylint: disable=import-outside-toplevel
    from services import llm_tasks

    async def read_transcript(settings, job):
        return '[{"speaker": "SPEAKER_00", "text": "Estou?"}]', "d1"

    async def transcript_digest(settings, job):
        return "d1"

    async def summary_context(job_uuid):
        return f"Dados da chamada de {job_uuid}"

    class Summaries:
        context = None

        async def summarize(self, text, custom, system, call_context=None):
            Summaries.context = call_context
            return "Resumo."

        async def save_summary(self, job_uuid, summary):
            pass

    for name, fake in (("read_transcript", read_transcript),
                       ("transcript_digest", transcript_digest),
                       ("summary_context", summary_context)):
        monkeypatch.setattr(llm_tasks, name, fake)

    asyncio.run(llm_tasks.summarize(None, Summaries(), {"uuid": "j1"}, {}))

    assert Summaries.context == "Dados da chamada de j1"


def test_a_summary_does_not_fail_when_the_call_record_cannot_be_read(monkeypatch):
    # pylint: disable=import-outside-toplevel
    from repositories import call_record_repository

    class Broken:
        async def summary(self, job_uuid):
            raise ConnectionError("database down")

    monkeypatch.setattr(call_record_repository, "CallRecordRepository", Broken)
    assert asyncio.run(call_record_repository.summary_context("j1")) is None
