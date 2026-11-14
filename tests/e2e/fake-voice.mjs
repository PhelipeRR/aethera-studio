// Prints what a speech engine would hear, through the same line protocol as the Windows provider.
const lines = ['conversa de fundo que ninguém pediu', 'Neura, próxima música'];
for (const text of lines) console.log(JSON.stringify({ text, confidence: 0.9 }));
setInterval(() => undefined, 60_000);
