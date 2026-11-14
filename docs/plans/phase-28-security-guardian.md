# Fase 28 — Security Guardian

## 1. Objetivo

Revisar operações e alterações antes da aprovação final, com risco explicável.

## 2. Estado atual

Fase 16 cobre IPC, segredos, permissões, comandos e confirmações; ainda não há revisor agregado de segurança.

## 3. Reutilização

redaction, assessRisk, permissões, Git diff, workspace, TaskEngine, Brain e Skills.

## 4. Escopo

Segredos, comandos perigosos, permissões, dependências vulneráveis disponíveis localmente, arquivos inesperados, escopo do diff e classificação de risco.

## 5. Arquitetura

Serviço de análise determinística chamado pelo TaskEngine antes da aprovação; resultados persistidos como eventos e exibidos no Chat.

## 6. Componentes

Agents, workspace, orchestrator, database, shared IPC, Chat e Projects.

## 7. Dados

Eventos de achados, severidade, evidência redigida, regra, decisão e timestamp; não persistir segredo nem prompt completo.

## 8. Fluxo

Alteração/comando → coletar diff/metadados → analisar → bloquear/avisar → aprovação humana → continuar ou rejeitar.

## 9. Segurança

O Guardian não pode conceder permissões a si próprio; análise é advisory para baixo risco e bloqueante para alto risco conforme política do projeto.

## 10. Desempenho

Limites de diff/arquivos, análise incremental, timeout e cancelamento.

## 11. Dependências

Fases 16, 20–22, permissões e Git Intelligence quando disponível.

## 12. Etapas

1. Taxonomia. 2. Detectores. 3. contrato de achados. 4. gate no TaskEngine. 5. UI/auditoria. 6. testes.

## 13. Testes

Segredos, comandos destrutivos, permissões, dependências, fora da raiz, baixo risco, falso positivo e tentativa de bypass.

## 14. Aceite

Riscos altos bloqueiam até aprovação; achados têm evidência; segredos não aparecem; alterações legítimas continuam; decisões são auditáveis.

## 15. Riscos

Falsos positivos e confiança excessiva. Mitigar com regras transparentes e estado “não analisado”.

## 16. Fora do escopo

Pentest completo, análise online obrigatória e correção automática.

## 17. Entregáveis

Guardian, integração, painel, contratos, testes e documentação.

## 18. Status

**CONCLUÍDA em 2026-10-29.** Implementação, decisões e limitações em `docs/PLAN.md`, Roadmap posterior.
