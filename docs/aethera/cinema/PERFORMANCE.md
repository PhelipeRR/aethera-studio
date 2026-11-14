# Perfis de Performance & VRAM (RTX 4060 Ti 8GB)

Definidos em `RENDER_PROFILES` (`packages/cinema/src/edit/editorial-engine.ts`):
- `draft_540p`: `960x540`, ~`1400 MB` VRAM (`fits8GbVram: true`)
- `review_720p`: `1280x720`, ~`2400 MB` VRAM (`fits8GbVram: true`)
- `master_1080p`: `1920x1080`, ~`4800 MB` VRAM (`fits8GbVram: true`)
- `master_4k`: `3840x2160`, ~`9200 MB` VRAM (`fits8GbVram: false`, ativa `useCpuFallback`)

Cache incremental por segmento (`planIncrementalSegmentRenders`) evita re-renderizar clipes não modificados.
