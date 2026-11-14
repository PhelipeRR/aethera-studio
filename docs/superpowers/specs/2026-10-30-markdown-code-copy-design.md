# Copiar blocos de código Markdown

## Intenção

Adicionar uma ação de copiar aos blocos de código exibidos nas respostas do chat, especialmente textos de commit, para que o usuário não precise selecionar manualmente conteúdo com rolagem horizontal.

## Escopo

- Adicionar botão acessível em todos os blocos de código renderizados por `MarkdownView`.
- Copiar somente o conteúdo do bloco, sem as cercas Markdown.
- Mostrar feedback temporário `Copiado` e manter o estado original quando a cópia falhar.
- Preservar o estilo visual existente e não alterar o conteúdo renderizado.

## Abordagens consideradas

1. **Todos os blocos de código (escolhida):** comportamento previsível, reutilizável e atende o caso de commit sem heurísticas frágeis.
2. **Somente blocos com linguagem ou formato de commit:** interface mais seletiva, mas exige regras para reconhecer conteúdo e deixaria blocos úteis sem a ação.

## Implementação proposta

Estender `MarkdownView` com um renderer para `code`, usando o padrão de `CopyButton` já existente em `McpPage`. O teste verificará que o botão copia o conteúdo e fornece feedback acessível de sucesso.

## Fora do escopo

Não haverá alteração no formato Markdown, no backend, no histórico de conversas ou em outros tipos de texto.
