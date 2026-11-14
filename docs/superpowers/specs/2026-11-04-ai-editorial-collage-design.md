# Colagem editorial com IA — Design

## Intenção

Adicionar à Fase 48.8 um provedor opcional de colagem editorial: a pessoa descreve uma metáfora, aprova o custo e a proposta, aprova o quadro parado, e só então o app gera um clipe B-roll. O resultado é validado, registrado no Rights Manager e pode entrar entre cenas da mistura de estilos.

## Abordagem escolhida

Usar uma interface de provedor com uma implementação Gemini no processo principal e um provedor fake determinístico nos testes. O renderer nunca recebe a chave nem chama a internet. O main guarda a chave com `safeStorage`, mostra estimativa antes da primeira aprovação, faz duas aprovações de uso único e registra a origem da mídia gerada.

## Escopo

- Contrato compartilhado para estimativa, metáfora, quadro, geração e QA.
- A funcionalidade é opcional no produto, mas indisponível até a pessoa configurar uma chave Gemini válida.
- Cliente Gemini REST limitado a endpoints configuráveis HTTPS/loopback em testes.
- Persistência mínima de chave cifrada e jobs/artefatos de colagem.
- IPC/preload/UI para o fluxo de aprovações.
- Inserção de clipes aprovados como B-roll entre cenas da mistura.
- Testes de contrato, segurança, fake provider, integração FFmpeg e E2E.

## Fora de escopo

- Geração sem aprovação humana.
- Chave em banco, renderer, logs ou texto puro.
- Uso automático de mídia não aprovada pelo Rights Manager.
- Dependência ou scripts do repositório `gbro-collage-broll`.

## Decisões de segurança

- A chave Gemini fica em arquivo cifrado por `safeStorage`; se a criptografia não estiver disponível, a operação falha antes da rede.
- Toda resposta externa é tratada como dado não confiável, limitada por tamanho e validada por schema.
- O vídeo só entra na mistura depois de QA de arquivo, FFprobe e registro de direitos `verified_allowed`.
- O fake provider não acessa rede e gera arquivos locais válidos para os testes.
