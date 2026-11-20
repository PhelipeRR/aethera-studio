# Guia de Instalação e Validação no Windows — Aethera Remote Studio

Este guia descreve como iniciar o **Aethera Remote Host** no seu PC Windows, conectar o túnel **ngrok** (já instalado e autenticado) ou **Cloudflare Tunnel**, e executar o teste real de ponta a ponta (Fase 7).

---

## 1. Pré-requisitos no PC Windows

1. **Node.js 22+** (obrigatório para `node:sqlite` nativo).
2. **FFmpeg e FFprobe** no `PATH` (com drivers NVIDIA atualizados se quiser aceleração `h264_nvenc`).
3. **Agentes locais instalados** (basta 1 para operar em modo solo RF-07):
   - Antigravity CLI (`agy`)
   - Claude Code CLI (`claude`)
   - Codex CLI (`codex`)
   - Ollama (`http://127.0.0.1:11434` com pelo menos 1 modelo)
4. **yt-dlp** no `PATH` (`winget install yt-dlp.yt-dlp`) para aquisição real de mídias.
5. **ngrok** (já instalado e autenticado) ou **cloudflared**.

---

## 2. Subindo o Remote Host + Túnel HTTPS (Porta 4848)

> **Importante:** o Remote Host usa a porta dedicada **`4848`** em **`127.0.0.1`** (sem conflito com o túnel antigo na porta `8080`). Antes de iniciar, encerre o túnel antigo que apontava para `localhost:8080`.

No PowerShell, a partir da raiz do monorepo:

```powershell
# Inicia o Remote Host em 127.0.0.1:4848, gera o token Bearer seguro em .env.local e abre o túnel HTTPS ngrok
.\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel ngrok
```

Alternativa com **Cloudflare Tunnel**:
```powershell
.\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel cloudflared
```

Para verificar o estado do PC, GPU/NVENC, agentes detectados e URL pública HTTPS:
```powershell
.\apps\aethera-remote-host\scripts\status-remote-host.ps1
```

Para encerrar o Remote Host e o túnel com segurança:
```powershell
.\apps\aethera-remote-host\scripts\stop-remote-host.ps1
```

---

## 3. Segurança Aplicada

- O serviço escuta **exclusivamente em `127.0.0.1:4848`** (recusa `0.0.0.0` por padrão).
- O arquivo `apps/aethera-remote-host/.env.local` é ignorado pelo Git e nunca deve ser commitado.
- O **token Bearer** digitado no Aethera Web permanece **apenas em memória** (nunca salvo em `localStorage`).
- Prévias `<video>` e downloads usam **tickets efêmeros assinados por HMAC-SHA256 com validade de 60 segundos**, sem expor o token principal na URL.
- Operações aceitas seguem um **catálogo fechado** (`cinema.produce`, `agent.run`, `cinema.humanize`, `cinema.youtube_audit`, `media.acquire`, `render.ffmpeg`, `media.probe`); nenhum comando shell arbitrário é aceito.
- Operações sensíveis (ex.: `media.acquire`) exigem **aprovação humana explícita** antes de executar.
- Nenhuma rota expõe Electron IPC, DPAPI (`safeStorage`), banco do Desktop diretamente ou terminal.

---

## 4. Checklist de Validação E2E no PC Windows (Fase 7 — Pendente de Execução Real)

Marque cada item após executar no seu PC Windows real:

- [ ] **1.** Executar `.\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel ngrok` no Windows e confirmar URL `https://...ngrok...`.
- [ ] **2.** Rodar `.\apps\aethera-remote-host\scripts\status-remote-host.ps1` e confirmar `engineMode: monorepo_cinema`, GPU/NVENC detectada e agentes instalados.
- [ ] **3.** Abrir o **Aethera Web** em outro dispositivo (celular ou outro PC).
- [ ] **4.** Acessar a aba **Remote Host**, colar a URL HTTPS do ngrok e o `AETHERA_REMOTE_TOKEN` do `.env.local`, e clicar em **Conectar PC**.
- [ ] **5.** Confirmar status **PC Online**, leitura real de CPU/RAM/GPU e lista de agentes instalados no PC.
- [ ] **6.** Enviar um job **`agent.run`** (ex.: roteiro curto) e confirmar execução de um agente real (ou fallback RF-07 automático).
- [ ] **7.** Enviar um job **`cinema.produce`** (ou **`Produção com IA`** com destino **PC Remoto**) e acompanhar etapas e logs em tempo real via SSE.
- [ ] **8.** Fechar a aba do navegador durante a execução, reabrir, reconectar e confirmar que o job continuou rodando e os eventos foram recuperados via `Last-Event-ID`.
- [ ] **9.** Confirmar geração do **MP4** real (com `h264_nvenc` se houver GPU NVIDIA).
- [ ] **10.** Clicar em **Assistir prévia** (streaming HTTP Range `206` via ticket HMAC 60s) e em **Baixar** para baixar o MP4 no dispositivo remoto.
- [ ] **11.** Testar cancelamento de job em execução e aprovação/rejeição de `media.acquire`.
