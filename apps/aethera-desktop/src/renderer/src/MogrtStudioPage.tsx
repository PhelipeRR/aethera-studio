import { AlertTriangle, Download, FileUp, FolderOpen, ImagePlus, LoaderCircle, Play, RotateCcw, X } from 'lucide-react';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PageHeader } from '@/app/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import {
	MOGRT_RESOLUTIONS,
	type MogrtControl,
	type MogrtMediaSlot,
	type MogrtRenderResult,
	type MogrtTemplate,
	type MogrtValue,
} from './mogrt-studio-contract';
import * as studio from './mogrt-studio-store';

const MEDIA_LABEL: Record<MogrtMediaSlot, string> = { logo: 'Logo', background: 'Imagem de fundo' };

const mediaUrl = (path: string): string => `aethera-media://local?path=${encodeURIComponent(path)}`;
const seconds = (value: number): string => `${value.toFixed(1).replace('.', ',')} s`;

function remaining(secondsLeft: number): string {
	return secondsLeft < 60 ? 'menos de 1 min restante' : `cerca de ${Math.round(secondsLeft / 60)} min restantes`;
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="min-w-0 space-y-4 rounded-[28px] bg-card p-5 text-card-foreground">
			<div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
				<h2 id={id} className="text-[15px] font-medium">
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/** Keeps what is being typed, so that "-" or an empty field isn't replaced under the cursor. */
function NumberInput({
	id,
	label,
	value,
	disabled,
	onChange,
}: {
	id?: string;
	label?: string;
	value: number;
	disabled: boolean;
	onChange: (value: number) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<Input
			id={id}
			aria-label={label}
			type="number"
			step="any"
			disabled={disabled}
			value={draft ?? value}
			onBlur={() => setDraft(null)}
			onChange={(event) => {
				setDraft(event.target.value);
				const next = event.target.valueAsNumber;
				if (Number.isFinite(next)) onChange(next);
			}}
		/>
	);
}

function ControlField({ control, value, disabled }: { control: MogrtControl; value: MogrtValue; disabled: boolean }) {
	const id = useId();
	const { name, kind } = control;
	const change = (next: MogrtValue): void => studio.setValue(name, next);

	if (kind === 'boolean') {
		return (
			<label className="flex min-h-9 items-center justify-between gap-3 text-[13px] font-medium">
				{name}
				<input
					type="checkbox"
					className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
					checked={Boolean(value)}
					disabled={disabled}
					onChange={(event) => change(event.target.checked)}
				/>
			</label>
		);
	}
	if (kind === 'color') {
		return (
			<div className="flex min-h-9 items-center justify-between gap-3">
				<label htmlFor={id} className="min-w-0 text-[13px] font-medium break-words">
					{name}
				</label>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xs text-muted-foreground uppercase tabular-nums">{String(value)}</span>
					<input
						id={id}
						type="color"
						className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
						value={String(value)}
						disabled={disabled}
						onChange={(event) => change(event.target.value)}
					/>
				</div>
			</div>
		);
	}
	if (kind === 'text') {
		return (
			<Field label={name} htmlFor={id}>
				<Textarea
					id={id}
					rows={2}
					maxLength={2000}
					value={String(value)}
					disabled={disabled}
					onChange={(event) => change(event.target.value)}
				/>
			</Field>
		);
	}
	if (Array.isArray(value)) {
		const axes = ['X', 'Y', 'Z'];
		return (
			<fieldset className="space-y-1.5">
				<legend className="mb-1.5 text-[13px] font-medium">{name}</legend>
				<div className="grid grid-cols-2 gap-2">
					{value.map((part, index) => (
						<NumberInput
							key={index}
							label={`${name}, ${axes[index] ?? index + 1}`}
							value={part}
							disabled={disabled}
							onChange={(next) => change(value.map((old, at) => (at === index ? next : old)))}
						/>
					))}
				</div>
			</fieldset>
		);
	}
	return (
		<Field label={kind === 'angle' ? `${name} (graus)` : kind === 'scale' ? `${name} (%)` : name} htmlFor={id}>
			<NumberInput id={id} value={Number(value)} disabled={disabled} onChange={change} />
		</Field>
	);
}

function MediaField({ slot, name, disabled }: { slot: MogrtMediaSlot; name?: string | undefined; disabled: boolean }) {
	const label = MEDIA_LABEL[slot];
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/50 p-3">
			<div className="min-w-0">
				<p className="text-[13px] font-medium">{label}</p>
				<p className="text-xs break-all text-muted-foreground">{name ?? 'Nenhuma imagem: o espaço fica vazio.'}</p>
				{slot === 'background' && name && (
					<p className="mt-1 text-xs text-muted-foreground">
						Se ela não aparecer, ligue a opção de fundo do template, por exemplo “BG Footage”.
					</p>
				)}
			</div>
			<div className="flex gap-1">
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					aria-label={`${name ? 'Trocar' : 'Escolher'}: ${label}`}
					onClick={() => void studio.pickMedia(slot)}
				>
					<ImagePlus aria-hidden />
					{name ? 'Trocar' : 'Escolher'}
				</Button>
				{name && (
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
						aria-label={`Remover: ${label}`}
						onClick={() => void studio.clearMedia(slot)}
					>
						<X aria-hidden />
					</Button>
				)}
			</div>
		</div>
	);
}

function Controls({ template, state }: { template: MogrtTemplate; state: studio.MogrtStudioState }) {
	const locked = state.task !== null;
	const groups = [
		{ title: 'Textos', controls: template.controls.filter((control) => control.kind === 'text') },
		// The template's own order: it keeps a switch such as "BG" next to the color that depends on it.
		{ title: 'Cores e ajustes', controls: template.controls.filter((control) => control.kind !== 'text') },
	];
	return (
		<Card
			title="Personalizar"
			action={
				<Button
					variant="ghost"
					size="sm"
					disabled={locked || Object.keys(state.values).length === 0}
					onClick={studio.resetValues}
				>
					<RotateCcw aria-hidden />
					Restaurar controles
				</Button>
			}
		>
			{template.media.map((slot) => (
				<MediaField key={slot} slot={slot} name={state.media[slot]} disabled={locked} />
			))}
			{groups.map(
				({ title, controls }) =>
					controls.length > 0 && (
						<details key={`${template.id}-${title}`} open className="border-t border-border pt-3">
							<summary className="cursor-pointer rounded-md py-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
								{title} ({controls.length})
							</summary>
							<div className="space-y-3 px-1 pt-3 pb-1">
								{controls.map((control) => (
									<ControlField
										key={control.name}
										control={control}
										value={state.values[control.name] ?? control.value}
										disabled={locked}
									/>
								))}
							</div>
						</details>
					),
			)}
			{template.controls.length + template.media.length === 0 && (
				<p className="text-sm text-muted-foreground">Este template não expõe controles editáveis.</p>
			)}
		</Card>
	);
}

function Preview({ template, state }: { template: MogrtTemplate; state: studio.MogrtStudioState }) {
	const id = useId();
	const { preview, previewError, previewing, tSec, edit, task } = state;
	const current = preview?.edit === edit && preview.tSec === tSec;
	const image = preview?.path ?? template.thumbnailPath;
	const status = previewError
		? 'A prévia falhou'
		: previewing
			? 'Atualizando a prévia'
			: current
				? 'Prévia atualizada'
				: task === 'render'
					? 'Prévia pausada durante o render'
					: !preview && image
						? 'Miniatura que veio no template'
						: 'Prévia desatualizada';
	return (
		<Card
			title="Prévia"
			action={
				<p aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
					{previewing && <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
					{status}
				</p>
			}
		>
			<div
				className="mx-auto max-h-[56vh] w-full overflow-hidden rounded-2xl bg-black"
				style={{ aspectRatio: `${template.width} / ${template.height}` }}
			>
				{image && (
					<img
						src={mediaUrl(image)}
						alt={preview ? `Quadro do template em ${seconds(preview.tSec)}` : 'Miniatura do template'}
						className="size-full object-contain"
					/>
				)}
			</div>
			<div className="flex items-center gap-3">
				<label htmlFor={id} className="text-[13px] font-medium">
					Instante
				</label>
				<input
					id={id}
					type="range"
					className="h-9 min-w-0 flex-1 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
					min={0}
					max={template.durationSec}
					step={0.1}
					value={tSec}
					disabled={task !== null}
					aria-valuetext={seconds(tSec)}
					onChange={(event) => studio.setTime(event.target.valueAsNumber)}
				/>
				<output htmlFor={id} className="w-24 text-right text-xs text-muted-foreground tabular-nums">
					{seconds(tSec)} de {seconds(template.durationSec)}
				</output>
			</div>
			{previewError && (
				<Alert variant="destructive">
					<AlertTriangle aria-hidden />
					<AlertTitle>Não foi possível gerar a prévia</AlertTitle>
					<AlertDescription>
						<p className="[overflow-wrap:anywhere]">{previewError}</p>
						<Button variant="outline" size="sm" onClick={studio.retryPreview}>
							Tentar de novo
						</Button>
					</AlertDescription>
				</Alert>
			)}
		</Card>
	);
}

function Fidelity({ result }: { result: MogrtRenderResult }) {
	const notes = [
		{
			title: 'Efeitos com lacuna',
			lines: result.effects.map(({ layerName, name, reason }) => `${layerName}, ${name}: ${reason}`),
		},
		{
			title: 'Outras lacunas',
			lines: result.gaps.map(({ layerName, reason }) => (layerName ? `${layerName}: ${reason}` : reason)),
		},
		{ title: 'Aproximações', lines: result.approximations },
	];
	return (
		<div className="space-y-2 text-sm">
			<Badge variant={result.verdict === 'complete' ? 'success' : result.verdict === 'failed' ? 'destructive' : 'warning'}>
				{result.verdict === 'complete' ? 'Completo' : result.verdict === 'failed' ? 'Reprovado' : 'Parcial'}
			</Badge>
			<p className="text-muted-foreground">{result.reason}</p>
			{notes.map(({ title, lines }) => {
				const unique = [...new Set(lines)];
				if (unique.length === 0) return null;
				return (
					<details key={title}>
						<summary className="cursor-pointer rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
							{title} ({unique.length})
						</summary>
						<ul className="list-disc space-y-1 py-1 pl-5 text-xs leading-relaxed break-words text-muted-foreground">
							{unique.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					</details>
				);
			})}
		</div>
	);
}

function Output({ template, state }: { template: MogrtTemplate; state: studio.MogrtStudioState }) {
	const id = useId();
	const { task, progress, cancelling, result, savedTo, edit, longEdge } = state;
	const original = Math.max(template.width, template.height);
	const options = MOGRT_RESOLUTIONS.filter((edge, index) => index === 0 || edge <= original);
	const rendering = task === 'render';
	return (
		<Card title="Vídeo">
			<div className="flex flex-wrap items-end gap-3">
				<div className="w-56">
					<Field label="Lado maior" htmlFor={id}>
						<Select
							id={id}
							disabled={task !== null}
							value={options.some((edge) => edge === longEdge) ? longEdge : options.at(-1)}
							onChange={(event) => studio.setLongEdge(Number(event.target.value))}
						>
							{options.map((edge) => (
								<option key={edge} value={edge}>
									{edge} px{edge === 640 ? ' (teste rápido)' : ''}
								</option>
							))}
						</Select>
					</Field>
				</div>
				{rendering ? (
					<Button variant="outline" disabled={cancelling} onClick={() => void studio.cancelRender()}>
						<X aria-hidden />
						{cancelling ? 'Cancelando…' : 'Cancelar'}
					</Button>
				) : (
					<Button disabled={task !== null} onClick={() => void studio.renderVideo()}>
						<Play aria-hidden />
						{result ? 'Renderizar de novo' : 'Renderizar MP4'}
					</Button>
				)}
			</div>
			<p className="text-xs text-muted-foreground">
				O motor usa a CPU, e um vídeo pode levar vários minutos. O MP4 sai sem áudio.
			</p>
			{rendering && (
				<div className="space-y-1.5">
					<Progress
						aria-label="Progresso do render"
						value={progress ? Math.round((progress.done / progress.total) * 100) : 0}
					/>
					<p className="text-xs text-muted-foreground tabular-nums">
						{progress ? `Quadro ${progress.done} de ${progress.total}` : 'Preparando…'}
						{progress?.secondsLeft != null && `, ${remaining(progress.secondsLeft)}`}
					</p>
				</div>
			)}
			<p aria-live="polite" className="sr-only">
				{rendering ? 'Render em andamento' : result ? 'Render concluído' : ''}
			</p>
			{result && (
				<div className="space-y-3 border-t border-border pt-4">
					{result.edit !== edit && (
						<p className="text-xs text-warning">Você editou depois deste render: o vídeo mostra a versão anterior.</p>
					)}
					<video
						key={result.renderId}
						controls
						aria-label={`Vídeo renderizado em ${result.width} por ${result.height}`}
						src={mediaUrl(result.path)}
						className="max-h-[56vh] w-full rounded-2xl bg-black"
					/>
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => void studio.saveVideo()}>
							<Download aria-hidden />
							Salvar como…
						</Button>
						<Button variant="outline" onClick={() => void studio.revealVideo()}>
							<FolderOpen aria-hidden />
							Mostrar na pasta
						</Button>
					</div>
					{savedTo && (
						<p aria-live="polite" className="text-xs break-all text-muted-foreground">
							Salvo em {savedTo}
						</p>
					)}
					<Fidelity result={result} />
				</div>
			)}
		</Card>
	);
}

export function MogrtStudioPage() {
	const state = useSyncExternalStore(studio.subscribe, studio.getState);
	const { template, task, error } = state;
	const importButton = (
		<Button disabled={task !== null} onClick={() => void studio.importTemplate()}>
			{task === 'import' ? (
				<LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
			) : (
				<FileUp aria-hidden />
			)}
			{task === 'import' ? 'Importando…' : template ? 'Trocar template' : 'Escolher .mogrt'}
		</Button>
	);
	return (
		<>
			<PageHeader
				title="Templates MOGRT"
				description="Personalize e renderize templates do After Effects sem instalar programas da Adobe."
				actions={template ? importButton : undefined}
			/>
			<div className="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
				{error && (
					<Alert variant="destructive">
						<AlertTriangle aria-hidden />
						<AlertTitle>Algo deu errado</AlertTitle>
						<AlertDescription>
							<p className="[overflow-wrap:anywhere]">{error}</p>
						</AlertDescription>
					</Alert>
				)}
				{template ? (
					<>
						<div className="min-w-0 px-1">
							<p className="text-[17px] leading-snug break-words">{template.name}</p>
							<p className="text-xs break-all text-muted-foreground">
								{template.fileName}, {template.width}×{template.height}, {Math.round(template.fps * 100) / 100} fps,{' '}
								{seconds(template.durationSec)}
							</p>
						</div>
						<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
							<div className="min-w-0 space-y-4">
								<Preview template={template} state={state} />
								<Output template={template} state={state} />
							</div>
							<Controls template={template} state={state} />
						</div>
					</>
				) : (
					<div className="flex flex-col items-center gap-3 rounded-[28px] bg-card px-6 py-16 text-center">
						<h2 className="text-[17px] font-medium">Nenhum template aberto</h2>
						<p className="max-w-[52ch] text-sm text-muted-foreground">
							Escolha um arquivo .mogrt criado no After Effects. Se veio num ZIP, extraia antes. O original não é alterado.
						</p>
						{importButton}
					</div>
				)}
				<p className="px-1 text-xs leading-relaxed text-muted-foreground">
					O resultado é uma reprodução aproximada, não equivale a um render do After Effects. Fontes que não estão
					instaladas são substituídas, e cada render lista as lacunas.
				</p>
			</div>
		</>
	);
}
