import type {
  PipelineStageId,
  ProductionProject,
  PublicationPackage,
  RevisionPlan,
  SceneItem,
} from './types';

export interface ParsedBriefingIntent {
  title: string;
  style: ProductionProject['style'];
  durationMin: number;
  durationDetected: boolean;
  aspectRatio: '16:9' | '9:16';
  format: ProductionProject['format'];
  language: string;
  humorLevel: number;
  keywords: string[];
}

export function parseBriefingIntent(rawPrompt: string): ParsedBriefingIntent {
  const text = rawPrompt.trim();
  const lower = text.toLowerCase();

  let durationMin = 10;
  let durationDetected = false;
  const minMatch = lower.match(/(\d{1,2})\s*(?:min|minuto|minutos)/);
  const secMatch = lower.match(/(\d{2,3})\s*(?:s|seg|segundo|segundos)/);
  if (minMatch) {
    durationMin = Math.min(60, Math.max(1, Number(minMatch[1])));
    durationDetected = true;
  } else if (secMatch) {
    durationMin = Math.max(1, Math.round(Number(secMatch[1]) / 60));
    durationDetected = true;
  }

  const isVertical =
    /\b(shorts|reels|tiktok|vertical|9:16)\b/.test(lower) ||
    (secMatch !== null && Number(secMatch[1]) <= 60);
  const aspectRatio: '16:9' | '9:16' = isVertical ? '9:16' : '16:9';
  const format: ProductionProject['format'] = isVertical
    ? 'shorts_9_16'
    : /\b(4k|cinema|imax)\b/.test(lower)
      ? 'youtube_4k'
      : /\b(document[áa]rio|doc)\b/.test(lower)
        ? 'documentary_wide'
        : 'youtube_1080p';

  let style: ProductionProject['style'] = 'Video Essay';
  if (/\b(top\s*\d+|ranking|\d+\s+melhores|\d+\s+piores|\d+\s+chefes|lista)\b/.test(lower)) {
    style = 'Top 10';
  } else if (/\b(document[áa]rio|hist[óo]ria real|dossi[êe]|investiga[çc][ãa]o)\b/.test(lower)) {
    style = 'Documentário';
  } else if (/\b(com[ée]dia|engra[çc]ado|s[áa]tira|par[óo]dia)\b/.test(lower)) {
    style = 'Comédia Narrada';
  } else if (/\b(an[áa]lise|arquitetura|benchmark|review t[ée]cnico|como funciona)\b/.test(lower)) {
    style = 'Análise Técnica';
  }

  let humorLevel = 25;
  if (/\b(com[ée]dia|par[óo]dia|hil[áa]rio)\b/.test(lower)) humorLevel = 75;
  else if (/\b(humor pontual|ir[ôo]nico|leve)\b/.test(lower)) humorLevel = 35;
  else if (/\b(s[ée]rio|sombrio|dram[áa]tico)\b/.test(lower)) humorLevel = 10;

  const language = /\b(english|ingl[êe]s|en-us)\b/.test(lower) ? 'en-US' : 'pt-BR';

  const cleaned = text
    .replace(
      /^(crie|fa[çc]a|produza|gere)\s+(um\s+)?(v[íi]deo|roteiro|document[áa]rio|short)\s*(cinematogr[áa]fico\s*)?(sobre\s+)?/i,
      '',
    )
    .replace(
      /\s*,?\s*(com\s+narrativa\s+[^,.]+|com\s+humor\s+[^,.]+|com\s+dura[çc][ãa]o\s+de\s+\d+\s*(?:min|minutos|s|segundos)|em\s+\d+\s*(?:min|minutos|s|segundos)).*$/i,
      '',
    )
    .replace(/[.,;:\s]+$/, '')
    .trim();
  const titleBase = cleaned.length > 4 ? cleaned : text || 'Nova Produção Audiovisual';
  const capitalized = titleBase.charAt(0).toUpperCase() + titleBase.slice(1);
  const title = capitalized.length > 56 ? `${capitalized.slice(0, 53).trim()}...` : capitalized;

  const stopWords = new Set([
    'sobre', 'para', 'como', 'mais', 'video', 'vídeo', 'crie', 'faca', 'faça',
    'minutos', 'minuto', 'com', 'uma', 'dos', 'das', 'que', 'por', 'sem', 'cinematografico',
    'cinematográfico', 'narrativa', 'duracao', 'duração',
  ]);
  const keywords = Array.from(
    new Set(
      lower
        .replace(/[^a-z0-9áéíóúâêôãõç\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stopWords.has(w)),
    ),
  ).slice(0, 5);

  return {
    title,
    style,
    durationMin,
    durationDetected,
    aspectRatio,
    format,
    language,
    humorLevel,
    keywords: keywords.length > 0 ? keywords : ['cinema', 'narrativa', 'estúdio'],
  };
}

const SCENE_ACCENTS = ['#b8a4f4', '#d8fb4f', '#f9a8d4', '#8fb8d6', '#f4c587'];

export function generateStoryboardScenes(
  title: string,
  briefing: string,
  durationMin: number,
  style: ProductionProject['style'],
): SceneItem[] {
  const totalSec = Math.max(45, durationMin * 60);
  const weights = [0.12, 0.22, 0.28, 0.24, 0.14];
  const templates: Array<{ title: string; role: string; transition: SceneItem['transition'] }> = [
    {
      title: 'Gancho & Premissa',
      role: `Abertura cinematográfica apresentando a tese central de "${title}" com corte rítmico e tensão imediata.`,
      transition: 'corte_seco',
    },
    {
      title: 'Contexto & Dossiê Factual',
      role: `Construção de contexto validado para o estilo ${style}, conectando evidências visuais ao arco narrativo.`,
      transition: 'dissolve',
    },
    {
      title: 'Desenvolvimento & Virada',
      role: `Aprofundamento do tema "${briefing.slice(0, 90)}" com contraste dramático, B-roll verificado e ritmo crescente.`,
      transition: 'whip_pan',
    },
    {
      title: 'Clímax & Prova Visual',
      role: 'Sequência principal com foco em retenção, legenda dinâmica e destaque sonoro no ponto alto.',
      transition: 'corte_seco',
    },
    {
      title: 'Síntese & Chamada Editorial',
      role: 'Fechamento memorável retomando o gancho inicial e preparando gancho para o próximo episódio do canal.',
      transition: 'fade_black',
    },
  ];

  return templates.map((tpl, idx) => {
    const durationSec = Math.max(8, Math.round(totalSec * weights[idx]));
    return {
      id: `scene-${idx + 1}`,
      index: idx + 1,
      title: tpl.title,
      narration: tpl.role,
      visualQuery: `${title.toLowerCase()} — plano ${idx + 1} (${style.toLowerCase()})`,
      durationSec,
      transition: tpl.transition,
      mediaMatched: idx < 4,
      caption: `${idx + 1}. ${tpl.title} — ${title}`,
      accentHex: SCENE_ACCENTS[idx % SCENE_ACCENTS.length],
    };
  });
}

export function planSurgicalRevision(instruction: string): Omit<RevisionPlan, 'id' | 'createdAt'> {
  const lower = instruction.toLowerCase();
  const affected: PipelineStageId[] = [];

  if (/(roteiro|texto|narra[çc][ãa]o|fala|humor|tom|gancho)/.test(lower)) {
    affected.push('script', 'audio_sfx');
  }
  if (/(cena|corte|ritmo|transi[çc][ãa]o|montagem|timeline|acelerar)/.test(lower)) {
    affected.push('assembly', 'preview_render');
  }
  if (/(m[íi]dia|b-roll|imagem|clip|frame|visual)/.test(lower)) {
    affected.push('decoupage', 'media_acquisition', 'assembly');
  }
  if (/(voz|[áa]udio|trilha|sfx|volume|legenda)/.test(lower)) {
    affected.push('audio_sfx', 'preview_render');
  }

  const uniqueStages = Array.from(
    new Set<PipelineStageId>(affected.length > 0 ? affected : ['assembly', 'preview_render']),
  );

  return {
    instruction: instruction.trim(),
    summary: `Revisão cirúrgica planejada (${uniqueStages.length} etapa${uniqueStages.length > 1 ? 's' : ''} impactada${uniqueStages.length > 1 ? 's' : ''}) preservando o restante do cache.`,
    affectedStages: uniqueStages,
  };
}

export interface HumanizeResult {
  humanizedText: string;
  changes: string[];
  readabilityBefore: number;
  readabilityAfter: number;
}

const AI_CLICHE_REPLACEMENTS: ReadonlyArray<[RegExp, string, string]> = [
  [/\bno cen[áa]rio atual\b/gi, 'hoje', 'Removido clichê corporativo "no cenário atual"'],
  [/\bmergulhar fundo\b/gi, 'analisar de perto', 'Substituído jargão traduzido "mergulhar fundo"'],
  [/\bvale ressaltar que\b/gi, 'repare que', 'Trocada transição rígida por fala natural'],
  [/\bem conclus[ãa]o,?\s*/gi, 'No fim das contas, ', 'Abertura de fechamento mais conversacional'],
  [/\bsem d[úu]vida alguma\b/gi, 'claramente', 'Reduzida hipérbole robótica'],
  [/\brevolucion[áa]ri[oa]\b/gi, 'transformador', 'Suavizado adjetivo exagerado'],
  [/\bportanto,?\s*/gi, 'Por isso, ', 'Conectivo adaptado para locução falada'],
  [/\bademais,?\s*/gi, 'Além disso, ', 'Conectivo adaptado para fala natural'],
];

export function humanizeNarrationScript(rawText: string, tone: 'editorial' | 'conversacional' | 'documental' = 'editorial'): HumanizeResult {
  const original = rawText.trim();
  if (!original) {
    return {
      humanizedText: '',
      changes: ['Nenhum texto fornecido para humanização.'],
      readabilityBefore: 0,
      readabilityAfter: 0,
    };
  }

  const changes: string[] = [];
  let text = original.replace(/\s+/g, ' ').trim();

  for (const [pattern, replacement, note] of AI_CLICHE_REPLACEMENTS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      changes.push(note);
    }
  }

  // Break overly long sentences (> 26 words) into spoken rhythm beats
  const sentences = text.split(/(?<=[.!?])\s+/);
  const refined = sentences.map((sentence) => {
    const words = sentence.split(/\s+/);
    if (words.length > 26 && sentence.includes(', ')) {
      const idx = sentence.indexOf(', ', Math.floor(sentence.length * 0.42));
      if (idx > 0) {
        changes.push('Quebrada frase longa em pausa respiratória para locução TTS.');
        const first = sentence.slice(0, idx).trim();
        const second = sentence.slice(idx + 2).trim();
        const capSecond = second.charAt(0).toUpperCase() + second.slice(1);
        return `${first}. ${capSecond}`;
      }
    }
    return sentence;
  });

  let output = refined.join(' ');
  if (tone === 'conversacional' && !/^[A-ZÁÉÍÓÚ]/.test(output)) {
    output = output.charAt(0).toUpperCase() + output.slice(1);
  }
  if (changes.length === 0) {
    changes.push(`Cadência revisada no perfil "${tone}" com pontuação preservada para narração natural.`);
  }

  const avgWordsBefore = original.split(/\s+/).length / Math.max(1, original.split(/[.!?]+/).filter(Boolean).length);
  const avgWordsAfter = output.split(/\s+/).length / Math.max(1, output.split(/[.!?]+/).filter(Boolean).length);
  const readabilityBefore = Math.max(35, Math.min(98, Math.round(100 - Math.max(0, avgWordsBefore - 14) * 2.4)));
  const readabilityAfter = Math.max(readabilityBefore, Math.min(99, Math.round(100 - Math.max(0, avgWordsAfter - 14) * 2.1 + 6)));

  return {
    humanizedText: output,
    changes: Array.from(new Set(changes)),
    readabilityBefore,
    readabilityAfter,
  };
}

export interface YouTubeAgentAnalysis {
  score: number;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedTags: string[];
  findings: Array<{ check: string; ok: boolean; recommendation: string }>;
}

export function analyzeYouTubePackage(project: ProductionProject, pkg: PublicationPackage): YouTubeAgentAnalysis {
  const title = (pkg.title || project.title).trim();
  const desc = (pkg.description || project.briefing).trim();
  const tags = pkg.tags.length > 0 ? pkg.tags : parseBriefingIntent(project.briefing).keywords;

  const titleLengthOk = title.length >= 25 && title.length <= 68;
  const hasChapters = /\b00:00\b/.test(desc);
  const hasCta = /(inscreva|coment|pr[óo]ximo|assista|canal)/i.test(desc);
  const tagCountOk = tags.length >= 4 && tags.length <= 15;
  const hasApprovedThumb = Boolean(pkg.thumbnailArtId);

  const findings = [
    {
      check: 'Comprimento ideal do título (25–68 caracteres)',
      ok: titleLengthOk,
      recommendation: titleLengthOk
        ? `Título equilibrado (${title.length} caracteres) para CTR mobile e desktop.`
        : `Ajustar título (${title.length} caracteres) para ficar entre 25 e 68 caracteres sem truncar no mobile.`,
    },
    {
      check: 'Capítulos com timestamp na descrição (00:00)',
      ok: hasChapters,
      recommendation: hasChapters
        ? 'Capítulos detectados — melhora indexação na busca do YouTube.'
        : 'Incluir marcações de capítulo a partir de 00:00 com base nas cenas do storyboard.',
    },
    {
      check: 'Tags e entidades semânticas (4–15 tags)',
      ok: tagCountOk,
      recommendation: tagCountOk
        ? `${tags.length} tags relevantes configuradas.`
        : 'Expandir tags para 5–8 termos combinando nicho, formato e tema central.',
    },
    {
      check: 'Chamada editorial / retenção na descrição',
      ok: hasCta,
      recommendation: hasCta
        ? 'Chamada para engajamento presente na descrição.'
        : 'Adicionar convite de comentário e gancho para o próximo vídeo.',
    },
    {
      check: 'Thumbnail vinculada ao pacote de publicação',
      ok: hasApprovedThumb,
      recommendation: hasApprovedThumb
        ? 'Arte do Creative Studio associada ao pacote.'
        : 'Selecionar uma thumbnail aprovada no Creative Studio antes de agendar.',
    },
  ];

  const score = Math.round((findings.filter((f) => f.ok).length / findings.length) * 100);

  // Build chapter list from actual project scenes
  let cursor = 0;
  const chapters = project.scenes
    .map((scene) => {
      const m = Math.floor(cursor / 60);
      const s = Math.floor(cursor % 60);
      cursor += scene.durationSec;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} — ${scene.title}`;
    })
    .join('\n');

  const suggestedTitle = title.length > 68 ? `${title.slice(0, 64).trim()}...` : title;
  const suggestedDescription = [
    `${project.briefing.trim()}`,
    '',
    'Capítulos:',
    chapters,
    '',
    'Qual cena mais chamou sua atenção? Comente abaixo e inscreva-se no canal para o próximo episódio.',
  ].join('\n');

  const baseKeywords = parseBriefingIntent(`${project.title} ${project.briefing}`).keywords;
  const suggestedTags = Array.from(
    new Set([
      ...tags,
      ...baseKeywords,
      project.style.toLowerCase(),
      project.aspectRatio === '9:16' ? 'shorts' : 'youtube',
      'aethera',
    ]),
  ).slice(0, 8);

  return {
    score,
    suggestedTitle,
    suggestedDescription,
    suggestedTags,
    findings,
  };
}
