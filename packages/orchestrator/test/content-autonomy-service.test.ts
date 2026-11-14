import { describe, expect, it } from 'vitest';
import { autonomyDecision, canStartContentExecution, requiresContentApproval } from '../src/content-autonomy-service.js';

describe('content autonomy policy', () => {
  it('keeps public publication approval mandatory in every mode', () => {
    expect(requiresContentApproval('autonomous', 'publication')).toBe(true);
    expect(requiresContentApproval('autonomous', 'script')).toBe(false);
    expect(requiresContentApproval('assisted', 'script')).toBe(true);
  });

  it('blocks concurrency and budget before an execution starts', () => {
    expect(canStartContentExecution({ mode: 'autonomous', budgetUsd: 10, activeExecutions: 1, concurrencyLimit: 1 }, 1)).toMatchObject({ allowed: false });
    expect(canStartContentExecution({ mode: 'autonomous', budgetUsd: 10, activeExecutions: 0, concurrencyLimit: 2 }, 11)).toMatchObject({ allowed: false });
    expect(autonomyDecision({ mode: 'autonomous', budgetUsd: 10, activeExecutions: 0, concurrencyLimit: 2 }, 'production', 2)).toMatchObject({ allowed: true, approvalRequired: false });
  });
});
