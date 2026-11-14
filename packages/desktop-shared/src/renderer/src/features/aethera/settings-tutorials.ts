export type TutorialIntegrationId =
  | 'youtube'
  | 'twitch_igdb'
  | 'rawg'
  | 'ai_agents'
  | 'voice_studio'
  | 'production';

export interface TutorialStep {
  title: string;
  instruction: string;
  targetFieldId?: string;
  example?: string;
  copyLabel?: string;
  copyValue?: string;
}

export interface IntegrationTutorialSpec {
  id: TutorialIntegrationId;
  title: string;
  subtitle: string;
  officialPortalUrl: string;
  officialPortalLabel: string;
  lastReviewedAt: string;
  requiredCredentials: string[];
  steps: TutorialStep[];
}

export const INTEGRATION_TUTORIALS: Record<TutorialIntegrationId, IntegrationTutorialSpec> = {
  youtube: {
    id: 'youtube',
    title: 'Configurar YouTube (OAuth e Publicação)',
    subtitle: 'Conecte seu canal usando Google Cloud OAuth oficial para uploads e agendamentos.',
    officialPortalUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    officialPortalLabel: 'Abrir Google Cloud Console',
    lastReviewedAt: '2026-11-14',
    requiredCredentials: ['Client ID / Fluxo OAuth oficial do canal', 'Permissão YouTube Data API v3'],
    steps: [
      {
        title: 'Ative a YouTube Data API v3',
        instruction:
          'Acesse o Google Cloud Console oficial, selecione ou crie um projeto e clique em Ativar na YouTube Data API v3.',
      },
      {
        title: 'Configure a Tela de Consentimento OAuth',
        instruction:
          'Em APIs e Serviços > Tela de consentimento OAuth, defina o tipo Externo (ou Interno) e adicione o escopo oficial de upload/leitura do YouTube.',
        copyLabel: 'Copiar escopo YouTube Upload',
        copyValue: 'https://www.googleapis.com/auth/youtube.upload',
      },
      {
        title: 'Conecte o Canal no Aethera Studio',
        instruction:
          'Volte ao painel ao lado e clique em Conectar Canal / Testar Conexão. O token é armazenado localmente via Electron safeStorage.',
        targetFieldId: 'youtube-connect-action',
      },
    ],
  },
  twitch_igdb: {
    id: 'twitch_igdb',
    title: 'Configurar Twitch / IGDB',
    subtitle: 'Pesquisa de jogos, capas, datas de lançamento e metadados oficiais via IGDB.',
    officialPortalUrl: 'https://dev.twitch.tv/console/apps',
    officialPortalLabel: 'Abrir Twitch Developer Console',
    lastReviewedAt: '2026-11-14',
    requiredCredentials: ['Twitch Client ID', 'Twitch Client Secret (mascarado e salvo em safeStorage)'],
    steps: [
      {
        title: 'Registre uma Aplicação na Twitch',
        instruction:
          'Entre no Twitch Developer Console oficial, clique em Register Your Application, dê um nome (ex.: Aethera Studio) e escolha a categoria Application Integration.',
      },
      {
        title: 'Copie o Client ID',
        instruction:
          'Após criar o app, abra Manage e copie o Client ID gerado. Cole no campo Client ID ao lado.',
        targetFieldId: 'igdb-client-id',
        example: 'Ex.: gp762nuuoqcoxypju8c569th9aoa7c',
      },
      {
        title: 'Gere e Cole o Client Secret',
        instruction:
          'Clique em New Secret na Twitch e cole no campo Client Secret. Ele nunca é exibido em claro após salvar.',
        targetFieldId: 'igdb-client-secret',
      },
    ],
  },
  rawg: {
    id: 'rawg',
    title: 'Configurar RAWG e Fontes de Mídia',
    subtitle: 'Catálogo complementar de jogos e banco de B-roll (Pexels / Collage).',
    officialPortalUrl: 'https://rawg.io/apidocs',
    officialPortalLabel: 'Abrir Portal Oficial RAWG',
    lastReviewedAt: '2026-11-14',
    requiredCredentials: ['RAWG API Key', 'Chave Pexels / Collage (opcional para B-roll)'],
    steps: [
      {
        title: 'Crie sua chave gratuita na RAWG',
        instruction:
          'Acesse o portal oficial da RAWG, faça login e gere sua API Key pessoal no painel de desenvolvedor.',
      },
      {
        title: 'Insira a RAWG API Key',
        instruction:
          'Cole a chave no campo RAWG API Key ao lado e clique em Salvar. Ela será criptografada via safeStorage.',
        targetFieldId: 'rawg-api-key',
      },
      {
        title: 'Teste a conexão',
        instruction:
          'Clique em Testar conexão para confirmar que o cofre local reconhece a credencial configurada.',
        targetFieldId: 'rawg-test-action',
      },
    ],
  },
  ai_agents: {
    id: 'ai_agents',
    title: 'Configurar Agentes e Provedores de IA',
    subtitle: 'Roteiristas e diretores usam Claude CLI, Codex CLI ou Antigravity CLI com fallback.',
    officialPortalUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    officialPortalLabel: 'Abrir Documentação Claude Code',
    lastReviewedAt: '2026-11-14',
    requiredCredentials: ['Sessão autenticada no CLI local (Claude, Codex ou Antigravity)'],
    steps: [
      {
        title: 'Verifique os CLIs disponíveis',
        instruction:
          'O Aethera detecta automaticamente os motores locais instalados (Claude, Codex, Antigravity) sem exigir que você cole chaves em páginas externas.',
        copyLabel: 'Copiar comando de verificação',
        copyValue: 'claude --version',
      },
      {
        title: 'Teste a disponibilidade no Estúdio',
        instruction:
          'Clique em Testar conexão para consultar o status real de cada agente e garantir fallback transparente caso algum atinja limite.',
        targetFieldId: 'ai-agents-test-action',
      },
    ],
  },
  voice_studio: {
    id: 'voice_studio',
    title: 'Configurar Narração e Voice Studio',
    subtitle: 'Vozes neurais pt-BR (Edge TTS / SAPI) sincronizadas com o EditorialScript.',
    officialPortalUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts',
    officialPortalLabel: 'Abrir Referência Oficial de Vozes TTS',
    lastReviewedAt: '2026-11-14',
    requiredCredentials: ['Nenhuma chave obrigatória para Edge TTS / vozes locais do sistema'],
    steps: [
      {
        title: 'Liste as vozes instaladas',
        instruction:
          'O Voice Studio consulta as vozes disponíveis no sistema e no Edge TTS diretamente pelo backend do Aethera.',
        targetFieldId: 'voice-studio-select',
      },
      {
        title: 'Valide a saúde do motor de áudio',
        instruction:
          'Use Testar conexão para confirmar a lista de vozes pt-BR ativas antes de iniciar produções longas.',
        targetFieldId: 'voice-studio-test-action',
      },
    ],
  },
  production: {
    id: 'production',
    title: 'Configurar Produção Audiovisual (FFmpeg & GPU)',
    subtitle: 'Dependências locais de renderização real MP4, áudio -14 LUFS e aceleração NVENC.',
    officialPortalUrl: 'https://ffmpeg.org/download.html',
    officialPortalLabel: 'Abrir Site Oficial do FFmpeg',
    lastReviewedAt: '2026-11-14',
    requiredCredentials: ['Binários locais: ffmpeg, ffprobe e yt-dlp'],
    steps: [
      {
        title: 'Confirme FFmpeg, FFprobe e yt-dlp',
        instruction:
          'O renderizador real do Aethera exige ffmpeg e ffprobe acessíveis no sistema. GPU NVIDIA (NVENC) acelera o encode automaticamente quando detectada.',
        copyLabel: 'Copiar comando de diagnóstico',
        copyValue: 'ffmpeg -version',
      },
      {
        title: 'Execute a verificação real de capacidades',
        instruction:
          'Clique em Testar conexão para sondar FFmpeg, FFprobe, yt-dlp e disponibilidade de NVENC em tempo real.',
        targetFieldId: 'production-test-action',
      },
    ],
  },
};

const PROGRESS_STORAGE_KEY = 'aethera.settings.tutorial.progress.v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getSafeLocalStorage(): StorageLike | null {
  const g = globalThis as { localStorage?: StorageLike };
  return g.localStorage ?? null;
}

export function loadTutorialStepProgress(integrationId: TutorialIntegrationId): number {
  const storage = getSafeLocalStorage();
  if (!storage) return 0;
  try {
    const raw = storage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const idx = parsed[integrationId];
    return typeof idx === 'number' && idx >= 0 ? idx : 0;
  } catch {
    return 0;
  }
}

export function saveTutorialStepProgress(integrationId: TutorialIntegrationId, stepIndex: number): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(PROGRESS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    parsed[integrationId] = Math.max(0, stepIndex);
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage errors
  }
}
