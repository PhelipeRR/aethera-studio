# Fase 35 — Velix: Estúdio e modelo Dossiê

**Status:** IMPLEMENTADA em 2026-10-30, aguardando um vídeo completo pela interface instalada.

## Objetivo

Montar o vídeo na própria aba do Velix, no estilo de dossiê com dados, sem depender do Chat. "Editar meus takes" continua no Chat, porque edita vídeo gravado.

## Decisões

- **Modelo do app:** `velix-dossie.ts` guarda o HTML, e o app o grava apontando para o motor do kit instalado. O kit não é alterado. Os blocos são fixos, então um agente preenche dados, mas não redesenha a tela.
- **Dados como arquivo:** `narracao/elevenlabs.txt` e `motion/roteiro.json`, na pasta do vídeo. O Estúdio edita esses arquivos.
- **Agente sem edição:** o roteiro é uma pergunta somente leitura; quem salva, sincroniza e renderiza é o app. Fotos fora da lista aprovada são descartadas.
- **Sincronia:** cada cena e bloco traz uma `frase` da narração. O app transcreve a voz, localiza as frases e distribui entre vizinhas as que não achar. Se a voz já existe, o roteiro mantém o texto gravado.
- **Áudio final:** o render passa pelo `exportar` do kit, para ficar perto de -14 LUFS.
- **Duração:** até 3 minutos, com no máximo 3 blocos por cena.

## Só Claude e limite

O Velix usa apenas o Claude Code. O evento `rate_limit_event` da CLI traz `unifiedWindows` com utilização real; o app faz uma consulta mínima com Haiku e interrompe ao receber os números. A resposta fica guardada por 5 minutos na tela e é renovada se tiver mais de 60 s antes de gastar Claude. Acima de 95%, ou com status `rejected`, roteiro, temas, pesquisa e plano de captura são recusados no processo principal. Limite desconhecido não bloqueia, mas a tela avisa. Sincronizar e renderizar não usam Claude, então seguem liberados.

## Limites

- Termos que a transcrição escreve de outra forma ("Pê Tê" e "PT") podem não ser achados; nesses casos o tempo é aproximado.
- O formato de `rate_limit_event` não é uma API documentada: se mudar, a barra some e nada é bloqueado.
- A trilha ainda não entra no render do Estúdio.
