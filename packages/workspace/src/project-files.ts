import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isInsideProject, isSensitiveFile } from './project-paths.js';
import { scanProject } from './stack.js';

const KNOWN = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'README',
  'CONTRIBUTING.md',
  'package.json',
  'tsconfig.json',
  'global.json',
  'Directory.Build.props',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yaml',
  'Dockerfile',
  '.env.example',
];
const MANIFEST = /(\.sln|\.slnx|\.csproj|\.fsproj|\/package\.json|schema\.prisma|pyproject\.toml)$/i;
const PREVIEW_LIMIT = 256 * 1024;

/** Files that explain a project to a person or an agent: instructions, readme, manifests. Never secrets. */
export async function relevantFiles(root: string): Promise<string[]> {
  const files = await scanProject(root);
  const present = new Set(files);
  const known = KNOWN.filter((file) => present.has(file));
  const manifests = files.filter((file) => MANIFEST.test(file.includes('/') ? file : `/${file}`) && !known.includes(file)).slice(0, 20);
  return [...known, ...manifests].filter((file) => !isSensitiveFile(file));
}

export type FileRead = { ok: true; content: string } | { ok: false; reason: string };

/** Preview of a small text file, refusing anything outside the project or likely to hold secrets. */
export function readProjectFile(root: string, relativePath: string): FileRead {
  if (!isInsideProject(root, relativePath)) return { ok: false, reason: 'Arquivo fora do projeto.' };
  if (isSensitiveFile(relativePath)) return { ok: false, reason: 'Arquivo sensível: o NeuralBridge não exibe arquivos que costumam guardar segredos.' };
  const path = join(root, relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, reason: 'Arquivo não encontrado.' };
  if (statSync(path).size > PREVIEW_LIMIT) return { ok: false, reason: 'Arquivo grande demais para pré-visualizar (limite de 256 KB).' };
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8192).includes(0)) return { ok: false, reason: 'Arquivo binário: não há pré-visualização.' };
  return { ok: true, content: bytes.toString('utf8') };
}
