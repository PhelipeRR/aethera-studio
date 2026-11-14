# NeuralBridge — checklist de distribuição e instalação limpa

Checklist externo para fechar a Fase 16 e os bloqueios de distribuição da Fase 39. Executar em uma máquina Windows limpa, sem Node, FFmpeg, VoiceStudio ou dados de desenvolvimento.

## NSIS

- [ ] Instalar o instalador NSIS gerado sem terminal aberto.
- [ ] Abrir o Electron e confirmar que o perfil inicia sem depender de `C:\dev\neuralbridge`.
- [ ] Confirmar criação de `userData`, banco, preferências e logs.
- [ ] Abrir o fluxo Motion sem navegador e confirmar bloqueio explicável.
- [ ] Acionar manualmente o download do navegador e confirmar que ele ocorre somente após o clique.
- [ ] Renderizar composição Motion com vídeo e FFprobe válidos.
- [ ] Repetir render com narração real autorizada e confirmar stream de áudio.
- [ ] Verificar Skill Manager, MCP e preservação de memória após reinício.
- [ ] Desinstalar, reinstalar e confirmar o comportamento documentado dos dados do usuário.

## Licenças e dependências

- [ ] Obter decisão jurídica sobre a licença Remotion e eventual Company License.
- [ ] Confirmar política de distribuição do navegador baixado sob demanda.
- [ ] Se VoiceStudio for usado, manter o aplicativo externo e validar separadamente licenças do modelo, voz e saída.
- [ ] Não distribuir VoiceStudio, pesos ou vozes sem autorização específica.

## Pendências

Até essa execução ser realizada em ambiente limpo, a Fase 16 e os critérios externos da Fase 39 permanecem abertos.
