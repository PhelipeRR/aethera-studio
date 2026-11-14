"""Word-list language detection. It reports doubt instead of guessing, because a doubtful answer goes to the model."""

import re
import unicodedata

UNDETERMINED = "und"
MIN_CONFIDENCE = 0.4
TRUSTED_CONFIDENCE = 0.6
MIXED_RATIO = 0.4

# Only words that tell the languages apart: "para", "por" or "a" would add noise, not evidence.
_WORDS = {
    "en": frozenset("the and you your we our they this that with have has had will would could should can what when where why how who is are was were do does did not for from of to it in on at".split()),
    "es": frozenset("el los las una unos del lo puedes puede usted nosotros ustedes está están pero porque cuando dónde cómo qué quién también muy hoy ayer tengo tiene hacer necesito gracias".split()),
    "pt": frozenset("o os as um uma do da dos das no na nos nas você vocês nós eles elas é são foi está estão mas então porque quando onde como quem também muito hoje ontem tenho tem fazer preciso obrigado obrigada pode posso até com sim não me".split()),
}
# Everyday words in another language too. Shared lists overlap as well, so distinct words are derived, not trusted.
_FALSE_FRIENDS = frozenset("as do me no um".split())
_WORDS = {
    language: frozenset(word for word in words if word not in _FALSE_FRIENDS and sum(word in other for other in _WORDS.values()) == 1)
    for language, words in _WORDS.items()
}
_MARKS = {"es": "ñ¿¡", "pt": "ãõç"}
_TOKEN = re.compile(r"[^\W\d_]+")


def _hits(text):
    tokens = _TOKEN.findall(text)
    hits = {language: sum(token in words for token in tokens) for language, words in _WORDS.items()}
    for language, marks in _MARKS.items():
        hits[language] += sum(any(mark in token for mark in marks) for token in text.split())
    return hits


def detect_language(text):
    hits = _hits(unicodedata.normalize("NFC", text).casefold())
    total = sum(hits.values())
    if total == 0:
        return {"language": UNDETERMINED, "confidence": 0.0, "mixed": False, "needsModel": True, "scores": []}
    ranked = sorted(hits.items(), key=lambda item: (-item[1], item[0]))
    (top, top_hits), (_, second_hits) = ranked[0], ranked[1]
    share = top_hits / total
    confidence = round(min(share * min(total / 4, 1), 0.99), 4)
    mixed = second_hits >= 2 and second_hits / top_hits >= MIXED_RATIO
    language = top if confidence >= MIN_CONFIDENCE else UNDETERMINED
    return {
        "language": language,
        "confidence": confidence,
        "mixed": mixed,
        "needsModel": language == UNDETERMINED or mixed or confidence < TRUSTED_CONFIDENCE,
        "scores": [{"language": name, "score": round(count / total, 4)} for name, count in ranked if count],
    }
