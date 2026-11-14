# Voz da Neura

O Neura usa o VoiceStudio local como saída de voz e reconhecimento contínuo. O processo principal fala com o VoiceStudio somente por loopback (`localhost:3900`); o renderer envia apenas frames PCM durante uma sessão consentida e recebe o áudio já gerado para reproduzi-lo no HUD.

## Voz escolhida

O padrão é o preset não pessoal `Nova` do VoiceStudio, escolhido para uma voz feminina natural sem usar a voz clonada `Phelipe PT-BR`. O perfil de design `Neura Lumen` continua disponível como fallback ou por configuração explícita. A velocidade é levemente abaixo do normal (`0.96`) e o idioma é enviado a cada fala: `en-US` gera inglês e `pt-BR` gera português brasileiro.

Briefing de produto para criar uma voz própria no VoiceStudio:

```text
Voz feminina adulta, natural e conversacional; calorosa, clara, inteligente e tranquila; dicção precisa, confiança gentil, emoção discreta, sem voz soprosa, sem tom de locutora e sem imitar uma pessoa real. Deve soar bem em português brasileiro e inglês.
```

No OmniVoice instalado, use no campo **Descreva a sua voz** somente os atributos reconhecidos pelo parser:

```text
female, moderate pitch
```

Os termos livres do briefing, como `natural`, `warm` e `conversational`, aparecem como “não foi possível mapear” no OmniVoice atual; isso não é uma falha da voz, apenas significa que esses descritores não viraram controles do motor. Para não deixar o motor escolher uma pronúncia estrangeira, o adaptador envia orientação de pronúncia nativa brasileira quando o idioma é `pt`/`pt-BR`.

O Neura seleciona automaticamente o primeiro modelo TTS instalado e prefere o preset `nova`. Se esse preset não existir, procura o perfil de catálogo com o nome exato `Neura Lumen`; perfis pessoais, como `Phelipe PT-BR`, nunca são escolhidos. Se nenhum dos dois existir, usa o alias sintético `default`. Para fixar uma voz criada especificamente para a Neura antes de iniciar o app, use:

```powershell
$env:NB_NEURA_VOICE_MODEL_ID = 'id-do-modelo'
$env:NB_NEURA_VOICE_ID = 'id-da-voz-criada-para-a-neura'
```

Se o VoiceStudio estiver desligado, incompatível ou sem modelo/voz, o HUD usa a voz local do sistema como fallback e mantém o reconhecimento de fala independente.

## Escuta contínua e ativação por voz

Com `Ativar a Neura` e `Permitir ouvir o microfone` ligados, a escuta inicia automaticamente quando o NeuralBridge abre e quando o VoiceStudio fica disponível. A captura usa a transcrição WebSocket contínua para evitar esperar um arquivo de até 10 segundos; o reconhecimento em lote permanece apenas como fallback. O botão `Parar de ouvir` interrompe a sessão manualmente; abrir o app novamente ou conceder o consentimento inicia outra vez. Durante a escuta, o fluxo é:

1. diga **“Neura”**;
2. o HUD toca um bip curto local, sem enviar áudio para outro serviço;
3. diga o comando em até oito segundos — por exemplo, **“próxima música”**;
4. a Neura executa o comando e responde na voz configurada.

Também é possível dizer **“Neura, próxima música”** em uma única frase. O bip acontece antes do processamento do comando. A palavra de ativação sozinha não gera uma fala extra: “Estou ouvindo” aparece no HUD e o bip é a confirmação sonora.

## Voz personalizada

O Neura não usa o perfil pessoal `Phelipe PT-BR`. Para uma voz customizada própria da Neura, instale ou crie primeiro outro perfil no VoiceStudio usando uma amostra autorizada e confirme as licenças do aplicativo, modelo, voz e áudio gerado. Enquanto isso, o preset `nova` mais as instruções específicas de idioma mantêm uma identidade sintética separada. O adaptador atual consome o catálogo de modelos/vozes e a API de síntese; ele não envia amostras para serviço remoto nem inclui modelos no instalador.

Modelos e vozes têm licenças próprias. Uma voz/modelo não comercial não deve ser usado em um produto comercial sem autorização.

