export type ContentCategoryId =
  | 'games'
  | 'anime-manga'
  | 'cinema'
  | 'education'
  | 'technology'
  | 'entertainment'
  | 'professional-production';

export type CreativeDimension = 'narrativeFormatId' | 'contentCategoryId' | 'aestheticDirectionId';
export type DeliveryQualityProfile = 'draft_540p' | 'review_720p' | 'master_1080p' | 'master_4k';
export type DeliveryPlatform = 'youtube' | 'shorts' | 'tiktok' | 'instagram' | 'cinema' | 'podcast' | 'presentation' | 'custom';
export type SupportedVideoCodec = 'h264' | 'h264_nvenc';
export type SupportedAudioCodec = 'aac' | 'pcm_s16le';

export const CONTENT_CATEGORIES: ReadonlyArray<{ id: ContentCategoryId; label: string; description: string }> = [
  { id: 'games', label: 'Games', description: 'Gameplay, análises, guias, eSports e design de jogos.' },
  { id: 'anime-manga', label: 'Anime e Mangá', description: 'Obras animadas, mangás, personagens, cenas e sistemas de poder.' },
  { id: 'cinema', label: 'Cinema', description: 'Filmes, linguagem audiovisual, roteiro, direção e história do cinema.' },
  { id: 'education', label: 'Educação', description: 'Aulas, cursos, tutoriais, ciência e comunicação de conhecimento.' },
  { id: 'technology', label: 'Tecnologia', description: 'Produtos, software, hardware, código, dados e inovação.' },
  { id: 'entertainment', label: 'Entretenimento', description: 'Podcasts, entrevistas, listas, humor, reação e cultura pop.' },
  { id: 'professional-production', label: 'Produção Profissional', description: 'Apresentações, treinamentos, webinars, marca e comunicação corporativa.' },
];

export const NARRATIVE_FORMATS: ReadonlyArray<{ id: string; label: string; description: string }> = [
  { id: 'documentary', label: 'Documentário', description: 'Investigação e contexto em progressão factual, com testemunhos e evidências.' },
  { id: 'gameplay-essay', label: 'Gameplay Essay', description: 'Argumento autoral sustentado por gameplay, análise e progressão temática.' },
  { id: 'top-list', label: 'Top List / Ranking', description: 'Lista ranqueada com critérios explícitos, comparação e revelação progressiva.' },
  { id: 'trailer', label: 'Trailer', description: 'Promessa audiovisual de alto impacto, com escalada, clímax e chamada final.' },
  { id: 'video-essay', label: 'Video Essay', description: 'Ensaio narrado que conecta tese, contexto, exemplos e conclusão.' },
  { id: 'review', label: 'Review', description: 'Avaliação argumentada com critérios, pontos fortes, limites e veredito.' },
  { id: 'tutorial', label: 'Tutorial', description: 'Aprendizado passo a passo, com demonstração e checagem de entendimento.' },
  { id: 'lesson', label: 'Aula', description: 'Explicação didática modular com objetivos, exemplos e síntese.' },
  { id: 'how-to', label: 'Como fazer', description: 'Procedimento orientado a resultado, com preparação, execução e validação.' },
  { id: 'product-demo', label: 'Demonstração de produto', description: 'Mostra um produto em uso e traduz recursos em benefícios observáveis.' },
  { id: 'benchmark', label: 'Benchmark', description: 'Teste comparável com método, condições, resultados e limitações.' },
  { id: 'interview', label: 'Entrevista', description: 'Conversa guiada por perguntas, contexto, escuta e cortes de relevância.' },
  { id: 'podcast', label: 'Podcast em vídeo', description: 'Conversa longa com presença, ritmo de fala, capítulos e cortes selecionados.' },
  { id: 'reaction', label: 'Reaction', description: 'Reação contextualizada com montagem de resposta, pausa e comentário.' },
  { id: 'vlog', label: 'Vlog', description: 'Registro pessoal com presença, cotidiano, descoberta e encerramento íntimo.' },
  { id: 'sketch', label: 'Esquete', description: 'Cena curta de humor com setup, escalada, virada e payoff.' },
  { id: 'case-study', label: 'Estudo de caso', description: 'Problema, decisão, execução, resultado e aprendizados transferíveis.' },
  { id: 'presentation', label: 'Apresentação', description: 'Mensagem executiva organizada por contexto, proposta, prova e decisão.' },
  { id: 'training', label: 'Treinamento', description: 'Capacitação profissional com objetivos, exemplos, prática e avaliação.' },
  { id: 'webinar', label: 'Webinar', description: 'Sessão explicativa com agenda, blocos, perguntas e chamada para ação.' },
  { id: 'brand-film', label: 'Filme de marca', description: 'Narrativa de marca guiada por propósito, pessoas, produto e sensação.' },
  { id: 'behind-scenes', label: 'Bastidores', description: 'Processo de produção revelado com observação, entrevistas e contexto.' },
  { id: 'music-video', label: 'Videoclipe', description: 'Montagem guiada por música, performance, imagem e pulsação visual.' },
  { id: 'profile', label: 'Perfil biográfico', description: 'Trajetória de uma pessoa ou obra com marcos, conflito e legado.' },
  { id: 'scene-breakdown', label: 'Decupagem de cena', description: 'Leitura plano a plano de composição, montagem, som e intenção.' },
  { id: 'news-briefing', label: 'Boletim de notícias', description: 'Atualização factual com fontes, prioridade, contexto e transparência.' },
];

export const AESTHETIC_DIRECTIONS: ReadonlyArray<{ id: string; label: string; description: string }> = [
  { id: 'cinematic', label: 'Cinematográfico', description: 'Escala, atmosfera, composição e tempo para criar presença.' },
  { id: 'anime', label: 'Anime Energy', description: 'Impacto gráfico, velocidade e ênfase de ação inspirados em anime.' },
  { id: 'manga', label: 'Mangá / Painéis', description: 'Quadros, retículas, onomatopeias e leitura sequencial.' },
  { id: 'documentary', label: 'Documental', description: 'Observação, clareza, textura de arquivo e confiança editorial.' },
  { id: 'editorial', label: 'Editorial', description: 'Hierarquia de informação, ritmo de publicação e legibilidade.' },
  { id: 'minimal', label: 'Minimalista', description: 'Poucos elementos, silêncio visual e foco na mensagem.' },
  { id: 'tech', label: 'Tech / Interface', description: 'Precisão, dados, interfaces, grids e contraste funcional.' },
  { id: 'playful', label: 'Lúdico', description: 'Cor, surpresa, elasticidade e energia acessível.' },
  { id: 'intimate', label: 'Íntimo', description: 'Proximidade, pausas, voz humana e textura de presença.' },
  { id: 'corporate', label: 'Corporativo premium', description: 'Consistência de marca, clareza executiva e confiança.' },
];

export interface AetheraCreativeSelection {
  schemaVersion: 1;
  narrativeFormatId: string;
  contentCategoryId: ContentCategoryId | 'automatic';
  aestheticDirectionId: string;
}

export const DEFAULT_CREATIVE_SELECTION: AetheraCreativeSelection = {
  schemaVersion: 1,
  narrativeFormatId: 'automatic',
  contentCategoryId: 'automatic',
  aestheticDirectionId: 'automatic',
};

export interface DirectionProfile {
  structure: string[];
  editingPace: { averageShotMs: [number, number]; cutsPerMinute: number; cutOnBeat: boolean };
  researchMedia: { strategy: string; sources: string[]; acquisition: string };
  narration: { direction: string; targetWpm: [number, number]; pauses: string };
  motionGraphics: { language: string; typography: string; overlays: string[] };
  soundMix: { sfx: string; vfx: string; music: string; mix: string };
  qualityCriteria: string[];
}

export interface AudiovisualFormatDefinition {
  id: string;
  label: string;
  description: string;
  categoryId: ContentCategoryId;
  narrativeFormatId: string;
  aliases: string[];
  profile: DirectionProfile;
}

const CATEGORY_BASE: Record<ContentCategoryId, { sources: string[]; acquisition: string; narration: string; motion: string; typography: string; sfx: string; vfx: string; music: string; quality: string[] }> = {
  games: { sources: ['fontes oficiais', 'gameplay autorizado', 'documentação técnica'], acquisition: 'Priorizar gameplay próprio ou mídia com direitos verificados; registrar obra, versão e intervalo usado.', narration: 'Analítica, concreta e orientada por mecânicas observáveis.', motion: 'HUD, mapas, comparações e indicadores de estado.', typography: 'Sans forte, numerais grandes e tags de sistema.', sfx: 'Whooshes, impactos e sinais de interface em função dos beats.', vfx: 'Realce de ações e transições com intensidade controlada.', music: 'Eletrônica rítmica ou trilha épica conforme a escalada.', quality: ['Cada afirmação mecânica tem evidência visual ou fonte.', 'Nenhum gameplay de obra diferente entra na cena.', 'O ritmo respeita o tempo de leitura dos indicadores.'] },
  'anime-manga': { sources: ['sites oficiais', 'créditos da obra', 'entrevistas e publicações editoriais'], acquisition: 'Separar material oficial, trecho contextual e arte editorial; sinalizar proveniência e transformação.', narration: 'Expressiva, clara e cuidadosa com nomes, traduções e contexto de obra.', motion: 'Painéis, linhas de ação, mapas de relações e ênfase de impacto.', typography: 'Display expressivo com fallback legível para nomes japoneses.', sfx: 'Swishes, impactos e stingers sincronizados a viradas narrativas.', vfx: 'Partículas, speed lines e composição de energia sem cobrir a evidência.', music: 'Trilha cinematográfica ou energética com ducking preservando a voz.', quality: ['Nomes, arcos e acontecimentos são conferidos em fontes.', 'Material de referência não é apresentado como prova de outro evento.', 'A estilização não encobre texto, rosto ou ação relevante.'] },
  cinema: { sources: ['créditos oficiais', 'pressbooks', 'arquivos e crítica especializada'], acquisition: 'Usar trechos licenciados, materiais de imprensa ou imagens de apoio claramente rotuladas.', narration: 'Interpretativa, articulada e ancorada em linguagem audiovisual.', motion: 'Cartelas discretas, linhas de tempo, molduras e comparação de planos.', typography: 'Serif ou grotesca editorial com contraste de sala escura.', sfx: 'Ambiências, transições pontuais e silêncio como ferramenta.', vfx: 'Correção de cor e composição a serviço da leitura, nunca como ornamento.', music: 'Atmosférica, orquestral ou minimalista com dinâmica de cena.', quality: ['A análise distingue fato, leitura crítica e opinião.', 'Cada trecho tem origem e contexto suficientes.', 'A montagem preserva continuidade e intenção do plano.'] },
  education: { sources: ['fontes acadêmicas', 'documentação primária', 'exemplos demonstráveis'], acquisition: 'Preferir gráficos próprios, capturas autorizadas e fontes que permitam rechecagem.', narration: 'Didática, segmentada e com explicações em camadas.', motion: 'Diagramas, destaques, etapas, perguntas e resumos.', typography: 'Alta legibilidade, hierarquia previsível e contraste WCAG.', sfx: 'Sinais suaves para mudança de etapa; evitar distração.', vfx: 'Animações explicativas e chamadas de foco, sem excesso.', music: 'Leve, discreta e abaixo da voz; silêncio em conceitos densos.', quality: ['O objetivo de aprendizagem é verificável.', 'Exemplos não substituem a explicação do princípio.', 'Legendas e diagramas têm tempo suficiente para leitura.'] },
  technology: { sources: ['documentação do fabricante', 'benchmarks reproduzíveis', 'repositórios e especificações'], acquisition: 'Capturar versões e condições de teste; evitar screenshots sem data ou contexto.', narration: 'Precisa, comparativa e transparente sobre método e limitações.', motion: 'Gráficos, logs, fluxos de sistema, UI e indicadores de desempenho.', typography: 'Mono para dados, sans para explicação e grids consistentes.', sfx: 'Clicks, pulses e transições digitais com função.', vfx: 'Glow e scanlines com parcimônia; preservar números e interfaces.', music: 'Eletrônica ambiente com ducking agressivo na leitura de dados.', quality: ['Versão, método e unidade aparecem nos benchmarks.', 'Dados de marketing não são tratados como medição independente.', 'Capturas de interface correspondem à versão discutida.'] },
  entertainment: { sources: ['material fornecido pelo produtor', 'fontes públicas verificáveis', 'créditos de convidados'], acquisition: 'Registrar autorização de convidados, obras e trilhas; reutilizar mídia somente com status claro.', narration: 'Conversacional, presente e ajustada ao timing de cada formato.', motion: 'Capítulos, reações, punch-ins, stickers e legendas contextuais.', typography: 'Sans expressiva com variação de escala para punchlines.', sfx: 'Stingers, risers, pops e impactos com teto de densidade.', vfx: 'Zooms e cortes de reação motivados pelo conteúdo.', music: 'Grooves ou beds temáticos com ducking por fala.', quality: ['A piada não altera o sentido factual.', 'Cortes preservam contexto e consentimento.', 'O volume de efeitos não compete com fala ou emoção.'] },
  'professional-production': { sources: ['briefing aprovado', 'dados internos autorizados', 'manuais de marca'], acquisition: 'Usar apenas materiais corporativos autorizados e registrar versão do brand kit.', narration: 'Confiante, direta e orientada à decisão ou competência.', motion: 'Gráficos de negócio, diagramas, lower thirds e chamadas de ação.', typography: 'Sistema de marca, acessibilidade e consistência entre slides.', sfx: 'Transições discretas e sinais de confirmação.', vfx: 'Composição limpa, transições funcionais e nenhum efeito ornamental.', music: 'Trilha premium de baixa distração com mix de voz prioritária.', quality: ['Todos os dados têm dono, data e fonte.', 'A marca e a área segura são consistentes.', 'A chamada para ação é inequívoca e mensurável.'] },
};

const AESTHETIC_MODIFIERS: Record<string, Partial<DirectionProfile>> = {
  cinematic: { editingPace: { averageShotMs: [3000, 8000], cutsPerMinute: 8, cutOnBeat: false }, soundMix: { sfx: 'Whooshes discretos e impactos de clímax.', vfx: 'Luz, grão e profundidade com motivação narrativa.', music: 'Trilha cinematográfica atmosférica com arco dramático.', mix: 'Voz à frente, música com ducking de -12 dB e dinâmica preservada.' } },
  anime: { editingPace: { averageShotMs: [900, 2800], cutsPerMinute: 28, cutOnBeat: true }, motionGraphics: { language: 'Speed lines, impactos, painéis de energia e ênfase de pose.', typography: 'Display expressivo com contraste alto.', overlays: ['impact-card', 'speed-line', 'character-tag'] }, soundMix: { sfx: 'Impactos, whooshes e stingers de transformação.', vfx: 'Partículas e linhas de ação sincronizadas a momentos observáveis.', music: 'Trilha energética com viradas de batalha.', mix: 'Voz clara; impactos abaixo do limiar de mascaramento.' } },
  manga: { editingPace: { averageShotMs: [1800, 4500], cutsPerMinute: 16, cutOnBeat: true }, motionGraphics: { language: 'Painéis, retículas, balões e onomatopeias com leitura sequencial.', typography: 'Display condensado e balões de fala legíveis.', overlays: ['manga-panel', 'halftone', 'onomatopoeia'] } },
  documentary: { editingPace: { averageShotMs: [3500, 9000], cutsPerMinute: 7, cutOnBeat: false }, motionGraphics: { language: 'Cartelas documentais, mapas, fontes e lower thirds discretos.', typography: 'Serif editorial para contexto e sans para dados.', overlays: ['source-card', 'lower-third', 'timeline'] } },
  editorial: { editingPace: { averageShotMs: [2000, 5000], cutsPerMinute: 14, cutOnBeat: false }, motionGraphics: { language: 'Hierarquia editorial, cartelas de seção e dados comparáveis.', typography: 'Sans editorial com escala rigorosa.', overlays: ['section-card', 'lower-third', 'comparison'] } },
  minimal: { editingPace: { averageShotMs: [3500, 9000], cutsPerMinute: 7, cutOnBeat: false }, motionGraphics: { language: 'Poucos elementos, transições suaves e foco no assunto.', typography: 'Sans neutra, espaçada e com grande área de respiro.', overlays: ['title', 'caption'] } },
  tech: { editingPace: { averageShotMs: [1400, 3800], cutsPerMinute: 22, cutOnBeat: true }, motionGraphics: { language: 'Grids, nós, métricas e interfaces com estados explícitos.', typography: 'Mono para dados e sans para narrativa.', overlays: ['metric', 'terminal', 'flow-map'] } },
  playful: { editingPace: { averageShotMs: [900, 2600], cutsPerMinute: 26, cutOnBeat: true }, motionGraphics: { language: 'Cartelas elásticas, adesivos e reações em escala controlada.', typography: 'Sans arredondada e contraste cromático.', overlays: ['sticker', 'reaction', 'punchline'] } },
  intimate: { editingPace: { averageShotMs: [2800, 7000], cutsPerMinute: 9, cutOnBeat: false }, motionGraphics: { language: 'Identificação suave, legendas de presença e capítulos discretos.', typography: 'Sans humanista com espaçamento generoso.', overlays: ['name-card', 'caption'] } },
  corporate: { editingPace: { averageShotMs: [2200, 5200], cutsPerMinute: 12, cutOnBeat: false }, motionGraphics: { language: 'Sistema de marca, dados e chamadas de decisão.', typography: 'Fonte de marca com fallback acessível.', overlays: ['brand-lower-third', 'metric', 'cta'] } },
};

function profileFor(categoryId: ContentCategoryId, narrativeFormatId: string, aestheticDirectionId: string): DirectionProfile {
  const base = CATEGORY_BASE[categoryId];
  const modifier = AESTHETIC_MODIFIERS[aestheticDirectionId] ?? AESTHETIC_MODIFIERS.editorial ?? {};
  const narrativeStructure: Record<string, string[]> = {
    documentary: ['gancho factual', 'contexto e pergunta', 'investigação por evidências', 'contraponto', 'síntese e consequência'],
    'top-list': ['promessa e critérios', 'contexto do ranking', 'itens em ordem crescente', 'comparação final', 'veredito e CTA'],
    trailer: ['cold open', 'promessa', 'escalada de conflito', 'clímax', 'tagline e CTA'],
    tutorial: ['objetivo', 'preparação', 'passo a passo', 'checagem', 'próximo passo'],
    lesson: ['objetivo de aprendizagem', 'conceito central', 'exemplo guiado', 'prática', 'recapitulação'],
    interview: ['apresentação', 'pergunta de contexto', 'aprofundamento', 'contraponto', 'síntese'],
    podcast: ['abertura', 'blocos de conversa', 'recapitulação', 'perguntas', 'encerramento'],
    benchmark: ['hipótese', 'método', 'teste', 'resultado', 'limitações'],
    presentation: ['contexto', 'problema', 'proposta', 'evidência', 'decisão'],
  };
  const structure = narrativeStructure[narrativeFormatId] ?? ['gancho', 'contexto', 'desenvolvimento', 'clímax', 'resolução'];
  const pace = modifier.editingPace ?? { averageShotMs: [2000, 5000] as [number, number], cutsPerMinute: 14, cutOnBeat: false };
  const graphics = modifier.motionGraphics ?? { language: base.motion, typography: base.typography, overlays: ['title', 'caption'] };
  const sound = modifier.soundMix ?? { sfx: base.sfx, vfx: base.vfx, music: base.music, mix: 'Voz à frente, música com ducking de -12 dB e picos abaixo de -1 dBTP.' };
  return {
    structure,
    editingPace: pace,
    researchMedia: { strategy: `Combinar ${base.sources.join(', ')} com leitura visual da obra e evidência por cena.`, sources: base.sources, acquisition: base.acquisition },
    narration: { direction: base.narration, targetWpm: narrativeFormatId === 'podcast' ? [145, 175] : [155, 185], pauses: narrativeFormatId === 'trailer' ? 'Pausas curtas antes dos impactos e da tagline.' : 'Pausas após conceitos, fontes e mudanças de bloco.' },
    motionGraphics: graphics,
    soundMix: sound,
    qualityCriteria: [...base.quality, `A estrutura ${narrativeFormatId} permanece identificável mesmo em combinação híbrida.`],
  };
}

type FormatSeed = [id: string, label: string, categoryId: ContentCategoryId, narrativeFormatId: string, description: string, aliases?: string[]];
const FORMAT_SEEDS: readonly FormatSeed[] = [
  ['gameplay-essay', 'Gameplay Essay', 'games', 'gameplay-essay', 'Ensaio autoral de jogo com gameplay, tese, contexto e leitura de sistemas.', ['gameplay essay', 'análise de jogo']],
  ['boss-analysis', 'Análise de chefes', 'games', 'video-essay', 'Estudo de chefes com fases, padrões, dificuldade e evidência de gameplay.', ['boss fight', 'chefes']],
  ['build-guide', 'Guia de build', 'games', 'how-to', 'Guia visual de build, equipamentos, rota de progressão e testes práticos.', ['build', 'build guide']],
  ['lore-deep-dive', 'Deep dive de lore', 'games', 'documentary', 'Investigação de lore com cronologia, fontes e conexões entre eventos.', ['lore']],
  ['speedrun-breakdown', 'Breakdown de speedrun', 'games', 'scene-breakdown', 'Decupagem de rota, técnica, risco e otimização de uma speedrun.', ['speedrun']],
  ['esports-match', 'Análise de eSports', 'games', 'review', 'Leitura tática de partida com momentos-chave, decisões e contexto competitivo.', ['esports', 'e-sports']],
  ['game-review', 'Review de jogo', 'games', 'review', 'Avaliação de jogo com critérios de design, execução, impacto e limitações.', ['review de jogo']],
  ['game-trailer', 'Trailer de jogo', 'games', 'trailer', 'Trailer de jogo com promessa, escalada visual e chamada para ação.', ['trailer game']],
  ['lets-play', 'Let’s Play editorial', 'games', 'vlog', 'Gameplay acompanhado por comentário e estrutura editorial de episódios.', ['lets play']],
  ['game-comparison', 'Comparativo de jogos', 'games', 'top-list', 'Comparação de jogos por critérios claros, exemplos e conclusão equilibrada.', ['versus games']],
  ['challenge-run', 'Challenge run', 'games', 'gameplay-essay', 'Narrativa de desafio com restrição, tentativas, viradas e resultado.', ['desafio']],
  ['game-design-analysis', 'Análise de game design', 'games', 'video-essay', 'Ensaio sobre mecânicas, feedback, level design e experiência do jogador.', ['design de jogos']],
  ['anime-essay', 'Ensaio de anime', 'anime-manga', 'video-essay', 'Ensaio sobre anime com tese, cenas, personagens e contexto de produção.', ['anime essay']],
  ['anime-character-study', 'Estudo de personagem', 'anime-manga', 'profile', 'Perfil de personagem com arco, escolhas, relações e evidências da obra.', ['personagem anime']],
  ['anime-season-review', 'Review de temporada', 'anime-manga', 'review', 'Review de temporada com estrutura de episódios, pontos altos e limites.', ['temporada anime']],
  ['anime-ranking', 'Ranking de anime', 'anime-manga', 'top-list', 'Ranking de animes com critérios explícitos, contexto e comparação.', ['top anime']],
  ['anime-trailer', 'Trailer de anime', 'anime-manga', 'trailer', 'Trailer de anime com impacto, progressão de conflito e tagline.', ['trailer anime']],
  ['manga-explainer', 'Explicador de mangá', 'anime-manga', 'lesson', 'Explicação de arco ou conceito usando painéis, contexto e fontes.', ['manga explainer']],
  ['manga-panel-analysis', 'Análise de painéis', 'anime-manga', 'scene-breakdown', 'Leitura de composição, ritmo, enquadramento e virada em páginas de mangá.', ['painéis manga']],
  ['power-system-breakdown', 'Sistema de poderes', 'anime-manga', 'tutorial', 'Explicação comparativa de regras, limites, progressão e exemplos.', ['power system']],
  ['anime-fight-breakdown', 'Breakdown de luta', 'anime-manga', 'scene-breakdown', 'Decupagem de luta com movimentos, stakes, edição e evidência da cena.', ['luta anime']],
  ['studio-history', 'História de estúdio', 'anime-manga', 'documentary', 'Documentário sobre estúdio, obras, decisões e legado.', ['estúdio anime']],
  ['opening-analysis', 'Análise de abertura', 'anime-manga', 'scene-breakdown', 'Análise de abertura por música, símbolos, montagem e antecipação narrativa.', ['opening anime']],
  ['anime-news', 'Boletim de anime', 'anime-manga', 'news-briefing', 'Boletim factual sobre anúncios, datas, equipe e contexto editorial.', ['notícias anime']],
  ['film-review', 'Review de filme', 'cinema', 'review', 'Review de filme com tese, critérios, cenas e veredito.', ['crítica de filme']],
  ['film-analysis', 'Análise de filme', 'cinema', 'video-essay', 'Análise de linguagem cinematográfica, tema, montagem e mise-en-scène.', ['análise cinematográfica']],
  ['film-essay', 'Ensaio cinematográfico', 'cinema', 'video-essay', 'Ensaio autoral que conecta obra, contexto histórico e interpretação.', ['video essay cinema']],
  ['scene-breakdown', 'Decupagem de cena', 'cinema', 'scene-breakdown', 'Leitura plano a plano de enquadramento, montagem, som e intenção.', ['cena de filme']],
  ['director-profile', 'Perfil de diretor', 'cinema', 'profile', 'Perfil de diretor com filmografia, método, contexto e legado.', ['diretor de cinema']],
  ['cinema-history', 'História do cinema', 'cinema', 'documentary', 'Linha do tempo documental sobre movimentos, tecnologia e impacto cultural.', ['história cinema']],
  ['trailer-analysis', 'Análise de trailer', 'cinema', 'scene-breakdown', 'Análise de promessa, corte, música e marketing narrativo de um trailer.', ['trailer analysis']],
  ['screenplay-breakdown', 'Breakdown de roteiro', 'cinema', 'lesson', 'Explicação de estrutura, beats, conflito e payoff em roteiro.', ['roteiro']],
  ['short-film', 'Curta-metragem', 'cinema', 'documentary', 'Formato de curta com arco completo, economia narrativa e linguagem visual.', ['curta']],
  ['awards-preview', 'Prévia de premiações', 'cinema', 'top-list', 'Panorama comparativo de indicados, critérios e contexto da temporada.', ['oscar', 'premiação']],
  ['documentary-film', 'Documentário de cinema', 'cinema', 'documentary', 'Documentário cinematográfico com observação, fontes, entrevistas e contexto.', ['documentário cinema']],
  ['lesson', 'Aula explicativa', 'education', 'lesson', 'Aula modular com objetivo, conceito, exemplo, prática e síntese.', ['aula']],
  ['tutorial', 'Tutorial passo a passo', 'education', 'tutorial', 'Tutorial demonstrativo com passos, checkpoints e resultado verificável.', ['tutorial']],
  ['course-module', 'Módulo de curso', 'education', 'lesson', 'Módulo de curso com progressão, pré-requisitos e atividade de fixação.', ['curso']],
  ['how-to', 'Como fazer', 'education', 'how-to', 'Como fazer orientado a resultado com preparação, execução e validação.', ['how to']],
  ['academic-lecture', 'Aula acadêmica', 'education', 'lesson', 'Aula aprofundada com fontes, conceitos, exemplos e limites do conhecimento.', ['palestra acadêmica']],
  ['science-communication', 'Divulgação científica', 'education', 'documentary', 'Ciência traduzida com precisão, contexto, visualização e transparência.', ['ciência']],
  ['quiz', 'Quiz educativo', 'education', 'lesson', 'Quiz com pergunta, tempo de resposta, explicação e recapitulação.', ['perguntas']],
  ['study-guide', 'Guia de estudos', 'education', 'how-to', 'Guia de revisão com prioridades, mapas, exemplos e plano de ação.', ['estudo']],
  ['case-study-education', 'Estudo de caso educacional', 'education', 'case-study', 'Caso didático com problema, hipóteses, solução e lições transferíveis.', ['caso educacional']],
  ['product-review', 'Review de produto', 'technology', 'review', 'Review de produto com método, uso real, limitações e comparação.', ['review tech']],
  ['hands-on', 'Hands-on', 'technology', 'product-demo', 'Demonstração prática com configuração, uso e observações de campo.', ['hands on']],
  ['benchmark', 'Benchmark técnico', 'technology', 'benchmark', 'Benchmark reproduzível com método, condições, resultados e limitações.', ['benchmark tech']],
  ['launch-keynote', 'Keynote de lançamento', 'technology', 'presentation', 'Apresentação de lançamento com problema, proposta, demonstração e CTA.', ['keynote']],
  ['software-tutorial', 'Tutorial de software', 'technology', 'tutorial', 'Tutorial de software com captura de tela, etapas e verificação.', ['software']],
  ['coding-walkthrough', 'Walkthrough de código', 'technology', 'how-to', 'Walkthrough de código com contexto, implementação, testes e trade-offs.', ['programação']],
  ['tech-news', 'Noticiário de tecnologia', 'technology', 'news-briefing', 'Boletim de tecnologia com fontes, datas, impacto e distinção de rumor.', ['notícias tech']],
  ['architecture-explainer', 'Arquitetura explicada', 'technology', 'lesson', 'Explicação de arquitetura, fluxos, dependências e limites operacionais.', ['arquitetura']],
  ['tech-comparison', 'Comparativo técnico', 'technology', 'top-list', 'Comparação técnica por critérios, medições e recomendação contextual.', ['comparativo tech']],
  ['startup-story', 'História de startup', 'technology', 'case-study', 'Case de produto e negócio com decisões, evidências e aprendizados.', ['startup']],
  ['top-list', 'Top List geral', 'entertainment', 'top-list', 'Lista ranqueada de entretenimento com critérios, contexto e payoff.', ['top 10']],
  ['interview', 'Entrevista em vídeo', 'entertainment', 'interview', 'Entrevista guiada por perguntas, escuta, contexto e cortes de relevância.', ['entrevista']],
  ['podcast', 'Podcast em vídeo', 'entertainment', 'podcast', 'Podcast em vídeo com capítulos, presença, cortes e ritmo de conversa.', ['podcast']],
  ['comedy-sketch', 'Esquete de comédia', 'entertainment', 'sketch', 'Esquete curta com setup, escalada, virada e payoff.', ['comédia']],
  ['reaction', 'Reaction contextualizada', 'entertainment', 'reaction', 'Reaction com resposta, pausa, comentário e contexto da obra.', ['reação']],
  ['vlog', 'Vlog', 'entertainment', 'vlog', 'Vlog com presença pessoal, descoberta, cotidiano e encerramento íntimo.', ['diário']],
  ['behind-scenes', 'Bastidores de produção', 'entertainment', 'behind-scenes', 'Bastidores com processo, equipe, decisões e material de apoio.', ['making of']],
  ['music-video', 'Videoclipe', 'entertainment', 'music-video', 'Videoclipe guiado por música, performance, imagem e pulsação visual.', ['música']],
  ['celebrity-profile', 'Perfil de personalidade', 'entertainment', 'profile', 'Perfil de personalidade com trajetória, marcos, contexto e legado.', ['celebridade']],
  ['live-session', 'Live session', 'entertainment', 'music-video', 'Sessão ao vivo com performance, presença, mix e cortes musicais.', ['sessão ao vivo']],
  ['corporate-presentation', 'Apresentação executiva', 'professional-production', 'presentation', 'Apresentação executiva com contexto, proposta, evidência e decisão.', ['apresentação executiva']],
  ['corporate-training', 'Treinamento corporativo', 'professional-production', 'training', 'Treinamento corporativo com objetivos, exemplos, prática e avaliação.', ['treinamento']],
  ['product-demo-pro', 'Demonstração profissional', 'professional-production', 'product-demo', 'Demonstração profissional de produto com benefícios, prova e CTA.', ['demo profissional']],
  ['investor-pitch', 'Investor pitch', 'professional-production', 'presentation', 'Pitch para investidores com tese, mercado, tração, risco e pedido.', ['pitch']],
  ['onboarding', 'Onboarding de produto', 'professional-production', 'tutorial', 'Onboarding com passos essenciais, linguagem de produto e sucesso mensurável.', ['integração']],
  ['webinar', 'Webinar profissional', 'professional-production', 'webinar', 'Webinar com agenda, blocos, perguntas e chamada para ação.', ['webinário']],
  ['conference-talk', 'Palestra de conferência', 'professional-production', 'presentation', 'Palestra com tese, evidências, casos e fechamento memorável.', ['conferência']],
  ['brand-film', 'Filme de marca', 'professional-production', 'brand-film', 'Filme de marca guiado por propósito, pessoas, produto e sensação.', ['brand film']],
  ['recruiting-film', 'Filme de recrutamento', 'professional-production', 'brand-film', 'Filme de recrutamento com cultura, pessoas, função e prova de ambiente.', ['employer branding']],
  ['case-study-pro', 'Case corporativo', 'professional-production', 'case-study', 'Case corporativo com problema, solução, resultado e prova autorizada.', ['case profissional']],
];

export const AUDIOVISUAL_FORMATS: readonly AudiovisualFormatDefinition[] = FORMAT_SEEDS.map(([id, label, categoryId, narrativeFormatId, description, aliases]) => ({
  id,
  label,
  categoryId,
  narrativeFormatId,
  description,
  aliases: aliases ?? [],
  profile: profileFor(categoryId, narrativeFormatId, categoryId === 'anime-manga' ? 'anime' : categoryId === 'technology' ? 'tech' : categoryId === 'professional-production' ? 'corporate' : 'editorial'),
}));

export function groupFormatsByCategory(formats: readonly AudiovisualFormatDefinition[] = AUDIOVISUAL_FORMATS): Record<ContentCategoryId, AudiovisualFormatDefinition[]> {
  const grouped = Object.fromEntries(CONTENT_CATEGORIES.map((category) => [category.id, [] as AudiovisualFormatDefinition[]])) as Record<ContentCategoryId, AudiovisualFormatDefinition[]>;
  for (const format of formats) grouped[format.categoryId]?.push(format);
  return grouped;
}

export function searchAudiovisualFormats(query: string, options: { categoryId?: ContentCategoryId } = {}): AudiovisualFormatDefinition[] {
  const normalized = normalize(query);
  return AUDIOVISUAL_FORMATS.filter((format) => {
    if (options.categoryId && format.categoryId !== options.categoryId) return false;
    if (!normalized) return true;
    const haystack = normalize(`${format.label} ${format.description} ${format.aliases.join(' ')}`);
    return normalized.split(/\s+/u).every((term) => haystack.includes(term));
  });
}

export function detectCreativeSelection(prompt: string): AetheraCreativeSelection {
  const text = normalize(prompt);
  const categoryId: AetheraCreativeSelection['contentCategoryId'] = /\b(game|jogo|gameplay|boss|e-sport|esport)\b/u.test(text)
    ? 'games'
    : /\b(anime|manga|mangá|shonen|isekai)\b/u.test(text)
      ? 'anime-manga'
      : /\b(filme|cinema|cineasta|roteiro|longa-metragem)\b/u.test(text)
        ? 'cinema'
        : /\b(aula|curso|educa|ci[eê]ncia|tutorial|aprender|estudo)\b/u.test(text)
          ? 'education'
          : /\b(tecnologia|software|hardware|app|programa|gpu|codigo|c[oó]digo|produto digital)\b/u.test(text)
            ? 'technology'
            : /\b(empresa|corporativo|treinamento|webinar|investidor|pitch|apresenta[cç][aã]o executiva|recrutamento)\b/u.test(text)
              ? 'professional-production'
              : 'entertainment';
  const narrativeFormatId = /\b(document[aá]rio|documental)\b/u.test(text)
    ? 'documentary'
    : /\b(trailer|teaser)\b/u.test(text)
      ? 'trailer'
      : /\b(top\s*\d+|ranking|lista|melhores|piores)\b/u.test(text)
        ? 'top-list'
        : /\b(podcast|conversa|entrevista)\b/u.test(text)
          ? (text.includes('entrevista') ? 'interview' : 'podcast')
          : /\b(tutorial|como fazer|passo a passo|ensine|ensinar)\b/u.test(text)
            ? 'tutorial'
            : /\b(review|an[aá]lise|avaliar|cr[ií]tica)\b/u.test(text)
              ? 'review'
              : categoryId === 'games' ? 'gameplay-essay' : categoryId === 'education' ? 'lesson' : categoryId === 'technology' ? 'product-demo' : 'video-essay';
  const aestheticDirectionId = /\b(cinematograf|cinematic|epic|filme)\w*/u.test(text)
    ? 'cinematic'
    : /\b(mang[aá]|pain[eé]is|ret[ií]cula|onomatopeia)\b/u.test(text)
      ? 'manga'
      : /\b(anime|shonen|isekai)\b/u.test(text)
        ? 'anime'
        : /\b(document[aá]rio|documental|arquivo)\b/u.test(text)
          ? 'documentary'
          : categoryId === 'technology' ? 'tech' : categoryId === 'professional-production' ? 'corporate' : 'editorial';
  return { schemaVersion: 1, narrativeFormatId, contentCategoryId: categoryId, aestheticDirectionId };
}

export function composeDirectionProfile(selection: AetheraCreativeSelection): DirectionProfile {
  const categoryId = selection.contentCategoryId === 'automatic' ? 'entertainment' : selection.contentCategoryId;
  const narrativeFormatId = selection.narrativeFormatId === 'automatic' ? 'video-essay' : selection.narrativeFormatId;
  const aestheticDirectionId = selection.aestheticDirectionId === 'automatic' ? 'editorial' : selection.aestheticDirectionId;
  return profileFor(categoryId, narrativeFormatId, aestheticDirectionId);
}

export interface DeliveryPreset {
  id: string;
  label: string;
  description: string;
  platform: DeliveryPlatform;
  aspectRatio: string;
  width: number;
  height: number;
  fps: number;
  audio: { integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number; sampleRate: number; channels: 1 | 2 };
  videoCodec: SupportedVideoCodec;
  audioCodec: SupportedAudioCodec;
  safeArea: { top: number; right: number; bottom: number; left: number };
  defaultQuality: DeliveryQualityProfile;
}

const delivery = (value: DeliveryPreset): DeliveryPreset => value;
export const DELIVERY_PRESETS: readonly DeliveryPreset[] = [
  delivery({ id: 'youtube-1080p', label: 'YouTube 1080p', description: 'Master horizontal Full HD para vídeos longos do YouTube.', platform: 'youtube', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, audio: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 8, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 6, right: 5, bottom: 12, left: 5 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'youtube-1440p', label: 'YouTube 1440p', description: 'Master horizontal QHD para detalhes e telas maiores.', platform: 'youtube', aspectRatio: '16:9', width: 2560, height: 1440, fps: 30, audio: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 8, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 6, right: 5, bottom: 12, left: 5 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'youtube-4k', label: 'YouTube 4K', description: 'Master horizontal UHD 3840×2160 para entrega 4K.', platform: 'youtube', aspectRatio: '16:9', width: 3840, height: 2160, fps: 30, audio: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 8, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 6, right: 5, bottom: 12, left: 5 }, defaultQuality: 'master_4k' }),
  delivery({ id: 'shorts', label: 'YouTube Shorts', description: 'Master vertical 9:16 com área segura para interface mobile.', platform: 'shorts', aspectRatio: '9:16', width: 1080, height: 1920, fps: 30, audio: { integratedLufs: -13, truePeakDbtp: -1, loudnessRangeLu: 6, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 12, right: 12, bottom: 22, left: 6 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'tiktok', label: 'TikTok', description: 'Master vertical 9:16 com respiro para controles e legendas.', platform: 'tiktok', aspectRatio: '9:16', width: 1080, height: 1920, fps: 30, audio: { integratedLufs: -12.5, truePeakDbtp: -1, loudnessRangeLu: 6, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 10, right: 12, bottom: 25, left: 6 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'instagram-reels', label: 'Instagram Reels', description: 'Master vertical 9:16 para Reels com áreas seguras próprias.', platform: 'instagram', aspectRatio: '9:16', width: 1080, height: 1920, fps: 30, audio: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 6, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 12, right: 10, bottom: 24, left: 6 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'feed-4-5', label: 'Feed 4:5', description: 'Master vertical 4:5 para feed social com leitura editorial.', platform: 'instagram', aspectRatio: '4:5', width: 1080, height: 1350, fps: 30, audio: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 6, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 8, right: 8, bottom: 12, left: 8 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'square-1-1', label: 'Quadrado 1:1', description: 'Master quadrado para feed, cards audiovisuais e distribuição híbrida.', platform: 'instagram', aspectRatio: '1:1', width: 1080, height: 1080, fps: 30, audio: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 7, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 8, right: 8, bottom: 8, left: 8 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'cinema-ultrawide', label: 'Cinema Ultrawide', description: 'Master 2:1 para apresentações cinematográficas e telas ultrawide.', platform: 'cinema', aspectRatio: '2:1', width: 2560, height: 1280, fps: 24, audio: { integratedLufs: -18, truePeakDbtp: -1, loudnessRangeLu: 10, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 7, right: 4, bottom: 7, left: 4 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'cinema-scope', label: 'Cinema Scope', description: 'Master 2.39:1 com composição anamórfica e área segura de sala.', platform: 'cinema', aspectRatio: '2.39:1', width: 2560, height: 1071, fps: 24, audio: { integratedLufs: -18, truePeakDbtp: -1, loudnessRangeLu: 10, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 10, right: 4, bottom: 10, left: 4 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'dci-4k', label: 'DCI 4K', description: 'Master 4096×2160 para cinema digital e revisão de sala.', platform: 'cinema', aspectRatio: '1.90:1', width: 4096, height: 2160, fps: 24, audio: { integratedLufs: -18, truePeakDbtp: -1, loudnessRangeLu: 10, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 6, right: 5, bottom: 6, left: 5 }, defaultQuality: 'master_4k' }),
  delivery({ id: 'documentary-16-9', label: 'Documentário 16:9', description: 'Preset documental com 24 fps, respiro para fontes e mix de sala.', platform: 'cinema', aspectRatio: '16:9', width: 1920, height: 1080, fps: 24, audio: { integratedLufs: -18, truePeakDbtp: -1, loudnessRangeLu: 10, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 7, right: 5, bottom: 10, left: 5 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'podcast-video', label: 'Podcast em vídeo', description: 'Preset horizontal com prioridade à fala, capítulos e mix de podcast.', platform: 'podcast', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, audio: { integratedLufs: -16, truePeakDbtp: -1.5, loudnessRangeLu: 7, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 7, right: 5, bottom: 12, left: 5 }, defaultQuality: 'master_1080p' }),
  delivery({ id: 'presentation-16-9', label: 'Apresentação 16:9', description: 'Preset para apresentação com gráficos, fontes e safe area amplas.', platform: 'presentation', aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, audio: { integratedLufs: -16, truePeakDbtp: -1, loudnessRangeLu: 8, sampleRate: 48000, channels: 2 }, videoCodec: 'h264', audioCodec: 'aac', safeArea: { top: 8, right: 8, bottom: 10, left: 8 }, defaultQuality: 'master_1080p' }),
];

export interface ResolvedDeliveryProfile {
  preset: DeliveryPreset;
  master: { width: number; height: number; fps: number };
  preview: { width: number; height: number; fps: number; quality: DeliveryQualityProfile };
  audio: DeliveryPreset['audio'];
}

const PREVIEW_SIZES: Record<DeliveryQualityProfile, { width: number; height: number }> = {
  draft_540p: { width: 960, height: 540 },
  review_720p: { width: 1280, height: 720 },
  master_1080p: { width: 1920, height: 1080 },
  master_4k: { width: 3840, height: 2160 },
};

function ratioOf(value: string): number {
  const [width, height] = value.split(':').map(Number);
  return width && height ? width / height : Number.NaN;
}

function previewResolution(preset: DeliveryPreset, quality: DeliveryQualityProfile): { width: number; height: number } {
  const base = PREVIEW_SIZES[quality];
  const ratio = ratioOf(preset.aspectRatio);
  if (!Number.isFinite(ratio)) return base;
  if (ratio >= 1) return { width: base.width, height: Math.max(1, Math.round(base.width / ratio)) };
  return { width: base.height, height: Math.max(1, Math.round(base.height * ratio)) };
}

export function detectDeliveryPreset(prompt: string): string {
  const text = normalize(prompt);
  if (/\b(tiktok)\b/u.test(text)) return 'tiktok';
  if (/\b(reels|instagram)\b/u.test(text)) return /\b4\s*[:x]\s*5\b/u.test(text) ? 'feed-4-5' : 'instagram-reels';
  if (/\b(shorts|short|vertical|9\s*[:x]\s*16)\b/u.test(text)) return 'shorts';
  if (/\b(podcast)\b/u.test(text)) return 'podcast-video';
  if (/\b(dci|cinema digital)\b/u.test(text)) return 'dci-4k';
  if (/\b(scope|2[.,:]?39)\b/u.test(text)) return 'cinema-scope';
  if (/\b(ultrawide|ultrawide|2\s*[:x]\s*1)\b/u.test(text)) return 'cinema-ultrawide';
  if (/\b(document[aá]rio|documental)\b/u.test(text)) return 'documentary-16-9';
  if (/\b(apresenta[cç][aã]o|slides|pitch)\b/u.test(text)) return 'presentation-16-9';
  if (/\b(quadrado|1\s*[:x]\s*1)\b/u.test(text)) return 'square-1-1';
  if (/\b(4k|uhd)\b/u.test(text)) return 'youtube-4k';
  if (/\b(1440p|qhd)\b/u.test(text)) return 'youtube-1440p';
  return 'youtube-1080p';
}

export function resolveDeliveryProfile(input: { presetId?: string; prompt?: string; previewProfile?: DeliveryQualityProfile }): ResolvedDeliveryProfile {
  const requested = input.presetId && input.presetId !== 'automatic' ? input.presetId : detectDeliveryPreset(input.prompt ?? '');
  const preset = DELIVERY_PRESETS.find((candidate) => candidate.id === requested);
  if (!preset) throw new Error(`invalid: preset de entrega desconhecido (${requested}).`);
  const quality = input.previewProfile ?? 'review_720p';
  const preview = previewResolution(preset, quality);
  return { preset, master: { width: preset.width, height: preset.height, fps: preset.fps }, preview: { ...preview, fps: preset.fps, quality }, audio: preset.audio };
}

export function validateCustomDeliveryPreset(input: { id: string; label: string; platform: DeliveryPlatform; aspectRatio: string; width: number; height: number; fps: number; videoCodec: string; audioCodec: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const expected = ratioOf(input.aspectRatio);
  if (!Number.isFinite(expected) || input.width <= 0 || input.height <= 0 || Math.abs(input.width / input.height - expected) > 0.03) errors.push('Dimensões não correspondem à proporção declarada.');
  if (![23.976, 24, 25, 29.97, 30, 50, 59.94, 60].some((fps) => Math.abs(input.fps - fps) < 0.01)) errors.push('FPS incompatível com os encoders disponíveis.');
  if (!(['h264', 'h264_nvenc'] as string[]).includes(input.videoCodec)) errors.push(`Codec de vídeo não executável: ${input.videoCodec}.`);
  if (!(['aac', 'pcm_s16le'] as string[]).includes(input.audioCodec)) errors.push(`Codec de áudio não executável: ${input.audioCodec}.`);
  return { valid: errors.length === 0, errors };
}

export interface DeliveryExportJob {
  presetId: string;
  profile: ResolvedDeliveryProfile;
  reuseSourceMaterial: boolean;
  reuseTimeline: boolean;
  reuseSceneRender: boolean;
  cacheCompatibilityKey: string;
}

export function planDeliveryExports(input: { presetIds: readonly string[]; prompt?: string; previewProfile?: DeliveryQualityProfile }): DeliveryExportJob[] {
  const requested = input.presetIds.length > 0 ? input.presetIds : ['automatic'];
  const profiles = requested.map((presetId) => resolveDeliveryProfile({ presetId, ...(input.prompt !== undefined ? { prompt: input.prompt } : {}), ...(input.previewProfile ? { previewProfile: input.previewProfile } : {}) }));
  const first = profiles[0];
  if (!first) return [];
  return profiles.map((profile) => ({
    presetId: profile.preset.id,
    profile,
    reuseSourceMaterial: true,
    reuseTimeline: true,
    reuseSceneRender: profile.master.width === first.master.width && profile.master.height === first.master.height && profile.master.fps === first.master.fps,
    cacheCompatibilityKey: `${profile.master.width}x${profile.master.height}@${profile.master.fps}:${profile.preset.videoCodec}:${profile.preset.audioCodec}`,
  }));
}

export function migrateLegacyCreativeSelection(input: { genre?: string; format?: string }): { creativeSelection: AetheraCreativeSelection; deliveryPresetId: string } {
  const genreMap: Record<string, string> = { documentary: 'documentary', gameplay_essay: 'gameplay-essay', top_list: 'top-list', trailer: 'trailer' };
  const formatMap: Record<string, string> = { youtube_16_9: 'youtube-1080p', shorts_9_16: 'shorts' };
  const category = input.genre === 'gameplay_essay' ? 'games' : input.genre === 'trailer' ? 'cinema' : input.genre === 'top_list' ? 'entertainment' : 'cinema';
  return {
    creativeSelection: { schemaVersion: 1, narrativeFormatId: genreMap[input.genre ?? ''] ?? 'automatic', contentCategoryId: category, aestheticDirectionId: input.genre === 'documentary' ? 'documentary' : 'automatic' },
    deliveryPresetId: formatMap[input.format ?? ''] ?? 'automatic',
  };
}

export interface ProductionCreativeContract {
  schemaVersion: 1;
  revision: number;
  sourcePrompt: string;
  sourcePromptHash: string;
  automaticSelection: AetheraCreativeSelection;
  effectiveSelection: AetheraCreativeSelection;
  automaticDeliveryPresetId: string;
  effectiveDeliveryPresetId: string;
  manualOverrides: Array<{ field: string; value: string }>;
  conflicts: Array<{ field: string; automaticValue: string; manualValue: string; resolution: 'manual_value_wins' }>;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function synchronizeProductionCreativeContract(input: { prompt: string; selection?: AetheraCreativeSelection; deliveryPresetId?: string; manualFields?: readonly (CreativeDimension | 'deliveryPresetId')[]; previous?: ProductionCreativeContract }): ProductionCreativeContract {
  const automaticSelection = detectCreativeSelection(input.prompt);
  const automaticDeliveryPresetId = detectDeliveryPreset(input.prompt);
  const selection = input.selection ?? DEFAULT_CREATIVE_SELECTION;
  const manualFields = new Set(input.manualFields ?? []);
  const effectiveSelection: AetheraCreativeSelection = {
    schemaVersion: 1,
    narrativeFormatId: manualFields.has('narrativeFormatId') ? selection.narrativeFormatId : automaticSelection.narrativeFormatId,
    contentCategoryId: manualFields.has('contentCategoryId') ? selection.contentCategoryId : automaticSelection.contentCategoryId,
    aestheticDirectionId: manualFields.has('aestheticDirectionId') ? selection.aestheticDirectionId : automaticSelection.aestheticDirectionId,
  };
  const effectiveDeliveryPresetId = manualFields.has('deliveryPresetId') ? input.deliveryPresetId ?? automaticDeliveryPresetId : automaticDeliveryPresetId;
  const conflicts = [
    ...(['narrativeFormatId', 'contentCategoryId', 'aestheticDirectionId'] as const).flatMap((field) => manualFields.has(field) && selection[field] !== automaticSelection[field] ? [{ field, automaticValue: String(automaticSelection[field]), manualValue: String(selection[field]), resolution: 'manual_value_wins' as const }] : []),
    ...(manualFields.has('deliveryPresetId') && effectiveDeliveryPresetId !== automaticDeliveryPresetId ? [{ field: 'deliveryPresetId', automaticValue: automaticDeliveryPresetId, manualValue: effectiveDeliveryPresetId, resolution: 'manual_value_wins' as const }] : []),
  ];
  const previousRevision = input.previous?.revision ?? 0;
  const changed = !input.previous || input.previous.sourcePromptHash !== hashText(input.prompt) || input.previous.effectiveDeliveryPresetId !== effectiveDeliveryPresetId || JSON.stringify(input.previous.effectiveSelection) !== JSON.stringify(effectiveSelection);
  return {
    schemaVersion: 1,
    revision: changed ? previousRevision + 1 : previousRevision,
    sourcePrompt: input.prompt,
    sourcePromptHash: hashText(input.prompt),
    automaticSelection,
    effectiveSelection,
    automaticDeliveryPresetId,
    effectiveDeliveryPresetId,
    manualOverrides: [...manualFields].map((field) => ({ field, value: field === 'deliveryPresetId' ? effectiveDeliveryPresetId : String(effectiveSelection[field]) })),
    conflicts,
  };
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
}
