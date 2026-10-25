"""Transcribe a media file with faster-whisper: word-level timings, fillers kept (ums, ahs), JSON out.

Usage:
  transcribe.py INPUT --out OUT.json [--model base] [--language en]
  transcribe.py --download-only [--model base]
Progress goes to stderr as "PROGRESS <0-1>" lines.
"""
import argparse
import json
import os
import sys

# Nudges Whisper to write disfluencies instead of silently cleaning them up, which is what "cut the ums" needs.
FILLER_PROMPT = "Umm, let me think, like, hmm... Okay, uh, here's what I'm, you know, thinking."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--model", default="base")
    ap.add_argument("--language")
    ap.add_argument("--download-only", action="store_true")
    a = ap.parse_args()

    from faster_whisper import WhisperModel

    # Gentle on the machine: a few threads, int8 on CPU. One transcription runs at a time (AgentShot queues them).
    threads = max(1, min(4, (os.cpu_count() or 4) // 2))
    model = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=threads)
    if a.download_only:
        print("model ready", file=sys.stderr)
        return

    segments, info = model.transcribe(
        a.input,
        language=a.language,
        word_timestamps=True,
        initial_prompt=FILLER_PROMPT,
        condition_on_previous_text=False,
        vad_filter=False,
    )
    out = {"language": info.language, "duration": info.duration, "segments": []}
    for seg in segments:
        out["segments"].append({
            "s": round(seg.start, 3),
            "e": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)} for w in (seg.words or [])],
        })
        if info.duration:
            print(f"PROGRESS {min(1.0, seg.end / info.duration):.3f}", file=sys.stderr, flush=True)

    with open(a.out, "w") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
