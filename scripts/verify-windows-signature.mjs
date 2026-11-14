import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const artifact = process.argv[2] ?? 'dist/Singularity-Setup-0.1.60-x64.exe';
if (!existsSync(artifact)) throw new Error(`missing Windows artifact: ${artifact}`);

const signtool = process.env.SIGNTOOL_PATH ?? 'signtool.exe';
try {
  const output = execFileSync(signtool, ['verify', '/pa', '/all', artifact], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`Authenticode verification passed: ${artifact}`);
  if (output.trim()) console.log(output.trim());
} catch (error) {
  const detail = error?.stderr?.toString?.().trim() || error?.message || 'unknown signature verification failure';
  throw new Error(`Authenticode verification failed for ${artifact}: ${detail}`, { cause: error });
}
