/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS run as Electron's main script by the M2 safeStorage test. */
const { app, safeStorage } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = new Set(process.argv.slice(2));
const dataDir = process.argv[process.argv.indexOf('--data-dir') + 1];
if (!dataDir) throw new Error('missing --data-dir');
app.setName('NeuralBridge');
app.setPath('userData', dataDir);

app.whenReady().then(() => {
  const encrypted = join(dataDir, 'safe-probe.bin');
  if (!safeStorage.isEncryptionAvailable()) {
    process.exitCode = 2;
    app.quit();
    return;
  }
  if (args.has('--write')) writeFileSync(encrypted, safeStorage.encryptString('m2-safe-storage-probe'), { mode: 0o600 });
  if (args.has('--read')) writeFileSync(join(dataDir, 'safe-probe-result.txt'), safeStorage.decryptString(readFileSync(encrypted)), { encoding: 'utf8', mode: 0o600 });
  app.quit();
});
