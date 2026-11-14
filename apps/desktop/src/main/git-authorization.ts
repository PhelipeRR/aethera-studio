import { createHash, randomBytes } from 'node:crypto';

export type GitRisk = 'read' | 'reversible' | 'destructive';
export type GitOperation = 'stage' | 'unstage' | 'branch-create' | 'branch-switch' | 'branch-rename' | 'branch-delete' | 'stash' | 'commit' | 'push' | 'revert' | 'cherry-pick' | 'apply-patch';

export interface GitAuthorizationRequest { repository: string; operation: GitOperation; risk: GitRisk; parameters: Record<string, string | string[]>; stateFingerprint: string; }
export interface GitAuditEntry { repository: string; operation: GitOperation; risk: GitRisk; outcome: 'authorized' | 'consumed' | 'rejected' | 'expired'; at: string; reason?: string; }

interface Grant { request: GitAuthorizationRequest; expiresAt: number; used: boolean; }

/** Main-process-only, single-use authorization registry. It never stores file contents or secrets. */
export class GitAuthorizationService {
  private readonly grants = new Map<string, Grant>();
  private readonly auditLog: GitAuditEntry[] = [];

  issue(request: GitAuthorizationRequest, ttlMs = 60_000): { token: string; expiresAt: string } {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + Math.max(1_000, Math.min(ttlMs, 5 * 60_000));
    this.grants.set(token, { request, expiresAt, used: false });
    this.record({ ...request, outcome: 'authorized', at: new Date().toISOString() });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(token: string, request: GitAuthorizationRequest): void {
    const grant = this.grants.get(token);
    const same = grant && !grant.used && grant.expiresAt >= Date.now() && stable(request) === stable(grant.request);
    if (!same) {
      const outcome: GitAuditEntry['outcome'] = grant && grant.expiresAt < Date.now() ? 'expired' : 'rejected';
      this.record({ ...request, outcome, at: new Date().toISOString(), reason: 'authorization_mismatch_or_expired' });
      throw new Error(`authorization: Autorização ${outcome === 'expired' ? 'expirada' : 'ausente ou incompatível'}.`);
    }
    grant.used = true;
    this.record({ ...request, outcome: 'consumed', at: new Date().toISOString() });
  }

  audit(): readonly GitAuditEntry[] { return this.auditLog.slice(); }

  private record(entry: GitAuditEntry): void { this.auditLog.push({ ...entry, repository: hash(entry.repository) }); }
}

function stable(request: GitAuthorizationRequest): string { return JSON.stringify([request.repository, request.operation, request.risk, request.parameters, request.stateFingerprint]); }
function hash(value: string): string { return `repo:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`; }
