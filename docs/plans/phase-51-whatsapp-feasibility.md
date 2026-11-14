# Fase 51.05 — Viabilidade do WhatsApp

**Decisão em 2026-11-10:** não implementar um conector para WhatsApp pessoal.

## Evidência e escopo

A WhatsApp Business Platform/Cloud API exige uma conta Business, um número dedicado, webhook HTTPS público, opt-in e
modelos aprovados para iniciar conversas. Ela não fornece o histórico de uma conta pessoal do WhatsApp Web. O Core local
atualmente é exposto somente por loopback ou Tailscale Serve privado; isso não satisfaz o requisito de webhook público.

Automação por engenharia reversa do WhatsApp Web, leitura de QR/session privada ou scraping fica fora do escopo por risco de
bloqueio da conta, quebra de termos, exposição de credenciais e ausência de contrato estável.

## Alternativa aprovada

- Notificações pessoais: central local e notificação Electron metadata-only.
- Fora do desktop: Companion Mobile/push ou e-mail, quando o usuário ligar o canal.
- Mensagens de saída: somente conectores com API oficial e ação tipada passando pelo `ComputerActionBroker`.

## Condições para reabrir

Reabrir somente se o usuário fornecer uma conta Business, número dedicado, endpoint HTTPS público controlado, política de
opt-in e modelos aprovados. Nesse caso, implementar verificação de assinatura, janela de 24 horas, deduplicação, limites e
testes com servidor falso antes de qualquer envio real.
