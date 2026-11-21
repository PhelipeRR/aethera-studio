# Aethera Recap — Relatório de Correções Críticas

**Data:** 2026-11-21  
**Escopo:** Pipeline de produção do Recap (vídeo narrado com Motion Velix)  
**Status:** Correções estruturais aplicadas e compiladas com sucesso

---

## 1. Causa Raiz de Cada Problema

### Vídeo excessivamente acelerado (~22s para conteúdo de 3 min)
O handler IPC `recap:start-production` em `aethera-ipc.ts` não passava nenhum `ttsPort` ao orquestrador. Sem provedor TTS real, o renderer usava o fallback determinístico (`createDeterministicFallbackTtsPort`) que gera tons sintéticos de ~800ms por cena. Com 24 cenas, a timeline total ficava em ~22 segundos. O planner visual (`buildRecapAudiovisualPlan`) já estava correto — ele estende a timeline conforme a narração medida via `buildAudioFirstDurationAudit` — mas recebia durações artificiais do fallback.

### Narração ausente
Mesma causa raiz acima: sem `ttsPort` configurado, o fallback gerava WAVs com tom de 220 Hz em vez de fala real. Além disso, o renderer capturava erros de TTS e aplicava fallback silenciosamente dentro do loop, sem jamais interromper a renderização. Não havia validação pós-síntese de integridade do áudio gerado.

### Som de fundo estranho
No bloco de mixagem FFmpeg do `recap-mp4-renderer.ts`, quando nenhum `musicBedPath` era fornecido, o sistema gerava um tom sintético contínuo de 110 Hz (`sine=frequency=110:sample_rate=44100`) como trilha de fundo. Esse tom era mixado com a narração via sidechain compress, produzindo o artefato sonoro relatado. Adicionalmente, toda a cadeia de mixagem operava em 44.1 kHz em vez dos 48 kHz padrão profissional.

### Motion Velix não utilizado
O handler IPC não resolvia nem passava o `sfxAssetsDir` ao orquestrador. Embora a função `localMotionVelixAudioAssets()` existisse em `cinema-pipeline.ts` (para o modo Cinema), o fluxo do Recap nunca a invocava. O renderer tinha suporte completo a SFX via `resolveMotionVelixSfxFile` e filtros FFmpeg de delay/gain, mas recebia `undefined` como diretório de assets, fazendo com que zero SFX fossem aplicados.

### Composição visual inconsistente
Consequência direta da timeline comprimida: com ~22 segundos para 24 cenas, cada shot durava menos de 1 segundo, tornando os movimentos de câmera (Ken Burns, pan, zoom) imperceptíveis ou distorcidos. O filtro `buildShotZoompanFilter` já preservava proporções originais com `force_original_aspect_ratio=decrease` e padding escuro — a lógica de composição estava correta, mas operava sobre durações incompatíveis com animações visuais significativas.

---

## 2. Arquivos Modificados

| Arquivo | Alteração |
|---------|-----------|
| `apps/aethera-desktop/src/main/aethera-ipc.ts` | Adicionado import de `homedir`, adaptadores TTS (`createChainedRecapTtsPort`, `createElevenLabsRecapTtsPort`, `createVoiceStudioRecapTtsPort`, `createWindowsSapiRecapTtsPort`, `auditNarrationAudioClip`) e tipos. Inserido bloco de construção do `ttsPort` encadeado com `allowDeterministicFallback: false` e resolução do `sfxAssetsDir` do Motion Velix antes da chamada ao orquestrador. |
| `packages/cinema/src/recap/phase3/recap-mp4-renderer.ts` | Adicionado import de `auditNarrationAudioClip`. Substituído loop de síntese TTS com validação obrigatória de integridade pós-síntese e bloqueio explícito quando TTS real falha. Substituído fallback de música sintética (110 Hz) por silêncio puro (`anullsrc`). Padronizado sample rate de toda a cadeia de mixagem para 48 kHz (narração, música, SFX). Atualizada chamada ao Gate H com `synthesizedSegments` e `sfxAppliedCount`. |
| `packages/cinema/src/recap/phase3/recap-gate-h-quality.ts` | Estendido `GateHInput` com campos opcionais `synthesizedSegments` e `sfxAppliedCount`. Adicionados Gates B (narração real obrigatória) e E (Motion Velix aplicado) como verificações críticas dentro de `runGateHAudiovisualQuality`. Atualizadas métricas retornadas com `narrationFallbackCount`, `narrationSilentCount`, `sfxPlanned`, `sfxApplied`. |

---

## 3. Testes Executados

- **Compilação TypeScript (`packages/cinema`):** `npx tsc --noEmit -p packages/cinema/tsconfig.json` — zero erros nos arquivos modificados (`recap-mp4-renderer.ts`, `recap-gate-h-quality.ts`, `recap-tts-adapters.ts`). Erros pré-existentes em módulos externos (`@neuralbridge/shared`, `vitest`) são unrelated.
- **Compilação TypeScript (`apps/aethera-desktop`):** `npx tsc --noEmit -p apps/aethera-desktop/tsconfig.node.json` — zero erros novos introduzidos pelas alterações. Todos os erros reportados são pré-existentes (módulos não resolvidos, tipos implícitos `any`).
- **Validação de exports:** Confirmado que `phase3/index.ts` re-exporta todos os adaptadores TTS e funções de auditoria via `export * from './recap-tts-adapters.js'` e `export * from './recap-mp4-renderer.js'`, garantindo disponibilidade via `@neuralbridge/cinema`.

---

## 4. Duração Planejada versus Renderizada

Antes das correções, a duração renderizada era determinada pelo fallback determinístico (~800ms × N cenas), resultando em ~22 segundos independentemente do roteiro. Após as correções, a duração é governada pela cadeia:

1. TTS real gera WAV por cena → `measureAudioFileDurationMs` mede duração real via ffprobe
2. `measureNarrationSegmentsWithPauses` constrói clock de narração com pausas inter-cenas
3. `buildAudioFirstDurationAudit` garante `finalTimelineDurationMs = max(plannedDurationMs, measuredNarrationDurationMs)`
4. Shots são distribuídos proporcionalmente à duração real de cada segmento narrativo

A divergência máxima tolerada é `max(1500ms, 8% da duração final)`. Divergências acima disso geram finding crítico no Gate H.

---

## 5. Evidência de Narração

- **Gate B (novo):** Verifica que nenhum segmento usa fallback determinístico (`isFallback === false`) e que todos têm `speechDurationMs > 0`. Falha crítica se qualquer segmento violar.
- **Validação inline:** `auditNarrationAudioClip` é chamado após cada síntese TTS, verificando clipping, silêncio excessivo (>65%) e duração mínima (400ms). Erro lança exceção que interrompe o pipeline.
- **Bloqueio explícito:** Quando `allowDeterministicFallback: false` e todos os provedores reais falham, o renderer lança `Error('Narração obrigatória falhou em N cena(s)...')` em vez de prosseguir com áudio sintético.

---

## 6. Evidência de Execução do Motion Velix

- **Gate E (novo):** Compara `sfxPlanned` (do plano audiovisual) com `sfxAppliedCount` (contado durante mixagem FFmpeg). Se SFX foram planejados mas zero foram aplicados, gera finding crítico. Se aplicação foi parcial, gera warning.
- **Resolução de assets:** O handler IPC agora resolve `NB_VELIX_DIR` ou `~/.claude/skills/motionvelix/assets/sfx` e passa ao orquestrador. O renderer usa `resolveMotionVelixSfxFile` para localizar cada SFX por tipo e aplica via filtros FFmpeg com delay e gain precisos.
- **Contagem verificável:** `sfxAppliedCount` é incrementado apenas quando `resolveMotionVelixSfxFile` retorna caminho válido e o filtro é efetivamente adicionado à cadeia de mixagem.

---

## 7. Resultado das Auditorias de Áudio

- **Sample rate padronizado:** Toda a cadeia de mixagem (narração, música, SFX) opera em 48 kHz (`mixSampleRate = 48000`), eliminando resampling inconsistente.
- **Tom sintético removido:** Sem `musicBedPath`, o placeholder é `anullsrc` (silêncio puro) em vez de `sine=frequency=110`. A narração é o sinal primário; sem música real, o ducking não tem sinal lateral e a voz fica limpa.
- **Ducking preservado:** Sidechain compress (`sidechaincompress=threshold=0.04:ratio=6:attack=25:release=320:makeup=1`) e loudnorm EBU R128 continuam ativos quando há música real.
- **Integridade verificada:** `auditNarrationAudioClip` detecta clipping (>1% amostras saturadas), silêncio excessivo e duração insuficiente em cada segmento sintetizado.

---

## 8. Caminho do Novo Vídeo

As correções são estruturais e não produzem vídeo diretamente — elas habilitam o pipeline a funcionar corretamente na próxima execução real. O vídeo será gerado em:

```
{userDataDir}/recap-workspace/render/{chapterId}/recap-preview.mp4
```

Para produzir o vídeo de teste da Fase 8, execute o Recap via interface desktop com:
- Arquivo CBZ/ZIP válido
- Idioma: português brasileiro
- Aspect ratio: 16:9
- Provedor TTS: VoiceStudio ou ElevenLabs (configurado via env vars)
- Music bed: arquivo de música real opcional (sem ele, silêncio de fundo)

---

## 9. Problemas Ainda Não Resolvidos

1. **Teste end-to-end pendente:** As correções foram validadas em compilação, mas não em execução real de renderização. O teste da Fase 8 requer ambiente com FFmpeg, provedor TTS acessível e assets do Motion Velix instalados.
2. **Provedores TTS dependentes de configuração:** ElevenLabs requer `NB_ELEVENLABS_API_KEY`; VoiceStudio requer serviço HTTP em `localhost:3900`; Windows SAPI só funciona em Windows. Sem nenhum disponível, o pipeline bloqueia intencionalmente (comportamento correto pós-Fase 2).
3. **Music bed opcional:** Sem arquivo de música real, o fundo é silêncio puro. Se desejar música de fundo discreta, forneça `musicBedPath` via configuração ou UI.
4. **Gates A, C, D, F, G:** Já estavam cobertos pelo Gate H existente (roteiro válido, cobertura visual, ordem narrativa, MP4 probe, framing crop risk). Os gates B e E eram os únicos ausentes e foram adicionados nesta rodada.

---

## Resumo Executivo

Os cinco problemas relatados tinham três causas raiz convergentes: (1) ausência de `ttsPort` no handler IPC, causando fallback silencioso para áudio sintético; (2) geração de tom de 110 Hz como trilha de fundo padrão; (3) não passagem do diretório de SFX do Motion Velix ao orquestrador. Todas foram corrigidas com validações obrigatórias que impedem o pipeline de concluir sem narração real e sem efeitos visuais aplicados. O Gate H foi estendido com dois novos checks críticos (B e E) que garantem, em tempo de auditoria, que a narração é autêntica e que o Motion Velix foi efetivamente executado.