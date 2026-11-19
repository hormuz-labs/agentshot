"""Repeatable offline Base speed/word-timing comparison, using the installed faster-whisper.
Run with its Python: bench-transcription.py --output out/speech-benchmark.json.
References are fixture word timings; no network or configuration changes.
"""
import argparse
import concurrent.futures
import difflib
import json
import multiprocessing
from pathlib import Path
import re
import statistics
import time


def measure(options):
    from faster_whisper import WhisperModel
    threads, beam, vad, device, fixture = options
    start = time.monotonic()
    model = WhisperModel("base", device=device, compute_type="float16" if device == "cuda" else "int8", cpu_threads=threads)
    loaded = time.monotonic() - start
    reference = json.loads(Path(fixture).with_suffix(".reference.json").read_text()).get("words", [])
    start = time.monotonic()
    segs, info = model.transcribe(fixture, word_timestamps=True, beam_size=beam, condition_on_previous_text=False,
        initial_prompt="Umm, let me think, like, hmm... Okay, uh, here's what I'm, you know, thinking.", vad_filter=vad,
        vad_parameters={"threshold": 0.25, "min_silence_duration_ms": 2000, "speech_pad_ms": 600} if vad else None)
    words = [{"w": w.word.strip(), "s": w.start, "e": w.end} for s in segs for w in (s.words or [])]
    elapsed = time.monotonic() - start
    norm = lambda s: re.sub(r"[^\w]", "", s.lower())
    expected, actual = [norm(w["w"]) for w in reference], [norm(w["w"]) for w in words]
    matcher = difflib.SequenceMatcher(a=expected, b=actual, autojunk=False)
    deviations = [abs(reference[a+i]["s"] - words[b+i]["s"]) for a, b, n in matcher.get_matching_blocks() for i in range(n)]
    fillers = {"um", "uh", "umm", "hmm", "ah"}
    result = {"threads": threads, "beam": beam, "vad": vad, "device": device, "fixture": fixture,
        "loadSeconds": loaded, "seconds": elapsed, "audioSeconds": info.duration,
        "wordMatchRatio": matcher.ratio() if reference else None, "matchedWordStartMedianError": statistics.median(deviations) if deviations else None,
        "expectedFillers": [w for w in expected if w in fillers], "recognizedFillers": [w for w in actual if w in fillers], "words": words}
    print(json.dumps({k: v for k, v in result.items() if k != "words"}), flush=True)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="out/speech-benchmark.json")
    ap.add_argument("--repeat", type=int, default=2)
    args = ap.parse_args()
    fixtures = [str(p) for p in Path("test/fixtures/speech").glob("*.flac")]
    results = []
    for repeat in range(args.repeat):
        for threads, beam, vad in [(4, 5, False), (8, 5, False), (12, 5, False), (4, 1, False), (4, 5, True)]:
            for fixture in fixtures:
                result = measure((threads, beam, vad, "cpu", fixture))
                results.append({**result, "repeat": repeat})
                Path(args.output).parent.mkdir(parents=True, exist_ok=True)
                Path(args.output).write_text(json.dumps(results, indent=2))
        start = time.monotonic()
        # Never fork an already initialized OpenMP/CTranslate2 runtime (its locks can deadlock).
        with concurrent.futures.ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context("spawn")) as pool:
            batch = list(pool.map(measure, [(4, 5, False, "cpu", f) for f in fixtures]))
        results.append({"parallelWorkers": 2, "threadsPerWorker": 4, "wallSeconds": time.monotonic() - start,
            "audioSeconds": sum(r["audioSeconds"] for r in batch), "repeat": repeat})
        Path(args.output).write_text(json.dumps(results, indent=2))
