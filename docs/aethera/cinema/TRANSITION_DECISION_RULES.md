# TRANSITION_DECISION_RULES — Direção Editorial Inteligente

**Princípio fundamental:** O **corte seco (`hard_cut`) é a opção padrão de primeira classe**. Toda transição diferente de `hard_cut` deve responder objetivamente à pergunta:
> *"Por que esta transição é melhor do que um corte seco neste momento do vídeo?"*

---

## 1. Critérios Avaliados pelo Intelligent Transition Director

1. **Gênero e identidade editorial** (`anime`, `amv`, `games`, `documentary`, `trailer`, `curiosities`, `ranking`, `motion_graphics`, `suspense`).
2. **Delta narrativo entre Cena A e Cena B**: continuidade da mesma cena (`continuity`), troca de assunto (`topic_shift`), salto temporal (`time_skip`), impacto/clímax (`climax_impact`), comparação (`comparison`), revelação (`reveal`) ou pausa emocional (`emotional_beat`).
3. **Alinhamento sonoro e musical**: presença de `beatHit` no grid musical, pausa natural na narração (`narrationGapMs`) e ausência de fala cruzando o ponto de corte.
4. **Movimento e composição**: direção de movimento compatível, presença de texto/legenda na SafeZone e resolução da mídia.
5. **Orçamento e anti-repetição**: nunca repetir a mesma transição estilizada em cortes consecutivos (`cooldown >= 2` cortes); manter pelo menos `60–75%` de cortes limpos (`hard_cut` / `j_cut` / `l_cut`) em produções narrativas.

---

## 2. Regras por Gênero e Momento Narrativo

| Gênero | Padrão Base | Quando Usar Transição (e Por Quê é Melhor que Corte Seco) | Contraindicações |
| :--- | :--- | :--- | :--- |
| **Anime de ação** | `hard_cut` (70%+) | • `impact_cut` / `white_flash` / `impact_shake` **somente** em golpes, transformações ou picos de energia sincronizados com SFX.<br>• `energy_wipe` / `manga_panel_transition` na mudança de arco/oponente.<br>• `j_cut` / `fade_to_white` em memórias ou momento emocional. | Nunca usar `glitch_cut` ou `3d_cube` em anime clássico; nunca flash > `3 Hz`. |
| **AMV musical** | `impact_cut` + `hard_cut` | • `velocity_edit` / `zoom_punch` / `rgb_split` travados no `beatGrid` para reforçar o drop musical.<br>• `speed_ramp` quando há continuidade de movimento entre dois planos de ação. | Não usar `cross_dissolve` lento em trechos de BPM > 120. |
| **Ranking de jogos** | `hard_cut` + `shape_wipe` | • `hud_reveal` / `shape_wipe` / `typography_morph` **apenas** na troca de posição do ranking (ex.: `#5 -> #4`).<br>• `camera_whip` / `glitch_cut` em transições de jogos sci-fi/ação.<br>• `hard_cut` dentro da explicação de um mesmo jogo. | Não usar `film_burn` ou `light_leak` em UI/HUD de gameplay. |
| **Documentário narrativo** | `hard_cut` + `j_cut` / `l_cut` | • `j_cut` / `l_cut` quando a narração conecta duas cenas distintas sem quebrar o raciocínio.<br>• `cross_dissolve` (`0.6s`) em passagem de tempo ou reflexão emocional.<br>• `fade_to_black` no encerramento de ato. | Proibido `white_flash`, `impact_shake`, `rgb_split` ou `elastic_slide`. |
| **Trailer cinematográfico** | `hard_cut` + `smash_cut` | • `black_flash` / `dip_to_color` com `sub_drop` e `riser` para escalar tensão entre atos do trailer.<br>• `smash_cut` para silêncio dramático antes da revelação final. | Evitar transições lentas no clímax final (preferir cortes rápidos no beat). |
| **Curiosidades / YouTube** | `hard_cut` / `jump_cut` | • `perspective_flip` / `split_screen_reveal` para contrastar "Mito vs. Fato".<br>• `l_cut` ao entrar em B-roll ilustrativo mantendo o ritmo da voz. | Não abusar de wipes entre frases do mesmo tópico. |
| **Motion graphics informativo** | `shape_wipe` + `hard_cut` | • `typography_morph` / `shape_wipe` para conectar dados e capítulos.<br>• `3d_parallax` na abertura de seção. | Não girar texto longo em 3D se comprometer leitura em mobile 9:16. |
| **Suspense** | `hard_cut` + `j_cut` | • `rack_focus_blur` / `fade_to_black` curto com `riser` ou silêncio tenso.<br>• `j_cut` com som ambiente antecipando o perigo antes da imagem. | Proibido `elastic_slide`, `pixel_dissolve` ou transições coloridas alegres. |

---

## 3. Fluxo de Decisão Registrado no Timeline IR
Toda decisão do diretor registra no campo `reason` do `TimelineTransition`:
1. A técnica escolhida (`techniqueId`, `ffmpegXfade` / `audioSync`).
2. A justificativa comparativa contra o corte seco (ex.: *"J-cut de 0.5s antecipa a ambiência da Cena B mantendo fluidez da narração sobre mudança de tópico, superior ao corte seco que causaria ruptura brusca."*).
3. O estado de validação (`studied` vs. `validated_experiment` vs. `approved_preference`).
