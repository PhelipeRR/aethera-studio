/** IPC of the MOGRT page. Every path comes from a dialog opened here. */

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
	MogrtMediaSlot,
	MogrtPreviewRequest,
	MogrtRenderRequest,
	MogrtReply,
} from '../renderer/src/mogrt-studio-contract.js';
import { createMogrtStudioService, MOGRT_MEDIA_EXTENSIONS } from './mogrt-studio-service.js';

export function registerMogrtStudioIpc(options: {
	ensureTrusted: (senderFrame: Electron.WebFrameMain | null) => void;
	userDataDir: string;
	ffmpegPath?: string;
}): void {
	const { ensureTrusted, userDataDir, ffmpegPath } = options;
	const tempDir = join(app.getPath('temp'), `aethera-mogrt-${randomUUID()}`);
	const service = createMogrtStudioService({
		workerPath: join(__dirname, 'mogrt-worker.js'),
		tempDir,
		rendersDir: join(userDataDir, 'aethera-mogrt', 'renders'),
		...(ffmpegPath ? { ffmpegPath } : {}),
	});

	function handle<I, T>(channel: string, run: (event: Electron.IpcMainInvokeEvent, input: I) => Promise<T> | T): void {
		ipcMain.handle(channel, async (event, input: I): Promise<MogrtReply<T>> => {
			ensureTrusted(event.senderFrame);
			try {
				return { ok: true, value: await run(event, input) };
			} catch (error) {
				return { ok: false, message: error instanceof Error ? error.message : String(error) };
			}
		});
	}

	async function chooseFile(sender: Electron.WebContents, title: string, name: string, extensions: string[]) {
		const dialogOptions: Electron.OpenDialogOptions = { title, properties: ['openFile'], filters: [{ name, extensions }] };
		const owner = BrowserWindow.fromWebContents(sender);
		const picked = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
		return picked.canceled ? null : (picked.filePaths[0] ?? null);
	}

	handle('mogrt:import', async (event) => {
		const path = await chooseFile(event.sender, 'Escolher template MOGRT', 'Template MOGRT', ['mogrt']);
		return path ? service.importTemplate(path) : null;
	});

	handle('mogrt:pick-media', async (event, { id, slot }: { id: string; slot: MogrtMediaSlot }) => {
		const title = slot === 'logo' ? 'Escolher logo' : 'Escolher fundo';
		const path = await chooseFile(event.sender, title, 'Imagem', MOGRT_MEDIA_EXTENSIONS);
		return path ? service.setMedia(id, slot, path) : null;
	});

	handle('mogrt:clear-media', (_event, { id, slot }: { id: string; slot: MogrtMediaSlot }) => {
		service.setMedia(id, slot, null);
		return null;
	});

	handle('mogrt:preview', (_event, input: MogrtPreviewRequest) => service.preview(input));

	handle('mogrt:render', (event, input: MogrtRenderRequest) =>
		service.render(input, (progress) => {
			if (!event.sender.isDestroyed()) event.sender.send('mogrt:progress', progress);
		}),
	);

	handle('mogrt:cancel', async () => {
		await service.cancel();
		return null;
	});

	handle('mogrt:save-render', async (event, { renderId }: { renderId: string }) => {
		const source = service.renderPath(renderId);
		const dialogOptions: Electron.SaveDialogOptions = {
			title: 'Salvar vídeo',
			defaultPath: join(app.getPath('videos'), 'template-mogrt.mp4'),
			filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }],
		};
		const owner = BrowserWindow.fromWebContents(event.sender);
		const picked = owner ? await dialog.showSaveDialog(owner, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
		if (picked.canceled || !picked.filePath) return null;
		await copyFile(source, picked.filePath);
		return picked.filePath;
	});

	handle('mogrt:reveal-render', (_event, { renderId }: { renderId: string }) => {
		shell.showItemInFolder(service.renderPath(renderId));
		return null;
	});

	app.on('will-quit', () => {
		void service.cancel();
		try {
			// Only this run's own folder: copies of the imports and their previews.
			rmSync(tempDir, { recursive: true, force: true });
		} catch (error) {
			console.warn('[mogrt] temporary folder not removed', error);
		}
	});
}
