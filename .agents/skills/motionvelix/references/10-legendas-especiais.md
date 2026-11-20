# 10 · Legendas especiais: infantil (música) e premium

## A) `legenda-infantil.html`: música e animação para crianças
Fonte Fredoka, cores de bala que alternam, contorno branco grosso e sombra de desenho animado.
- As palavras entram uma a uma no tempo do canto, com mola e rotação.
- A palavra cantada dá um pulinho, e todas dão um squash a cada batida.
- Efeitos interativos: `emoji` (anim pulsa | gira | pula), `chuva` (explosão de emojis com gravidade), `balao` ("Bate palma! 👏"), `notas` (♪ subindo no beat), `girar` e `tremer` (aplicados à frase).

Pipeline para música (a voz cantada precisa ser separada):
```bash
pip install "audio-separator[cpu]" audioread --break-system-packages   # os modelos vêm do GitHub (TRvlvr/model_repo)
audio-separator audio.wav -m UVR-MDX-NET-Voc_FT.onnx --output_dir sep --model_file_dir models
# letra: python3 $S/scripts/transcrever.py sep/voz.wav letra.json  → CORRIJA a letra à mão
# tempo: librosa.onset_detect na voz → escolha N onsets por linha (N = sílabas) → palavra = onset da 1ª sílaba
# encaixe cada palavra na colcheia mais próxima (tolerância de 0,09s) usando mv_edit.py batidas --salvar bat.json
```
Dados: `{dur, capY, beats, words:[{w,s,e,l}], lines:[{a,b}], efeitos:[...]}`. A legenda fica na faixa da grama ou do chão (capY ~1430), e os balões vão acima da cabeça do personagem (y ~330), nunca sobre o rosto.

## B) `legenda-premium.html`
Palavras surgem com blur, palavras-chave em serifa itálica com sublinhado em cor de destaque, e um véu escuro suave atrás.
⚠ O primeiro cliente (loja de cubas) **não gostou** desse estilo. Antes de usar com marca comercial, mostre uma prévia em PNG. Para varejo e promoção, prefira as legendas de `overlay-talking-head.html` (estilo caixa ou destaque).

## Transcrever fala com música de fundo
- `transcrever.py` já distribui as palavras pelas "ilhas de fala" (RMS em janelas de 20 ms) dentro de cada trecho de VAD. Em música, refine com onsets e batidas como acima.
- Sempre corrija marcas e nomes à mão (ex.: "Hidrohouse", "inox").
