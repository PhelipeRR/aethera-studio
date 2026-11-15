import { randomUUID } from 'node:crypto';
import { brandKitSchema, type BrandKit } from './schemas.js';

export interface BrandKitStore {
  list(): BrandKit[];
  get(id: string): BrandKit | null;
  save(kit: BrandKit): BrandKit;
  delete(id: string): boolean;
}

export class InMemoryBrandKitStore implements BrandKitStore {
  private readonly items = new Map<string, BrandKit>();

  list(): BrandKit[] {
    return Array.from(this.items.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): BrandKit | null {
    return this.items.get(id) ?? null;
  }

  save(kit: BrandKit): BrandKit {
    const parsed = brandKitSchema.parse(kit);
    this.items.set(parsed.id, parsed);
    return parsed;
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }
}

export class BrandKitManager {
  constructor(private readonly store: BrandKitStore = new InMemoryBrandKitStore()) {}

  create(input: {
    id?: string;
    channelId?: string;
    channelName: string;
    palette?: Partial<BrandKit['palette']>;
    typography?: Partial<BrandKit['typography']>;
    logoAssetId?: string;
    avatarAssetId?: string;
    watermarkAssetId?: string;
    thumbnailStyles?: string[];
    compositionPresets?: string[];
    referenceAssetIds?: string[];
  }): BrandKit {
    const now = new Date().toISOString();
    const kit = brandKitSchema.parse({
      id: input.id ?? `bk-${randomUUID().slice(0, 10)}`,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      channelName: input.channelName,
      palette: {
        primary: input.palette?.primary ?? '#00F0FF',
        secondary: input.palette?.secondary ?? '#FF006E',
        accent: input.palette?.accent ?? '#FACC15',
        background: input.palette?.background ?? '#070B14',
        surface: input.palette?.surface ?? '#111827',
        text: input.palette?.text ?? '#FFFFFF',
      },
      typography: {
        headingFont: input.typography?.headingFont ?? 'Arial Black',
        bodyFont: input.typography?.bodyFont ?? 'Segoe UI',
        titleWeight: input.typography?.titleWeight ?? 900,
        strokeColor: input.typography?.strokeColor ?? '#000000',
        shadowColor: input.typography?.shadowColor ?? '#000000CC',
      },
      ...(input.logoAssetId ? { logoAssetId: input.logoAssetId } : {}),
      ...(input.avatarAssetId ? { avatarAssetId: input.avatarAssetId } : {}),
      ...(input.watermarkAssetId ? { watermarkAssetId: input.watermarkAssetId } : {}),
      thumbnailStyles: input.thumbnailStyles ?? ['impact', 'tech', 'cinematic'],
      compositionPresets: input.compositionPresets ?? ['cyber-split', 'hero-center'],
      referenceAssetIds: input.referenceAssetIds ?? [],
      createdAt: now,
      updatedAt: now,
    });
    return this.store.save(kit);
  }

  update(
    id: string,
    patch: Partial<Omit<BrandKit, 'id' | 'createdAt' | 'palette' | 'typography'>> & {
      palette?: Partial<BrandKit['palette']>;
      typography?: Partial<BrandKit['typography']>;
    },
  ): BrandKit {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Brand Kit not found: ${id}`);
    }
    const updated = brandKitSchema.parse({
      ...existing,
      ...patch,
      palette: {
        ...existing.palette,
        ...(patch.palette ?? {}),
      },
      typography: {
        ...existing.typography,
        ...(patch.typography ?? {}),
      },
      updatedAt: new Date().toISOString(),
    });
    return this.store.save(updated);
  }

  get(id: string): BrandKit | null {
    return this.store.get(id);
  }

  list(): BrandKit[] {
    return this.store.list();
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }
}
