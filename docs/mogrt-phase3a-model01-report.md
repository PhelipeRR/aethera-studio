# MOGRT Engine, Fase 3A: validação de `Dynamic Anime Burst Logo 01.mogrt`

Gerado por `scripts/validate-mogrt-phase3a.ts` a partir do arquivo real. Todos os números abaixo são medidos na execução.

- SHA-256: `742d296d11a90b0b8b35b5394c7a9404790e128ec6246f92188b36df619d96cc`
- Resultado das verificações: **aprovado**
- Completude do render: `partial_with_documented_gaps`
- Reprodução parcial: 97 de 106 máscaras rasterizadas, 15 ocorrência(s) de efeito com lacuna (ADBE Turbulent Displace, ADBE Displacement Map, ADBE Fractal Noise, ADBE CurvesCustom, APC Vegas, ADBE Scribble Fill), 0 expressão(ões) não avaliada(s), 1 outra(s) lacuna(s) e 7 aproximação(ões). Não equivale a um render do After Effects.

A única referência do After Effects é o `thumb.png` de um quadro. Os demais quadros não têm com o que ser comparados.

## Verificações

| Verificação | Resultado | Medido |
| :--- | :--- | :--- |
| base: render | passou | 199/218 quadros não pretos |
| base: duração do MP4 igual ao definition.json | passou | 7.266 s, esperado 7.267 s |
| logo-a: render | passou | 216/218 quadros não pretos |
| logo-a: duração do MP4 igual ao definition.json | passou | 7.266 s, esperado 7.267 s |
| logo-b: render | passou | 216/218 quadros não pretos |
| logo-b: duração do MP4 igual ao definition.json | passou | 7.266 s, esperado 7.267 s |
| edited: render | passou | 197/218 quadros não pretos |
| edited: duração do MP4 igual ao definition.json | passou | 7.267 s, esperado 7.267 s |
| arquivo original intacto | passou | SHA-256 antes e depois |
| quadro base contra o thumb.png (t=0.667 s) | passou | MAE 10.76 (máx. 20), IoU 0.913 (mín. 0.85) |
| trocar o logo muda o quadro | passou | MAE 10.73 (mín. 0.2) |
| editar cores muda a transição | passou | MAE 77.06 (mín. 0.2) |
| editar só o texto muda o quadro final | passou | MAE 0.56 (mín. 0.2) |

## Renders

| Variante | Edição | Duração (ffprobe) | Quadros | Quadros não pretos | Codec |
| :--- | :--- | :--- | :--- | :--- | :--- |
| base | template sem edição | 7.266 s | 218 | 199 | h264 |
| logo-a | logo de teste A | 7.266 s | 218 | 216 | h264 |
| logo-b | logo de teste B | 7.266 s | 218 | 216 | h264 |
| edited | todas as cores e o texto editados | 7.267 s | 218 | 197 | h264 |

## Composições renderizadas

| Composição | Tamanho | FPS | Duração | Camadas | Máscaras |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Dynamic Anime Burst 01 Logo Placeholder Comp | 500x500 | 30 | 10.000 s | 1 | 0 |
| Dynamic Anime Burst 01 Logo Placeholder | 500x500 | 30 | 10.000 s | 0 | 0 |
| Dynamic Anime Burst Logo 01 Text | 857x81 | 30 | 5.367 s | 1 | 0 |
| DABL_01 | 4096x2304 | 30 | 7.267 s | 9 | 0 |
| L01 COLOR_LOGO 01 | 1920x1080 | 30 | 1.367 s | 2 | 0 |
| L01 COLOR_LOGO 02 | 1920x1080 | 30 | 1.200 s | 2 | 0 |
| L01 COLOR_LOGO GR | 1920x1080 | 30 | 1.367 s | 4 | 0 |
| L01 LOGO | 1920x1080 | 30 | 6.867 s | 14 | 0 |
| L01 REF_MAP | 500x500 | 30 | 10.000 s | 1 | 0 |
| L01 STROKE | 500x500 | 30 | 1.033 s | 1 | 0 |
| Matte | 1920x1080 | 15 | 1.067 s | 1 | 0 |
| Transition 01 | 1920x1080 | 15 | 2.067 s | 2 | 90 |
| Energy 25 | 1920x1080 | 30 | 0.867 s | 1 | 0 |
| Energy 25 Glow | 1920x947 | 30 | 0.867 s | 2 | 16 |
| Dynamic Anime Burst Logo 01 | 4096x2304 | 30 | 7.267 s | 2 | 0 |

## Máscaras e expressões

- Máscaras no .aep: 106, com 832 keyframes de forma
- Máscaras distintas rasterizadas no template sem edição: 97
- Expressões no .aep: 74
- Expressões não avaliadas: 0

## Efeitos executados

| Efeito | Execuções |
| :--- | :--- |
| ADBE Fill | 942 |
| ADBE Tint | 199 |
| ADBE Drop Shadow | 1151 |
| ADBE Glo2 | 207 |
| ADBE Noise2 | 218 |
| ADBE Shift Channels | 365 |
| ADBE Simple Choker | 365 |
| ADBE Geometry2 | 782 |
| ADBE Box Blur2 | 184 |
| ADBE Set Matte3 | 184 |

## Efeitos não reproduzidos

| Composição | Camada | Efeito | Motivo |
| :--- | :--- | :--- | :--- |
| L01 COLOR_LOGO 01 | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 COLOR_LOGO 01 | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE Displacement Map | Efeito não implementado; a camada aparece sem ele. |
| Matte | Shape Layer 1 | ADBE Fractal Noise | Efeito não implementado; a camada aparece sem ele. |
| Matte | Shape Layer 1 | ADBE CurvesCustom | Efeito não implementado; a camada aparece sem ele. |
| L01 LOGO | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 STROKE | Dynamic Anime Burst 01 Logo Placeholder Comp | APC Vegas | Gerador não implementado que substitui a camada; a camada é omitida. |
| L01 COLOR_LOGO 02 | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 COLOR_LOGO 02 | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE Displacement Map | Efeito não implementado; a camada aparece sem ele. |
| L01 LOGO | Blink 03 | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 REF_MAP | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE CurvesCustom | Efeito não implementado; a camada aparece sem ele. |
| L01 LOGO | Blink 04 | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 LOGO | Blink 01 | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 LOGO | Blink 02 | ADBE Turbulent Displace | Efeito não implementado; a camada aparece sem ele. |
| L01 STROKE | Dynamic Anime Burst 01 Logo Placeholder Comp | ADBE Turbulent Displace | Efeito não implementado (Fase 3B); não é reproduzido. |
| Energy 25 Glow | Shape Layer 2 | ADBE Scribble Fill | Efeito não implementado (Fase 3B); não é reproduzido. |

## Outras lacunas

| Composição | Camada | Motivo |
| :--- | :--- | :--- |
| DABL_01 | Shape Layer 1 | Traço de shape não implementado. |

## Aproximações

- Recolher transformações: mais resolução (até 2x); só pré-composições com texto deixam de cortar nas bordas.
- Drop Shadow: desfoque por três box blurs, com queda próxima da do After Effects.
- Glow: bloom próprio; cores A e B usam a média, e só Add/atrás são distinguidos.
- Noise: grão determinístico próprio, com outro padrão de pixels.
- wiggle(): ruído determinístico próprio, com curva diferente da do After Effects.
- Set Matte com origem recolhida: usa o espaço da composição; regra inferida, sem quadro do After Effects para comparar.
- Fonte "Montserrat-Bold" não vem no .mogrt: se não estiver instalada, o rasterizador usa outra.

## Como repetir

```bash
npx tsx scripts/validate-mogrt-phase3a.ts --mogrt "<caminho>/Dynamic Anime Burst Logo 01.mogrt"
```
