# Neura — fechamento da implementação

Data: 2026-11-02. Nada foi commitado. Plano: `2026-11-02-neura-general-assistant.md`. Privacidade: `docs/neura-privacy.md`.

## Decisões tomadas para fechar as questões do spec

| Questão | Decisão |
|---|---|
| Provedor de voz | `VoiceStudioWhisperProvider`: microfone no HUD e Whisper local. OneCore foi descartado porque o ditado exige fala online (`0x80045509`). `WindowsSpeechProvider` fica como alternativa SAPI |
| Fala | Vozes locais do sistema, no renderer |
| Fonte de transcrição | `ManualTranscriptSource`: texto colado pelo usuário. Não há captura de áudio de reunião |
| Local ou remoto | Comandos conhecidos são locais. Conversa e sugestões vão ao agente escolhido, com consentimento próprio para reuniões |
| Automático seguro | Spotify, volume, abrir Spotify e Teams. Configurações pede confirmação. Qualquer outro programa é bloqueado |
| Digitar no Teams | Não. A primeira versão só copia ou fala |
| Python no instalador | Não embarcado. Fontes em `resources/local-worker/src`; venv opcional em `<userData>/local-worker/.venv` |

## Desvios do plano

- **Task 6, passo 3:** só existe abrir aplicativos da allowlist. Digitar e clicar não foram implementados, por risco e porque nada na v1 precisa disso.
- **Task 6, passo 4:** ações pendentes e resultados chegam ao HUD pelo evento `neura:changed`, não pelo stream do Companion, cujos eventos exigem uma tarefa do TaskEngine e um agente.
- **Task 5:** quando nem fonte nem worker conhecem o idioma, o agente decide e informa `language`, registrado com `reason: 'model'`. Sem isso uma reunião em inglês saía em português.
- **Task 8:** a E2E cobre Spotify não conectado. `no_device` está coberto em `apps/desktop/test/spotify-adapter-integration.test.ts`.

## Corrigido durante a integração

- `TaskEngineSuggestionModel` passava um objeto Zod onde o CLI espera JSON Schema.
- `ComputerActionBroker` aprovava ação segura sem executá-la (novo `run`), e o executor recebia `decidedAt` como `expiresAt`.

## Benchmark do worker (reunião sintética, tokens ≈ caracteres / 4)

| Min | Bruto | Sem worker | Com worker | vs bruto | vs sem worker | p50 |
|---|---:|---:|---:|---:|---:|---:|
| 5 | 8.275 | 653 | 1.100 | −86,7% | +68,5% | 1,6 ms |
| 15 | 21.965 | 653 | 1.100 | −95,0% | +68,5% | 3,5 ms |

O worker reduz frente ao transcript completo, mas envia mais que o fallback de 12 linhas, porque entrega falas distintas e perguntas. O ganho é cobertura, não tokens absolutos.

## Limites conhecidos

- O microfone físico não foi testado: a E2E usa áudio injetado no Chromium, com o Whisper real do VoiceStudio.
- Nenhum modelo real foi usado: a E2E usa o agente falso, então a qualidade e o idioma das respostas reais seguem sem validação.
- O texto enviado ao agente fica no histórico de tarefas, e "Apagar histórico de sugestões" não o remove.
- `SpotifyService.request()` não chama `fail()`: um 401 definitivo não limpa os tokens até o próximo poll, e 403 de volume chega como `forbidden`.
- Detecção local de idioma só cobre `pt`, `en` e `es`.
- O app não cria o venv do worker sozinho.
