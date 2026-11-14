"""Compares what the model would read with and without the worker, through the real subprocess protocol.

The meeting is synthetic but shaped like speech-to-text output: growing partials, silence markers and fillers.
Tokens are estimated as characters / 4, so read the ratios, not the absolute numbers.

    PYTHONPATH=packages/local-worker/src python -B packages/local-worker/benchmarks/meeting_window.py
"""

import json
import os
import statistics
import subprocess
import sys
import time

MAX_CHARS = 12_000
WINDOW_MS = 10 * 60_000
MAX_RECENT = 12
RUNS = 20

TOPICS = [
    ("Dana", "We should review the budget for this quarter before the board meeting"),
    ("Ravi", "The team is waiting for the numbers from finance and they said it will be ready on Tuesday"),
    ("Dana", "I think we can move the launch if the integration tests are not stable by then"),
    ("Mei", "The vendor sent the contract and we have to answer them about the renewal terms"),
    ("Ravi", "There is a risk with the migration because the old system does not export the audit data"),
]
QUESTION = "Could you share the timeline for the migration with the team?"


def meeting(minutes):
    segments = []
    clock = 0

    def add(speaker, text, duration=4_000):
        nonlocal clock
        segments.append({"id": f"s{len(segments)}", "speaker": speaker, "text": text, "startMs": clock, "endMs": clock + duration})
        clock += duration

    while clock < minutes * 60_000 and len(segments) < 480:
        for speaker, sentence in TOPICS:
            words = sentence.split()
            add(speaker, " ".join(words[: len(words) // 2]), 1_500)
            add(speaker, " ".join(words[: len(words) * 3 // 4]), 1_500)
            add(speaker, sentence)
            add(speaker, sentence + ".", 1_000)
            add(speaker, "[silence]", 2_000)
            add(speaker, "hum...", 1_000)
    add("Ravi", QUESTION)
    return segments


def model_path_chars(segments):
    """What the suggestion engine sends when the worker is unavailable: the newest lines, unfiltered."""
    return sum(len(f"{item['speaker']}: {item['text']}") for item in segments[-MAX_RECENT:])


class Client:
    def __init__(self):
        self.process = subprocess.Popen([sys.executable, "-B", "-m", "neura_worker"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env={**os.environ, "PYTHONUTF8": "1"})
        self.count = 0

    def call(self, op, payload):
        self.count += 1
        self.process.stdin.write(json.dumps({"v": 1, "id": str(self.count), "op": op, "payload": payload}).encode() + b"\n")
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        if not response["ok"]:
            raise RuntimeError(response["error"]["code"])
        return response["result"]

    def close(self):
        self.process.stdin.close()
        self.process.wait(5)


def run(segments, client):
    started = time.perf_counter()
    window = client.call("filter_transcript", {"segments": segments, "maxChars": MAX_CHARS, "windowMs": WINDOW_MS})
    context = client.call("summarize_window", {"segments": window["segments"], "maxRecent": MAX_RECENT})
    return (time.perf_counter() - started) * 1000, window, context


def main():
    started = time.perf_counter()
    client = Client()
    client.call("health", {})
    startup_ms = (time.perf_counter() - started) * 1000
    print(f"startup: {startup_ms:.0f} ms")
    print("minutes | segments | raw chars | model path | worker | vs raw | vs model path | p50 ms | max ms | question kept | language")
    for minutes in (5, 15, 30):
        segments = meeting(minutes)
        raw = sum(len(item["text"]) for item in segments)
        fallback = model_path_chars(segments)
        timings = []
        for _ in range(RUNS):
            elapsed, window, context = run(segments, client)
            timings.append(elapsed)
        kept = QUESTION in context["questions"] and context["recent"][-1].endswith(QUESTION)
        chars = context["outputChars"]
        print(f"{minutes:7} | {len(segments):8} | {raw:9} | {fallback:10} | {chars:6} | {1 - chars / raw:6.1%} | {1 - chars / fallback:13.1%} | {statistics.median(timings):6.1f} | {max(timings):6.1f} | {str(kept):13} | {context['meetingLanguage']}")
    client.close()


if __name__ == "__main__":
    main()
