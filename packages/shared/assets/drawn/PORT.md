# Presets desenhados

## Revisão de segurança — 2026-11-04

`drawn-book` e `drawn-watercolor` são uma implementação nativa pequena do NeuralBridge, não uma execução de `buildwithhanif/claude-animation`. O código usa somente JSX/CSS determinístico dentro do bundle Remotion; não há `canvas` nativo, `eval`, shell, leitura de arquivos, chamadas de rede, instalação de dependências ou scripts externos.

O pacote externo foi usado apenas como referência de direção visual. Nenhum arquivo do repositório upstream é carregado em runtime e nenhuma licença/atribuição externa é necessária para a implementação nativa. Os presets são locais, versionados no registro e podem ser removidos sem alterar o motor.

Evidência: `MotionComposition.tsx` contém apenas tokens, gradientes e texturas calculadas pelo frame; o bundle foi construído e os dois presets renderizados em MP4 de 2,0 s, confirmados pelo FFprobe.
