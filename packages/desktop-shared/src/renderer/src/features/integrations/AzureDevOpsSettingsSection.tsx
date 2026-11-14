import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/features/brain/format";

const INPUT =
  "mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AzureDevOpsSettingsSection() {
  const api = window.neuralbridge.azureDevOps;
  const [baseUrl, setBaseUrl] = useState("https://tfs.hepta.com.br/tfs");
  const [collection, setCollection] = useState("CONFEA");
  const [project, setProject] = useState("Sistema Unificado");
  const [repositoryId, setRepositoryId] = useState("");
  const [id, setId] = useState<string | null>(() =>
    localStorage.getItem("azure-devops-connection-id"),
  );
  const [status, setStatus] = useState<string>("disconnected");
  const [message, setMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [prs, setPrs] = useState<
    Array<{
      id: number;
      title: string;
      status: string;
      sourceRef: string;
      targetRef: string;
    }>
  >([]);
  const [pullRequestId, setPullRequestId] = useState("");
  const [pullRequestDetail, setPullRequestDetail] = useState<{
    title: string;
    description: string | null;
    mergeStatus: string | null;
    reviewers: string[];
  } | null>(null);
  const [threads, setThreads] = useState<
    Array<{
      id: number;
      status: string;
      comments: Array<{
        id: number;
        author: string | null;
        content: string;
        publishedAt: string | null;
      }>;
    }>
  >([]);
  const [workItemIds, setWorkItemIds] = useState("");
  const [workItems, setWorkItems] = useState<
    Array<{
      id: number;
      title: string;
      state: string;
      type: string;
      assignedTo: string | null;
    }>
  >([]);
  const [iterations, setIterations] = useState<
    Array<{
      id: string;
      name: string;
      startDate: string | null;
      finishDate: string | null;
      state: string | null;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [pat, setPat] = useState("");
  const [patConfigured, setPatConfigured] = useState(false);
  const [writeContent, setWriteContent] = useState("");
  const [writeAction, setWriteAction] = useState<"comment_pr" | "set_pr_status" | "create_work_item" | "update_work_item">("comment_pr");
  const [writeStatus, setWriteStatus] = useState<"active" | "completed" | "abandoned">("completed");
  const [writeType, setWriteType] = useState<"Task" | "User Story">("Task");
  const [writeTitle, setWriteTitle] = useState("");
  const [writeState, setWriteState] = useState("Active");
  const [writeWorkItemId, setWriteWorkItemId] = useState("");
  const [writeDraft, setWriteDraft] = useState<{
    operationId: string;
    target: string;
    summary: string;
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void api.azureDevOpsCredentialStatus(id).then((result) => { if (active) setPatConfigured(result.configured); }).catch(() => { if (active) setPatConfigured(false); });
    return () => { active = false; };
  }, [api, id]);
  const prepareWrite = async () => {
    if (!id) return;
    const number = Number(pullRequestId);
    const workItemId = Number(writeWorkItemId);
    if ((writeAction === "comment_pr" || writeAction === "set_pr_status") && (!repositoryId.trim() || !Number.isInteger(number) || number <= 0)) {
      setMessage("Informe um número de PR válido.");
      return;
    }
    if (writeAction === "comment_pr" && !writeContent.trim()) { setMessage("Escreva o comentário antes de preparar."); return; }
    if (writeAction === "create_work_item" && !writeTitle.trim()) { setMessage("Informe o título do work item."); return; }
    if (writeAction === "update_work_item" && (!Number.isInteger(workItemId) || workItemId <= 0 || !writeState.trim())) { setMessage("Informe o ID e o estado do work item."); return; }
    setBusy(true);
    setMessage(null);
    try {
      const draft = await api.azureDevOpsWritePrepare({
        id,
        request: writeAction === "comment_pr" ? { action: writeAction, repositoryId: repositoryId.trim(), pullRequestId: number, content: writeContent.trim() }
          : writeAction === "set_pr_status" ? { action: writeAction, repositoryId: repositoryId.trim(), pullRequestId: number, status: writeStatus }
          : writeAction === "create_work_item" ? { action: writeAction, type: writeType, title: writeTitle.trim(), description: writeContent.trim() }
          : { action: writeAction, workItemId, state: writeState.trim() },
      });
      setWriteDraft(draft);
      setMessage(
        "Rascunho preparado. Revise e clique em Subir/Publicar para enviar.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const executeWrite = async () => {
    if (!id || !writeDraft) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.azureDevOpsWriteExecute({
        id,
        operationId: writeDraft.operationId,
      });
      if (
        "approved" in (result as object) &&
        !(result as { approved: boolean }).approved
      )
        setMessage("Operação cancelada.");
      else {
        setWriteDraft(null);
        setWriteContent("");
        setMessage("Operação enviada após a confirmação nativa.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.azureDevOpsConnectionSave({
        baseUrl,
        collection,
        project,
        readOnly: !writeEnabled,
      });
      setId(result.id);
      localStorage.setItem("azure-devops-connection-id", result.id);
      sessionStorage.setItem("azure-devops-connection-id", result.id);
      window.dispatchEvent(
        new CustomEvent("azure-devops-connection-saved", { detail: result.id }),
      );
      setStatus(result.status);
      setMessage(
        writeEnabled
          ? "Conexão salva com escritas habilitadas; cada operação exigirá confirmação."
          : "Conexão salva em modo somente leitura.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const savePat = async () => { if (!id || !pat.trim()) return; setBusy(true); setMessage(null); try { await api.azureDevOpsCredentialSave({ id, token: pat.trim() }); setPat(""); setPatConfigured(true); setMessage("PAT cifrado e armazenado no sistema operacional; o valor não é exibido novamente."); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  const clearPat = async () => { if (!id) return; setBusy(true); setMessage(null); try { await api.azureDevOpsCredentialClear(id); setPatConfigured(false); setMessage("Credencial TFS removida."); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  const probe = async () => {
    if (!id) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.azureDevOpsProbe(id);
      setStatus(result.status);
      setMessage(
        `Capacidades detectadas: ${
          Object.entries(result.capabilities)
            .filter(([, value]) => value === true)
            .map(([key]) => key)
            .join(", ") || "nenhuma"
        }.`,
      );
    } catch (error) {
      setStatus("login_required");
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const loadProjects = async () => {
    if (!id) return;
    setBusy(true);
    try {
      setProjects(await api.azureDevOpsProjects(id));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const loadPullRequests = async () => {
    if (!id || !repositoryId.trim()) return;
    setBusy(true);
    try {
      setPrs(
        await api.azureDevOpsPullRequests({
          id,
          repositoryId: repositoryId.trim(),
        }),
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const loadWorkItems = async () => {
    if (!id) return;
    const ids = workItemIds
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      setWorkItems(await api.azureDevOpsWorkItems({ id, ids }));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const loadIterations = async () => {
    if (!id) return;
    setBusy(true);
    try {
      setIterations(await api.azureDevOpsIterations(id));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const loadPullRequestReview = async () => {
    if (!id || !repositoryId.trim()) return;
    const number = Number(pullRequestId);
    if (!Number.isInteger(number) || number <= 0) return;
    setBusy(true);
    try {
      const [detail, reviewThreads] = await Promise.all([
        api.azureDevOpsPullRequestDetail({
          id,
          repositoryId: repositoryId.trim(),
          pullRequestId: number,
        }),
        api.azureDevOpsPullRequestThreads({
          id,
          repositoryId: repositoryId.trim(),
          pullRequestId: number,
        }),
      ]);
      setPullRequestDetail(detail);
      setThreads(reviewThreads);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const openBrowser = async () => {
    if (!id) return;
    try {
      await api.azureDevOpsOpenBrowser(id);
      setMessage(
        "TFS aberto no navegador. Conclua o login HTTP Basic por lá e depois teste o acesso.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };
  return (
    <section aria-labelledby="azure-devops-heading" className="space-y-4">
      <div>
        <h2 id="azure-devops-heading" className="text-base font-medium">
          Azure DevOps / TFS
        </h2>
        <p className="mt-1 text-muted-foreground">
          Conexão local, somente leitura por padrão. O login HTTP Basic continua
          no navegador; o Singularity não armazena sua senha.
        </p>
        <label className="mt-3 flex items-start gap-2 rounded border p-3 text-sm">
          <input
            aria-label="Habilitar escritas no TFS"
            type="checkbox"
            checked={writeEnabled}
            onChange={(event) => setWriteEnabled(event.target.checked)}
          />
          <span>
            <span className="font-medium">Habilitar escritas</span>
            <span className="block text-xs text-muted-foreground">
              Cada operação ainda exigirá confirmação nativa em Subir/Publicar.
            </span>
          </span>
        </label>
        <div className="mt-3 rounded border p-3 text-sm">
          <p className="font-medium">Token/PAT opcional para TFS Server</p>
          <p className="mt-1 text-xs text-muted-foreground">Use somente se a organização não oferecer OAuth/OIDC interativo. O token é cifrado com o armazenamento seguro do sistema e nunca chega ao renderer depois de salvo.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input aria-label="PAT do TFS" type="password" autoComplete="off" className={`${INPUT} max-w-md`} value={pat} onChange={(event) => setPat(event.target.value)} placeholder="Cole o PAT e salve" />
            <Button variant="outline" onClick={() => void savePat()} disabled={busy || !id || !pat.trim()}>Salvar PAT cifrado</Button>
            <Button variant="ghost" onClick={() => void clearPat()} disabled={busy || !id || !patConfigured}>Remover PAT</Button>
          </div>
          {patConfigured && <p className="mt-2 text-xs text-success">PAT configurado (valor oculto).</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium sm:col-span-3">
          URL do TFS
          <input
            aria-label="URL do TFS"
            className={INPUT}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium">
          Collection
          <input
            aria-label="Collection do TFS"
            className={INPUT}
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Projeto
          <input
            aria-label="Projeto do TFS"
            className={INPUT}
            value={project}
            onChange={(event) => setProject(event.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void save()}
          disabled={busy || !baseUrl || !collection || !project}
        >
          {busy ? "Salvando…" : "Salvar conexão"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void openBrowser()}
          disabled={busy || !id}
        >
          Abrir TFS para login
        </Button>
        <Button
          variant="outline"
          onClick={() => void probe()}
          disabled={busy || !id}
        >
          Testar acesso
        </Button>
        <Button
          variant="outline"
          onClick={() => void loadProjects()}
          disabled={busy || !id}
        >
          Listar projetos
        </Button>
        <Button
          variant="outline"
          onClick={() => void loadIterations()}
          disabled={busy || !id}
        >
          Carregar sprint
        </Button>
      </div>
      {id && (
        <p role="status" className="text-xs text-muted-foreground">
          Status: <span className="font-medium">{status}</span> · somente
          leitura
        </p>
      )}
      {projects.length > 0 && (
        <ul
          aria-label="Projetos do TFS"
          className="space-y-1 rounded border p-3 text-sm"
        >
          {projects.map((item) => (
            <li key={item.id}>{item.name}</li>
          ))}
        </ul>
      )}
      {iterations.length > 0 && (
        <ul
          aria-label="Sprints do TFS"
          className="space-y-1 rounded border p-3 text-sm"
        >
          {iterations.map((item) => (
            <li key={item.id}>
              <span className="font-medium">{item.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {item.state ?? "sem estado"} · {item.startDate ?? "?"} →{" "}
                {item.finishDate ?? "?"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded border p-3">
        <label className="text-sm font-medium">
          ID do repositório
          <input
            aria-label="ID do repositório TFS"
            className={INPUT}
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
            placeholder="GUID ou identificador do repositório"
          />
        </label>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => void loadPullRequests()}
          disabled={busy || !id || !repositoryId.trim()}
        >
          Listar Pull Requests
        </Button>
        {prs.length > 0 && (
          <ul aria-label="Pull Requests do TFS" className="mt-3 space-y-2">
            {prs.map((item) => (
              <li key={item.id} className="rounded border p-2 text-sm">
                <span className="font-medium">
                  #{item.id} {item.title}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.status} · {item.sourceRef} → {item.targetRef}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t pt-3">
          <label className="text-sm font-medium">
            Número da PR
            <input
              aria-label="Número da Pull Request"
              className={INPUT}
              value={pullRequestId}
              onChange={(event) => setPullRequestId(event.target.value)}
              placeholder="ex.: 2532"
            />
          </label>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void loadPullRequestReview()}
            disabled={
              busy || !id || !repositoryId.trim() || !pullRequestId.trim()
            }
          >
            Abrir revisão
          </Button>
          {pullRequestDetail && (
            <div
              aria-label="Detalhe da Pull Request"
              className="mt-3 space-y-2 rounded border p-3 text-sm"
            >
              <p className="font-medium">{pullRequestDetail.title}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {pullRequestDetail.description || "Sem descrição."}
              </p>
              <p className="text-xs text-muted-foreground">
                Merge: {pullRequestDetail.mergeStatus ?? "não informado"} ·
                Revisores: {pullRequestDetail.reviewers.join(", ") || "nenhum"}
              </p>
              {threads.map((thread) => (
                <div key={thread.id} className="rounded bg-muted/30 p-2">
                  <p className="text-xs font-medium">
                    Thread #{thread.id} · {thread.status}
                  </p>
                  {thread.comments.map((comment) => (
                    <p key={comment.id} className="mt-1 text-xs">
                      <span className="font-medium">
                        {comment.author ?? "Autor desconhecido"}:
                      </span>{" "}
                      {comment.content}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {writeEnabled && (
          <div className="mt-4 rounded border border-dashed p-3">
            <p className="text-sm font-medium">Preparar operação no TFS</p>
            <p className="mt-1 text-xs text-muted-foreground">
              O texto fica como rascunho até você clicar em Subir/Publicar e
              confirmar no diálogo nativo.
            </p>
            <label className="block text-xs font-medium">Operação<select aria-label="Operação de escrita no TFS" className={INPUT} value={writeAction} onChange={(event) => setWriteAction(event.target.value as typeof writeAction)}><option value="comment_pr">Comentar na PR</option><option value="set_pr_status">Alterar status da PR</option><option value="create_work_item">Criar User Story/Task</option><option value="update_work_item">Atualizar estado da task</option></select></label>
            {(writeAction === "comment_pr" || writeAction === "create_work_item") && <textarea aria-label="Comentário para a Pull Request" className={`${INPUT} min-h-24`} value={writeContent} onChange={(event) => setWriteContent(event.target.value)} placeholder={writeAction === "comment_pr" ? "Escreva um comentário para revisar antes do envio" : "Descrição do work item"} />}
            {writeAction === "set_pr_status" && <label className="block text-xs font-medium">Status<select aria-label="Status da Pull Request" className={INPUT} value={writeStatus} onChange={(event) => setWriteStatus(event.target.value as typeof writeStatus)}><option value="active">Ativa</option><option value="completed">Concluída</option><option value="abandoned">Abandonada</option></select></label>}
            {writeAction === "create_work_item" && <label className="block text-xs font-medium">Tipo<select aria-label="Tipo do work item" className={INPUT} value={writeType} onChange={(event) => setWriteType(event.target.value as typeof writeType)}><option value="Task">Task</option><option value="User Story">User Story</option></select></label>}
            {writeAction === "create_work_item" && <label className="block text-xs font-medium">Título<input aria-label="Título do work item" className={INPUT} value={writeTitle} onChange={(event) => setWriteTitle(event.target.value)} /></label>}
            {writeAction === "update_work_item" && <><label className="block text-xs font-medium">ID da task<input aria-label="ID da task para atualizar" className={INPUT} value={writeWorkItemId} onChange={(event) => setWriteWorkItemId(event.target.value)} /></label><label className="block text-xs font-medium">Novo estado<input aria-label="Novo estado da task" className={INPUT} value={writeState} onChange={(event) => setWriteState(event.target.value)} /></label></>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void prepareWrite()}
                disabled={busy || !id}
              >
                Preparar rascunho
              </Button>
              {writeDraft && (
                <Button
                  onClick={() => void executeWrite()}
                  disabled={busy}
                >
                  Subir/Publicar
                </Button>
              )}
            </div>
            {writeDraft && (
              <p className="mt-2 text-xs text-muted-foreground">
                {writeDraft.target}: {writeDraft.summary}
              </p>
            )}
          </div>
        )}
        <label className="mt-4 block text-sm font-medium">
          IDs de tasks
          <input
            aria-label="IDs das tasks"
            className={INPUT}
            value={workItemIds}
            onChange={(event) => setWorkItemIds(event.target.value)}
            placeholder="123, 456"
          />
        </label>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => void loadWorkItems()}
          disabled={busy || !id || !workItemIds.trim()}
        >
          Listar tasks
        </Button>
        {workItems.length > 0 && (
          <ul aria-label="Tasks do TFS" className="mt-3 space-y-2">
            {workItems.map((item) => (
              <li key={item.id} className="rounded border p-2 text-sm">
                <span className="font-medium">
                  #{item.id} {item.title}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.type} · {item.state}
                  {item.assignedTo ? ` · ${item.assignedTo}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  );
}
