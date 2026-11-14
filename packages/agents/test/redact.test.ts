import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/redact.js';

describe('redactSecrets', () => {
  it.each([
    ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv_-123', 'sk-ant-api03-AbC'],
    ['OPENAI sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'AbCdEfGhIjKlMnOp'],
    ['ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123', 'AbCdEfGhIj'],
    ['aws AKIAABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOP'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'dozjgNryP4J3'],
    ['Authorization: Bearer abc.def-ghi_123456', 'abc.def-ghi'],
    ['{"access_token": "s3cr3t-value-here"}', 's3cr3t-value'],
    ['DB_PASSWORD=hunter22 next', 'hunter22'],
    ['api_key=XYZ987654321', 'XYZ987654321'],
  ])('removes %s', (input, secretPart) => {
    const output = redactSecrets(input);
    expect(output).not.toContain(secretPart);
    expect(output).toContain('***');
  });

  it('leaves ordinary text, token counts and field names alone', () => {
    for (const text of ['"input_tokens":15015,"output_tokens":5', 'max_tokens=100', 'the token budget is 2000', 'password policy: 12 chars minimum']) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});
