import { describe, expect, it } from 'vitest';
import { findSecrets, maskSecrets } from '../src/secrets.js';

describe('secret detection', () => {
  it('finds known credential formats', () => {
    const samples = [
      'use a chave sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv para testar',
      'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345',
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAABCDEFGHIJKLMNOP é a chave da AWS',
      'Authorization: Bearer abc.def.ghi-longvalue',
      'password: hunter2hunter2',
      '"client_secret": "x9-not-real-but-long"',
      'Server=db;User Id=sa;Password=Sup3rS3nha!;',
      'postgres://admin:segredo123@db.local:5432/app',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx',
      'AIzaSyA1234567890abcdefghijklmnopqrstuv',
    ];
    for (const sample of samples) expect(findSecrets(sample), sample).not.toEqual([]);
  });

  it('finds long random-looking tokens by entropy', () => {
    expect(findSecrets('o valor é Zq8xK2mP9vR4tY7wB3nL6hJ1cF5dG0sA no arquivo')).toEqual([expect.objectContaining({ kind: 'high-entropy' })]);
  });

  it('leaves ordinary technical text alone', () => {
    const text = [
      'Use Redis com TTL de 300 segundos no cache de pedidos; max_tokens=100 e "input_tokens": 120.',
      'O commit 3cdd1f9 corrigiu o bug; veja packages/brain/src/brain-service.ts e docs/PLAN.md.',
      'ULID 01J8ZK3Q4W5E6R7T8Y9U0I1O2P identifica a memória; a senha deve ser lida de variável de ambiente.',
      'https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md',
      'sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n');
    expect(findSecrets(text)).toEqual([]);
  });

  it('masks what it finds, keeping the rest readable', () => {
    const masked = maskSecrets('Conecte com password=hunter2hunter2 e token ghp_abcdefghijklmnopqrstuvwxyz0123456789 no CI.');
    expect(masked).toBe('Conecte com password=*** e token *** no CI.');
  });
});
