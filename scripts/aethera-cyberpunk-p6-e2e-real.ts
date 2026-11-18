/**
 * P6 E2E Real — Cyberpunk 2077 (60s)
 *
 * Executa o pipeline real de produção audiovisual a partir do prompt, sem mocks:
 * 1. Interpretação do prompt e decupagem semântica.
 * 2. Pesquisa real via Steam + yt-dlp (YouTube search).
 * 3. Aquisição autorizada com yt-dlp (download novo comprovado).
 * 4. Extração de frames e análise visual (VisionRouter ou fallback explícito).
 * 5. Scene Grounding e seleção de segmentos.
 * 6. Narração TTS (Windows SAPI como fallback autorizado).
 * 7. Legendas inteligentes (smart captions).
 * 8. Áudio real local (ambience + SFX MotionVelix) e música (missing se indisponível).
 * 9. Renderização FFmpeg H.264/AAC ≥ 1280×720, ~60s.
 * 10. Delivery Gate com relatório needs_review quando aplicável.
 *
 * Uso: npx tsx scripts/aethera-cyberpunk-p6-e2e-real.ts <outDir>
 * Requer: python -m yt_dlp, ffmpeg/ffprobe no PATH.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  buildEditorialScript,
  buildSemanticDecupagem,
  createDefaultMediaProviderAdapters,
  estimateNarrationSec,
  extractVerificationFrames,
  interpretProductionPrompt,
  MediaProviderRegistry,
  probeRealMp4,
  produceCinemaPackage,
  renderRealCinemaMp4,
  resolveProjectDomain,
  runAutonomousMediaAcquisition,
  workReferenceForScene,
  type EditorialResearchDossier,
  type MediaProviderAdapter,
  type NarrativeBeat,
  type SourceMediaRecord,
} from '../packages/cinema/src/index.js';
import { acquireWithYtDlp, defaultYtDlp, ytDlpSearch } from '../packages/workspace/src/aethera-acquisition.js';

const PROMPT = 'Crie um vídeo cinematográfico de 60 segundos sobre Cyberpunk 2077, apresentando Night City, seus personagens, combates, veículos e ambientação futurista.';
const TARGET_DURATION_SEC = 60;

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('usage: aethera-cyberpunk-p6-e2e-real.ts <outDir>');
  mkdirSync(outDir, { recursive: true });
  const mediaDir = join(outDir, 'media');
  const framesDir = join(outDir, 'frames');
  const segmentCacheDir = join(outDir, 'segment-cache');
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(segmentCacheDir, { recursive: true });

  const startedAt = Date.now();
  const ytDlp = defaultYtDlp();
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    phase: 'P6-E2E-REAL',
    prompt: PROMPT,
    targetDurationSec: TARGET_DURATION_SEC,
    ranAt: new Date().toISOString(),
    ytDlpCommand: `${ytDlp.command} ${ytDlp.prefix.join(' ')}`,
  };

  // 1. Interpretação + domínio
  const interpretation = interpretProductionPrompt(PROMPT);
  const domain = resolveProjectDomain({
    promptDomain: interpretation.domain,
    prompt: PROMPT,
    workTitles: ['Cyberpunk 2077'],
    genre: 'gameplay_essay',
  });
  report.interpretation = interpretation;
  report.projectDomain = domain;

  // 2. Roteiro editorial + dossiê de pesquisa reais (necessários para buildSemanticDecupagem)
  const beats: Array<{ stage: NarrativeBeat['stage']; summary: string }> = [
    { stage: 'hook', summary: 'Night City nunca dorme, e cada esquina esconde uma promessa de glória ou ruína. Os arranha-céus brilham com propagandas holográficas enquanto mercenários disputam território nas ruas molhadas pela chuva ácida.' },
    { stage: 'progression', summary: 'Os implantes cibernéticos amplificam reflexos e força física, mas cobram um preço invisível. Cada upgrade aproxima o usuário da perda de humanidade, transformando escolhas técnicas em dilemas existenciais irreversíveis.' },
    { stage: 'progression', summary: 'A metrópole pulsa com tráfego aéreo denso e mercados subterrâneos onde informações valem mais que créditos. Neon, vapor e multidões criam uma paisagem sensorial que recompensa quem observa os detalhes escondidos.' },
    { stage: 'tension', summary: 'Quando uma corporação reescreve as regras do jogo, o mercenário precisa escolher entre obedecer ao contrato ou proteger quem ficou para trás. A velocidade salva vidas, mas a hesitação pode preservar algo maior.' },
    { stage: 'climax', summary: 'O confronto final expõe que tecnologia avançada sem propósito humano é apenas ruído caro. Sobreviver exige mais que hardware: exige lembrar por que você entrou em Night City em primeiro lugar.' },
    { stage: 'resolution', summary: 'A cidade continua indiferente às vitórias individuais, mas cada sobrevivente carrega uma nova história. A próxima escolha já começou antes mesmo de você perceber que a anterior terminou.' },
  ];
  const script = buildEditorialScript({
    scriptId: 'p6_e2e_cyberpunk_real_script',
    source: 'agent',
    treatment: 'Produção E2E real com aquisição externa, narração medida e composição FFmpeg.',
    segments: beats.map((b, idx) => ({
      beatId: `beat_${idx + 1}`,
      stage: b.stage,
      title: `Cena ${idx + 1}`,
      spokenText: b.summary,
      estimatedDurationSec: Math.round(TARGET_DURATION_SEC / beats.length),
      approved: true,
    })),
    academyRulesApplied: [],
  });
  const dossier: EditorialResearchDossier = {
    dossierId: 'p6_e2e_cyberpunk_real_dossier',
    dossierHash: createHash('sha256').update(PROMPT).digest('hex').slice(0, 16),
    promptHash: createHash('sha256').update(PROMPT).digest('hex').slice(0, 16),
    workTitle: 'Cyberpunk 2077',
    theme: 'Night City, implantes, combate e ambientação futurista',
    rankingCriteria: ['relevância_cyberpunk_2077', 'cobertura_visual_night_city'],
    entities: [
      {
        entityName: 'Cyberpunk 2077',
        workTitle: 'Cyberpunk 2077',
        role: 'primary_work',
        verifiedFacts: ['Jogo RPG de ação em mundo aberto desenvolvido pela CD PROJEKT RED.'],
        mechanicsOrEvents: ['combate', 'implantes cibernéticos', 'exploração urbana'],
        uncertainties: [],
        sources: [{ id: 'prompt', url: '', publisher: 'user_input', retrievedAt: new Date().toISOString() }],
      },
      {
        entityName: 'Night City',
        workTitle: 'Cyberpunk 2077',
        role: 'setting',
        verifiedFacts: ['Metrópole futurista onde o jogo se passa.'],
        mechanicsOrEvents: ['neon', 'chuva', 'veículos voadores'],
        uncertainties: [],
        sources: [{ id: 'prompt', url: '', publisher: 'user_input', retrievedAt: new Date().toISOString() }],
      },
    ],
    uncertainties: [],
    sourcesUsed: ['prompt_interpretation'],
    createdAt: new Date().toISOString(),
  };
  const decupagem = buildSemanticDecupagem(script, dossier, interpretation);
  const scenes = Array.isArray(decupagem) ? decupagem : (decupagem as unknown as { scenes: typeof decupagem }).scenes;
  report.decupagem = {
    sceneCount: scenes.length,
    scenes: scenes.map((s) => ({
      sceneId: s.sceneId,
      summary: s.narrationText,
      durationSec: s.durationSec,
      entities: s.entities,
      queries: s.mediaQueries,
    })),
  };

  // 3. Provider registry real (Steam + YouTube via yt-dlp)
  const providerCalls: string[] = [];
  const adapters: MediaProviderAdapter[] = createDefaultMediaProviderAdapters().map((a) => {
    const search = a.search.bind(a);
    a.search = async (r) => {
      providerCalls.push(`${a.descriptor.id}:${r.query}`);
      return search(r);
    };
    return a;
  });
  const registry = new MediaProviderRegistry({ adapters });

  // 3.5 Validação prévia de conectividade yt-dlp (busca + metadata sem download)
  const connectivityCheck = await ytDlpSearch(ytDlp, 'Cyberpunk 2077 Night City gameplay showcase', 2).catch((err) => ({ error: String(err), results: [] as Array<{ url: string; title: string }> }));
  report.connectivityCheck = {
    query: 'Cyberpunk 2077 Night City gameplay showcase',
    resultCount: Array.isArray(connectivityCheck) ? connectivityCheck.length : 0,
    firstResult: Array.isArray(connectivityCheck) && connectivityCheck.length > 0 ? { url: connectivityCheck[0].url, title: connectivityCheck[0].title } : null,
    error: Array.isArray(connectivityCheck) ? null : (connectivityCheck as { error?: string }).error ?? 'unknown',
  };
  if (!Array.isArray(connectivityCheck) || connectivityCheck.length === 0) {
    report.blocker = 'yt-dlp não retornou resultados de busca; verifique conectividade ou proxy antes de continuar.';
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    throw new Error('Conectividade yt-dlp falhou; abortando antes da aquisição.');
  }

  // 4. Aquisição autônoma real
  const acquisitionStartedAt = Date.now();
  let downloadNewProven: { url: string; filePath: string; sha256: string; bytes: number; provider: string } | undefined;
  const audit = await runAutonomousMediaAcquisition({
    projectId: 'p6_e2e_cyberpunk_real',
    prompt: PROMPT,
    genre: 'gameplay_essay',
    projectDomain: domain.domain,
    format: 'analysis',
    mediaDir,
    segments: scenes.map((s) => {
      const work = workReferenceForScene(
        {
          workTitle: 'Cyberpunk 2077',
          works: ['Cyberpunk 2077'],
          expectedEvent: s.narrationText,
          visualKeywords: (s.entities ?? []).slice(0, 4),
          matchingCriteria: { requiredEntities: ['Cyberpunk 2077'], expectedActions: [], minVisualConfidence: 0.5 },
        },
        { multiWork: false, language: interpretation.language },
      );
      const queries = Array.isArray(s.mediaQueries) && s.mediaQueries.length > 0
        ? s.mediaQueries
        : [`Cyberpunk 2077 ${s.narrationText.slice(0, 40)} gameplay`];
      return {
        segmentId: s.sceneId,
        subject: s.narrationText,
        narrationText: s.narrationText,
        entities: s.entities ?? [],
        expectedDurationSec: s.durationSec ?? s.expectedDurationSec ?? 10,
        preferredQueries: queries,
        ...(work ? { work } : {}),
      };
    }),
    probeDurationFn: async (fp) => (await probeRealMp4(fp)).durationSec,
    analyzeFrames: async (uri, timestampsSec, segment) => {
      const tag = basename(dirname(uri));
      const outFrameDir = join(framesDir, `${tag}_${segment.segmentId}`);
      mkdirSync(outFrameDir, { recursive: true });
      const extracted = await extractVerificationFrames(uri, outFrameDir, timestampsSec);
      // Fallback explícito: sem VisionRouter disponível neste script, registramos os frames extraídos
      // e retornamos análise mínima baseada apenas em metadados, sem inventar evidência visual.
      return extracted.map((fp, idx) => ({
        framePath: fp,
        timestampSec: timestampsSec[idx] ?? 0,
        hash: createHash('sha256').update(readFileSync(fp)).digest('hex'),
        analysis: {
          nature: 'unknown',
          natureConfidence: 0,
          description: 'Frame extraído; análise semântica indisponível fora do app (VisionRouter requer credenciais do desktop).',
          entities: [],
          actions: [],
          environment: { description: 'não analisado', basis: 'metadata_only' as const, confidence: 0 },
          overlays: { burnedText: false, watermark: false, webcam: false },
          limitations: ['vision_unavailable_outside_app'],
          confidence: 0,
        },
      }));
    },
    requireVisualVerification: false, // Permitir continuidade sem VisionRouter; gate final registra needs_review
    checkpointPath: join(mediaDir, '.acquisition-checkpoint.json'),
    licensePolicy: 'assemble_with_rights_review',
    limits: { maxRounds: 2, maxDurationMs: 600_000, perDownloadTimeoutMs: 180_000 },
    deps: {
      localMediaDirs: [],
      mediaProviders: { registry, context: { jobId: 'p6_e2e_cyberpunk_real' } },
      ytDlpSearchFn: (q, count, sig) => ytDlpSearch(ytDlp, q, count, sig),
      ytDlpAcquireFn: async (targetUrl, idx, dir, sig, downloadSection) => {
        const relativeDir = `acq_${idx}`;
        mkdirSync(join(dir, relativeDir), { recursive: true });
        const out = await acquireWithYtDlp({
          ytDlp,
          url: targetUrl,
          root: dir,
          relativeDir,
          fileStem: 'source',
          maxHeight: 720,
          downloadSection: downloadSection ?? '*0:00-0:45',
          maxFilesize: '80M',
          ...(sig ? { signal: sig } : {}),
        });
        if (out.relativePath) {
          const abs = join(dir, out.relativePath);
          if (!downloadNewProven && existsSync(abs)) {
            const buf = readFileSync(abs);
            downloadNewProven = {
              url: targetUrl,
              filePath: abs,
              sha256: createHash('sha256').update(buf).digest('hex'),
              bytes: buf.length,
              provider: 'yt_dlp',
            };
          }
          return abs;
        }
        return null;
      },
    },
  });
  report.acquisition = {
    durationMs: Date.now() - acquisitionStartedAt,
    providerCalls,
    totalCandidates: audit.relevanceDecisions.length,
    approvedAssets: audit.approvedAssets.map((a) => ({ mediaId: a.mediaId, uri: a.uri, origin: a.origin, durationSec: a.durationSec })),
    recoveryAttempts: audit.recoveryAttempts.length,
    coverageReport: audit.coverageReport,
    downloadNewProven: downloadNewProven ?? null,
  };

  if (!downloadNewProven) {
    report.blocker = 'Nenhum download novo foi realizado; o pipeline não pode continuar sem mídia adquirida.';
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    throw new Error('Aquisição não produziu nenhum arquivo novo. Verifique conectividade e provedores.');
  }

  // 5. Montar catálogo de mídias reais para o cinema package
  // Quando approvedAssets está vazio (VisionRouter indisponível neste script), usamos os arquivos
  // comprovadamente baixados como fallback autorizado, registrando needs_review no delivery final.
  let mediaCatalog: SourceMediaRecord[] = audit.approvedAssets.map((asset, idx) => ({
    mediaId: asset.mediaId ?? `acquired_${idx}`,
    uri: asset.uri,
    sha256: createHash('sha256').update(readFileSync(asset.uri)).digest('hex'),
    kind: 'video' as const,
    origin: asset.origin ?? 'yt_dlp',
    license: 'publisher_promotional',
    duration: { value: Math.round(asset.durationSec ?? 15), rate: 1 },
    width: 1280,
    height: 720,
    fps: { value: 30, rate: 1 },
    hasAudio: false,
  }));

  if (mediaCatalog.length === 0 && downloadNewProven && existsSync(downloadNewProven.filePath)) {
    const probe = await probeRealMp4(downloadNewProven.filePath).catch(() => null);
    mediaCatalog = [{
      mediaId: 'fallback_acquired_yt_dlp',
      uri: downloadNewProven.filePath,
      sha256: downloadNewProven.sha256,
      kind: 'video' as const,
      origin: downloadNewProven.provider,
      license: 'publisher_promotional',
      duration: { value: Math.round(probe?.durationSec ?? 15), rate: 1 },
      width: probe?.width ?? 1280,
      height: probe?.height ?? 720,
      fps: { value: probe?.fps ?? 30, rate: 1 },
      hasAudio: Boolean(probe?.audioCodec),
    }];
    report.catalogFallback = {
      reason: 'approvedAssets vazio (VisionRouter indisponível fora do app); usando download comprovado como fallback autorizado.',
      mediaId: mediaCatalog[0].mediaId,
      uri: mediaCatalog[0].uri,
      probe: probe ?? null,
    };
  }

  if (mediaCatalog.length === 0) {
    report.blocker = 'Nenhuma mídia aprovada ou baixada disponível para montagem.';
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    throw new Error('Catálogo vazio após aquisição e fallback.');
  }

  // 6. Cinema Package + Renderização real
  const pkg = produceCinemaPackage({
    projectId: 'p6_e2e_cyberpunk_real',
    prompt: PROMPT,
    genre: 'gameplay_essay',
    targetDurationSec: TARGET_DURATION_SEC,
    humorIntensity: 0,
    mediaCatalog,
    externalDirection: {
      treatment: 'Produção E2E real com aquisição externa, narração medida e composição FFmpeg.',
      beats: scenes.map((s) => ({ stage: 'progression' as const, summary: s.narrationText })),
    },
  });

  // Assets de áudio locais (MotionVelix)
  const motionRoot = process.env['NB_VELIX_DIR'] ?? join(homedir(), '.claude', 'skills', 'motionvelix', 'assets', 'sfx');
  const ambiencePath = join(motionRoot, 'chuva.wav');
  const sfxDefs = [
    ['whoosh', 4_500],
    ['glitch', 12_000],
    ['impacto', 26_500],
    ['whoosh_rapido', 39_500],
  ] as const;
  const sfx = sfxDefs
    .map(([id, atMs]) => ({
      id: String(id),
      path: join(motionRoot, `${String(id)}.wav`),
      license: 'motionvelix-user-kit-original-synthesized',
      origin: 'motionvelix-user-kit',
      useConditions: 'uso autorizado no escopo do kit',
      atMs: Number(atMs),
      gainDb: -18,
    }))
    .filter((a) => existsSync(a.path));
  const realAudioAssets = existsSync(ambiencePath) || sfx.length > 0
    ? {
        ...(existsSync(ambiencePath) ? { ambience: { path: ambiencePath, license: 'motionvelix-user-kit-original-synthesized', origin: 'motionvelix-user-kit', useConditions: 'uso autorizado no escopo do kit' } } : {}),
        ...(sfx.length > 0 ? { sfx } : {}),
      }
    : undefined;

  const renderResult = await renderRealCinemaMp4({
    pkg,
    outputDir: outDir,
    fileName: 'aethera-p6-cyberpunk-real.mp4',
    segmentCacheDir,
    requireRealMedia: true,
    previewQuality: 'review_720p',
    allowProceduralVoiceFallback: true,
    ...(realAudioAssets ? { realAudioAssets } : {}),
  });

  report.render = {
    mp4Path: renderResult.mp4Path,
    probe: renderResult.probe,
    deliveryValidation: renderResult.deliveryValidation,
    deliveryGate: renderResult.deliveryGate,
    narrationMode: renderResult.narrationMode,
    audioFirstTimeline: renderResult.audioFirstTimeline,
    captionAlignment: renderResult.captionAlignment,
    smartCaptions: renderResult.smartCaptions,
    audioSources: renderResult.audioSources,
    audioDiagnostics: renderResult.audioDiagnostics,
    musicSelection: renderResult.musicSelection,
  };
  report.totalDurationMs = Date.now() - startedAt;

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`[P6-E2E-REAL] Relatório salvo em ${join(outDir, 'report.json')}`);
  console.log(`[P6-E2E-REAL] MP4: ${renderResult.mp4Path}`);
  console.log(`[P6-E2E-REAL] Download novo: ${downloadNewProven.filePath} (${downloadNewProven.bytes} bytes)`);
  console.log(`[P6-E2E-REAL] Delivery Gate: ${renderResult.deliveryGate?.status ?? 'unknown'}`);
}

main().catch((err) => {
  console.error('[P6-E2E-REAL] Falha:', err);
  process.exit(1);
});