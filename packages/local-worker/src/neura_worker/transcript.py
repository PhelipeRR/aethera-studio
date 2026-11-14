"""Rolling transcript windows. Everything here is extractive: no text is rewritten or interpreted."""

import re

from .language import UNDETERMINED, detect_language

_MARKER = re.compile(r"^[\[(<{][^\])>}]*[\])>}]$")
_FILLERS = frozenset("ah ahn eh er erm hm hmm hum uh uhm um é".split())
_WORD = re.compile(r"\w+")
_QUESTION_STARTS = frozenset(
    "who what when where why how can could would should do does did is are will "
    "quem qual quais quando onde como pode poderia podemos você "
    "quién cuál cuándo dónde cómo puedes podría".split()
)
MAX_SPEAKERS = 20
MAX_QUESTIONS = 10


def _normalized(text):
    return " ".join(_WORD.findall(text.casefold()))


def _is_silence(text):
    stripped = text.strip()
    if not stripped or _MARKER.match(stripped):
        return True
    words = _normalized(stripped).split()
    return all(word in _FILLERS for word in words)


def _is_question(text):
    stripped = text.strip()
    if stripped.endswith("?"):
        return True
    words = _normalized(stripped).split()
    return len(words) >= 3 and words[0] in _QUESTION_STARTS


def filter_transcript(segments, max_chars, window_ms, check):
    dropped = {"silence": 0, "duplicate": 0, "overflow": 0}
    kept = []
    last_by_speaker = {}
    for segment in segments:
        check()
        text = segment["text"].strip()
        if _is_silence(text):
            dropped["silence"] += 1
            continue
        current = _normalized(text)
        previous = last_by_speaker.get(segment["speaker"])
        previous_text = _normalized(previous["text"]) if previous else ""
        if previous and (current == previous_text or previous_text.startswith(current + " ")):
            dropped["duplicate"] += 1
            continue
        if previous and current.startswith(previous_text + " "):
            # Speech recognizers repeat a growing partial: the longer one replaces it where it stood.
            dropped["duplicate"] += 1
            previous.update(id=segment["id"], text=text, endMs=max(previous["endMs"], segment["endMs"]))
            continue
        entry = {**segment, "text": text}
        kept.append(entry)
        last_by_speaker[segment["speaker"]] = entry

    latest = max((segment["endMs"] for segment in kept), default=0)
    recent = [segment for segment in kept if segment["endMs"] >= latest - window_ms]
    dropped["overflow"] += len(kept) - len(recent)

    selected = []
    used = 0
    for segment in reversed(recent):
        check()
        room = max_chars - used
        length = len(segment["text"])
        if length > room:
            if selected:
                break
            # The newest segment always survives, clipped to its end, where the question usually is.
            segment = {**segment, "text": segment["text"][-room:].strip()}
            length = len(segment["text"])
        selected.append(segment)
        used += length
    selected.reverse()
    dropped["overflow"] += len(recent) - len(selected)
    return {"segments": selected, "dropped": dropped, "inputChars": sum(len(item["text"]) for item in segments), "outputChars": used}


def summarize_window(segments, max_recent, check):
    weights = {}
    weighted_confidence = 0.0
    weight_total = 0
    speakers = []
    questions = []
    lines = []
    for segment in segments:
        check()
        text = segment["text"].strip()
        if not text:
            continue
        detection = detect_language(text)
        if detection["language"] != UNDETERMINED and not detection["mixed"]:
            weights[detection["language"]] = weights.get(detection["language"], 0) + len(text)
            weighted_confidence += detection["confidence"] * len(text)
            weight_total += len(text)
        speaker = segment["speaker"]
        if speaker and speaker not in speakers and len(speakers) < MAX_SPEAKERS:
            speakers.append(speaker)
        if _is_question(text):
            questions.append(text)
        lines.append(f"{speaker}: {text}" if speaker else text)
    language = min(weights, key=lambda name: (-weights[name], name)) if weights else None
    confidence = round(weights[language] / weight_total * weighted_confidence / weight_total, 4) if language else 0.0
    recent = lines[-max_recent:]
    questions = questions[-MAX_QUESTIONS:]
    return {
        "meetingLanguage": language,
        "languageConfidence": confidence,
        "speakers": speakers,
        "questions": questions,
        "recent": recent,
        "inputChars": sum(len(item["text"]) for item in segments),
        "outputChars": sum(len(item) for item in recent) + sum(len(item) for item in questions),
    }
