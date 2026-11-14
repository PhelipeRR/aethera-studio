import unittest

from neura_worker.language import detect_language


class LanguageTests(unittest.TestCase):
    def test_english(self):
        result = detect_language("Could you share the timeline with the team?")
        self.assertEqual(result["language"], "en")
        self.assertGreaterEqual(result["confidence"], 0.75)
        self.assertFalse(result["needsModel"])

    def test_portuguese(self):
        result = detect_language("Você pode me passar o prazo do projeto até amanhã?")
        self.assertEqual(result["language"], "pt")
        self.assertGreaterEqual(result["confidence"], 0.75)

    def test_spanish(self):
        self.assertEqual(detect_language("¿Puedes enviarme el informe para mañana, por favor?")["language"], "es")

    def test_short_text_is_undetermined_and_left_to_the_model(self):
        for text in ("ok", "Sure", "123 456", "..."):
            result = detect_language(text)
            self.assertEqual(result["language"], "und", text)
            self.assertLess(result["confidence"], 0.5)
            self.assertTrue(result["needsModel"])

    def test_mixed_text_is_flagged_with_low_confidence(self):
        result = detect_language("Então the deadline is amanhã, mas we should talk with você")
        self.assertTrue(result["mixed"])
        self.assertTrue(result["needsModel"])
        self.assertLess(result["confidence"], 0.75)

    def test_words_shared_between_languages_are_not_evidence(self):
        self.assertNotEqual(detect_language("As we discussed, do me a favor, no problem")["language"], "pt")
        self.assertFalse(detect_language("Can you send me the report by tomorrow?")["mixed"])

    def test_is_deterministic(self):
        text = "Precisamos revisar the numbers antes da reunião"
        self.assertEqual(detect_language(text), detect_language(text))


if __name__ == "__main__":
    unittest.main()
