# Fase 38.2 — Benchmark do renderer Electron

Data: 2026-10-31. Ambiente: Windows, Electron empacotado pelo workspace, Playwright 1.64, um worker, fixture local criada por `git fast-import`.

Metodologia: repositório temporário real com 5.000 commits lineares e uma árvore/arquivo compartilhado. O projeto foi registrado pelo IPC real, a rota Git Intelligence foi aberta no Electron, e as medições foram feitas após o primeiro botão do grafo aparecer. `dom` conta descendentes do container do grafo; `svg` conta `svg,path`; `commitsMounted` conta botões de commits; seleção mede do clique ao painel de detalhes visível; scroll mede a alteração de scrollTop até o próximo frame.

| Métrica | Resultado |
|---|---:|
| Commits no fixture | 5.000 |
| Primeira renderização observada | 4.067 ms |
| Resposta da seleção | 29 ms |
| Scroll programático observado | 5 ms |
| Elementos DOM no container | 150 |
| Elementos SVG/path | 22 |
| Commits montados | 21 |
| Altura virtualizada | 7.608 px |
| Altura do viewport | 560 px |

Conclusão: o renderer não montou 5.000 nós; montou 21 commits e uma janela de SVG limitada, mantendo a geometria total para rolagem. Memória do renderer não foi reportada porque não houve uma medição confiável exposta pelo Electron neste cenário; nenhum valor foi inferido.
