# CINEMA-AUDIO-01 — Auditoria e Correção Profissional de Áudio (`showcase-v2-final.mp4`)

**Data:** 2026-11-14  
**Escopo:** Diagnóstico real das sobreposições de voz reportadas na avaliação humana, implementação do **Diretor de Som (`sound-director.ts`)** com poder de bloqueio de renderização, separação explícita de buses (`A1`–`A5`), medição real dos WAVs do VoiceStudio antes da mixagem, e re-renderização com stems separados.

---

## 1. Diagnóstico Real do Problema (Antes da Correção)

Ao medir com `ffprobe` a duração efetiva de cada arquivo `nar_*.wav` gerado pelo VoiceStudio na versão anterior (`showcase-v2-final.mp4` pré-correção) e cruzar com `sceneStartSec`:

| Cena | Início da Fala (`startMs`) | Duração Real do WAV (`ffprobe`) | Fim Real (`endMs`) | Início da Próxima Fala | Diagnóstico Real |
| :--- | :---: | :---: | :---: | :---: | :--- |
| Cena 3 (`scene_03_duel`) | `18.00s` | `5.25s` | `23.25s` | `22.95s` | **SOBREPOSIÇÃO de 0,30s** (`22.95s–23.25s`) |
| Cena 4 (`scene_04_comedy_35`) | `22.95s` | `5.44s` | `28.39s` | `25.20s` | **SOBREPOSIÇÃO CRÍTICA de 3,19s** (`25.20s–28.39s`) |
| Cena 6 (`scene_06_silksong_combat`) | `34.45s` | `4.69s` | `39.14s` | `38.50s` | **SOBREPOSIÇÃO de 0,64s** (`38.50s–39.14s`) |
| Cena 10 (`scene_10_outro`) | `56.95s` | `6.21s` | `63.16s` | Fim em `60.60s` | **TRUNCAMENTO de 2,56s** no fim do vídeo |

**Causa raiz:** `amix` posicionava cada narração por `adelay` fixo no início de cada cena **sem medir a duração real do WAV** e **sem nenhum gate bloqueador** para impedir falas simultâneas ou truncamento.

---

## 2. Arquitetura Implementada (`sound-director.ts` + `real-renderer.ts`)

- **Timeline explícita de áudio** ([sound-director.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/audio/sound-director.ts)):
  - Eventos tipados com `sourceId`, `sceneId`, `bus`, `role`, `startMs`, `endMs`, `gainDb`, `priority`, `fadeInMs`, `fadeOutMs`.
  - Buses lógicos separados: `A1_narration`, `A2_gameplay_dialogue`, `A3_music`, `A4_sfx`, `A5_ambience`.
- **Gate bloqueador (`assertSoundDirectorApproval` / `SoundDirectorBlockedError`)**:
  - **Bloqueia a renderização final** se houver `narration_overlap` (sobreposição `> 0ms` entre falas em `A1`), `narration_truncated` (`endMs > totalDurationMs`) ou `narration_vs_gameplay_dialogue` (colisão entre `A1` e `A2`).
  - Sinaliza avisos para `narration_tight_gap` (`< 200ms`), `sfx_masking_speech` (`A4 > -6 dB` durante fala) e `music_unducked_over_speech` (`A3` sem *sidechain ducking*).
- **Tratamento da mixagem:** `highpass=f=85` + fade-in `25ms` na voz `A1`, cama musical filtrada (`lowpass=f=680`, fade-in/out suaves) com `sidechaincompress` (`threshold=0.02`, `ratio=5.0`, `attack=15ms`, `release=350ms`), e masterização `loudnorm` (`I=-14.0`, `TP=-1.5 dBTP`).

---

## 3. Comparativo Antes vs Depois (Timestamps Reais Verificados)

| Cena | Antes: Fim da Fala / Conflito | Depois: Janela Real (`startMs -> endMs`) | Duração Real WAV | Folga até Próxima Fala | Status Diretor de Som |
| :--- | :--- | :---: | :---: | :---: | :--- |
| 01 (`scene_01_hook`) | `9.01s` (folga `0.24s`) | `250ms -> 6044ms` | `5.794s` | `3.206s` | Aprovado |
| 02 (`scene_02_silksong_world`) | `17.81s` (folga `0.19s`) | `9250ms -> 15194ms` | `5.944s` | `2.806s` | Aprovado |
| 03 (`scene_03_duel`) | **Sobreposição `0.30s`** | `18000ms -> 20216ms` | `2.216s` | `2.734s` | **Corrigido** |
| 04 (`scene_04_comedy_35`) | **Sobreposição `3.19s`** | `22950ms -> 24761ms` | `1.811s` | `0.439s` | **Corrigido** |
| 05 (`scene_05_silksong_threads`) | `33.57s` | `25200ms -> 30571ms` | `5.371s` | `3.879s` | Aprovado |
| 06 (`scene_06_silksong_combat`) | **Sobreposição `0.64s`** | `34450ms -> 37182ms` | `2.732s` | `1.318s` | **Corrigido** |
| 07 (`scene_07_tension`) | `43.76s` | `38500ms -> 41867ms` | `3.367s` | `4.883s` | Aprovado |
| 08 (`scene_08_magma`) | `48.62s` | `46750ms -> 48135ms` | `1.385s` | `1.165s` | Aprovado |
| 09 (`scene_09_climax`) | `54.71s` | `49300ms -> 53202ms` | `3.902s` | `3.748s` | Aprovado |
| 10 (`scene_10_outro`) | **Truncada `2.56s`** | `56950ms -> 59617ms` | `2.667s` | `0.983s` antes do fim | **Corrigido** |

- **Métricas finais (`showcase-v2-final.mp4`):** `60.6s`, `48.709.484 bytes`, `-16.2 LUFS`, `-1.3 dBTP`, `0s` dessincronia A/V, `0` conflitos no `SoundDirectorAuditReport` (`approved: true`).
- **Stems separados exportados para inspeção:**
  - [A1_narration.wav](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/real-showcase/stems_v2/A1_narration.wav)
  - [A3_music_ducked.wav](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/real-showcase/stems_v2/A3_music_ducked.wav)

---

## 4. O que Ainda Depende de Escuta Humana

As medições acima comprovam objetivamente que **não há sobreposição de falas, truncamento ou clipping**. Porém, a aprovação final de qualidade artística ainda depende da escuta humana em dois pontos:
1. Naturalidade prosódica da voz clonada (`Phelipe PT-BR` no `omnivoice`) em frases curtas de ritmo rápido (ex.: Cena 4 `"Plano B: só correr!"`).
2. Preferência estética pela cama musical filtrada procedural versus substituição por uma trilha instrumental licenciada.
