import { describe, expect, it } from 'vitest';
import { IpcChannel, parseIpcInput, type ContentChannel } from '@neuralbridge/shared';
import {
  buildEmptyChannelForm,
  buildFormFromChannel,
  toChannelCreatePayload,
  toChannelUpdatePayload,
  validateChannelForm,
} from '../../../packages/desktop-shared/src/renderer/src/features/aethera/channel-manager-helpers';
import { registerContentOperatingSystemIpcHandlers } from '../../../packages/desktop-shared/src/main/handlers/content-operating-system';

describe('Channel Manager IPC Payload & Persistence Regression', () => {
  it('reproduces IpcRejectedError when workspaceId is sent to content:channels:update and passes with toChannelUpdatePayload', () => {
    const form = buildEmptyChannelForm('ch_nextworth_1');
    form.name = 'NextWorth';
    form.niche = 'Finanças, investimentos e tecnologia';
    form.audience = 'Jovens adultos interessados em independência financeira';
    form.tone = 'Analítico, claro e direto';

    const createPayload = toChannelCreatePayload(form);
    expect(() => parseIpcInput(IpcChannel.contentChannelCreate, createPayload)).not.toThrow();

    // Reproduces the exact bug: strictObject rejects unknown workspaceId on update
    expect(() => parseIpcInput(IpcChannel.contentChannelUpdate, createPayload)).toThrow();

    // Fixed update payload omits workspaceId and validates cleanly
    const updatePayload = toChannelUpdatePayload(form);
    expect('workspaceId' in updatePayload).toBe(false);
    expect(() => parseIpcInput(IpcChannel.contentChannelUpdate, updatePayload)).not.toThrow();
  });

  it('handles empty optional fields and validates field length limits with specific messages', () => {
    const emptyForm = buildEmptyChannelForm('ch_empty_opt');
    emptyForm.name = 'Canal Teste';
    emptyForm.niche = '';
    emptyForm.audience = '';
    emptyForm.tone = '';

    expect(validateChannelForm(emptyForm)).toEqual([]);
    const payload = toChannelUpdatePayload(emptyForm);
    expect(() => parseIpcInput(IpcChannel.contentChannelUpdate, payload)).not.toThrow();

    const invalidForm = buildEmptyChannelForm('ch_invalid');
    invalidForm.name = '   ';
    invalidForm.niche = 'x'.repeat(301);
    invalidForm.audience = 'y'.repeat(501);
    invalidForm.tone = 'z'.repeat(501);

    const errors = validateChannelForm(invalidForm);
    expect(errors.some((e) => e.includes('Nome do canal'))).toBe(true);
    expect(errors.some((e) => e.includes('Nicho'))).toBe(true);
    expect(errors.some((e) => e.includes('Público-alvo'))).toBe(true);
    expect(errors.some((e) => e.includes('Tom narrativo'))).toBe(true);
  });

  it('persists channel creation and update through real IPC handler validation', async () => {
    const store = new Map<string, ContentChannel>();
    const handlers = new Map<string, (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>>();
    const ipcMock = {
      handle: (channel: string, listener: (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, listener);
      },
    };

    const now = new Date().toISOString();
    const repositoryMock = {
      createChannel: (input: {
        id: string;
        workspaceId: string;
        name: string;
        autonomy: ContentChannel['autonomy'];
        budgetUsd: number;
        concurrencyLimit: number;
        niche?: string;
        audience?: string;
        tone?: string;
        identity?: Record<string, unknown>;
        editorialStrategy?: Record<string, unknown>;
      }): ContentChannel => {
        const ch: ContentChannel = {
          id: input.id,
          workspaceId: input.workspaceId,
          name: input.name,
          niche: input.niche ?? '',
          audience: input.audience ?? '',
          tone: input.tone ?? '',
          autonomy: input.autonomy,
          budgetUsd: input.budgetUsd,
          concurrencyLimit: input.concurrencyLimit,
          identity: input.identity ?? {},
          editorialStrategy: input.editorialStrategy ?? {},
          createdAt: now,
          updatedAt: now,
        };
        store.set(ch.id, ch);
        return ch;
      },
      updateChannel: (input: {
        id: string;
        name?: string;
        niche?: string;
        audience?: string;
        tone?: string;
        autonomy?: ContentChannel['autonomy'];
        budgetUsd?: number;
        concurrencyLimit?: number;
        identity?: Record<string, unknown>;
        editorialStrategy?: Record<string, unknown>;
      }): ContentChannel => {
        const existing = store.get(input.id);
        if (!existing) throw new Error('not_found');
        const updated: ContentChannel = {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.niche !== undefined ? { niche: input.niche } : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          ...(input.tone !== undefined ? { tone: input.tone } : {}),
          ...(input.autonomy !== undefined ? { autonomy: input.autonomy } : {}),
          ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}),
          ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: input.concurrencyLimit } : {}),
          ...(input.identity !== undefined ? { identity: input.identity } : {}),
          ...(input.editorialStrategy !== undefined ? { editorialStrategy: input.editorialStrategy } : {}),
          updatedAt: new Date().toISOString(),
        };
        store.set(updated.id, updated);
        return updated;
      },
    };

    registerContentOperatingSystemIpcHandlers(
      ipcMock,
      repositoryMock as unknown as Parameters<typeof registerContentOperatingSystemIpcHandlers>[1],
      () => true,
    );

    const trustedEvent = { senderFrame: { url: 'app://aethera/index.html' } };
    const createHandler = handlers.get(IpcChannel.contentChannelCreate)!;
    const updateHandler = handlers.get(IpcChannel.contentChannelUpdate)!;

    const form = buildEmptyChannelForm('ch_nextworth_persist');
    form.name = 'NextWorth';
    form.niche = 'Educação Financeira';

    const created = (await createHandler(trustedEvent, toChannelCreatePayload(form))) as ContentChannel;
    expect(created.name).toBe('NextWorth');

    const editForm = buildFormFromChannel(created);
    editForm.audience = 'Investidores iniciantes no Brasil';
    editForm.tone = 'Objetivo e educativo';

    const updated = (await updateHandler(trustedEvent, toChannelUpdatePayload(editForm))) as ContentChannel;
    expect(updated.audience).toBe('Investidores iniciantes no Brasil');
    expect(updated.tone).toBe('Objetivo e educativo');
    expect(store.get('ch_nextworth_persist')?.audience).toBe('Investidores iniciantes no Brasil');
  });
});
