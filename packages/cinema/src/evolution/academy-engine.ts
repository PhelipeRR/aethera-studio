import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { AetheraEvolutionCore, DirectorId, LearningState } from './evolution-core.js';
import { probeRealMp4 } from '../qc/real-media-probe.js';

const execFileAsync = promisify(execFile);

export type AcademyMaterialKind = 'video' | 'audio' | 'image' | 'document' | 'script' | 'timeline';
export type AcademyLearningMode = 'study' | 'reference' | 'train';
export type AcademyRightsScope = 'study_only' | 'reusable_owned';

export interface AcademyChunk {
  chunkId: string;
  reference: string; // e.g., "page:2", "section:5 · 5. Composição e legibilidade", "00:12-00:18"
  sectionTitle?: string;
  text: string;
}

export interface AcademyMaterialRecord {
  materialId: string;
  sha256: string;
  title: string;
  kind: AcademyMaterialKind;
  sourceUri: string;
  author: string;
  license: string;
  rightsScope: AcademyRightsScope;
  mode: AcademyLearningMode;
  assignedDirectors: DirectorId[];
  metadata: {
    durationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
    sceneCutsCount?: number;
    integratedLufs?: number;
    truePeakDbtp?: number;
    silenceEventsCount?: number;
    chunkCount: number;
  };
  chunks: AcademyChunk[];
  importedAt: string;
}

export interface AcademyKnowledgeRecord {
  knowledgeId: string;
  materialId: string;
  directorId: DirectorId;
  techniqueName: string;
  referenceLocation: string; // timestamp or page/section
  observedInfo: string;
  aiInterpretation: string;
  proposedTechnique: string;
  description?: string;
  objective?: string;
  whenToUse?: string;
  contraindications?: string;
  examples?: string[];
  sourceExcerpt?: string;
  extractionMethod?: 'structured_heuristic' | 'rf07_ai';
  testedInExercise: boolean;
  validationState: LearningState;
  confidence: number;
  usageCount: number;
  version: number;
  createdAt: string;
}

export interface AcademyCitation {
  materialId: string;
  chunkId?: string;
  title: string;
  reference: string;
  excerpt: string;
  fullSectionText?: string;
  verifiedAgainstSource?: boolean;
  relevanceScore: number;
}

export interface AcademyAskResult {
  answer: string;
  sufficientKnowledge: boolean;
  synthesisMode: 'rf07_ai' | 'grounded_extractive' | 'insufficient_evidence';
  citations: AcademyCitation[];
}

export interface AcademyExerciseRecord {
  exerciseId: string;
  title: string;
  directorId: DirectorId;
  knowledgeIds: string[];
  outputSummary: string;
  qualityScore: number;
  passed: boolean;
  notes: string;
  createdAt: string;
}

export interface AcademyStoreSnapshot {
  schemaVersion: 1;
  materials: AcademyMaterialRecord[];
  knowledge: AcademyKnowledgeRecord[];
  exercises: AcademyExerciseRecord[];
}

function sanitizeExternalText(raw: string): string {
  return raw
    .replace(/(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/gi, '[filtered-directive]')
    .replace(/<\/?(?:system|assistant|tool_call|prompt)>/gi, '')
    .trim();
}

export function normalizeMarkdownLine(line: string): string {
  return line
    .replace(/^>\s?/, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/^\s*[-*+]\s+/, '• ')
    .trim();
}

export function convertMarkdownToPlainText(raw: string): string {
  const withoutFrontmatter = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = withoutFrontmatter.split(/\r?\n/);
  const out: string[] = [];
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    if (/^```|^~~~/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      if (trimmed) out.push(trimmed);
      continue;
    }

    // Setext headings: Title\n=== or Title\n---
    const nextTrimmed = (lines[i + 1] ?? '').trim();
    if (trimmed && /^={3,}$|^-{3,}$/.test(nextTrimmed)) {
      out.push(`## ${normalizeMarkdownLine(trimmed)}`);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      continue;
    }

    // Markdown table separator row: | --- | :---: |
    if (/^\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed)) {
      continue;
    }

    // Markdown table data row: | col1 | col2 | -> col1; col2
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => normalizeMarkdownLine(c))
        .filter(Boolean);
      if (cells.length > 0) out.push(cells.join('; '));
      continue;
    }

    // ATX headings (# .. ######) preserved for section splitting, with inline markdown cleaned
    const atx = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (atx) {
      out.push(`${atx[1]} ${normalizeMarkdownLine(atx[2] ?? '')}`);
      continue;
    }

    out.push(trimmed ? normalizeMarkdownLine(trimmed) : '');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas',
  'que', 'quais', 'qual', 'como', 'para', 'por', 'com', 'sem', 'entre', 'sobre', 'sob',
  'ao', 'aos', 'ou', 'se', 'nao', 'sim', 'mais', 'menos', 'muito', 'muita', 'ser', 'sao',
  'esta', 'estao', 'foram', 'foi', 'deve', 'devem', 'pode', 'podem', 'quando', 'onde',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'when', 'how',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

interface ParsedSection {
  reference: string;
  sectionTitle: string;
  text: string;
}

function parseDocumentSections(cleanText: string, kind: AcademyMaterialKind, fallbackTitle: string): ParsedSection[] {
  if (!cleanText.trim()) {
    return [{ reference: 'section:1', sectionTitle: fallbackTitle, text: `Ativo ${kind}: ${fallbackTitle}` }];
  }

  const lines = cleanText.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let currentTitle = fallbackTitle;
  let buffer: string[] = [];
  let sectionIdx = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (!body) return;
    sectionIdx += 1;
    const refPrefix = kind === 'video' || kind === 'audio' ? `segment:${sectionIdx}` : `section:${sectionIdx}`;
    const refLabel = currentTitle && currentTitle !== fallbackTitle ? `${refPrefix} (${currentTitle})` : refPrefix;
    sections.push({
      reference: refLabel,
      sectionTitle: currentTitle,
      text: body.slice(0, 3200),
    });
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch =
      line.match(/^#{1,6}\s+(.+)$/) ||
      line.match(/^(\d+(?:\.\d+)?[.)]\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ].{2,80})$/) ||
      line.match(/^(?:Se[çc][aã]o|Cap[ií]tulo|Parte|M[oó]dulo)\s+\d+[:.\s-]+(.+)$/i);

    if (headingMatch) {
      flush();
      currentTitle = (headingMatch[1] ?? line).trim();
      continue;
    }

    if (line === '' && buffer.join('\n').length > 1800) {
      flush();
      continue;
    }
    if (line !== '') {
      buffer.push(line);
    }
  }
  flush();

  if (sections.length === 0) {
    return [{ reference: 'section:1', sectionTitle: fallbackTitle, text: cleanText.slice(0, 3200) }];
  }
  return sections;
}

function isBoilerplateSection(title: string | undefined, text: string): boolean {
  const t = (title ?? '').toLowerCase();
  if (/checklist de decis|perguntas para revisar|metadados|sum[aá]rio|objetivos do m[oó]dulo/i.test(t)) {
    return true;
  }
  const lower = text.toLowerCase();
  return (
    lower.includes('qual é o objetivo narrativo ou informativo deste trecho') &&
    lower.includes('que evidência ou material visual está disponível')
  );
}

interface ExtractedConcept {
  techniqueName: string;
  description: string;
  objective: string;
  whenToUse: string;
  contraindications: string;
  examples: string[];
  directorId: DirectorId;
  referenceLocation: string;
  sourceExcerpt: string;
}

function inferDirectorForConcept(text: string, fallback: DirectorId[]): DirectorId {
  const lower = text.toLowerCase();
  if (/composi[çc][aã]o|enquadramento|rosto|hud|c[aâ]mera|fotografia|plano|ilumina/i.test(lower)) {
    return 'cinematography_director';
  }
  if (/motion|gr[aá]fico|t[ií]tulo|legenda|tipografia|visualiza[çc][aã]o de dados|compara[çc][õo]es animadas|destaque de conceitos|anima[çc][õo]es explicativas|transi[çc][õo]es narrativas|[áa]reas? seguras?/i.test(lower)) {
    return 'motion_director';
  }
  if (/som|áudio|audio|narra[çc][aã]o|lufs|m[uú]sica|sfx|trilha|ducking/i.test(lower)) {
    return 'sound_director';
  }
  if (/edi[çc][aã]o|montagem|corte|ritmo|pacing|j-cut|l-cut/i.test(lower)) {
    return 'editing_director';
  }
  if (/document[aá]rio|narrativa|roteiro|hist[oó]ria|pesquisa|cient[ií]fico/i.test(lower)) {
    return 'narrative_director';
  }
  if (/vfx|efeito|part[ií]cula|compositing/i.test(lower)) {
    return 'vfx_director';
  }
  if (/cor|color|grading|paleta/i.test(lower)) {
    return 'color_director';
  }
  if (/humor|piada|c[oô]mico/i.test(lower)) {
    return 'comedy_director';
  }
  return fallback[0] ?? 'general_director';
}

function extractStructuredConceptsFromSections(
  sections: ParsedSection[],
  materialTitle: string,
  fallbackDirectors: DirectorId[],
): ExtractedConcept[] {
  const concepts: ExtractedConcept[] = [];

  for (const sec of sections) {
    const lines = sec.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const contraindicationLines = lines.filter((l) =>
      /evitar|n[aã]o\s+usar|contraindica|quando\s+n[aã]o|atrapalh|prejudic|dens[ao]|polui/i.test(l),
    );
    const exampleLines = lines.filter((l) => /exemplo|por exemplo|ex\.:|como em/i.test(l));
    const globalContraindication =
      contraindicationLines[0] ??
      'Evitar uso excessivo quando a cena já possuir informação visual densa ou elementos críticos no quadro.';

    // Look for explicit "Concept: explanation" bullets or lines
    let foundExplicitInSection = false;
    for (const line of lines) {
      const cleaned = line.replace(/^[-*•]\s*/, '');
      const colonMatch = cleaned.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:]{2,58}):\s+(.{12,})$/);
      if (colonMatch) {
        foundExplicitInSection = true;
        const name = (colonMatch[1] ?? '').trim();
        const desc = (colonMatch[2] ?? '').trim();
        const objMatch = desc.match(/(?:para|com objetivo de|visando)\s+([^.;]+)/i);
        concepts.push({
          techniqueName: name,
          description: desc,
          objective: objMatch ? objMatch[0].trim() : desc,
          whenToUse: desc,
          contraindications: globalContraindication,
          examples: exampleLines.slice(0, 2),
          directorId: inferDirectorForConcept(`${sec.sectionTitle} ${name} ${desc}`, fallbackDirectors),
          referenceLocation: sec.reference,
          sourceExcerpt: cleaned.slice(0, 260),
        });
      }
    }

    if (!foundExplicitInSection) {
      const summaryText = lines.slice(0, 3).join(' ');
      const whenLine = lines.find((l) => /quando|usar|aplicar|escolher|deve|devem/i.test(l)) ?? summaryText;
      concepts.push({
        techniqueName: sec.sectionTitle !== materialTitle ? sec.sectionTitle : `${materialTitle} (${sec.reference})`,
        description: summaryText.slice(0, 260),
        objective: summaryText.slice(0, 200),
        whenToUse: whenLine.slice(0, 220),
        contraindications: globalContraindication,
        examples: exampleLines.slice(0, 2),
        directorId: inferDirectorForConcept(`${sec.sectionTitle} ${sec.text}`, fallbackDirectors),
        referenceLocation: sec.reference,
        sourceExcerpt: sec.text.slice(0, 260),
      });
    }
  }

  return concepts.slice(0, 40);
}

export function routeMaterialToDirectors(
  title: string,
  kind: AcademyMaterialKind,
  textSample: string,
  manualDirectors?: DirectorId[],
): DirectorId[] {
  if (manualDirectors && manualDirectors.length > 0) {
    return Array.from(new Set(manualDirectors));
  }
  const combined = `${title} ${textSample}`.toLowerCase();
  const dirs = new Set<DirectorId>();

  if (kind === 'audio' || /mix|ducking|lufs|som|áudio|audio|sfx|narra/i.test(combined)) {
    dirs.add('sound_director');
    if (/narra|voz|pros[oó]dia/i.test(combined)) dirs.add('narration_director');
    if (/m[uú]sica|trilha/i.test(combined)) dirs.add('music_director');
  }
  if (kind === 'video' || /trailer|corte|ritmo|pacing|montagem|edi[çc][aã]o/i.test(combined)) {
    dirs.add('editing_director');
    dirs.add('cinematography_director');
    dirs.add('music_director');
  }
  if (/roteiro|narrativa|hist[oó]ria|ato|gancho|cl[ií]max/i.test(combined)) {
    dirs.add('narrative_director');
  }
  if (/cor|color|grading|lut|rec\.?709/i.test(combined)) {
    dirs.add('color_director');
  }
  if (/vfx|efeito|composi[çc][aã]o|part[ií]cula/i.test(combined)) {
    dirs.add('vfx_director');
  }
  if (/motion|t[ií]tulo|tipografia|safe/i.test(combined)) {
    dirs.add('motion_director');
  }
  if (/humor|com[eé]dia|piada|ironia/i.test(combined)) {
    dirs.add('comedy_director');
  }
  if (dirs.size === 0) {
    dirs.add('general_director');
    dirs.add('narrative_director');
  }
  return Array.from(dirs);
}

async function probeLocalMediaForAcademy(filePath: string): Promise<{
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  sceneCutsCount?: number;
  integratedLufs?: number;
  truePeakDbtp?: number;
  silenceEventsCount?: number;
}> {
  if (!existsSync(filePath)) return {};
  try {
    const [ffprobeRes, fullProbe] = await Promise.all([
      execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width,height,r_frame_rate:format=duration',
        '-of',
        'json',
        filePath,
      ]),
      probeRealMp4(filePath).catch(() => null),
    ]);
    const parsed = JSON.parse(ffprobeRes.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }>;
    };
    const vStream = (parsed.streams ?? []).find((s) => s.codec_type === 'video');
    let fps: number | undefined;
    if (vStream?.r_frame_rate) {
      const [num, den] = vStream.r_frame_rate.split('/').map(Number);
      if (num && den) fps = Number((num / den).toFixed(2));
    }
    const durationSec = parsed.format?.duration ? Number(Number(parsed.format.duration).toFixed(2)) : undefined;
    return {
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(vStream?.width ? { width: vStream.width } : {}),
      ...(vStream?.height ? { height: vStream.height } : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(typeof fullProbe?.sceneCutsCount === 'number' ? { sceneCutsCount: fullProbe.sceneCutsCount } : {}),
      ...(typeof fullProbe?.integratedLufs === 'number' ? { integratedLufs: fullProbe.integratedLufs } : {}),
      ...(typeof fullProbe?.truePeakDbtp === 'number' ? { truePeakDbtp: fullProbe.truePeakDbtp } : {}),
      ...(typeof fullProbe?.silenceEventsCount === 'number' ? { silenceEventsCount: fullProbe.silenceEventsCount } : {}),
    };
  } catch {
    return {};
  }
}

export class AetheraAcademyEngine {
  private readonly storePath: string | null;
  private readonly evolution: AetheraEvolutionCore;
  private snapshot: AcademyStoreSnapshot;

  constructor(evolution: AetheraEvolutionCore, storePath?: string) {
    this.evolution = evolution;
    this.storePath = storePath ?? null;
    this.snapshot = this.load();
    if (this.snapshot.knowledge.some((k) => /· Técnica \d+$/u.test(k.techniqueName))) {
      this.reprocessAllMaterials();
    }
  }

  private load(): AcademyStoreSnapshot {
    if (this.storePath && existsSync(this.storePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.storePath, 'utf8')) as AcademyStoreSnapshot;
        if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.materials)) {
          return parsed;
        }
      } catch {
        // start fresh
      }
    }
    return { schemaVersion: 1, materials: [], knowledge: [], exercises: [] };
  }

  private persist(): void {
    if (!this.storePath) return;
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.snapshot, null, 2), 'utf8');
    renameSync(tmp, this.storePath);
  }

  replaceSnapshot(next: AcademyStoreSnapshot): AcademyStoreSnapshot {
    if (!next || next.schemaVersion !== 1 || !Array.isArray(next.materials)) {
      throw new Error('Snapshot da Academy inválido para restauração.');
    }
    this.snapshot = {
      schemaVersion: 1,
      materials: [...next.materials],
      knowledge: Array.isArray(next.knowledge) ? [...next.knowledge] : [],
      exercises: Array.isArray(next.exercises) ? [...next.exercises] : [],
    };
    this.persist();
    return this.getSnapshot();
  }

  async ingestMaterial(input: {
    title: string;
    kind: AcademyMaterialKind;
    sourceUri: string;
    author: string;
    license: string;
    rightsScope: AcademyRightsScope;
    mode: AcademyLearningMode;
    textContent?: string;
    manualDirectors?: DirectorId[];
  }): Promise<{
    material: AcademyMaterialRecord;
    extractedKnowledge: AcademyKnowledgeRecord[];
  }> {
    let rawText = input.textContent ?? '';
    if (!rawText && (input.kind === 'document' || input.kind === 'script') && existsSync(input.sourceUri)) {
      rawText = readFileSync(input.sourceUri, 'utf8');
    }
    const cleanText = sanitizeExternalText(convertMarkdownToPlainText(rawText));
    const cleanTitle = sanitizeExternalText(input.title);
    const sha256 = createHash('sha256')
      .update(`${input.sourceUri}:${cleanTitle}:${cleanText.slice(0, 2000)}`)
      .digest('hex')
      .slice(0, 16);

    const existing = this.snapshot.materials.find((m) => m.sha256 === sha256);
    if (existing) {
      return {
        material: existing,
        extractedKnowledge: this.snapshot.knowledge.filter((k) => k.materialId === existing.materialId),
      };
    }

    const mediaMeta =
      input.kind === 'video' || input.kind === 'audio' || input.kind === 'image'
        ? await probeLocalMediaForAcademy(input.sourceUri)
        : {};

    const parsedSections = parseDocumentSections(cleanText, input.kind, cleanTitle);
    const chunks: AcademyChunk[] = parsedSections.map((sec, idx) => ({
      chunkId: `chk_${idx + 1}`,
      reference: sec.reference,
      sectionTitle: sec.sectionTitle,
      text: sec.text,
    }));

    const assignedDirectors = routeMaterialToDirectors(
      cleanTitle,
      input.kind,
      cleanText.slice(0, 1200),
      input.manualDirectors,
    );

    const material: AcademyMaterialRecord = {
      materialId: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sha256,
      title: cleanTitle,
      kind: input.kind,
      sourceUri: input.sourceUri,
      author: sanitizeExternalText(input.author),
      license: sanitizeExternalText(input.license),
      rightsScope: input.rightsScope,
      mode: input.mode,
      assignedDirectors,
      metadata: {
        ...mediaMeta,
        chunkCount: chunks.length,
      },
      chunks,
      importedAt: new Date().toISOString(),
    };
    this.snapshot.materials.push(material);

    const extractedKnowledge = this.extractAndStoreKnowledge(material, parsedSections, material.metadata);
    this.persist();
    return { material, extractedKnowledge };
  }

  private extractAndStoreKnowledge(
    material: AcademyMaterialRecord,
    sections: ParsedSection[],
    mediaMeta: AcademyMaterialRecord['metadata'],
    preservedStates?: Map<string, { validationState: LearningState; testedInExercise: boolean; usageCount: number; version: number }>,
  ): AcademyKnowledgeRecord[] {
    const concepts = extractStructuredConceptsFromSections(
      sections,
      material.title,
      material.assignedDirectors,
    );

    const records: AcademyKnowledgeRecord[] = concepts.map((concept, idx) => {
      const avgShotSec =
        mediaMeta.durationSec && mediaMeta.sceneCutsCount !== undefined
          ? Number((mediaMeta.durationSec / (mediaMeta.sceneCutsCount + 1)).toFixed(2))
          : undefined;
      const observedInfo =
        material.kind === 'video' && mediaMeta.durationSec
          ? `Vídeo "${material.title}" (${mediaMeta.width ?? '?'}x${mediaMeta.height ?? '?'}, ${mediaMeta.durationSec}s, ${mediaMeta.sceneCutsCount ?? 0} cortes, ritmo ~${avgShotSec ?? '?'}s/plano, ${mediaMeta.integratedLufs ?? '?'} LUFS, pico ${mediaMeta.truePeakDbtp ?? '?'} dBTP): ${concept.sourceExcerpt}`
          : `${concept.referenceLocation}: ${concept.sourceExcerpt}`;
      const proposedTechnique =
        material.kind === 'video' && concept.directorId === 'editing_director' && avgShotSec !== undefined
          ? `Manter ritmo de montagem próximo a ${avgShotSec}s/plano (${mediaMeta.sceneCutsCount ?? 0} cortes em ${mediaMeta.durationSec}s).`
          : material.kind === 'video' && concept.directorId === 'sound_director' && mediaMeta.integratedLufs !== undefined
            ? `Alinhar mixagem em ~${mediaMeta.integratedLufs} LUFS com true peak <= ${mediaMeta.truePeakDbtp ?? -1.0} dBTP.`
            : `${concept.techniqueName}: ${concept.description} | Contraindicação: ${concept.contraindications}`;

      const prev = preservedStates?.get(concept.techniqueName);
      const knowledge: AcademyKnowledgeRecord = {
        knowledgeId: `know_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
        materialId: material.materialId,
        directorId: concept.directorId,
        techniqueName: concept.techniqueName,
        referenceLocation: concept.referenceLocation,
        observedInfo,
        aiInterpretation: `Conceito estruturado para ${concept.directorId}: ${concept.objective}`,
        proposedTechnique,
        description: concept.description,
        objective: concept.objective,
        whenToUse: concept.whenToUse,
        contraindications: concept.contraindications,
        examples: concept.examples,
        sourceExcerpt: concept.sourceExcerpt,
        extractionMethod: 'structured_heuristic',
        testedInExercise: prev?.testedInExercise ?? false,
        validationState: prev?.validationState ?? 'proposed',
        confidence: prev?.validationState === 'validated' ? 0.9 : 0.78,
        usageCount: prev?.usageCount ?? 0,
        version: (prev?.version ?? 0) + 1,
        createdAt: new Date().toISOString(),
      };
      this.snapshot.knowledge.push(knowledge);

      this.evolution.recordMemory({
        techniqueKey: `acad_${material.sha256}_${concept.directorId}_${idx}`,
        directorId: concept.directorId,
        kind: 'semantic',
        epistemicLevel: prev?.validationState === 'validated' ? 'validated_rule' : 'extracted_knowledge',
        state: prev?.validationState ?? 'proposed',
        title: knowledge.techniqueName,
        content: `${observedInfo} -> ${proposedTechnique}`,
        tags: ['academy', material.kind, material.mode, concept.directorId],
        scope: { directorId: concept.directorId },
        confidence: knowledge.confidence,
        evidence: {
          sourceType: 'academy_material',
          sourceId: material.materialId,
          summary: `${material.title} (${concept.referenceLocation})`,
          recordedAt: new Date().toISOString(),
        },
      });

      return knowledge;
    });

    return records;
  }

  reprocessAllMaterials(): { reprocessedCount: number; totalKnowledge: number } {
    let reprocessedCount = 0;
    for (const mat of this.snapshot.materials) {
      const prevMap = new Map<string, { validationState: LearningState; testedInExercise: boolean; usageCount: number; version: number }>();
      for (const old of this.snapshot.knowledge.filter((k) => k.materialId === mat.materialId)) {
        prevMap.set(old.techniqueName, {
          validationState: old.validationState,
          testedInExercise: old.testedInExercise,
          usageCount: old.usageCount,
          version: old.version,
        });
      }
      this.snapshot.knowledge = this.snapshot.knowledge.filter((k) => k.materialId !== mat.materialId);
      const rawJoined = mat.chunks.map((c) => (c.sectionTitle ? `## ${c.sectionTitle}\n${c.text}` : c.text)).join('\n\n');
      const sections = parseDocumentSections(convertMarkdownToPlainText(rawJoined), mat.kind, mat.title);
      mat.chunks = sections.map((sec, idx) => ({
        chunkId: `chk_${idx + 1}`,
        reference: sec.reference,
        sectionTitle: sec.sectionTitle,
        text: sec.text,
      }));
      mat.metadata.chunkCount = mat.chunks.length;
      this.extractAndStoreKnowledge(mat, sections, mat.metadata, prevMap);
      reprocessedCount += 1;
    }
    this.persist();
    return { reprocessedCount, totalKnowledge: this.snapshot.knowledge.length };
  }

  runExercise(input: {
    title: string;
    directorId: DirectorId;
    knowledgeIds: string[];
    qualityScore: number;
    passed: boolean;
    notes: string;
  }): AcademyExerciseRecord {
    const exercise: AcademyExerciseRecord = {
      exerciseId: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: sanitizeExternalText(input.title),
      directorId: input.directorId,
      knowledgeIds: input.knowledgeIds,
      outputSummary: `Exercício prático de ${input.directorId} aplicando ${input.knowledgeIds.length} técnica(s).`,
      qualityScore: input.qualityScore,
      passed: input.passed,
      notes: sanitizeExternalText(input.notes),
      createdAt: new Date().toISOString(),
    };
    this.snapshot.exercises.push(exercise);

    for (const kId of input.knowledgeIds) {
      const k = this.snapshot.knowledge.find((item) => item.knowledgeId === kId);
      if (k) {
        k.testedInExercise = true;
        k.usageCount += 1;
        k.validationState = input.passed ? 'validated' : 'evaluating';
        k.confidence = input.passed ? Math.min(0.95, k.confidence + 0.2) : k.confidence;
      }
    }

    this.evolution.recordMemory({
      techniqueKey: `exercise_${input.directorId}_${exercise.exerciseId}`,
      directorId: input.directorId,
      kind: 'procedural',
      epistemicLevel: input.passed ? 'validated_rule' : 'hypothesis',
      state: input.passed ? 'validated' : 'evaluating',
      title: `Exercício: ${exercise.title}`,
      content: `${exercise.outputSummary} Nota QC: ${input.qualityScore}/100. ${exercise.notes}`,
      tags: ['academy', 'exercise', input.directorId],
      scope: { directorId: input.directorId },
      confidence: input.passed ? 0.88 : 0.5,
      evidence: {
        sourceType: 'exercise',
        sourceId: exercise.exerciseId,
        summary: exercise.notes,
        metrics: { qualityScore: input.qualityScore, passed: input.passed },
        recordedAt: new Date().toISOString(),
      },
    });

    this.persist();
    return exercise;
  }

  private retrieveRelevantEvidence(question: string, directorFilter?: DirectorId) {
    const qTokens = tokenize(question);
    const qSet = new Set(qTokens);
    const qNorm = question
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Build bigrams for phrase matching
    const qBigrams: string[] = [];
    for (let i = 0; i < qTokens.length - 1; i += 1) {
      qBigrams.push(`${qTokens[i]} ${qTokens[i + 1]}`);
    }

    const scoredKnowledge = this.snapshot.knowledge
      .filter((k) => !directorFilter || k.directorId === directorFilter)
      .map((k) => {
        const titleTokens = new Set(tokenize(`${k.techniqueName} ${k.referenceLocation}`));
        const bodyTokens = new Set(
          tokenize(`${k.description ?? ''} ${k.objective ?? ''} ${k.whenToUse ?? ''} ${k.contraindications ?? ''} ${k.observedInfo}`),
        );
        let score = 0;
        for (const t of qSet) {
          if (titleTokens.has(t)) score += 2.2;
          else if (bodyTokens.has(t)) score += 1.1;
        }
        const hayNorm = `${k.techniqueName} ${k.description ?? ''} ${k.observedInfo} ${k.referenceLocation}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        for (const bg of qBigrams) {
          if (hayNorm.includes(bg)) score += 2.5;
        }
        if (/diretor|colabor|equipe/i.test(qNorm) && /diretor|colabor/i.test(hayNorm)) score += 1.5;
        if (/evitar|atrapalh|composi|segur/i.test(qNorm) && /evitar|atrapalh|composi|segur|hud|rosto/i.test(hayNorm)) score += 2.0;
        if (isBoilerplateSection(k.referenceLocation, k.observedInfo) && !/checklist/i.test(qNorm)) {
          score *= 0.35;
        }
        return { k, score };
      })
      .filter((item) => item.score >= 2.0)
      .sort((a, b) => b.score - a.score);

    const scoredChunks: Array<{ material: AcademyMaterialRecord; chunk: AcademyChunk; score: number }> = [];
    for (const mat of this.snapshot.materials) {
      if (directorFilter && !mat.assignedDirectors.includes(directorFilter)) continue;
      for (const chunk of mat.chunks) {
        const secTokens = new Set(tokenize(`${chunk.sectionTitle ?? ''} ${chunk.reference}`));
        const txtTokens = new Set(tokenize(chunk.text));
        let score = 0;
        for (const t of qSet) {
          if (secTokens.has(t)) score += 2.2;
          else if (txtTokens.has(t)) score += 1.0;
        }
        const chunkNorm = `${chunk.sectionTitle ?? ''} ${chunk.text}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        for (const bg of qBigrams) {
          if (chunkNorm.includes(bg)) score += 2.5;
        }
        if (isBoilerplateSection(chunk.sectionTitle, chunk.text) && !/checklist/i.test(qNorm)) {
          score *= 0.35;
        }
        if (score >= 2.0) {
          scoredChunks.push({ material: mat, chunk, score });
        }
      }
    }
    scoredChunks.sort((a, b) => b.score - a.score);

    // Deduplicate identical boilerplate/repeated sections across modules
    const seenFingerprints = new Set<string>();
    const dedupedChunks = scoredChunks.filter((item) => {
      const fp = item.chunk.text.slice(0, 120).toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenFingerprints.has(fp)) return false;
      seenFingerprints.add(fp);
      return true;
    });

    const relevantMemories = this.evolution
      .retrieveRelevantMemories({ text: question, ...(directorFilter ? { directorId: directorFilter } : {}) })
      .filter((m) => {
        const memTokens = new Set(tokenize(`${m.title} ${m.content} ${m.tags.join(' ')}`));
        return qTokens.some((t) => memTokens.has(t));
      })
      .slice(0, 4);

    return { scoredKnowledge, scoredChunks: dedupedChunks, relevantMemories };
  }

  askAcademy(question: string, directorFilter?: DirectorId): AcademyAskResult {
    const { scoredKnowledge, scoredChunks, relevantMemories } = this.retrieveRelevantEvidence(
      question,
      directorFilter,
    );
    const bestScore = Math.max(
      scoredKnowledge[0]?.score ?? 0,
      scoredChunks[0]?.score ?? 0,
      relevantMemories.length > 0 ? 2.5 : 0,
    );

    if (
      bestScore < 2.2 ||
      (scoredKnowledge.length === 0 && scoredChunks.length === 0 && relevantMemories.length === 0)
    ) {
      return {
        answer:
          'Não há evidências suficientes nos materiais atualmente indexados na Aethera Academy para responder com segurança a esta pergunta. Importe um material pertinente antes de solicitar esta orientação.',
        sufficientKnowledge: false,
        synthesisMode: 'insufficient_evidence',
        citations: [],
      };
    }

    const topKnowledge = scoredKnowledge.slice(0, 6);
    const topChunks = scoredChunks.slice(0, 5);

    // Build grounded natural-language Portuguese response
    const paragraphs: string[] = [];
    if (topKnowledge.length > 0) {
      const bullets = topKnowledge.map(({ k }) => {
        const detail = k.description ?? k.proposedTechnique;
        const whenPart = k.whenToUse && k.whenToUse !== k.description ? ` Quando usar: ${k.whenToUse}` : '';
        return `• ${k.techniqueName} (${k.directorId} · ${k.referenceLocation}): ${detail}${whenPart}`;
      });
      paragraphs.push(bullets.join('\n'));
      const uniqueContras = Array.from(
        new Set(topKnowledge.map(({ k }) => k.contraindications).filter((c): c is string => Boolean(c))),
      );
      if (uniqueContras.length > 0) {
        paragraphs.push(`Cuidados e contraindicações: ${uniqueContras[0]}`);
      }
    } else if (topChunks.length > 0) {
      paragraphs.push(
        topChunks
          .map(({ chunk }) => `• [${chunk.reference}]: ${chunk.text.slice(0, 420)}`)
          .join('\n'),
      );
    }

    if (relevantMemories.length > 0) {
      const memLines = relevantMemories.map(
        (m) => `• [${m.state} · ${m.directorId}] ${m.content}`,
      );
      paragraphs.push(`Preferências e aprendizados contextuais persistidos:\n${memLines.join('\n')}`);
    }

    // Build non-redundant verified citations from chunks/knowledge supporting the answer
    const citationMap = new Map<string, AcademyCitation>();
    for (const { material, chunk, score } of topChunks) {
      const key = `${material.materialId}:${chunk.chunkId}`;
      if (!citationMap.has(key)) {
        const excerpt = chunk.text.length > 480 ? `${chunk.text.slice(0, 477)}...` : chunk.text;
        const verifiedAgainstSource = material.chunks.some(
          (stored) => stored.chunkId === chunk.chunkId && stored.text.includes(excerpt.replace(/\.\.\.$/, '')),
        );
        citationMap.set(key, {
          materialId: material.materialId,
          chunkId: chunk.chunkId,
          title: material.title,
          reference: chunk.reference,
          excerpt,
          fullSectionText: chunk.text,
          verifiedAgainstSource,
          relevanceScore: Number(score.toFixed(2)),
        });
      }
    }
    for (const { k, score } of topKnowledge) {
      const mat = this.snapshot.materials.find((m) => m.materialId === k.materialId);
      const matchingChunk = mat?.chunks.find((c) => c.reference === k.referenceLocation);
      const key = `${k.materialId}:${matchingChunk?.chunkId ?? k.referenceLocation}`;
      if (!citationMap.has(key)) {
        const rawExcerpt = matchingChunk?.text ?? k.sourceExcerpt ?? k.observedInfo;
        const excerpt = rawExcerpt.length > 480 ? `${rawExcerpt.slice(0, 477)}...` : rawExcerpt;
        citationMap.set(key, {
          materialId: k.materialId,
          ...(matchingChunk ? { chunkId: matchingChunk.chunkId, fullSectionText: matchingChunk.text } : {}),
          title: mat?.title ?? k.materialId,
          reference: k.referenceLocation,
          excerpt,
          verifiedAgainstSource: Boolean(matchingChunk),
          relevanceScore: Number(score.toFixed(2)),
        });
      }
    }

    return {
      answer: paragraphs.join('\n\n'),
      sufficientKnowledge: true,
      synthesisMode: 'grounded_extractive',
      citations: Array.from(citationMap.values()).slice(0, 5),
    };
  }

  async askAcademyAsync(
    question: string,
    directorFilter?: DirectorId,
    rf07Synthesizer?: (prompt: string) => Promise<string | null>,
  ): Promise<AcademyAskResult> {
    const base = this.askAcademy(question, directorFilter);
    if (!base.sufficientKnowledge || !rf07Synthesizer) {
      return base;
    }
    const { relevantMemories } = this.retrieveRelevantEvidence(question, directorFilter);
    const evidenceBlock = base.citations
      .map(
        (c, idx) =>
          `[Fonte ${idx + 1} | ${c.materialId}${c.chunkId ? `:${c.chunkId}` : ''}] ${c.title} (${c.reference}):\n${c.fullSectionText ?? c.excerpt}`,
      )
      .join('\n\n');
    const memoryBlock =
      relevantMemories.length > 0
        ? `\nMemórias e Preferências Persistidas (EvolutionCore):\n${relevantMemories
            .map((m) => `- (${m.memoryId} · ${m.state} · ${m.directorId}): ${m.content}`)
            .join('\n')}`
        : '';
    const prompt = [
      'Responda à pergunta em português natural usando EXCLUSIVAMENTE as seções completas e memórias abaixo.',
      'Estruture a resposta de forma clara separando: 1) Procedimento / Técnicas recuperadas (com diretores responsáveis, condições de uso e contraindicações), 2) Contexto/Preferências persistidas (se houver), e 3) Lacunas explícitas se algo não estiver nas fontes.',
      'Não invente informações ausentes e evite Markdown excessivo.',
      `Pergunta: ${question}`,
      '',
      evidenceBlock,
      memoryBlock,
    ].join('\n');

    try {
      const aiText = await rf07Synthesizer(prompt);
      if (aiText && aiText.trim().length > 20) {
        return {
          ...base,
          answer: aiText.trim(),
          synthesisMode: 'rf07_ai',
        };
      }
    } catch {
      // Explicit deterministic fallback
    }
    return base;
  }

  deleteMaterial(materialId: string): boolean {
    const before = this.snapshot.materials.length;
    const mat = this.snapshot.materials.find((m) => m.materialId === materialId);
    if (!mat) return false;
    this.snapshot.materials = this.snapshot.materials.filter((m) => m.materialId !== materialId);
    this.snapshot.knowledge = this.snapshot.knowledge.filter((k) => k.materialId !== materialId);
    // Also clean derived memories in Evolution Core
    for (const mem of this.evolution.getSnapshot().memories) {
      if (mem.evidence.some((e) => e.sourceId === materialId)) {
        this.evolution.deleteMemory(mem.memoryId);
      }
    }
    this.persist();
    return this.snapshot.materials.length < before;
  }

  getSnapshot(): AcademyStoreSnapshot {
    return structuredClone(this.snapshot);
  }
}
