"""Newline-delimited JSON over stdio. Operations are a closed list: no message can name code to run.

Request:  {"v": 1, "id": "...", "op": "...", "payload": {...}, "deadlineMs": 1000}
Response: {"v": 1, "id": "...", "ok": true, "result": {...}}
          {"v": 1, "id": "..." | null, "ok": false, "error": {"code": "...", "message": "..."}}
"""

import base64
import binascii
import json
import threading
import time
from collections import deque

from . import __version__
from .audio import detect_speech
from .language import detect_language
from .transcript import filter_transcript, summarize_window

SCHEMA_VERSION = 1
MAX_LINE_BYTES = 1_048_576
MAX_QUEUE = 32
MAX_TEXT = 4_000
MAX_SEGMENTS = 500
MAX_DEADLINE_MS = 600_000
MAX_ID = 64


class ProtocolError(Exception):
    def __init__(self, code, message, request_id=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.request_id = request_id


def _payload_error(message):
    return ProtocolError("invalid_payload", message)


def _fields(payload, required, optional=()):
    keys = set(payload)
    if not set(required) <= keys or not keys <= set(required) | set(optional):
        raise _payload_error("unexpected or missing fields")


def _integer(value, low, high, name):
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise _payload_error(f"{name} is out of range")
    return value


def _text(value, name, maximum=MAX_TEXT):
    if not isinstance(value, str) or len(value) > maximum:
        raise _payload_error(f"{name} is invalid")
    return value


def _segments(value):
    if not isinstance(value, list) or len(value) > MAX_SEGMENTS:
        raise _payload_error("segments are invalid")
    for segment in value:
        if not isinstance(segment, dict):
            raise _payload_error("segment is invalid")
        _fields(segment, ("id", "speaker", "text", "startMs", "endMs"))
        if not _text(segment["id"], "segment id", MAX_ID):
            raise _payload_error("segment id is invalid")
        if segment["speaker"] is not None:
            _text(segment["speaker"], "speaker", 200)
        _text(segment["text"], "segment text")
        _integer(segment["startMs"], 0, 2**53 - 1, "startMs")
        _integer(segment["endMs"], 0, 2**53 - 1, "endMs")
    return value


def _op_health(_payload, _check):
    _fields(_payload, ())
    return {"status": "ok", "schemaVersion": SCHEMA_VERSION, "workerVersion": __version__, "operations": sorted(OPERATIONS)}


def _op_detect_language(payload, _check):
    _fields(payload, ("text",))
    return detect_language(_text(payload["text"], "text"))


def _op_filter_transcript(payload, check):
    _fields(payload, ("segments", "maxChars", "windowMs"))
    return filter_transcript(_segments(payload["segments"]), _integer(payload["maxChars"], 100, 100_000, "maxChars"), _integer(payload["windowMs"], 1_000, 14_400_000, "windowMs"), check)


def _op_summarize_window(payload, check):
    _fields(payload, ("segments", "maxRecent"))
    return summarize_window(_segments(payload["segments"]), _integer(payload["maxRecent"], 1, 40, "maxRecent"), check)


def _op_detect_speech(payload, check):
    _fields(payload, ("pcm16Base64", "sampleRate"))
    encoded = _text(payload["pcm16Base64"], "pcm16Base64", MAX_LINE_BYTES)
    try:
        pcm = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise _payload_error("pcm16Base64 is not base64") from error
    if len(pcm) % 2:
        raise _payload_error("pcm16Base64 has a partial sample")
    return detect_speech(pcm, _integer(payload["sampleRate"], 8_000, 48_000, "sampleRate"), check)


OPERATIONS = {
    "health": _op_health,
    "detect_language": _op_detect_language,
    "filter_transcript": _op_filter_transcript,
    "summarize_window": _op_summarize_window,
    "detect_speech": _op_detect_speech,
}


def _success(request_id, result):
    return {"v": SCHEMA_VERSION, "id": request_id, "ok": True, "result": result}


def _failure(request_id, code, message):
    return {"v": SCHEMA_VERSION, "id": request_id, "ok": False, "error": {"code": code, "message": message}}


def _parse(raw):
    if len(raw.rstrip(b"\r\n")) > MAX_LINE_BYTES:
        raise ProtocolError("too_large", "line exceeds the size limit")
    try:
        message = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError) as error:
        raise ProtocolError("malformed", "line is not JSON") from error
    if not isinstance(message, dict):
        raise ProtocolError("malformed", "message is not an object")
    request_id = message.get("id")
    if not isinstance(request_id, str) or not 0 < len(request_id) <= MAX_ID:
        raise ProtocolError("malformed", "id is invalid")
    if message.get("v") != SCHEMA_VERSION and "v" in message:
        raise ProtocolError("unsupported_version", "schema version is not supported", request_id)
    if not {"v", "id", "op", "payload"} <= set(message) or not set(message) <= {"v", "id", "op", "payload", "deadlineMs"}:
        raise ProtocolError("malformed", "unexpected or missing fields", request_id)
    if not isinstance(message["op"], str) or not isinstance(message["payload"], dict):
        raise ProtocolError("malformed", "op or payload is invalid", request_id)
    deadline = message.get("deadlineMs")
    if deadline is not None and (not isinstance(deadline, int) or isinstance(deadline, bool) or not 0 < deadline <= MAX_DEADLINE_MS):
        raise ProtocolError("malformed", "deadlineMs is invalid", request_id)
    return message


class Worker:
    """Requests queue here so that a `cancel` can overtake the operation it targets."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._queue = deque()
        self._cancelled = set()
        self._running = None
        self._lock = threading.Lock()
        self._ready = threading.Condition(self._lock)
        self.on_checkpoint = None

    def submit(self, raw):
        """Returns an immediate response, or None once the request is queued for `process_next`."""
        try:
            message = _parse(raw)
            if message["op"] == "cancel":
                return self._handle_cancel(message)
            if message["op"] not in OPERATIONS:
                raise ProtocolError("unknown_operation", "operation is not supported", message["id"])
        except ProtocolError as error:
            return _failure(error.request_id, error.code, error.message)
        budget = message.get("deadlineMs")
        with self._ready:
            if len(self._queue) >= MAX_QUEUE:
                return _failure(message["id"], "busy", "queue is full")
            self._queue.append((message, None if budget is None else self._clock() + budget / 1000))
            self._ready.notify()
        return None

    def _handle_cancel(self, message):
        payload = message["payload"]
        target = payload.get("targetId") if set(payload) == {"targetId"} else None
        if not isinstance(target, str):
            raise ProtocolError("invalid_payload", "targetId is invalid", message["id"])
        return _success(message["id"], {"cancelled": self.cancel(target)})

    def cancel(self, target):
        with self._lock:
            known = target == self._running or any(item[0]["id"] == target for item in self._queue)
            if known:
                self._cancelled.add(target)
            return known

    def pending(self):
        with self._lock:
            return bool(self._queue)

    def wait(self, stopping):
        with self._ready:
            while not self._queue and not stopping.is_set():
                self._ready.wait(0.05)
            return bool(self._queue)

    def process_next(self):
        with self._lock:
            message, deadline = self._queue.popleft()
            self._running = message["id"]
        request_id = message["id"]

        def check():
            if self.on_checkpoint:
                self.on_checkpoint()
            if request_id in self._cancelled:
                raise ProtocolError("cancelled", "request was cancelled")
            if deadline is not None and self._clock() > deadline:
                raise ProtocolError("timeout", "deadline exceeded")

        try:
            check()
            return _success(request_id, OPERATIONS[message["op"]](message["payload"], check))
        except ProtocolError as error:
            return _failure(request_id, error.code, error.message)
        except Exception:  # The exception text may quote the transcript, so it stays out of the response.
            return _failure(request_id, "internal", "operation failed")
        finally:
            with self._lock:
                self._running = None
                self._cancelled.discard(request_id)


def read_line(stream):
    """Reads one line without ever buffering more than the limit; a longer one is drained and comes back oversized."""
    line = stream.readline(MAX_LINE_BYTES + 2)
    if len(line) > MAX_LINE_BYTES and not line.endswith(b"\n"):
        rest = line
        while rest and not rest.endswith(b"\n"):
            rest = stream.readline(MAX_LINE_BYTES)
    return line


def serve(stdin, stdout):
    worker = Worker()
    stopping = threading.Event()
    write_lock = threading.Lock()

    def write(response):
        encoded = json.dumps(response, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii") + b"\n"
        with write_lock:
            stdout.write(encoded)
            stdout.flush()

    def process():
        while worker.wait(stopping):
            write(worker.process_next())

    processor = threading.Thread(target=process, daemon=True)
    processor.start()
    while True:
        line = read_line(stdin)
        if not line:
            break
        if not line.strip():
            continue
        response = worker.submit(line)
        if response is not None:
            write(response)
    # Closing stdin is how the parent says stop, so a dead app never leaves a worker behind.
    stopping.set()
    processor.join()
