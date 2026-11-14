# Fase 45 — Fala da Neura por frases

**Status: PLANEJADA (2026-11-02).** Reduzida por decisão do usuário: o modo Live, o modelo local e o modo híbrido foram cancelados.

## Decisão

Claude e Codex continuam raciocinando, e a Neura só fala quando é chamada. O áudio já é gerado localmente pelo VoiceStudio, então um modelo local trocaria qualidade por pouco ou nenhum ganho. O único trecho a melhorar é a espera pelo áudio da resposta inteira.

## Escopo

Quando a resposta tiver mais de uma frase, o processo principal gera o áudio da primeira frase, a Neura toca, e as seguintes vêm em ordem. Resposta de uma frase segue igual, sem ganho esperado. O tempo do Claude ou do Codex não muda.

**Arquivos:** `apps/desktop/src/main/neura-speech.ts`, `apps/desktop/src/renderer/src/features/neura/useNeura.ts`, `apps/desktop/src/renderer/src/features/neura/useNeuraVoiceOutput.ts` e os testes correspondentes.

- [ ] Medir uma chamada real: tempo do agente, geração do áudio e início da fala. Se o áudio pesar pouco, encerrar a fase sem implementar.
- [ ] Dividir o texto em frases PT/EN, cobrindo abreviações e resposta sem pontuação.
- [ ] Tocar os segmentos em ordem, liberando cada áudio ao terminar.
- [ ] Uma nova chamada cancela a fila; falha em um segmento não desfaz a ação concluída e mantém a resposta em texto visível.
- [ ] Avisar `speechFinished` somente ao fim do último segmento, para a palavra de ativação reabrir no momento certo.
- [ ] Testar com fala real ou fakes, sem tons: eles podem rebaixar o Parakeet no VoiceStudio.
- [ ] Rodar typecheck, lint, Vitest sem paralelismo de arquivos, E2E da Neura e build.

**Fora do escopo:** resposta em áudio direto do agente, streaming palavra por palavra, modelo local, modo híbrido, conversa contínua, novo botão parar e instalador sem pedido do usuário.
