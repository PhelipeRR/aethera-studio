# Taxonomia de QC & Issue Ledger

- **Categorias:** `technical`, `visual`, `audio`, `narrative`, `comedy`, `rights`.
- **Severidades:** `critical` (bloqueante, não pode receber waiver), `warning` (aceita waiver justificado), `info`.
- **Regras:**
  - `flashRateHz > 3.0` -> crítico (`safety_epilepsy_flash_rate`).
  - `avSyncDriftMs > 45` -> crítico (`audio_av_sync_drift`).
  - Áudio não licenciado -> crítico (`rights_unlicensed_audio`).
  - LUT sem licença -> warning (`rights_unknown_lut_license`).
  - Reparo incremental (`applyTargetedRepair`) respeita `maxBudget = 3` e não regride clipes já aprovados.
