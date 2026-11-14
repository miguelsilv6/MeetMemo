"""
NVIDIA Nemotron 3 Diarization, run through Transformers.

Unlike the pyannote pipelines (several models and a clustering step), this is
one end-to-end model: it gives, for every 10 ms of audio, the probability that
each of up to 8 speakers (ordered by when they first speak) is talking, so
overlapping speech comes out as overlapping segments. It has no setting for
the number of speakers: the number given at upload is not used.

torch and transformers are imported when the model is loaded, so the server
starts (and uses pyannote) without them being touched.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Speaker channels of the model.
MAX_SPEAKERS = 8


class NemotronDiarizer:
    """A loaded Nemotron 3 Diarization model: audio in, speaker turns out."""

    def __init__(self, processor: Any, model: Any):
        self.processor = processor
        self.model = model

    @classmethod
    def load(cls, model_name: str, token: str | None, device: Any) -> "NemotronDiarizer":
        """Download (the first time) and load the model on ``device``. Blocking."""
        # pylint: disable=import-outside-toplevel
        from transformers import AutoModelForAudioFrameClassification, AutoProcessor

        processor = AutoProcessor.from_pretrained(model_name, token=token or None)
        model = AutoModelForAudioFrameClassification.from_pretrained(
            model_name, token=token or None
        )
        return cls(processor, model.to(device).eval())

    def diarize(self, waveform: Any, sample_rate: int) -> list[tuple[float, float, str]]:
        """
        Who speaks when in ``waveform`` (channels x samples, as torchaudio loads
        it): a list of (start, end, speaker) in seconds, by start time. Blocking.
        """
        # pylint: disable=import-outside-toplevel
        import torch
        import torchaudio

        wanted = self.processor.feature_extractor.sampling_rate
        audio = waveform.mean(dim=0) if waveform.ndim > 1 else waveform  # mono
        if sample_rate != wanted:
            audio = torchaudio.functional.resample(audio, sample_rate, wanted)
        inputs = self.processor(audio.cpu().numpy(), sampling_rate=wanted)
        inputs = inputs.to(self.model.device, dtype=self.model.dtype)
        with torch.inference_mode():
            logits = self.model(**inputs).logits  # (1, frames, 8), a frame per 10 ms
        found = self.processor.extract_speaker_dict(logits, inputs.attention_mask)[0]
        turns = [
            (float(turn["Start"]), float(turn["End"]), f"SPEAKER_{int(turn['Speaker']):02d}")
            for turn in found
        ]
        logger.info("Nemotron 3 Diarization found %d turns", len(turns))
        return sorted(turns)
