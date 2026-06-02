#!/usr/bin/env python3
"""
Qwen3-ASR transcription with real chunk-by-chunk progress.

This version uses the official Qwen3ASRModel for transcription
but splits the audio ourselves so we can show live progress.
"""

import argparse
import time
from pathlib import Path
from typing import List, Tuple

import librosa
import numpy as np
from tqdm import tqdm

from qwen_asr import Qwen3ASRModel
from qwen_asr.inference.utils import SAMPLE_RATE, MAX_ASR_INPUT_SECONDS


def load_audio(audio_path: Path) -> np.ndarray:
    print(f"Loading audio: {audio_path}")
    audio, _ = librosa.load(str(audio_path), sr=SAMPLE_RATE, mono=True)
    duration_min = len(audio) / SAMPLE_RATE / 60
    print(f"  Loaded {duration_min:.2f} minutes of audio")
    return audio


def split_into_chunks(audio: np.ndarray, chunk_seconds: int) -> List[Tuple[np.ndarray, float, float]]:
    """
    Split audio into chunks.
    Returns list of (chunk_audio, start_sec, end_sec)
    """
    chunk_samples = int(chunk_seconds * SAMPLE_RATE)
    chunks = []
    for start in range(0, len(audio), chunk_samples):
        end = min(start + chunk_samples, len(audio))
        if (end - start) < int(1.0 * SAMPLE_RATE):
            continue
        chunk = audio[start:end]
        chunks.append((chunk, start / SAMPLE_RATE, end / SAMPLE_RATE))
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=str, help="Path to audio file")
    parser.add_argument("--output", "-o", type=str, required=True, help="Output text file")
    parser.add_argument("--model", "-m", type=str, default="Qwen/Qwen3-ASR-1.7B")
    parser.add_argument("--chunk-seconds", type=int, default=300,
                        help="Chunk size in seconds (smaller = more frequent updates)")
    parser.add_argument("--language", type=str, default=None)
    args = parser.parse_args()

    audio_path = Path(args.audio).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio not found: {audio_path}")

    # Load model using the official high-level wrapper
    print(f"Loading model: {args.model}")
    model = Qwen3ASRModel.from_pretrained(args.model)

    # Load + split audio
    audio = load_audio(audio_path)
    chunks = split_into_chunks(audio, args.chunk_seconds)
    total_duration = len(audio) / SAMPLE_RATE

    print(f"\nAudio will be processed in {len(chunks)} chunks of ~{args.chunk_seconds}s")
    print("Starting transcription with live progress...\n")

    full_text_parts: List[str] = []
    start_time = time.time()

    for i, (chunk_audio, start_sec, end_sec) in enumerate(tqdm(chunks, desc="Chunks", unit="chunk")):
        progress = ((end_sec) / total_duration) * 100
        elapsed = time.time() - start_time

        print(f"\n[{i+1}/{len(chunks)}] {progress:5.1f}% | "
              f"{start_sec/60:5.1f}–{end_sec/60:.1f} min | Elapsed: {elapsed/60:.1f} min")

        # Transcribe just this chunk using the official model
        results = model.transcribe(
            audio=(chunk_audio, SAMPLE_RATE),
            language=args.language,
            return_time_stamps=False
        )

        chunk_text = results[0].text.strip()
        full_text_parts.append(chunk_text)

        preview = chunk_text[:120] + "..." if len(chunk_text) > 120 else chunk_text
        print(f"    → {preview}")

    full_text = "\n".join(full_text_parts).strip()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(full_text, encoding="utf-8")

    total_time = time.time() - start_time
    print(f"\n✅ Done!")
    print(f"Saved to: {output_path}")
    print(f"Total characters: {len(full_text)}")
    print(f"Total time: {total_time/60:.1f} minutes")


if __name__ == "__main__":
    main()
