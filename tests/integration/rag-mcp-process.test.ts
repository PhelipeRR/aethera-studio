import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDatabase, projects } from '@neuralbridge/database';
import { RagEngine } from '@neuralbridge/brain';
import { describe, expect, it } from 'vitest';

const migrations = fileURLToPath(new URL('../../packages/database/migrations', import.meta.url));
const server = fileURLToPath(new URL('../../apps/desktop/out/main/mcp-server.js', import.meta.url));

describe('MCP RAG process integration', () => {
  it('indexes real files and searches through an independent MCP process', async () => {
    const data = await mkdtemp(join(tmpdir(), 'nb-mcp-rag-')); const root = await mkdtemp(join(tmpdir(), 'nb-rag-project-')); await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'auth.md'), '# Authentication\nOAuth login protects credentials.');
    const handle = openDatabase(join(data, 'db', 'brain.db'), { migrationsFolder: migrations });
    handle.db.insert(projects).values({ id: 'p', name: 'p', rootPath: root }).run();
    await new RagEngine(handle).indexProject('p', root); handle.close();
    const transport = new StdioClientTransport({ command: process.execPath, args: [server, '--project', 'p', '--migrations', migrations], env: { NB_DATA_DIR: data, PATH: process.env.PATH ?? '' } });
    const client = new Client({ name: 'rag-process-test', version: '1.0.0' });
    await client.connect(transport);
    const result = await client.callTool({ name: 'brain_rag_search', arguments: { query: 'OAuth credentials', limit: 3 } }) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).not.toBe(true); expect(result.content[0]?.text).toContain('src/auth.md:1-2');
    await client.close();
  }, 30_000);
});
