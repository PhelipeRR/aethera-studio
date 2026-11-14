import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { envFromText, envToText, screensFromText, screensToText } from './capture-form';

const SIZES = { vertical: { width: 1080, height: 1920 }, horizontal: { width: 1920, height: 1080 } } as const;
const INPUT = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Props = { blocked: boolean; targetId: string; videoName: string; reviewed: boolean; onReviewed: (reviewed: boolean) => void; onPrints: (count: number) => void };

/** Proposes, confirms, captures and reviews: nothing runs before the user accepts the exact command. */
export function CapturePanel({ blocked, targetId, videoName, reviewed, onReviewed, onPrints }: Props) {
  const client = useQueryClient();
  const [kind, setKind] = useState<'web' | 'electron'>('web');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [env, setEnv] = useState('');
  const [screens, setScreens] = useState('');
  const [size, setSize] = useState<keyof typeof SIZES>('vertical');
  const [confirmed, setConfirmed] = useState(false);
  const prints = useQuery({
    queryKey: ['velix-prints', videoName],
    queryFn: async () => {
      const list = await window.neuralbridge.video.prints(videoName);
      onPrints(list.length);
      return list;
    },
    enabled: !!videoName,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['velix-prints', videoName] });
  const plan = useMutation({
    mutationFn: () => window.neuralbridge.video.capturePlan(targetId),
    onSuccess: (next) => {
      setKind(next.kind);
      setSize(next.kind === 'electron' ? 'horizontal' : 'vertical');
      setCommand(next.command);
      setUrl(next.url);
      setEnv(envToText(next.env));
      setScreens(screensToText(next.screens));
      setConfirmed(false);
    },
  });
  const capture = useMutation({
    mutationFn: () => window.neuralbridge.video.capture({ targetId, name: videoName, plan: { kind, command: command.trim(), url: url.trim(), env: envFromText(env), screens: screensFromText(screens) }, size: SIZES[size], confirmed: true }),
    onSuccess: () => {
      setConfirmed(false);
      onReviewed(false);
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (file: string) => window.neuralbridge.video.removePrint(videoName, file), onSuccess: () => void refresh() });
  const ready = !!videoName && !!command.trim() && !!url.trim() && !!screens.trim() && confirmed;

  return (
    <section aria-label="Prints do app" className="space-y-3 rounded-md border p-4">
      <div>
        <h4 className="text-sm font-medium">Prints do app</h4>
        <p className="text-xs text-muted-foreground">Capture as telas aqui ou coloque arquivos PNG na pasta prints deste vídeo. Apps web e Electron.</p>
      </div>
      <Button variant="outline" onClick={() => plan.mutate()} disabled={plan.isPending || blocked}>{plan.isPending ? 'Lendo o projeto…' : 'Preparar captura'}</Button>
      {plan.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(plan.error)}</p>}
      {(plan.data || command) && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium sm:col-span-2">Comando para abrir o app<input aria-label="Comando para abrir o app" className={`${INPUT} font-mono text-xs`} value={command} onChange={(event) => { setCommand(event.target.value); setConfirmed(false); }} /></label>
            <label className="block text-sm font-medium">Endereço local<input aria-label="Endereço local" className={INPUT} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
            <label className="block text-sm font-medium">Formato dos prints<select aria-label="Formato dos prints" className={INPUT} value={size} onChange={(event) => setSize(event.target.value as keyof typeof SIZES)}><option value="vertical">Vertical, 1080 × 1920</option><option value="horizontal">Horizontal, 1920 × 1080</option></select></label>
          </div>
          <label className="block text-sm font-medium">Telas, uma por linha: nome | caminho<textarea aria-label="Telas" className={`${INPUT} min-h-24 font-mono text-xs`} value={screens} onChange={(event) => setScreens(event.target.value)} /></label>
          <label className="block text-sm font-medium">Variáveis, uma por linha: NOME=valor<textarea aria-label="Variáveis" className={`${INPUT} min-h-16 font-mono text-xs`} value={env} onChange={(event) => { setEnv(event.target.value); setConfirmed(false); }} placeholder="Use uma pasta de dados de demonstração, se o app permitir" /></label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>Entendo que este comando vai rodar o código do projeto no meu computador, e o texto dele veio de um agente.</span>
          </label>
          <Button onClick={() => capture.mutate()} disabled={!ready || capture.isPending}>{capture.isPending ? 'Capturando telas…' : 'Capturar telas'}</Button>
          {capture.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(capture.error)}</p>}
          {capture.data && capture.data.failed.length > 0 && <p role="status" className="text-sm text-muted-foreground">Não capturadas: {capture.data.failed.join(', ')}.</p>}
        </div>
      )}
      {prints.data && prints.data.length > 0 && (
        <div className="space-y-3 border-t pt-3">
          <ul aria-label="Prints capturados" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {prints.data.map((item) => (
              <li key={item.file} className="space-y-1">
                <img src={item.image} alt={item.file} className="max-h-56 w-full rounded-md border bg-black object-contain" />
                <Button variant="outline" size="sm" aria-label={`Remover ${item.file}`} onClick={() => remove.mutate(item.file)}>Remover</Button>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={reviewed} onChange={(event) => onReviewed(event.target.checked)} />
            <span>Revisei os prints: nenhum mostra senha, chave, e-mail ou dado pessoal que não deva aparecer no vídeo.</span>
          </label>
        </div>
      )}
    </section>
  );
}
