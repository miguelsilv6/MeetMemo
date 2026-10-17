# Evaluating Transcription Reliability

`backend/scripts/evaluate_asr.py` measures how well MeetMemo transcribes and identifies the language of a set of recordings whose content you already know. Use it to:

- get a baseline before changing a model or a setting;
- compare `turbo` with `large-v3`, or one setting value with another;
- document the method's error rate on recordings like the ones you process. In a forensic context this is the validation you can show.

The script uses the same audio preprocessing, model, decoding settings and hallucination filter as the pipeline. By default it reads the settings saved in the admin panel.

## Preparing a benchmark folder

Put each recording next to two optional text files with the same name:

```
benchmark/
├── call-01.wav
├── call-01.txt     # what was said (reference transcript), UTF-8
├── call-01.lang    # the language spoken: an ISO 639-1 code, e.g. pt, ro, ar
├── call-02.mp3
├── call-02.txt
└── call-02.lang
```

- **Reference (`.txt`):** write it as plain text in reading order.
  - Case and punctuation are ignored when scoring.
  - Accents count: "e" and "é" are different words.
  - Without a reference, the file still gets a language check and timings.
- **Language (`.lang`):** the code Whisper would use, for example `pt` for European and Brazilian Portuguese alike.
  - Languages Whisper does not support, such as Cape Verdean or Guinean creole, can still be listed to see what they get detected as.
- **Size:** 10–20 recordings that resemble your real material (phone quality, accents, languages) say more than many clean ones.

## Running it

Run it inside the backend container, ideally while no transcription is running, since it uses the same CPU threads:

```bash
docker cp ./benchmark meetmemo-backend:/app/benchmark
docker exec meetmemo-backend python scripts/evaluate_asr.py /app/benchmark
docker cp meetmemo-backend:/app/benchmark/results ./results
```

### Options

| Option | Effect |
|---|---|
| `--model large-v3` | Use this Whisper model instead of the admin panel's |
| `--language pt` | Force a language (or `auto`) instead of the panel's default |
| `--defaults` | Ignore the panel settings saved in the database and use the defaults |
| `--out DIR` | Write the results to `DIR` (default `<folder>/results/<date-time>`) |

## Reading the results

Each run writes:

- **`report.md`**: the model, the settings, the software versions and the host, then one row per file:
  - duration, processing time and real-time factor (RTF: below 1 is faster than real time);
  - expected and detected language, with its probability;
  - WER and CER;
  - how many segments were flagged as low confidence or removed as hallucinations.
- **`results.csv`**: the same per-file data, for a spreadsheet or for comparing runs.
- **`transcripts/<name>.txt`**: what MeetMemo transcribed, to compare with the reference by hand.

### Metrics

- **WER** (word error rate) is the substitutions, insertions and deletions needed to turn the transcript into the reference, divided by the number of reference words.
- **CER** is the same measure on characters.
- The summary's WER and CER are corpus-wide: total errors over total reference words. Long recordings therefore weigh more than short ones.

To compare two configurations, run the script twice on the same folder, for example with `--model turbo` and then `--model large-v3`, and compare the two reports.
