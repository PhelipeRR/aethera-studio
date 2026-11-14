import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AetheraAcademyEngine, AetheraEvolutionCore } from '../src/index.js';

const SAMPLE_BOOK_CONTENT = `
# 1. Introdução à Direção Audiovisual
A direção cinematográfica integra narrativa, ritmo, som e imagem para conduzir a atenção do espectador.

# 2. Motion Graphics e Comunicação Visual
Quando usar motion graphics em produções informativas:
- Visualização de dados: para comunicar números e relações entre métricas complexas de forma clara.
- Comparações animadas: para destacar diferenças de desempenho, escala ou evolução temporal.
- Destaque de conceitos: para direcionar a atenção do espectador para termos-chave na fala.
- Animações explicativas: para demonstrar processos e fenômenos invisíveis ou abstratos.
- Transições narrativas: para conectar ideias ou momentos distintos sem quebra brusca.
Evitar motion graphics em cenas com informações visuais já densas ou quando o quadro original já exige leitura imediata.

# 3. Documentário Científico e Colaboração entre Diretores
Na edição de um documentário científico, o Diretor de Edição organiza o ritmo e os cortes, o Diretor de Som assegura inteligibilidade da narração e mixagem EBU R128, o Diretor Narrativo garante precisão do arco explicativo e o Diretor de Motion Graphics traduz conceitos abstratos sem poluir a imagem.

# 5. Composição e legibilidade
Para evitar que gráficos e títulos atrapalhem a composição original, o Diretor de Fotografia deve identificar textos, HUDs, rostos e objetos importantes no material original.
O Diretor de Motion Graphics deve escolher áreas seguras e ajustar posição, escala ou momento da animação.
Se não houver espaço adequado na composição, o elemento gráfico deve ser reformulado ou omitido.
`;

describe('EVO-ACADEMY-01 & 02 — Extração Semântica e Respostas Fundamentadas', () => {
  it('responde às 3 perguntas reais com explicações distintas, citações pertinentes e reconhece ausência de evidência', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aethera-acad-qa-'));
    const evoPath = join(tempDir, 'evolution.json');
    const acadPath = join(tempDir, 'academy.json');

    try {
      const evo = new AetheraEvolutionCore(evoPath);
      const academy = new AetheraAcademyEngine(evo, acadPath);

      const { extractedKnowledge } = await academy.ingestMaterial({
        title: 'Fundamentos de Direção Cinematográfica e Motion Graphics',
        kind: 'document',
        sourceUri: 'doc://fundamentos-cinema.md',
        author: 'Acervo Técnico',
        license: 'Uso Interno',
        rightsScope: 'study_only',
        mode: 'study',
        textContent: SAMPLE_BOOK_CONTENT,
      });

      // Must extract real concept names, never generic "Técnica 1..N"
      expect(extractedKnowledge.some((k) => /· Técnica \d+$/u.test(k.techniqueName))).toBe(false);
      expect(extractedKnowledge.some((k) => /Visualização de dados/i.test(k.techniqueName))).toBe(true);

      // Pergunta 1
      const q1 = academy.askAcademy(
        'Quais técnicas de motion graphics foram aprendidas e quando devem ser usadas?',
      );
      expect(q1.sufficientKnowledge).toBe(true);
      expect(q1.answer).toContain('Visualização de dados');
      expect(q1.answer).toContain('Comparações animadas');
      expect(q1.answer).toContain('Destaque de conceitos');
      expect(q1.answer).toContain('Animações explicativas');
      expect(q1.answer).toContain('Transições narrativas');
      expect(q1.answer).toMatch(/densas/i);
      expect(q1.citations.some((c) => /Motion Graphics/i.test(c.reference))).toBe(true);

      // Pergunta 2
      const q2 = academy.askAcademy(
        'Quais diretores devem colaborar na edição de um documentário científico?',
      );
      expect(q2.sufficientKnowledge).toBe(true);
      expect(q2.answer).toMatch(/Documentário Científico|Edição|Diretor/i);
      expect(q2.answer).not.toBe(q1.answer);
      expect(q2.citations.some((c) => /Documentário Científico/i.test(c.reference))).toBe(true);

      // Pergunta 3
      const q3 = academy.askAcademy(
        'Como evitar que gráficos e títulos atrapalhem a composição original?',
      );
      expect(q3.sufficientKnowledge).toBe(true);
      expect(q3.answer).toMatch(/HUDs|rostos|áreas seguras|omitido/i);
      expect(q3.answer).not.toBe(q1.answer);
      expect(q3.answer).not.toBe(q2.answer);
      expect(q3.citations.some((c) => /Composição e legibilidade/i.test(c.reference))).toBe(true);

      // Pergunta sem resposta no acervo
      const qUnknown = academy.askAcademy('Qual a receita de bolo de chocolate com cobertura?');
      expect(qUnknown.sufficientKnowledge).toBe(false);
      expect(qUnknown.synthesisMode).toBe('insufficient_evidence');
      expect(qUnknown.citations).toHaveLength(0);

      // RF-07 async synthesis + fallback
      const qRf07 = await academy.askAcademyAsync(
        'Como evitar que gráficos e títulos atrapalhem a composição original?',
        undefined,
        async () => 'Síntese RF-07: identifique HUDs e rostos, use áreas seguras e ajuste escala ou omita o gráfico.',
      );
      expect(qRf07.synthesisMode).toBe('rf07_ai');
      expect(qRf07.answer).toContain('Síntese RF-07');

      const qFallback = await academy.askAcademyAsync(
        'Como evitar que gráficos e títulos atrapalhem a composição original?',
        undefined,
        async () => {
          throw new Error('RF-07 offline');
        },
      );
      expect(qFallback.synthesisMode).toBe('grounded_extractive');
      expect(qFallback.sufficientKnowledge).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reprocessa automaticamente registros legados ("Técnica 1") preservando estado validado', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aethera-acad-migrate-'));
    const evoPath = join(tempDir, 'evolution.json');
    const acadPath = join(tempDir, 'academy.json');

    try {
      writeFileSync(
        acadPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            materials: [
              {
                materialId: 'mat_legacy_1',
                sha256: 'abc123',
                title: 'Fundamentos',
                kind: 'document',
                sourceUri: 'doc://legacy.md',
                author: 'Autor',
                license: 'Interno',
                rightsScope: 'study_only',
                mode: 'study',
                assignedDirectors: ['motion_director'],
                metadata: { chunkCount: 1 },
                chunks: [
                  {
                    chunkId: 'chk_1',
                    reference: 'section:1',
                    text: '- Visualização de dados: para comunicar números e relações.\nEvitar em cenas visualmente densas.',
                  },
                ],
                importedAt: '2026-11-13T00:00:00.000Z',
              },
            ],
            knowledge: [
              {
                knowledgeId: 'know_old_1',
                materialId: 'mat_legacy_1',
                directorId: 'motion_director',
                techniqueName: 'Fundamentos · Técnica 1',
                referenceLocation: 'section:1',
                observedInfo: 'legacy',
                aiInterpretation: 'legacy',
                proposedTechnique: 'legacy',
                testedInExercise: true,
                validationState: 'validated',
                confidence: 0.9,
                usageCount: 2,
                version: 1,
                createdAt: '2026-11-13T00:00:00.000Z',
              },
            ],
            exercises: [],
          },
          null,
          2,
        ),
        'utf8',
      );

      const evo = new AetheraEvolutionCore(evoPath);
      const academy = new AetheraAcademyEngine(evo, acadPath);
      const snap = academy.getSnapshot();
      expect(snap.knowledge.some((k) => /· Técnica \d+$/u.test(k.techniqueName))).toBe(false);
      expect(snap.knowledge.some((k) => k.techniqueName === 'Visualização de dados')).toBe(true);
      expect(snap.materials[0]?.materialId).toBe('mat_legacy_1');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reads .md files and converts Markdown syntax into clean structured text', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aethera-md-ingest-'));
    try {
      const mdPath = join(tempDir, 'guia-edicao.md');
      writeFileSync(
        mdPath,
        [
          '---',
          'title: Guia de Edição',
          'author: Equipe Aethera',
          '---',
          '',
          '# Ritmo e Cortes',
          '',
          '> Use **cortes motivados** e *j-cuts* conforme o [manual oficial](https://example.com/manual).',
          '',
          '| Técnica | Aplicação |',
          '| --- | --- |',
          '| `J-Cut` | Antecipa o áudio da próxima cena |',
        ].join('\n'),
        'utf8',
      );

      const evo = new AetheraEvolutionCore(join(tempDir, 'evo.json'));
      const academy = new AetheraAcademyEngine(evo, join(tempDir, 'acad.json'));
      const ingested = await academy.ingestMaterial({
        title: 'Guia de Edição MD',
        kind: 'document',
        sourceUri: mdPath,
        author: 'Equipe',
        license: 'Uso Interno',
        rightsScope: 'study_only',
        mode: 'study',
      });

      const joined = ingested.material.chunks.map((c) => c.text).join('\n');
      expect(joined).not.toContain('author: Equipe Aethera');
      expect(joined).not.toContain('**');
      expect(joined).not.toContain('https://example.com');
      expect(joined).not.toContain('| --- |');
      expect(joined).toContain('cortes motivados');
      expect(joined).toContain('manual oficial');
      expect(joined).toContain('J-Cut; Antecipa o áudio da próxima cena');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('avoids repeated Checklist de decisão boilerplate, verifies citations against chunkId, and proves Evolution feedback alters produceCinemaPackage', async () => {
    const { produceCinemaPackage } = await import('../src/index.js');
    const tempDir = mkdtempSync(join(tmpdir(), 'aethera-academy-eval-'));
    try {
      const evo = new AetheraEvolutionCore(join(tempDir, 'evo.json'));
      const academy = new AetheraAcademyEngine(evo, join(tempDir, 'acad.json'));

      const sharedChecklist = [
        '## Checklist de decisão',
        '- Qual é o objetivo narrativo ou informativo deste trecho?',
        '- Que evidência ou material visual está disponível?',
        '- Qual técnica melhora a compreensão sem encobrir informação?',
        '- Que conflito pode surgir entre imagem, texto, voz, música, SFX e VFX?',
      ].join('\n');

      for (let i = 1; i <= 4; i += 1) {
        await academy.ingestMaterial({
          title: `0${i}_modulo_base`,
          kind: 'document',
          sourceUri: `doc://mod-${i}.md`,
          author: 'Aethera',
          license: 'Interno',
          rightsScope: 'study_only',
          mode: 'study',
          textContent: `## Introdução\nFundamentos gerais do módulo ${i}.\n\n${sharedChecklist}`,
        });
      }

      await academy.ingestMaterial({
        title: '12_qualidade_aprendizado',
        kind: 'document',
        sourceUri: 'doc://mod-12.md',
        author: 'Aethera',
        license: 'Interno',
        rightsScope: 'study_only',
        mode: 'study',
        textContent: [
          '## Conversão de Falha em Aprendizado Contextual',
          'Quando um título cobrir o HUD, o Diretor de Composição deve registrar a falha como problema contextual de áreas ocupadas, ajustar a detecção de regiões seguras no quadro e nunca banir títulos globalmente.',
          '',
          '## Parâmetro Contextual de Humor 35%',
          'O parâmetro de humor 35% (cinematic_subtle_humor) instrui o Diretor Narrativo e o Diretor de Montagem a inserir ironia sutil apenas em cenas compatíveis, bloqueando humor em momentos sensíveis.',
          '',
          sharedChecklist,
        ].join('\n'),
      });

      const qa = academy.askAcademy('Como converter uma falha de posicionamento de título em aprendizado contextual?');
      expect(qa.sufficientKnowledge).toBe(true);
      expect(qa.citations.length).toBeGreaterThan(0);
      expect(qa.citations[0]?.title).toBe('12_qualidade_aprendizado');
      expect(qa.citations[0]?.chunkId).toBeTruthy();
      expect(qa.citations[0]?.verifiedAgainstSource).toBe(true);
      expect(qa.citations[0]?.fullSectionText).toContain('detecção de regiões seguras');

      const humorQa = academy.askAcademy('Como funciona o parâmetro contextual de humor 35%?');
      expect(humorQa.sufficientKnowledge).toBe(true);
      expect(humorQa.answer).toContain('35%');

      // Record human correction in EvolutionCore and verify it alters produceCinemaPackage decisions
      const fb = evo.ingestHumanFeedback(
        'Não usar cards automáticos de ATO I ou II em documentários e manter humor 35% pontual.',
        { genre: 'documentary' },
      );
      expect(fb.memory.memoryId).toBeTruthy();

      const activeMemories = evo
        .retrieveRelevantMemories({ text: 'Documentário sobre ciência com humor 35%', genre: 'documentary' })
        .map((m) => ({ memoryId: m.memoryId, rule: m.content, directorId: m.directorId }));

      const prod = produceCinemaPackage({
        projectId: 'test_learned_prod',
        prompt: 'Documentário sobre ciência',
        genre: 'documentary',
        humorIntensity: 35,
        appliedMemories: activeMemories,
      });

      expect(prod.appliedLearningRules?.length).toBeGreaterThan(0);
      expect(prod.direction.brief.restrictions).toContain(activeMemories[0]?.rule);
      expect(prod.direction.brief.humorProfile.humorIntensity).toBe(35);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
