# Direção de Comédia e Entretenimento (`CINEMA-10`)

- **Perfil padrão:** `cinematic_subtle_humor` (`Cinematográfico com humor pontual`), `humorIntensity = 35`, `maxBeatsPerMinute = 2.5`.
- **Subordinação:** o humor é subordinado ao `CreativeBrief` e `NarrativeDirector` — nunca inventa fatos nem sobrepõe cenas sensíveis (`tragedy`, `grief`, `sensitive_disclosure`, `critical_instruction`, `climax`).
- **Controle 0–100:** `0%` desativa completamente e remove edições cômicas; `sceneOverrides` permite ajuste por cena.
- **Reversibilidade:** cada beat inclui `fallbackWithoutHumor` e `pauseFrames` determinístico.
