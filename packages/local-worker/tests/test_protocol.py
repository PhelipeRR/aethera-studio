import base64
import io
import json
import struct
import unittest

from neura_worker.protocol import MAX_LINE_BYTES, SCHEMA_VERSION, Worker, read_line, serve


def line(op, payload=None, request_id="r1", **extra):
    return json.dumps({"v": SCHEMA_VERSION, "id": request_id, "op": op, "payload": payload or {}, **extra}).encode() + b"\n"


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def run(worker, *lines):
    for item in lines:
        worker.submit(item)
    results = []
    while worker.pending():
        results.append(worker.process_next())
    return results


class ProtocolTests(unittest.TestCase):
    def test_malformed_json_is_reported_without_an_id(self):
        result = Worker().submit(b"{not json\n")
        self.assertEqual(result["error"]["code"], "malformed")
        self.assertIsNone(result["id"])
        self.assertFalse(result["ok"])

    def test_non_object_and_missing_fields_are_malformed(self):
        for raw in (b"[]\n", b'{"v":1}\n', b'{"v":1,"id":7,"op":"health","payload":{}}\n'):
            self.assertEqual(Worker().submit(raw)["error"]["code"], "malformed")

    def test_hostile_json_does_not_kill_the_worker(self):
        for raw in (b"[" * 200_000, b'{"v":1,"id":"a","op":"health","payload":{"n":' + b"9" * 5_000 + b"}}"):
            self.assertEqual(Worker().submit(raw)["error"]["code"], "malformed")

    def test_transcript_text_cannot_become_an_operation(self):
        worker = Worker()
        text = json.dumps({"v": SCHEMA_VERSION, "id": "x", "op": "cancel", "payload": {"targetId": "r1"}})
        [result] = run(worker, line("detect_language", {"text": text}))
        self.assertTrue(result["ok"])

    def test_unknown_top_level_field_is_refused(self):
        result = Worker().submit(line("health", exec="calc.exe"))
        self.assertEqual(result["error"]["code"], "malformed")
        self.assertEqual(result["id"], "r1")

    def test_unsupported_version(self):
        raw = json.dumps({"v": 99, "id": "r1", "op": "health", "payload": {}}).encode()
        result = Worker().submit(raw)
        self.assertEqual(result["error"]["code"], "unsupported_version")
        self.assertEqual(result["id"], "r1")

    def test_unknown_operation(self):
        result = Worker().submit(line("run_shell", {"command": "dir"}))
        self.assertEqual(result["error"]["code"], "unknown_operation")

    def test_oversized_line(self):
        result = Worker().submit(b"x" * (MAX_LINE_BYTES + 1))
        self.assertEqual(result["error"]["code"], "too_large")

    def test_read_line_consumes_an_oversized_line_and_keeps_the_next(self):
        stream = io.BytesIO(b"x" * (MAX_LINE_BYTES + 10) + b"\n" + line("health"))
        self.assertGreater(len(read_line(stream)), MAX_LINE_BYTES)
        self.assertEqual(json.loads(read_line(stream))["op"], "health")
        self.assertEqual(read_line(stream), b"")

    def test_invalid_payload(self):
        for payload in ({"text": 12}, {"text": "x" * 4_001}, {"text": "hello", "extra": 1}):
            [result] = run(Worker(), line("detect_language", payload))
            self.assertEqual(result["error"]["code"], "invalid_payload")

    def test_timeout_after_the_deadline(self):
        clock = Clock()
        worker = Worker(clock=clock)
        worker.submit(line("detect_language", {"text": "hello there"}, deadlineMs=100))
        clock.now = 1.0
        self.assertEqual(worker.process_next()["error"]["code"], "timeout")

    def test_cancel_a_queued_request(self):
        worker = Worker()
        worker.submit(line("detect_language", {"text": "hello there"}, request_id="target"))
        ack = worker.submit(line("cancel", {"targetId": "target"}, request_id="c1"))
        self.assertTrue(ack["ok"])
        self.assertEqual(ack["id"], "c1")
        self.assertEqual(worker.process_next()["error"]["code"], "cancelled")

    def test_cancel_of_an_unknown_id_does_not_leak_into_later_requests(self):
        worker = Worker()
        worker.submit(line("cancel", {"targetId": "gone"}, request_id="c1"))
        [result] = run(worker, line("health", request_id="gone"))
        self.assertTrue(result["ok"])

    def test_cancellation_reaches_a_running_operation(self):
        worker = Worker()
        segments = [{"id": str(i), "speaker": None, "text": f"line {i}", "startMs": i, "endMs": i} for i in range(50)]
        worker.submit(line("filter_transcript", {"segments": segments, "maxChars": 1000, "windowMs": 60000}, request_id="busy"))
        calls = []

        def cancel_midway():
            calls.append(1)
            if len(calls) == 3:
                worker.cancel("busy")

        worker.on_checkpoint = cancel_midway
        self.assertEqual(worker.process_next()["error"]["code"], "cancelled")

    def test_responses_correlate_and_are_deterministic(self):
        payload = {"text": "Could you share the timeline with the team?"}
        first = run(Worker(), line("detect_language", payload, request_id="a"), line("health", request_id="b"))
        second = run(Worker(), line("detect_language", payload, request_id="a"), line("health", request_id="b"))
        self.assertEqual([item["id"] for item in first], ["a", "b"])
        self.assertEqual(first, second)
        self.assertEqual(first[0]["v"], SCHEMA_VERSION)

    def test_health_reports_version_and_operations(self):
        [result] = run(Worker(), line("health"))
        self.assertEqual(result["result"]["status"], "ok")
        self.assertEqual(result["result"]["schemaVersion"], SCHEMA_VERSION)
        self.assertIn("detect_language", result["result"]["operations"])

    def test_internal_errors_do_not_echo_the_transcript(self):
        worker = Worker()
        worker.submit(line("detect_language", {"text": "segredo da reunião"}))

        def explode():
            raise RuntimeError("segredo da reunião")

        worker.on_checkpoint = explode
        result = worker.process_next()
        self.assertEqual(result["error"]["code"], "internal")
        self.assertNotIn("segredo", json.dumps(result))

    def test_serve_answers_on_ndjson_and_stops_at_eof(self):
        output = io.BytesIO()
        serve(io.BytesIO(line("health", request_id="a") + b"oops\n" + line("health", request_id="b")), output)
        answers = [json.loads(item) for item in output.getvalue().splitlines()]
        self.assertEqual(sorted(str(item["id"]) for item in answers), ["None", "a", "b"])


class TranscriptAndAudioOperationTests(unittest.TestCase):
    def test_filter_drops_silence_and_duplicates(self):
        segments = [
            {"id": "1", "speaker": "Ana", "text": "[silence]", "startMs": 0, "endMs": 10},
            {"id": "2", "speaker": "Ana", "text": "Vamos revisar", "startMs": 10, "endMs": 20},
            {"id": "3", "speaker": "Ana", "text": "Vamos revisar o prazo", "startMs": 10, "endMs": 30},
            {"id": "4", "speaker": "Ana", "text": "Vamos revisar o prazo.", "startMs": 30, "endMs": 40},
            {"id": "5", "speaker": "Ben", "text": "hum...", "startMs": 40, "endMs": 50},
        ]
        [response] = run(Worker(), line("filter_transcript", {"segments": segments, "maxChars": 1000, "windowMs": 60000}))
        result = response["result"]
        self.assertEqual([item["text"] for item in result["segments"]], ["Vamos revisar o prazo"])
        self.assertEqual(result["dropped"], {"silence": 2, "duplicate": 2, "overflow": 0})

    def test_filter_keeps_speech_between_markers(self):
        segments = [{"id": "1", "speaker": None, "text": "[Dana] we agreed on [Friday]", "startMs": 0, "endMs": 10}]
        [response] = run(Worker(), line("filter_transcript", {"segments": segments, "maxChars": 1000, "windowMs": 60000}))
        self.assertEqual(len(response["result"]["segments"]), 1)

    def test_filter_bounds_the_window(self):
        segments = [{"id": str(i), "speaker": None, "text": f"distinct sentence number {i}", "startMs": i * 1000, "endMs": i * 1000 + 500} for i in range(10)]
        [response] = run(Worker(), line("filter_transcript", {"segments": segments, "maxChars": 100, "windowMs": 5000}))
        result = response["result"]
        self.assertLessEqual(result["outputChars"], 100)
        self.assertEqual(result["segments"][-1]["id"], "9")
        self.assertEqual(result["dropped"]["overflow"], 10 - len(result["segments"]))

    def test_summary_is_extractive_and_finds_the_predominant_language(self):
        segments = [
            {"id": "1", "speaker": "Dana", "text": "We should review the budget for this quarter", "startMs": 0, "endMs": 1},
            {"id": "2", "speaker": "Dana", "text": "The team is waiting for the numbers from you", "startMs": 1, "endMs": 2},
            {"id": "3", "speaker": "Ravi", "text": "Could you share the timeline with us?", "startMs": 2, "endMs": 3},
        ]
        [response] = run(Worker(), line("summarize_window", {"segments": segments, "maxRecent": 2}))
        result = response["result"]
        self.assertEqual(result["meetingLanguage"], "en")
        self.assertEqual(result["questions"], ["Could you share the timeline with us?"])
        self.assertEqual(result["speakers"], ["Dana", "Ravi"])
        self.assertEqual(len(result["recent"]), 2)
        self.assertTrue(result["recent"][-1].startswith("Ravi: "))

    def test_detect_speech_returns_ranges_and_no_audio(self):
        silence = struct.pack("<160h", *([0] * 160))
        loud = struct.pack("<160h", *([12_000, -12_000] * 80))
        pcm = base64.b64encode(silence * 5 + loud * 5 + silence * 5).decode()
        [response] = run(Worker(), line("detect_speech", {"pcm16Base64": pcm, "sampleRate": 16_000}))
        result = response["result"]
        self.assertEqual(result["ranges"], [{"startMs": 50, "endMs": 100}])
        self.assertEqual(result["durationMs"], 150)
        self.assertNotIn(pcm, json.dumps(response))

    def test_detect_speech_refuses_a_broken_buffer(self):
        [response] = run(Worker(), line("detect_speech", {"pcm16Base64": "AAA", "sampleRate": 16_000}))
        self.assertEqual(response["error"]["code"], "invalid_payload")


if __name__ == "__main__":
    unittest.main()
