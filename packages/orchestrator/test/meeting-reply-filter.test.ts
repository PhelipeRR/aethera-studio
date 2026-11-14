import { describe, expect, it } from 'vitest';
import { needsReply, shouldDraft } from '../src/meeting/reply-filter.js';

describe('needsReply', () => {
  it('takes what was transcribed as a question', () => {
    for (const text of ['Quando a entrega fica pronta?', 'E o maior risco?', 'What is the timeline?', 'Tudo certo ?']) expect(needsReply(text)).toBe(true);
  });

  it('hears a question Whisper left without a question mark', () => {
    for (const text of ['Quando a entrega fica pronta', 'qual é o prazo', 'por que atrasou', 'o que você acha disso', 'Você pode me mandar o relatório', 'Consegue revisar hoje', 'can you share the timeline', 'how long will it take', 'Could you share the timeline with the team']) expect(needsReply(text)).toBe(true);
  });

  it('hears a request made in passing', () => {
    expect(needsReply('Então, João, você consegue fechar isso até sexta.')).toBe(true);
    expect(needsReply('Preciso que você revise o contrato.')).toBe(true);
    expect(needsReply('Me diz se faz sentido.')).toBe(true);
  });

  it('stays quiet on what asks for nothing', () => {
    for (const text of ['Ok, o pessoal do financeiro já aprovou o orçamento.', 'Vamos seguir com o planejamento.', 'Bom dia, pessoal.', 'Isso mesmo.', 'We shipped the release yesterday.', 'Quando eu cheguei, a reunião já tinha começado.', 'Como eu disse, está tudo certo.']) expect(needsReply(text)).toBe(false);
  });

  it('ignores what Whisper makes of silence', () => {
    for (const text of ['', '   ', '...']) expect(needsReply(text)).toBe(false);
  });

  it('always drafts what the user pasted, and filters only what was captured', () => {
    expect(shouldDraft({ sourceId: 'manual-transcript' }, 'O orçamento foi aprovado.')).toBe(true);
    expect(shouldDraft({ sourceId: 'system-audio' }, 'O orçamento foi aprovado.')).toBe(false);
    expect(shouldDraft({ sourceId: 'system-audio' }, 'O orçamento foi aprovado?')).toBe(true);
  });
});
