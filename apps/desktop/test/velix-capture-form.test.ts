import { describe, expect, it } from 'vitest';
import { envFromText, envToText, screensFromText, screensToText } from '../src/renderer/src/features/video/capture-form';

describe('capture form', () => {
  it('round-trips screens and skips empty lines', () => {
    const screens = [{ name: 'Chat', path: '#/chat' }, { name: 'Início', path: '/' }];
    expect(screensFromText(`${screensToText(screens)}\n\n`)).toEqual(screens);
    expect(screensFromText('Só nome')).toEqual([{ name: 'Só nome', path: '' }]);
  });

  it('round-trips env and keeps equals signs in the value', () => {
    expect(envFromText(envToText({ NB_DATA_DIR: 'C:\\demo', A: 'b=c' }))).toEqual({ NB_DATA_DIR: 'C:\\demo', A: 'b=c' });
    expect(envFromText('sem igual\n=vazio')).toEqual({});
  });
});
