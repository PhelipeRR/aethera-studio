# Exemplo: corte viral com números → motion (aprovado pelo cliente: "sensacional")

Talking head (vídeo longo) → corte de ~45s → vertical → cenas de motion em fundo sólido para **cada número falado** → texto gigante atrás da pessoa → legenda caixa.

- `reel.html`: overlay `--alpha` com cenas (iPhone Tempo de Uso, conta R$ 3.000 ÷ 160h, contador R$ 1.687 com notas voando, barra dos 100 mil perdendo 20%, ampulheta) e legendas (lê `palavras.json`)
- `atras.html`: palavras gigantes para `mv_visao.py atras` (PROBLEMA, VOCÊ NEM PERCEBE)

Pipeline:
```
mv_visao.py reframe → mv_edit.py silencio → palavras.json → mv_visao.py recorte corte.mp4 pessoa.mov
render atras.html → atras.webm (--alpha) ; render reel.html → reel.webm (--alpha)
tpad +1,5s → mv_visao.py atras base.mp4 atras.webm comAtras.mp4 --pessoa pessoa.mov
→ grade → zoom → compor reel.webm → exportar → qc
```

Regras:
- As cenas devem cobrir os gráficos que já vêm gravados no original.
- A cena seguinte entra **antes** da anterior sair, para não aparecer o vídeo por baixo.
- Peças que caem devem sumir com fade.
- Credite o criador original no final.
