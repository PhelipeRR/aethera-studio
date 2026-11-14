import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

export function AzureDevOpsReviewExtras() {
  const api = window.neuralbridge.azureDevOps;
  const [connectionId, setConnectionId] = useState<string | null>(() => localStorage.getItem('azure-devops-connection-id'));
  const [repositoryId, setRepositoryId] = useState('');
  const [pullRequestId, setPullRequestId] = useState('');
  const [boards, setBoards] = useState<Array<{ id: string; name: string; url: string | null }>>([]);
  const [changes, setChanges] = useState<Array<{ path: string; changeType: string; objectId: string | null; url: string | null }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const onSaved = (event: Event) => setConnectionId((event as CustomEvent<string>).detail); window.addEventListener('azure-devops-connection-saved', onSaved); return () => window.removeEventListener('azure-devops-connection-saved', onSaved); }, []);
  const loadBoards = async () => { if (!connectionId) return; setBusy(true); setMessage(null); try { setBoards(await api.azureDevOpsBoards(connectionId)); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  const loadChanges = async () => { const id = Number(pullRequestId); if (!connectionId || !repositoryId.trim() || !Number.isInteger(id) || id <= 0) return; setBusy(true); setMessage(null); try { setChanges(await api.azureDevOpsPullRequestChanges({ id: connectionId, repositoryId: repositoryId.trim(), pullRequestId: id })); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  return <section aria-labelledby="azure-devops-review-extras" className="space-y-3 sg-panel rounded-lg p-4"><div><h3 id="azure-devops-review-extras" className="font-medium">Boards e arquivos da PR</h3><p className="text-xs text-muted-foreground">Consultas somente leitura da conexão TFS salva nesta sessão.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void loadBoards()} disabled={busy || !connectionId}>Listar boards</Button><input aria-label="Repositório para arquivos da PR" className="rounded-md border bg-background px-3 py-2 text-sm" placeholder="ID do repositório" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} /><input aria-label="PR para arquivos alterados" className="w-28 rounded-md border bg-background px-3 py-2 text-sm" placeholder="PR" value={pullRequestId} onChange={(event) => setPullRequestId(event.target.value)} /><Button variant="outline" onClick={() => void loadChanges()} disabled={busy || !connectionId || !repositoryId.trim() || !pullRequestId.trim()}>Arquivos alterados</Button></div>{boards.length > 0 && <ul aria-label="Boards do TFS" className="space-y-1 rounded border p-3 text-sm">{boards.map((board) => <li key={board.id}>{board.name}</li>)}</ul>}{changes.length > 0 && <ul aria-label="Arquivos alterados da PR" className="space-y-1 rounded border p-3 text-sm">{changes.map((change) => <li key={`${change.path}-${change.objectId ?? ''}`}><span className="font-medium">{change.changeType}</span><span className="ml-2">{change.path}</span></li>)}</ul>}{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</section>;
}
