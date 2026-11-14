export type BrainErrorCode = 'not_found' | 'forbidden' | 'invalid' | 'conflict';

/** Expected failures, safe to show to the user or return to an MCP client. */
export class BrainError extends Error {
  override name = 'BrainError';

  constructor(
    readonly code: BrainErrorCode,
    message: string,
  ) {
    super(message);
  }
}
