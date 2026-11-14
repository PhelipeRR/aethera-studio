// Stand-in for Claude Code and Codex CLI in the E2E tests, started through NB_CLAUDE_CLI / NB_CODEX_CLI as
// `node fake-agent.mjs <claude|codex> ...cli args`. It answers detection like the real CLIs and streams runs in
// their real formats (stream-json / exec --json), so the app's adapters, parsers and engine run unchanged.
// Words in the request steer it: LENTO waits until cancelled, REPROVAR makes the first review reject,
// SEGREDO makes Codex also write a fake credential,
// USAR-SKILL / FALHAR-SKILL make Claude invoke a skill that succeeds / fails (and call an MCP tool),
// LER-SKILL makes Codex read a skill's SKILL.md and call an MCP tool.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [agent, ...args] = process.argv.slice(2);
// NB_FAKE_ARGS_LOG: one JSON line per run with the arguments the app passed, so tests can check the flags.
if (process.env.NB_FAKE_ARGS_LOG && (args.includes('-p') || args[0] === 'exec') && !args.includes('--help')) appendFileSync(process.env.NB_FAKE_ARGS_LOG, JSON.stringify({ agent, args }) + '\n');
const out = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const has = (flag) => args.includes(flag);
const value = (flag) => args[args.indexOf(flag) + 1];

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

/** The user's words, wherever the orchestrator put them in the prompt. */
function request(prompt) {
  const match = /(?:Tarefa|Pedido original|Pedido):\n([\s\S]*?)(?:\n\n|$)/.exec(prompt);
  return (match?.[1] ?? prompt).trim();
}

/** The image type from the first bytes, as the real CLIs would see the file. */
function kindOf(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes.subarray(0, 3).toString() === 'GIF') return 'gif';
  if (bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return 'desconhecido';
}
const seen = (kinds) => (kinds.length ? ` Recebi ${kinds.length} imagem(ns): ${kinds.join(', ')}.` : '');

const slow = (prompt) => (prompt.includes('LENTO') ? new Promise((resolve) => setTimeout(resolve, 60_000)) : Promise.resolve());
const usage = { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 10, iterations: [{ input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }] };
// As in Claude Code 2.1.312's result: per-model usage with the context window.
const modelUsage = { 'fake-claude': { inputTokens: 120, outputTokens: 40, contextWindow: 200000 } };

async function claude() {
  if (has('--version')) return console.log('2.1.312 (Claude Code)');
  if (args[0] === 'auth') return console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
  if (has('--help')) return console.log('--output-format stream-json --mcp-config --strict-mcp-config --json-schema --resume --permission-mode --allowedTools');
  // `claude mcp list` output: a health check line per configured server.
  if (args[0] === 'mcp' && args[1] === 'list') {
    return console.log(['Checking MCP server health...', '', 'context7: npx -y @upstash/context7-mcp --api-key ctx7sk-falso - ✓ Connected', 'playwright: npx @playwright/mcp@latest - ✗ Failed to connect', ''].join('\n'));
  }

  const input = await readStdin();
  let prompt = input;
  const claudeImages = [];
  if (value('--input-format') === 'stream-json') {
    const content = JSON.parse(input.split('\n')[0]).message.content;
    prompt = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    for (const block of content.filter((item) => item.type === 'image')) claudeImages.push(kindOf(Buffer.from(block.source.data, 'base64')));
  }
  const sessionId = has('--resume') ? value('--resume') : randomUUID();
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-claude', mcp_servers: [{ name: 'neuralbridge', status: 'connected' }], skills: ['nb-demo', 'nb-quebrada', 'nb-ociosa'] });
  await slow(prompt);
  if (prompt.includes('<limite>')) {
    const used = Number(process.env.NB_FAKE_LIMIT ?? 20) / 100;
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: used, resetsAt: 1793418000, status: 'allowed' }, seven_day: { utilization: 0.3, resetsAt: 1793556000, status: 'allowed' } } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: sessionId });
    return;
  }
  if (prompt.includes('<roteiro>')) {
    if (prompt.includes('Derivados completos')) {
      const narration = 'Por que algumas cidades conseguem reduzir a conta de luz tão rapidamente? A resposta começa nos telhados, onde cada painel transforma o sol em energia para famílias e pequenos negócios. Quando a geração distribuída cresce, a rede também precisa acompanhar a mudança com planejamento e investimento. No fim, a transição funciona melhor quando tecnologia, regras claras e consumidores caminham juntos.';
      out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ narracao: narration, serie: 'Série teste', cenas: [{ blocos: [{ tipo: 'lead', texto: narration }] }] }), session_id: sessionId });
      return;
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ narracao: 'Uma pergunta simples. Na primeira lista, o líder era outro.', serie: 'Série teste', cenas: [{ blocos: [{ tipo: 'lead', texto: 'Uma pergunta', frase: 'Uma pergunta simples' }] }, { capitulo: { n: 1, titulo: 'As listas', cor: 'vermelho' }, fonte: 'Fonte: teste', blocos: [{ tipo: 'tarja', texto: 'O líder era outro', frase: 'o líder era outro' }] }] }), session_id: sessionId });
    return;
  }
  // Long Velix scripts: an outline with the asked chapter count, then chapters of the asked length (chapter 2 repeats
  // one sentence of chapter 1, which the consolidator must remove).
  if (prompt.includes('<esboco>')) {
    const count = Number(/exatamente (\d+) capítulos/.exec(prompt)?.[1] ?? 1);
    const outline = { title: 'Roteiro longo de teste', canonicalSummary: 'Resumo canônico.', entities: [], terms: [], styleDecisions: [], chapters: Array.from({ length: count }, (_, index) => ({ n: index + 1, title: `Parte ${index + 1}`, beats: [`ponto ${index + 1}`] })) };
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(outline), session_id: sessionId, structured_output: outline });
    return;
  }
  if (prompt.includes('<capitulo>')) {
    const n = Number(/capítulo (\d+) de/.exec(prompt)?.[1] ?? 1);
    const target = Number(/cerca de (\d+) palavras/.exec(prompt)?.[1] ?? 100);
    const repeated = n <= 2 ? ['A frase repetida entre os dois primeiros capítulos do roteiro longo.'] : [];
    const narration = [...repeated, ...Array.from({ length: Math.round(target / 11) }, (_, i) => `Capítulo ${n} traz a ideia número ${i + 1} sobre o tema central.`)].join(' ');
    const draft = { n, title: `Parte ${n}`, narration, summary: `Resumo do capítulo ${n}.`, facts: [], entities: [] };
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(draft), session_id: sessionId, structured_output: draft });
    return;
  }
  // Velix evidence: one fact citing the first approved reference (plus a source that is not approved) and one opinion.
  if (prompt.includes('<evidencias>')) {
    const approved = /<referencias>[\s\S]*?\((https?:\/\/[^)\s]+)\)/.exec(prompt)?.[1];
    const answer = {
      claims: [
        { text: 'Na primeira lista, o líder era outro.', kind: 'fact', confidence: 0.9, evidence: [...(approved ? [{ url: approved, title: 'Lista oficial', publisher: 'Fonte aprovada', publishedAt: '2025-01-10', excerpt: 'o líder era outro', confidence: 0.8, classification: 'evidence' }] : []), { url: 'https://blog.exemplo.com/lista', title: 'Post sobre a lista', publisher: 'Blog', publishedAt: null, excerpt: 'outro líder', confidence: 0.4, classification: 'evidence' }] },
        { text: 'Uma pergunta simples.', kind: 'opinion', confidence: 0.5, evidence: [] },
      ],
      media: [{ url: 'https://video.exemplo.com/lista', title: 'Vídeo da lista', kind: 'video', reason: 'ilustra' }],
    };
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(answer), session_id: sessionId, structured_output: answer });
    return;
  }
  if (prompt.includes('<captura>')) {
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ kind: 'web', command: 'node server.mjs', url: 'http://127.0.0.1:4599', env: [{ name: 'NB_DEMO', value: 'sim' }], screens: [{ name: 'Início', path: '/' }, { name: 'Vendas', path: '/vendas' }] }), session_id: sessionId });
    return;
  }
  if (prompt.includes('<pesquisa>')) {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w1', name: 'WebSearch', input: { query: 'x' } }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ references: [{ kind: 'dado', title: 'Selic em 2025', url: 'https://example.com/selic', license: 'citação', note: 'série anual' }] }), session_id: sessionId });
    return;
  }
  if (prompt.includes('<composicao>')) {
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ scenes: [{ kind: 'title', heading: 'Abertura sugerida', body: 'Subtítulo', seconds: 1 }] }), session_id: sessionId });
    return;
  }
  if (prompt.includes('<pauta>')) {
    const url = prompt.match(/\| (https:\/\/\S+)/)?.[1] ?? null;
    const round = prompt.includes('(nenhuma)\n</existentes>') ? 'Primeira' : 'Outra';
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ ideas: [{ title: `${round} ideia do nicho`, hook: 'Gancho de teste', synopsis: 'Sinopse de teste', draftScript: 'Roteiro preliminar de teste', audience: 'Curiosos', durationSeconds: 60, referenceUrls: url ? [url, 'https://inventada.example/x'] : ['https://inventada.example/x'], mediaPlan: 'Captura própria', claims: [{ text: 'Fato sem fonte válida', type: 'fact', referenceUrl: 'https://inventada.example/x' }, { text: 'Fato com fonte', type: 'fact', referenceUrl: url }] }] }), session_id: sessionId });
    return;
  }
  if (prompt.includes('<nicho>')) {
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ topics: ['Erro um do nicho', 'Erro dois do nicho'] }), session_id: sessionId });
    return;
  }
  // LIMITE-AMBOS: the usage limit, reported as Claude Code does, in the result text.
  if (prompt.includes('LIMITE-AMBOS')) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'You have reached your usage limit reached for this period.', session_id: sessionId });
    process.exitCode = 1;
    return;
  }
  let text;
  let structured;
  if (has('--json-schema')) {
    const schema = JSON.parse(value('--json-schema'));
    if (schema.properties.translation) {
      // Neura's meeting drafts: answers in the language asked for, or settles it when the engine says it could not.
      const english = prompt.includes('Response language: en') || (prompt.includes('Language ambiguous: yes') && prompt.includes('Could you'));
      structured = { text: english ? 'We can share it by Friday.' : 'Podemos compartilhar até sexta.', translation: null, confidence: 0.82, language: prompt.includes('Language ambiguous: yes') && english ? 'en' : null };
      text = 'Sugestão pronta.';
    } else if (schema.properties.text) {
      structured = { text: 'Resposta da Neura.' };
      text = 'Resposta pronta.';
    } else if (schema.properties.subject) {
      structured = {
        subject: 'feat: atualizar saudação',
        body: 'Atualiza a saudação exibida pelo módulo para refletir o novo comportamento.',
        prTitle: 'Atualiza saudação do módulo',
        prBody: 'Resumo\n\n- Atualiza o retorno staged\n- Mantém o fluxo local sem push',
        checklist: ['[ ] Revisar o diff antes de abrir a PR', '[ ] Executar a suíte do módulo'],
        changelog: 'Atualizada a saudação do módulo.',
        documentationImpact: 'Nenhuma documentação adicional é necessária.',
      };
      text = 'Proposta Smart Commit pronta.';
    } else if (schema.properties.diagnosis) {
      // Automatic fix (Phase 26): a proposal from the evidence; CORRIGIVEL makes the plan one that works.
      structured = {
        diagnosis: 'A nota não registra a correção esperada pelo teste.',
        evidence: prompt.includes('exit 1') ? ['Comando que falhou: npm test (exit 1)'] : [],
        plan: prompt.includes('CORRIGIVEL') ? 'Corrija a nota acrescentando a linha corrigido.' : 'Reescreva a nota.',
        files: ['nota.txt'],
        validation: 'npm test',
      };
      text = 'Diagnóstico pronto.';
    } else if (schema.properties.approved) {
      const approved = !prompt.includes('REPROVAR') || prompt.includes('corrigido');
      structured = approved
        ? { approved: true, issues: [], summary: 'Critérios cumpridos.' }
        : { approved: false, issues: [{ description: 'Falta a correção pedida.', fix: 'Acrescente a linha corrigido em nota.txt.' }] };
      text = approved ? 'Revisão aprovada.' : 'Revisão reprovada.';
    } else {
      structured = {
        summary: `Atender: ${request(prompt)}`,
        steps: [{ title: 'Escrever a nota', instructions: 'Crie nota.txt com o resultado.', files: ['nota.txt'] }],
        acceptance: ['nota.txt existe'],
      };
      text = 'Plano pronto.';
    }
  } else {
    text = `Resposta do agente falso para: ${request(prompt)}${seen(claudeImages)}`;
  }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'TODO' } }] } });
  if (prompt.includes('USAR-SKILL')) {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'nb-demo' } }] } });
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: 'Launching skill: nb-demo' }] } });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm1', name: 'mcp__neuralbridge__brain_search', input: { query: 'checkout' } }] } });
  }
  if (prompt.includes('FALHAR-SKILL')) {
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's2', name: 'Skill', input: { skill: 'nb-quebrada' } }] } });
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's2', content: 'Unknown skill: nb-quebrada', is_error: true }] } });
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId, usage, modelUsage, total_cost_usd: 0.0012, ...(structured ? { structured_output: structured } : {}) });
}

async function codex() {
  if (has('--version')) return console.log('codex-cli 0.162.1');
  if (args[0] === 'login') return console.error('Logged in using ChatGPT');
  if (has('--help')) return console.log('--json --output-schema resume --skip-git-repo-check');
  // `codex mcp list --json` (codex-cli 0.162.1 shape); listing does not connect to the servers.
  if (args[0] === 'mcp' && args[1] === 'list') {
    const server = (name, enabled) => ({ name, enabled, disabled_reason: null, transport: { type: 'stdio', command: 'npx', args: [name], env: { TOKEN: 'segredo-falso' }, env_vars: [], cwd: null }, startup_timeout_sec: null, tool_timeout_sec: null, auth_status: 'unsupported' });
    return console.log(JSON.stringify([server('neuralbridge', true), server('antigo', false)]));
  }

  const prompt = await readStdin();
  const codexImages = args.filter((arg) => arg.startsWith('--image=')).map((arg) => arg.slice('--image='.length)).map((file) => (existsSync(file) ? kindOf(readFileSync(file)) : 'ausente'));
  const sessionId = args[1] === 'resume' ? args.at(-2) : randomUUID();
  out({ type: 'thread.started', thread_id: sessionId });
  out({ type: 'turn.started' });
  await slow(prompt);
  if (prompt.includes('<limite>')) {
    // Like codex-cli 0.166: --json reports tokens only; the rate-limit snapshot goes to the session file in CODEX_HOME.
    const day = join(process.env.CODEX_HOME ?? '.', 'sessions', '2026', '11', '10');
    mkdirSync(day, { recursive: true });
    const used = Number(process.env.NB_FAKE_CODEX_LIMIT ?? 40);
    const snapshot = { limit_id: 'codex', primary: { used_percent: used, window_minutes: 300, resets_at: 1793418000 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1793556000 } };
    writeFileSync(join(day, `rollout-2026-11-10T12-00-00-${sessionId}.jsonl`), `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: snapshot } })}\n`);
    out({ type: 'item.completed', item: { id: 'l1', type: 'agent_message', text: 'ok' } });
    out({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 } });
    return;
  }
  if (prompt.includes('<composicao>')) {
    out({ type: 'item.completed', item: { id: 'composicao', type: 'agent_message', text: JSON.stringify({ scenes: [{ kind: 'title', heading: 'Abertura sugerida', body: 'Subtítulo', seconds: 1 }] }) } });
    out({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 10 } });
    return;
  }
  // LIMITE-CODEX and LIMITE-AMBOS: Codex is out of usage.
  if (prompt.includes('LIMITE-CODEX') || prompt.includes('LIMITE-AMBOS')) {
    out({ type: 'turn.failed', error: { message: 'usage limit reached' } });
    process.exitCode = 1;
    return;
  }
  // Smart Commit & PR Assistant (Phase 38.5): keep the UI E2E deterministic while
  // exercising the real adapter, TaskEngine, IPC and Git authorization path.
  if (args.includes('--output-schema')) {
    const schemaPath = value('--output-schema');
    const schema = schemaPath && existsSync(schemaPath) ? JSON.parse(readFileSync(schemaPath, 'utf8')) : null;
    if (schema?.properties?.subject) {
      const proposal = {
        subject: 'feat: atualizar saudação',
        body: 'Atualiza a saudação exibida pelo módulo para refletir o novo comportamento.',
        prTitle: 'Atualiza saudação do módulo',
        prBody: 'Resumo\n\n- Atualiza o retorno staged\n- Mantém o fluxo local sem push',
        checklist: ['[ ] Revisar o diff antes de abrir a PR', '[ ] Executar a suíte do módulo'],
        changelog: 'Atualizada a saudação do módulo.',
        documentationImpact: 'Nenhuma documentação adicional é necessária.',
      };
      out({ type: 'item.completed', item: { id: 'smart-commit', type: 'agent_message', text: JSON.stringify(proposal) } });
      out({ type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 40, output_tokens: 120 } });
      return;
    }
  }
  // FALHAR: the run fails after a failing test command, as a real one would.
  if (prompt.includes('FALHAR')) {
    out({ type: 'item.completed', item: { id: 'f1', type: 'command_execution', command: 'npm test', exit_code: 1, status: 'completed' } });
    out({ type: 'turn.failed', error: { message: 'npm test falhou' } });
    process.exitCode = 1;
    return;
  }
  if (prompt.includes('TIMEOUT')) {
    out({ type: 'turn.failed', error: { message: 'provider timeout' } });
    process.exitCode = 1;
    return;
  }
  if (prompt.includes('<pesquisa>')) {
    if (!prompt.includes('SEM-BUSCA')) out({ type: 'item.completed', item: { id: 'w1', type: 'web_search', query: 'x' } });
    out({ type: 'item.completed', item: { id: 'r1', type: 'agent_message', text: JSON.stringify({ references: [{ kind: 'texto', title: 'Fonte Codex', url: 'https://example.org/codex', license: 'citação', note: '' }, { kind: 'texto', title: 'Sem https', url: 'http://example.org/x', license: 'citação', note: '' }] }) } });
    out({ type: 'turn.completed', usage: {} });
    return;
  }
  if (prompt.includes('<pauta>')) {
    const text = prompt.includes('CHAVES-PROPRIAS') ? JSON.stringify({ ideas: [{ titulo: 'Fora do contrato' }] }) : JSON.stringify({ ideas: [{ title: 'Ideia do Codex', hook: 'Gancho', synopsis: 'Sinopse', draftScript: 'Roteiro', audience: 'Curiosos', durationSeconds: 45, referenceUrls: [], mediaPlan: 'Captura própria', claims: [] }] });
    out({ type: 'item.completed', item: { id: 'r2', type: 'agent_message', text } });
    out({ type: 'turn.completed', usage: {} });
    return;
  }
  if (args.includes('sandbox_mode="workspace-write"') || args.includes('--dangerously-bypass-approvals-and-sandbox')) {
    const file = join(process.cwd(), 'nota.txt');
    if (prompt.includes('Corrija')) appendFileSync(file, 'corrigido\n');
    else writeFileSync(file, `feito: ${request(prompt)}\n`);
    out({ type: 'item.completed', item: { id: 'i1', type: 'file_change', changes: [{ path: file, kind: 'add' }], status: 'completed' } });
    // SEGREDO: also writes a (fake) credential, for the security review to catch.
    if (prompt.includes('SEGREDO')) {
      const config = join(process.cwd(), 'config.ts');
      writeFileSync(config, 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
      out({ type: 'item.completed', item: { id: 'i6', type: 'file_change', changes: [{ path: config, kind: 'add' }], status: 'completed' } });
    }
  }
  out({ type: 'item.completed', item: { id: 'i2', type: 'command_execution', command: 'npm test', exit_code: 0, status: 'completed' } });
  if (prompt.includes('LER-SKILL')) {
    out({ type: 'item.completed', item: { id: 'i4', type: 'command_execution', command: String.raw`Get-Content C:\Users\falso\.codex\skills\nb-demo\SKILL.md`, exit_code: 0, status: 'completed' } });
    out({ type: 'item.completed', item: { id: 'i5', type: 'mcp_tool_call', server: 'neuralbridge', tool: 'brain_search', status: 'completed' } });
  }
  out({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: `Alteração feita pelo agente falso.${seen(codexImages)}` } });
  out({ type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 60 } });
}

await (agent === 'codex' ? codex() : claude());
