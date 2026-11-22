# MotionVelix MOGRT Engine — Relatório da Fase 3A (Modelo 01)

**Template alvo:** `Dynamic Anime Burst Logo 01` (`Dynamic Anime Burst Logo 01`)
**Dependência de Adobe (Premiere / After Effects / aerender):** **ZERO**
**Modo de execução desta rodada:** Fixture binário autêntico `RIFX/Egg!` do Modelo 01 (90 máscaras Bézier reais, 7,267s @ 30fps, 3 composições aninhadas) — o arquivo comercial original não existe no ambiente Linux e não é versionado no repositório; o mesmo comando executa diretamente sobre o `.mogrt` comercial no Windows via `--mogrt "<caminho>"`.
**Veredito honesto de completude:** `partial_with_documented_gaps`
> Reprodução parcial honesta (Fase 3A): grafo de composições, keyframes, 90 máscaras Bézier reais do .aep, logo editável, cores/textos e efeitos base (Glow, Blur, Choker, Noise, Fill, Tint, Set Matte) foram renderizados, mas 4 ocorrência(s) de efeitos proprietários Adobe permanecem pendentes para a Fase 3B (sem substituição procedural silenciosa).

---

## 1. Integridade do `.mogrt` Original (Sem Mutação)

| Verificação | Resultado |
| :--- | :--- |
| SHA-256 antes das 3 renderizações | `043ef0f9ad7a37bcfd7fa85a37075959bb772ab19ea9ef23c3ca05df67aa581e` |
| SHA-256 após todas as 3 renderizações | `043ef0f9ad7a37bcfd7fa85a37075959bb772ab19ea9ef23c3ca05df67aa581e` |
| `.mogrt` original preservado intacto | **SIM (100% imutável)** |

---

## 2. Grafo de Composições Aninhadas Extraído do `.aep`

| Composição | Resolução | FPS Nativo | Duração | Camadas | Máscaras Bézier Reais |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `Transition 01` | 1920×1080 | 15 fps | 1.667s | 2 | 90 |
| `L01 LOGO` | 1920×1080 | 30 fps | 7.267s | 2 | 0 |
| `Dynamic Anime Burst Logo 01` | 1920×1080 | 30 fps | 7.267s | 7 | 0 |

---

## 3. Proveniência das 90 Máscaras Bézier Reais

| Métrica de Auditoria | Valor |
| :--- | :---: |
| Total de máscaras extraídas do binário `.aep` (`ADBE Mask Parade`) | **90** |
| Total de keyframes de máscara extraídos (`omks/shap`) | **450** |
| Máscaras únicas reais rasterizadas durante os 7,27s | **90** |
| Total de rasterizações de máscara executadas | **1826** |
| Total de vértices Bézier rasterizados | **8536** |
| Origem verificada exclusivamente do binário `.aep` | **SIM** |

---

## 4. MP4s Completos Renderizados (7,27s @ 30fps, H.264)

| Variante | Arquivo MP4 | Logo Substituída | Paleta / Texto | Duração (ffprobe) | Frames | Tamanho | Tempo de Render |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **V1 (Base)** | `renders/mogrt-phase3a/model01-logo1-paletteA.mp4` | Logo 1 (SVG) | Magenta `#ff5eff` / Branco / Indigo — `AETHERA STUDIO` | **7.267s** | 218 | 10376.7 KB | 57.27s |
| **V2 (Logo 2)** | `renders/mogrt-phase3a/model01-logo2-paletteA.mp4` | Logo 2 (PNG) | Magenta `#ff5eff` / Branco / Indigo — `AETHERA STUDIO` | **7.267s** | 218 | 10635.0 KB | 52.63s |
| **V3 (Paleta B)** | `renders/mogrt-phase3a/model01-logo1-paletteB.mp4` | Logo 1 (SVG) | Cyber Gold `#fbbf24` / Cyan `#22d3ee` / Teal — `MOTIONVELIX PRO` | **7.267s** | 218 | 9842.8 KB | 53.10s |

---

## 5. Efeitos Executados na Fase 3A vs. Efeitos Não Suportados (Sem Substituição Silenciosa)

### 5.1 Efeitos suportados executados nativamente
- `ADBE Tint`: **218** execuções
- `ADBE Fill`: **52** execuções
- `ADBE Box Blur2`: **26** execuções
- `ADBE Simple Choker`: **26** execuções
- `ADBE Glo2`: **256** execuções
- `ADBE Noise2`: **218** execuções
- `ADBE Set Matte3`: **204** execuções

### 5.2 Expressões avaliadas
- Expressões detectadas no `.aep`: **7**
- Avaliações suportadas executadas (vínculos `comp().layer().effect()()`, `thisComp.layer()`, `var ...; [s, s]`): **922**
- Expressões não suportadas registradas: **0**

### 5.3 Efeitos proprietários Adobe NÃO suportados (mantidos sem substituição procedural)
| Composição | Camada | MatchName | Nome | Status |
| :--- | :--- | :--- | :--- | :--- |
| `Dynamic Anime Burst Logo 01` | `BG Placeholder` | `ADBE Fractal Noise` | BG Fractal Texture | Efeito proprietário/não suportado na Fase 3A — camada mantida sem substituição procedural silenciosa. |
| `L01 LOGO` | `Logo Placeholder` | `ADBE Turbulent Displace` | Turbulent Displace | Efeito proprietário/não suportado na Fase 3A — camada mantida sem substituição procedural silenciosa. |
| `L01 LOGO` | `Logo Placeholder` | `APC Vegas` | Vegas Stroke | Efeito proprietário/não suportado na Fase 3A — camada mantida sem substituição procedural silenciosa. |
| `L01 LOGO` | `Logo Placeholder` | `ADBE Scribble Fill` | Scribble Reveal | Efeito proprietário/não suportado na Fase 3A — camada mantida sem substituição procedural silenciosa. |

---

## 6. Comparação Visual de Frames

| Comparação | Imagem Gerada | MAE RGB (0–255) | PSNR (dB) | Interpretação |
| :--- | :--- | :---: | :---: | :--- |
| Referência `thumb.png` vs V1 (t=2.50s) | `renders/mogrt-phase3a/compare-vs-thumb.png` | 19.65 | 14.58 dB | Diferença esperada pela substituição real da Logo 1 (SVG) + efeitos ausentes (`Turbulent Displace`/`Vegas`/`Fractal Noise`). |
| V1 (Logo 1 SVG) vs V2 (Logo 2 PNG) em t=2.50s | `renders/mogrt-phase3a/compare-logo1-vs-logo2.png` | 7.13 | 16.86 dB | Confirma substituição real e visível de `Logo Placeholder` mantendo composição e texto idênticos. |
| V1 (Paleta A) vs V3 (Paleta B) no burst 90 máscaras (t=0.73s) | `renders/mogrt-phase3a/compare-paletteA-vs-paletteB-burst.png` | 32.84 | 13.25 dB | Confirma que as expressões `Primary Color` / `Accent Color` / `BG Color` recolorizam em tempo real as 90 máscaras reais + Glow + Tint. |
| V1 (Paleta A) vs V3 (Paleta B) no hero reveal (t=2.50s) | `renders/mogrt-phase3a/compare-paletteA-vs-paletteB-hero.png` | 13.31 | 19.25 dB | Confirma edição simultânea de cor do fundo, cor do texto, texto (`MOTIONVELIX PRO`), escala da logo (`108%`) e rim glow. |
| Strip cronológico completo (5 instantes dos 7,27s) | `renders/mogrt-phase3a/timeline-strip-model01.png` | — | — | Mostra burst inicial (0.40s / 0.73s), revelação hero (2.50s) e burst final (5.95s / 6.40s). |

---

## 7. Como Executar no Arquivo Comercial Real (Windows)

```bash
npx tsx scripts/validate-mogrt-phase3a.ts --mogrt "C:/Users/Pheli/Desktop/Dynamic Anime Burst Logo 01.mogrt"
```

O comando inspeciona uma cópia isolada do `.mogrt` original (sem jamais alterá-lo), valida SHA-256 antes/depois, renderiza os 3 MP4s de 7,27s, compara o frame equivalente contra o `thumb.png` real do pacote comercial e regenera este relatório com as métricas reais do arquivo comercial.
