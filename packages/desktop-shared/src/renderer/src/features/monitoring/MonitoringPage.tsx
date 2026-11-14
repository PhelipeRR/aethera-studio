import * as React from 'react';
import { Activity, Cpu, Gauge, HardDrive, MemoryStick, Network, Sparkles } from 'lucide-react';
import { MONITORING_HISTORY, MONITORING_INTERVALS_MS, type MonitoringInterval, type MonitorSource } from '@neuralbridge/shared/monitoring';
import { PageHeader } from '@/app/PageHeader';
import { ErrorState, LoadingState } from '@/components/feedback/FeedbackState';
import { Select } from '@/components/ui/field';
import { GlassPanel, MeterBar, SectionLabel, StatusDot } from '@/components/ui/glass';
import { TimeSeriesChart } from '@/components/ui/time-series-chart';
import { bits, bytes, celsius, megahertz, niceMax, percent, rate, share } from './format';
import { series, setMonitoringInterval, useMonitoring } from './monitoring-store';

/*
 * Monitoring page (lote 50.08). Every number comes from the Windows collector in the main process; a sensor that this
 * machine does not expose is shown as unavailable with the reason, never as zero.
 */

const GOLD = 'var(--primary)';
const TEAL = 'var(--info)';
const GREEN = 'var(--success)';

function Card({ icon: Icon, title, subtitle, value, children, testId }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string | null; value?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <GlassPanel className="sg-enter space-y-3 p-4" data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md border border-[var(--glass-border)] bg-secondary p-1.5 text-primary" aria-hidden="true"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</p>}
        </div>
        {value !== undefined && <p className="shrink-0 text-2xl leading-none font-extralight text-foreground tabular-nums">{value}</p>}
      </div>
      {children}
    </GlassPanel>
  );
}

function Detail({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground tabular-nums" title={hint ?? undefined}>{value}</dd>
    </div>
  );
}

function Unavailable({ reason }: { reason: string | null | undefined }) {
  return <p className="flex items-start gap-2 text-xs text-muted-foreground"><StatusDot tone="unknown" className="mt-1" />{reason ?? 'Indisponível neste computador.'}</p>;
}

export function MonitoringPage({ description }: { description: string }) {
  const data = useMonitoring();
  const samples = data.samples;
  const last = samples.at(-1);
  const sources = data.static?.sources;
  const source = (key: MonitorSource) => sources?.[key];
  const [saving, setSaving] = React.useState(false);

  const header = (
    <PageHeader
      title="Monitoramento"
      description={description}
      actions={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Atualizar a cada
          <Select aria-label="Intervalo de atualização" className="h-8 w-auto text-xs" value={String(data.intervalMs)} disabled={saving} onChange={(event) => { setSaving(true); void setMonitoringInterval(Number(event.target.value) as MonitoringInterval).finally(() => setSaving(false)); }}>
            {MONITORING_INTERVALS_MS.map((value) => <option key={value} value={value}>{value / 1000} s</option>)}
          </Select>
        </label>
      }
    />
  );

  if (data.state === 'error') return <>{header}<div className="p-6"><ErrorState title="Monitoramento indisponível" description="O processo principal não respondeu." /></div></>;
  if (!last) return <>{header}<div className="p-6"><LoadingState title="Iniciando a coleta" description={data.state === 'unavailable' ? (sources?.cpu.reason ?? 'Coleta indisponível.') : 'Lendo os contadores de desempenho do Windows. A primeira leitura chega em alguns segundos.'} /></div></>;

  const cpu = series(samples, (s) => s.cpu.utilization);
  const ram = series(samples, (s) => share(s.memory.usedBytes, s.memory.totalBytes));
  const gpu = series(samples, (s) => s.gpu.utilization);
  const vram = series(samples, (s) => share(s.gpu.vramUsedBytes, s.gpu.vramTotalBytes));
  const diskRead = series(samples, (s) => s.disk.readBytesPerSec);
  const diskWrite = series(samples, (s) => s.disk.writeBytesPerSec);
  const down = series(samples, (s) => s.network.downBytesPerSec);
  const up = series(samples, (s) => s.network.upBytesPerSec);
  const appCpu = series(samples, (s) => s.app.cpuPercent);
  const overheadCpu = series(samples, (s) => s.overhead.cpuPercent);
  const pct = (value: number | null) => percent(value);
  // The chart window grows with the history (at least 30 samples), so a fresh start is not squeezed into one edge.
  const capacity = Math.min(MONITORING_HISTORY, Math.max(30, samples.length));
  const historyLabel = `${Math.round((samples.length * data.intervalMs) / 1000)} s de histórico`;

  return (
    <>
      {header}
      <div className="space-y-4 px-6 py-5" data-testid="monitoring" data-samples={samples.length}>
        <p className="text-xs text-muted-foreground">
          <StatusDot tone={data.state === 'running' ? 'ok' : 'warning'} className="mr-2" />
          {data.state === 'running' ? 'Coletando dados reais do Windows' : 'Iniciando'} · {historyLabel} · intervalo de {data.intervalMs / 1000} s
        </p>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <Card testId="monitor-cpu" icon={Cpu} title="CPU" subtitle={data.static ? `${data.static.cpuModel ?? 'Processador'} · ${data.static.logicalCores} threads` : null} value={percent(last.cpu.utilization)}>
            {source('cpu')?.available ? <TimeSeriesChart title="Uso de CPU" series={[{ label: 'Uso', values: cpu, color: GOLD }]} max={100} capacity={capacity} format={pct} /> : <Unavailable reason={source('cpu')?.reason} />}
            <dl className="grid grid-cols-2 gap-3">
              <Detail label="Frequência atual" value={megahertz(last.cpu.frequencyMhz)} />
              <Detail label="Temperatura" value={last.cpu.temperatureC === null ? 'indisponível' : celsius(last.cpu.temperatureC)} hint={source('cpuTemperature')?.reason} />
            </dl>
            {last.cpu.temperatureC === null && <Unavailable reason={source('cpuTemperature')?.reason} />}
          </Card>

          <Card testId="monitor-memory" icon={MemoryStick} title="Memória RAM" subtitle={`${bytes(last.memory.totalBytes)} no total`} value={percent(share(last.memory.usedBytes, last.memory.totalBytes))}>
            <TimeSeriesChart title="Uso de memória" series={[{ label: 'Em uso', values: ram, color: GOLD }]} max={100} capacity={capacity} format={pct} />
            <dl className="grid grid-cols-3 gap-3">
              <Detail label="Em uso" value={bytes(last.memory.usedBytes)} />
              <Detail label="Disponível" value={bytes(last.memory.availableBytes)} />
              <Detail label="Total" value={bytes(last.memory.totalBytes)} />
            </dl>
          </Card>

          <Card testId="monitor-gpu" icon={Gauge} title="GPU" subtitle={data.static?.gpuName ?? 'Placa de vídeo'} value={percent(last.gpu.utilization)}>
            {source('gpu')?.available ? <TimeSeriesChart title="Uso de GPU" series={[{ label: 'Uso', values: gpu, color: GOLD }]} max={100} capacity={capacity} format={pct} /> : <Unavailable reason={source('gpu')?.reason} />}
            <dl className="grid grid-cols-2 gap-3">
              <Detail label="Temperatura" value={last.gpu.temperatureC === null ? 'indisponível' : celsius(last.gpu.temperatureC)} hint={source('gpuTemperature')?.reason} />
              <Detail label="Fonte" value={source('gpu')?.provider ?? '—'} />
            </dl>
            {last.gpu.temperatureC === null && <Unavailable reason={source('gpuTemperature')?.reason} />}
          </Card>

          <Card testId="monitor-vram" icon={Sparkles} title="Memória de vídeo (VRAM)" subtitle={last.gpu.vramTotalBytes ? `${bytes(last.gpu.vramTotalBytes)} dedicados` : null} value={percent(share(last.gpu.vramUsedBytes, last.gpu.vramTotalBytes))}>
            {source('vram')?.available ? <TimeSeriesChart title="Uso de VRAM" series={[{ label: 'Em uso', values: vram, color: GOLD }]} max={100} capacity={capacity} format={pct} /> : <Unavailable reason={source('vram')?.reason} />}
            <dl className="grid grid-cols-2 gap-3">
              <Detail label="Em uso" value={bytes(last.gpu.vramUsedBytes)} />
              <Detail label="Total" value={bytes(last.gpu.vramTotalBytes)} />
            </dl>
          </Card>

          <Card testId="monitor-disk" icon={HardDrive} title="Disco" subtitle="Todos os discos físicos" value={percent(last.disk.busy)}>
            {source('disk')?.available ? <TimeSeriesChart title="Leitura e gravação em disco" series={[{ label: 'Leitura', values: diskRead, color: GOLD }, { label: 'Gravação', values: diskWrite, color: TEAL }]} max={niceMax([...diskRead, ...diskWrite], 1024 * 1024)} capacity={capacity} format={rate} /> : <Unavailable reason={source('disk')?.reason} />}
            <ul className="space-y-2">
              {(data.static?.drives ?? []).map((drive) => (
                <li key={drive.mount}><MeterBar label={`${drive.mount} · ${bytes(drive.freeBytes)} livres de ${bytes(drive.totalBytes)}`} value={share(drive.totalBytes - drive.freeBytes, drive.totalBytes)} /></li>
              ))}
            </ul>
          </Card>

          <Card testId="monitor-network" icon={Network} title="Rede" subtitle={`Conexão: ${bits(last.network.linkBitsPerSec)}`} value={rate(last.network.downBytesPerSec)}>
            {source('network')?.available ? <TimeSeriesChart title="Download e upload" series={[{ label: 'Download', values: down, color: GOLD }, { label: 'Upload', values: up, color: GREEN }]} max={niceMax([...down, ...up], 64 * 1024)} capacity={capacity} format={rate} /> : <Unavailable reason={source('network')?.reason} />}
            <dl className="grid grid-cols-3 gap-3">
              <Detail label="Download" value={rate(last.network.downBytesPerSec)} />
              <Detail label="Upload" value={rate(last.network.upBytesPerSec)} />
              <Detail label="Velocidade do link" value={bits(last.network.linkBitsPerSec)} />
            </dl>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card testId="monitor-consumers" icon={Activity} title="Consumo por componente" subtitle="CPU em % do total da máquina" value={percent(last.app.cpuPercent)}>
            <TimeSeriesChart title="CPU do Singularity" series={[{ label: 'Singularity (app)', values: appCpu, color: GOLD }]} max={niceMax(appCpu, 5)} capacity={capacity} format={pct} />
            <table className="w-full text-sm">
              <caption className="sr-only">Consumo por componente</caption>
              <thead><tr className="text-left text-[11px] text-muted-foreground"><th scope="col" className="pb-1 font-normal">Componente</th><th scope="col" className="pb-1 text-right font-normal">CPU</th><th scope="col" className="pb-1 text-right font-normal">Memória</th></tr></thead>
              <tbody>
                {data.consumers.map((consumer) => (
                  <tr key={consumer.id} className="border-t border-[var(--glass-border)]">
                    <th scope="row" className="py-1.5 text-left font-normal text-foreground">
                      <span className="flex items-center gap-2"><StatusDot tone={consumer.monitored ? 'ok' : 'unknown'} />{consumer.label}</span>
                      {!consumer.monitored && <span className="block pl-4 text-[11px] text-muted-foreground">{consumer.reason}</span>}
                    </th>
                    <td className="py-1.5 text-right align-top text-foreground tabular-nums">{consumer.monitored ? percent(consumer.cpuPercent) : '—'}</td>
                    <td className="py-1.5 text-right align-top text-foreground tabular-nums">{consumer.monitored ? bytes(consumer.memoryBytes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card testId="monitor-overhead" icon={Gauge} title="Custo do monitoramento" subtitle="Processos do coletor: typeperf e nvidia-smi" value={percent(last.overhead.cpuPercent)}>
            {source('overhead')?.available ? <TimeSeriesChart title="CPU usada pelo coletor" series={[{ label: 'CPU do coletor', values: overheadCpu, color: GOLD }]} max={niceMax(overheadCpu, 1)} capacity={capacity} format={(value) => (value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)} /> : <Unavailable reason={source('overhead')?.reason} />}
            <dl className="grid grid-cols-2 gap-3">
              <Detail label="Memória do coletor" value={bytes(last.overhead.memoryBytes)} />
              <Detail label="Pausa automática" value="20 s sem tela aberta" />
            </dl>
            <SectionLabel>Fontes</SectionLabel>
            <ul className="space-y-1 text-xs">
              {sources && (Object.entries(sources) as [MonitorSource, NonNullable<typeof sources>[MonitorSource]][]).map(([key, status]) => (
                <li key={key} className="flex items-start gap-2"><StatusDot tone={status.available ? 'ok' : 'unknown'} className="mt-1" /><span className="text-foreground">{SOURCE_LABEL[key]}</span><span className="text-muted-foreground">— {status.available ? status.provider : status.reason}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

const SOURCE_LABEL: Record<MonitorSource, string> = {
  cpu: 'CPU',
  cpuTemperature: 'Temperatura da CPU',
  memory: 'Memória',
  gpu: 'GPU',
  gpuTemperature: 'Temperatura da GPU',
  vram: 'VRAM',
  disk: 'Disco',
  network: 'Rede',
  app: 'Singularity (app)',
  overhead: 'Coletor',
};
