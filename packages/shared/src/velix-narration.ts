export type NarrationProviderId = 'elevenlabs-manual' | 'voicestudio';
export type NarrationLicenseReview = 'unknown' | 'reviewed';

export interface NarrationLicenseState {
  provider: NarrationLicenseReview;
  model: NarrationLicenseReview;
  voice: NarrationLicenseReview;
  output: NarrationLicenseReview;
  userConfirmed: boolean;
}

export interface NarrationModel {
  id: string;
  label: string;
  installed: boolean;
  license: NarrationLicenseState;
  /** The license the provider declares for this model. */
  licenseNote: string | null;
}

export interface NarrationVoice {
  id: string;
  label: string;
  source: 'local' | 'profile' | 'preset' | 'unknown';
  license: NarrationLicenseState;
}

export interface VoiceStudioStatus {
  available: boolean;
  compatible: boolean;
  baseUrl: string;
  apiVersion: string | null;
  models: NarrationModel[];
  voices: NarrationVoice[];
  error: string | null;
}

export interface NarrationTimeline {
  assetId: string;
  relativePath: string;
  startMs: number;
  endMs: number;
  syncStatus: 'not-synced' | 'synced' | 'needs-review';
}

export interface NarrationAsset {
  id: string;
  provider: NarrationProviderId;
  relativePath: string;
  format: 'mp3' | 'wav';
  modelId: string | null;
  voiceId: string | null;
  textHash: string;
  durationMs: number;
  license: NarrationLicenseState;
  status: 'pending-license' | 'ready' | 'blocked';
  createdAt: string;
}
