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
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--beam-size", type=int, choices=[1, 5], default=5)
    ap.add_argument("--device", choices=["auto", "cpu"], default="auto")
    ap.add_argument("--vad", action="store_true")
    a = ap.parse_args()

    from faster_whisper import WhisperModel

    threads = max(1, min(a.threads, os.cpu_count() or 4, 16))
    # CTranslate2 supports CUDA. AMD/Intel use the native Vulkan engine, Apple uses Metal.
    import ctranslate2
    gpu = False
    if a.device == "auto" and not a.download_only:
        try:
            gpu = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            pass
    if a.download_only:
        WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=threads)
        print("model ready", file=sys.stderr)
        return

    def transcribe(device):
        engine = WhisperModel(a.model, device=device, compute_type="float16" if device == "cuda" else "int8", cpu_threads=threads)
        print(f"BACKEND {device} threads={threads} beam={a.beam_size}", file=sys.stderr, flush=True)
        segments, info = engine.transcribe(
            a.input, language=a.language, word_timestamps=True, beam_size=a.beam_size,
            initial_prompt=FILLER_PROMPT, condition_on_previous_text=False,
            vad_filter=a.vad,
            # Low threshold and generous padding protect quiet syllables and fillers.
            vad_parameters={"threshold": 0.25, "min_silence_duration_ms": 2000, "speech_pad_ms": 600} if a.vad else None,
        )
        out = {"language": info.language, "duration": info.duration, "segments": []}
        for seg in segments:
            out["segments"].append({
                "s": round(seg.start, 3), "e": round(seg.end, 3), "text": seg.text.strip(),
                "words": [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)} for w in (seg.words or [])],
            })
            if info.duration:
                print(f"PROGRESS {min(1.0, seg.end / info.duration):.3f}", file=sys.stderr, flush=True)
        return out

    if gpu:
        try:
            out = transcribe("cuda")
        except Exception as e:
            # Includes deferred generator failures: retry the entire unpublished chunk.
            print(f"CUDA unavailable, retrying on CPU: {e}", file=sys.stderr, flush=True)
            out = transcribe("cpu")
    else:
        out = transcribe("cpu")

    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
