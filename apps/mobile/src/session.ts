import { CoreClient, type CoreClientOptions } from './core-client';
import type { TokenResponse } from '@neuralbridge/shared/core-api';

export type RefreshToken = (refreshToken: string) => Promise<TokenResponse>;

/** Keeps one authenticated client and rotates the refresh token only after the Core accepts it. */
export class CoreSession {
  private client: CoreClient;
  private accessToken: string;
  private refreshToken: string;
  private readonly options: Omit<CoreClientOptions, 'accessToken'>;
  private readonly refresh: RefreshToken;

  constructor(options: CoreClientOptions & { refreshToken: string; refresh: RefreshToken }) {
    this.accessToken = options.accessToken ?? '';
    this.refreshToken = options.refreshToken;
    this.refresh = options.refresh;
    this.options = { endpoint: options.endpoint, fetch: options.fetch, dpop: options.dpop };
    this.client = new CoreClient({ ...this.options, accessToken: this.accessToken });
  }

  get core(): CoreClient { return this.client; }

  async reconnect(): Promise<void> {
    const next = await this.refresh(this.refreshToken);
    this.accessToken = next.accessToken;
    this.refreshToken = next.refreshToken;
    this.client = new CoreClient({ ...this.options, accessToken: this.accessToken });
  }

  tokens(): { accessToken: string; refreshToken: string } { return { accessToken: this.accessToken, refreshToken: this.refreshToken }; }
}
