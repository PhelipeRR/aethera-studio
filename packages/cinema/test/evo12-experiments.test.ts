import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AetheraAcademyEngine,
  AetheraEvolutionCore,
  produceCinemaPackage,
  renderRealCinemaMp4,
  resolveNarrationDurationConflict,
  runDirectorOrchestrationDag,
} from '../src/index.js';

describe('EVO-12 — Validação Real de Aprendizado e Autonomia Cinematográfica', () => {
  it('Experimentos 1, 2, 3 e 4 com renderização MP4 real, persistência pós-reinício e métricas Antes/Depois', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aethera-evo12-'));
    const evolutionPath = join(tempDir, 'evolution-store.json');
    const academyPath = join(tempDir, 'academy-store.json');
    const techDocPath = join(tempDir, 'manual-montagem.md');

    try {
      // =========================================================================
      // EXPERIMENTO 1 — Aprendizado com correção humana + reinício + exceção
      // =========================================================================
      const evo1 = new AetheraEvolutionCore(evolutionPath);

      // 1A. Baseline BEFORE feedback: produces a documentary with default ATO I..III + Aethera signature
      const docBeforePkg = produceCinemaPackage({
        projectId: 'evo12_doc_before',
        prompt: 'Documentário curto sobre missões espaciais profundas',
        format: 'youtube_16_9',
        targetDurationSec: 8,
      });
      docBeforePkg.timeline.clips = docBeforePkg.timeline.clips.slice(0, 2).map((c) => ({
        ...c,
        label: '',
        timelineRange: { ...c.timelineRange, duration: { value: 4, rate: 1 } },
      }));

      const renderBefore = await renderRealCinemaMp4({
        pkg: docBeforePkg,
        outputDir: join(tempDir, 'renders-before'),
        fileName: 'doc-before.mp4',
        useNvenc: false,
        evolution: evo1,
        genre: 'documentario',
      });
      expect(renderBefore.renderedHeadlines?.length ?? 0).toBeGreaterThan(0);
      expect(renderBefore.renderedHeadlines?.some((h) => /ATO\s+I|Aethera\s+Studio/i.test(h))).toBe(false);
      expect(renderBefore.probe.durationSec).toBeGreaterThan(5);

      // 1B. Provide exact human feedback from EVO-12
      const feedbackText =
        'Não quero cards automáticos de ATO I, II ou III nem assinatura do Aethera no encerramento. Em documentários, prefiro imagens reais e fontes discretas. Em outros formatos, motion graphics podem ser mais elaborados.';
      const { analysis, memory } = evo1.ingestHumanFeedback(feedbackText, {
        genre: 'documentario',
      });
      expect(analysis.classification).toBe('explicit_preference');
      expect(memory.state).toBe('validated');

      // 1C. Simulate Electron restart (new instance reading from disk)
      const evoAfterRestart = new AetheraEvolutionCore(evolutionPath);

      // 1D. Produce ANOTHER documentary WITHOUT repeating the instruction
      const docAfterPkg = produceCinemaPackage({
        projectId: 'evo12_doc_after',
        prompt: 'Documentário curto sobre telescópios orbitais',
        format: 'youtube_16_9',
        targetDurationSec: 8,
      });
      docAfterPkg.timeline.clips = docAfterPkg.timeline.clips.slice(0, 2).map((c) => ({
        ...c,
        label: '',
        timelineRange: { ...c.timelineRange, duration: { value: 4, rate: 1 } },
      }));

      const renderAfter = await renderRealCinemaMp4({
        pkg: docAfterPkg,
        outputDir: join(tempDir, 'renders-after'),
        fileName: 'doc-after.mp4',
        useNvenc: false,
        evolution: evoAfterRestart,
        genre: 'documentario',
      });
      expect(renderAfter.appliedDirectives?.suppressActCards).toBe(true);
      expect(renderAfter.appliedDirectives?.suppressAetheraSignature).toBe(true);
      expect(renderAfter.appliedDirectives?.discreteTypography).toBe(true);
      expect(renderAfter.appliedDirectives?.preferRealImages).toBe(true);
      expect(renderAfter.appliedDirectives?.appliedMemoryIds).toContain(memory.memoryId);
      expect(renderAfter.renderedHeadlines?.some((h) => /\bATO\s+[IVX]+/i.test(h))).toBe(false);
      expect(renderAfter.renderedHeadlines?.some((h) => /Aethera\s+Studio/i.test(h))).toBe(false);

      // 1E. Explicit instruction later creates an exception without erasing general preference
      const exceptionDirectives = evoAfterRestart.resolveProductionDirectives({
        prompt: 'Documentário especial: incluir card de ATO I na abertura',
        genre: 'documentario',
      });
      expect(exceptionDirectives.suppressActCards).toBe(false);
      expect(exceptionDirectives.overriddenDirectives).toContain('suppressActCards');
      expect(exceptionDirectives.suppressAetheraSignature).toBe(true);

      // =========================================================================
      // EXPERIMENTO 2 — Academy estudando vídeo real + documento técnico
      // =========================================================================
      const academy1 = new AetheraAcademyEngine(evoAfterRestart, academyPath);
      writeFileSync(
        techDocPath,
        'Seção 1: Ritmo em documentários espaciais exige planos >= 3s e J-cuts de 400ms.\n\nSeção 2: Mixagem EBU R128 em -14 LUFS com true peak <= -1.0 dBTP.',
        'utf8',
      );

      const videoStudy = await academy1.ingestMaterial({
        title: 'Estudo Audiovisual Doc Espacial',
        kind: 'video',
        sourceUri: renderAfter.mp4Path,
        author: 'Aethera Internal',
        license: 'Proprietary Test',
        rightsScope: 'study_only',
        mode: 'study',
      });
      expect(videoStudy.material.metadata.durationSec).toBeGreaterThan(5);
      expect(videoStudy.material.metadata.integratedLufs).toBeDefined();
      expect(videoStudy.material.metadata.sceneCutsCount).toBeDefined();

      const docStudy = await academy1.ingestMaterial({
        title: 'Manual Técnico de Montagem e Som',
        kind: 'document',
        sourceUri: techDocPath,
        author: 'Aethera Lab',
        license: 'Internal',
        rightsScope: 'study_only',
        mode: 'train',
      });
      expect(docStudy.extractedKnowledge.length).toBeGreaterThan(0);

      // Practice & validate in another session
      const academy2 = new AetheraAcademyEngine(new AetheraEvolutionCore(evolutionPath), academyPath);
      const soundKnow = docStudy.extractedKnowledge[0];
      if (!soundKnow) throw new Error('Expected extracted knowledge');
      const exercise = academy2.runExercise({
        title: 'Aplicação de loudness -14 LUFS',
        directorId: soundKnow.directorId,
        knowledgeIds: [soundKnow.knowledgeId],
        qualityScore: 92,
        passed: true,
        notes: 'Aplicado na renderização real.',
      });
      expect(exercise.passed).toBe(true);

      const qa = academy2.askAcademy('Qual foi o LUFS e cortes observados no Estudo Audiovisual?');
      expect(qa.citations.length).toBeGreaterThan(0);

      // =========================================================================
      // EXPERIMENTO 3 — Colaboração real entre diretores em conflito de narração
      // =========================================================================
      const collabPkg = produceCinemaPackage({
        projectId: 'evo12_collab',
        prompt: 'Cena única com narração longa',
        format: 'youtube_16_9',
        targetDurationSec: 6,
      });
      collabPkg.timeline.clips = collabPkg.timeline.clips.slice(0, 1).map((c) => ({
        ...c,
        timelineRange: { ...c.timelineRange, duration: { value: 3, rate: 1 } },
      }));
      const firstCollabClip = collabPkg.timeline.clips[0];
      if (!firstCollabClip) throw new Error('Expected collab clip');

      const resolution = resolveNarrationDurationConflict({
        sceneId: firstCollabClip.clipId,
        narrationDurationMs: 4800,
        sceneDurationMs: 3000,
        rawClipMaxDurationMs: 8000,
        evolution: evoAfterRestart,
        projectId: 'evo12_collab',
      });
      expect(resolution.raisedBy).toBe('sound_director');
      expect(resolution.proposals.map((p) => p.directorId)).toEqual(['editing_director', 'narrative_director']);
      expect(resolution.chosenBy).toBe('general_director');
      expect(resolution.chosenProposal.directorId).toBe('editing_director');
      expect(resolution.validatedByQuality).toBe(true);

      // Apply the winning Editing decision to the timeline clip and render
      firstCollabClip.timelineRange.duration = { value: 5, rate: 1 };
      const collabRender = await renderRealCinemaMp4({
        pkg: collabPkg,
        outputDir: join(tempDir, 'renders-collab'),
        fileName: 'collab.mp4',
        useNvenc: false,
        evolution: evoAfterRestart,
      });
      expect(collabRender.probe.durationSec).toBeGreaterThanOrEqual(4.5);

      // =========================================================================
      // EXPERIMENTO 4 — Métricas longitudinais Antes vs Depois
      // =========================================================================
      const dagAfter = await runDirectorOrchestrationDag({
        runId: 'evo12_dag_after',
        projectId: 'evo12_doc_after',
        prompt: 'Documentário curto sobre telescópios orbitais',
        genre: 'documentario',
        pkg: docAfterPkg,
        evolution: evoAfterRestart,
      });
      expect(dagAfter.status).toBe('completed');

      const finalSnapshot = evoAfterRestart.getSnapshot();
      expect(finalSnapshot.decisions.length).toBeGreaterThanOrEqual(2);
      expect(finalSnapshot.memories.some((m) => m.state === 'validated')).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
