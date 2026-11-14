import {
  azureDevOpsCapabilitiesSchema,
  type AzureDevOpsBoard,
  type AzureDevOpsCapabilities,
  type AzureDevOpsConnectionInput,
  type AzureDevOpsError,
  type AzureDevOpsProject,
  type AzureDevOpsRepository,
  type AzureDevOpsPullRequest,
  type AzureDevOpsPullRequestChange,
  type AzureDevOpsPullRequestDetail,
  type AzureDevOpsPullRequestThread,
  type AzureDevOpsWorkItem,
  type AzureDevOpsWorkItemAttachment,
} from "@neuralbridge/shared";
import { currentCorrelationId } from "../correlation.js";

export type AzureDevOpsHttp = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
export type AzureDevOpsClientOptions = {
  http?: AzureDevOpsHttp;
  writeHttp?: AzureDevOpsHttp;
  apiVersion?: string;
  signal?: AbortSignal;
  authorization?: string | null;
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends the current correlation id as `X-TFS-Session`, the activity id Azure DevOps Server records in its
 * own logs, so a request seen by the server can be traced back to the NeuralBridge task that made it.
 */
function correlated(http: AzureDevOpsHttp): AzureDevOpsHttp {
  return (url, init = {}) => {
    const id = currentCorrelationId();
    if (!id || !GUID.test(id)) return http(url, init);
    return http(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-tfs-session": id } });
  };
}

export class AzureDevOpsClient {
  private readonly http: AzureDevOpsHttp;
  private readonly version: string;
  private readonly signal: AbortSignal | undefined;
  private readonly writeHttp: AzureDevOpsHttp;
  private readonly writesEnabled: boolean;
  private readonly authorization: string | null;
  constructor(
    private readonly connection: AzureDevOpsConnectionInput,
    options: AzureDevOpsClientOptions = {},
  ) {
    this.http = correlated(options.http ?? fetch);
    this.writeHttp = options.writeHttp ? correlated(options.writeHttp) : this.http;
    this.version = options.apiVersion ?? "7.1";
    this.signal = options.signal;
    this.writesEnabled = !connection.readOnly;
    this.authorization = options.authorization ?? null;
  }
  private url(path: string, query: Record<string, string> = {}): string {
    const params = new URLSearchParams({
      "api-version": this.version,
      ...query,
    });
    return `${this.connection.baseUrl}/${this.connection.collection}/${encodeURIComponent(this.connection.project)}${path}?${params}`;
  }
  private collectionUrl(path: string, query: Record<string, string> = {}): string {
    const params = new URLSearchParams({ "api-version": this.version, ...query });
    return `${this.connection.baseUrl}/${this.connection.collection}${path}?${params}`;
  }
  private async getPage<T>(
    path: string,
    query: Record<string, string> = {},
  ): Promise<{ body: T; continuationToken: string | null }> {
    const response = await this.http(this.url(path, query), {
      method: "GET",
      ...(this.authorization ? { headers: { authorization: this.authorization } } : {}),
      ...(this.signal ? { signal: this.signal } : {}),
    });
    if (!response.ok) {
      const error: AzureDevOpsError = {
        code:
          response.status === 401
            ? "login_required"
            : response.status === 403
              ? "forbidden"
              : response.status === 404
                ? "not_found"
                : "request_failed",
        message: response.statusText || "Falha no TFS.",
        status: response.status,
      };
      throw Object.assign(new Error(error.message), { azureDevOps: error });
    }
    return {
      body: (await response.json()) as T,
      continuationToken:
        response.headers.get("x-ms-continuationtoken") ??
        response.headers.get("x-ms-continuation-token"),
    };
  }
  private async get<T>(
    path: string,
    query: Record<string, string> = {},
  ): Promise<T> {
    return (await this.getPage<T>(path, query)).body;
  }
  private async getText(path: string, query: Record<string, string>): Promise<string | null> {
    const response = await this.http(this.url(path, query), {
      method: "GET",
      ...(this.authorization ? { headers: { authorization: this.authorization } } : {}),
      ...(this.signal ? { signal: this.signal } : {}),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw Object.assign(new Error(response.statusText || "Falha no TFS."), { azureDevOps: { code: response.status === 401 ? "login_required" : response.status === 403 ? "forbidden" : "request_failed", message: response.statusText || "Falha no TFS.", status: response.status } });
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { content?: unknown };
      return typeof parsed.content === "string" ? parsed.content : text;
    } catch {
      return text;
    }
  }
  private unifiedDiff(path: string, before: string | null, after: string | null): string | null {
    if (before === null && after === null) return null;
    const oldLines = (before ?? "").split(/\r?\n/);
    const newLines = (after ?? "").split(/\r?\n/);
    const lines = [`--- a${path}`, `+++ b${path}`];
    const max = Math.max(oldLines.length, newLines.length);
    let changed = false;
    for (let index = 0; index < max; index += 1) {
      const oldLine = oldLines[index];
      const newLine = newLines[index];
      if (oldLine === newLine) {
        lines.push(` ${oldLine ?? ""}`);
      } else {
        if (oldLine !== undefined) lines.push(`-${oldLine}`);
        if (newLine !== undefined) lines.push(`+${newLine}`);
        changed = true;
      }
    }
    return changed ? lines.join("\n") : null;
  }
  private async getCollection<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const response = await this.http(this.collectionUrl(path, query), { method: "GET", ...(this.authorization ? { headers: { authorization: this.authorization } } : {}), ...(this.signal ? { signal: this.signal } : {}) });
    if (!response.ok) throw Object.assign(new Error(response.statusText || "Falha no TFS."), { azureDevOps: { code: response.status === 401 ? "login_required" : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "request_failed", message: response.statusText || "Falha no TFS.", status: response.status } });
    return (await response.json()) as T;
  }
  async getWorkItemAttachment(attachmentId: string): Promise<{ name: string; contentType: string; data: string }> {
    if (!/^[0-9a-f-]{8,}$/i.test(attachmentId)) throw new Error("Anexo TFS inválido.");
    const response = await this.http(this.collectionUrl(`/_apis/wit/attachments/${encodeURIComponent(attachmentId)}`, { download: "true" }), { method: "GET", ...(this.authorization ? { headers: { authorization: this.authorization } } : {}), ...(this.signal ? { signal: this.signal } : {}) });
    if (!response.ok) throw Object.assign(new Error(response.statusText || "Falha ao buscar anexo no TFS."), { azureDevOps: { code: response.status === 401 ? "login_required" : response.status === 403 ? "forbidden" : "request_failed", message: response.statusText || "Falha ao buscar anexo no TFS.", status: response.status } });
    const contentType = ((response.headers.get("content-type") ?? "").split(";", 1)[0] ?? "").trim().toLowerCase();
    if (!contentType.startsWith("image/")) throw new Error("Somente anexos de imagem podem ser exibidos.");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 8 * 1024 * 1024) throw new Error("Imagem anexada excede o limite de 8 MB.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Imagem anexada excede o limite de 8 MB.");
    const name = response.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1] ?? "anexo";
    return { name: decodeURIComponent(name), contentType, data: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` };
  }
  private async getAllCollectionValues<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    let continuationToken: string | null = null;
    do {
      const response = await this.http(this.collectionUrl(path, continuationToken ? { continuationToken } : {}), { method: "GET", ...(this.authorization ? { headers: { authorization: this.authorization } } : {}), ...(this.signal ? { signal: this.signal } : {}) });
      if (!response.ok) throw Object.assign(new Error(response.statusText || "Falha no TFS."), { azureDevOps: { code: response.status === 401 ? "login_required" : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "request_failed", message: response.statusText || "Falha no TFS.", status: response.status } });
      const body = (await response.json()) as { value?: T[] };
      values.push(...(body.value ?? []));
      continuationToken = response.headers.get("x-ms-continuationtoken") ?? response.headers.get("x-ms-continuation-token");
    } while (continuationToken);
    return values;
  }
  private async write<T>(
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
    contentType = "application/json",
  ): Promise<T> {
    if (!this.writesEnabled)
      throw Object.assign(new Error("Conexão TFS em modo somente leitura."), {
        azureDevOps: {
          code: "read_only",
          message: "Conexão TFS em modo somente leitura.",
          status: null,
        },
      });
    const response = await this.writeHttp(this.url(path), {
      method,
      headers: { "content-type": contentType, ...(this.authorization ? { authorization: this.authorization } : {}) },
      body: JSON.stringify(body),
      ...(this.signal ? { signal: this.signal } : {}),
    });
    if (!response.ok) {
      const error: AzureDevOpsError = {
        code:
          response.status === 401
            ? "login_required"
            : response.status === 403
              ? "forbidden"
              : response.status === 404
                ? "not_found"
                : "request_failed",
        message: response.statusText || "Falha ao gravar no TFS.",
        status: response.status,
      };
      throw Object.assign(new Error(error.message), { azureDevOps: error });
    }
    return (await response.json()) as T;
  }
  private async getAllValues<T>(
    path: string,
    query: Record<string, string> = {},
  ): Promise<T[]> {
    const values: T[] = [];
    let continuationToken: string | null = null;
    do {
      const page: { body: { value?: T[] }; continuationToken: string | null } =
        await this.getPage<{ value?: T[] }>(
          path,
          continuationToken ? { ...query, continuationToken } : query,
        );
      values.push(...(page.body.value ?? []));
      continuationToken = page.continuationToken;
    } while (continuationToken);
    return values;
  }
  async capabilities(): Promise<AzureDevOpsCapabilities> {
    const checks = await Promise.allSettled([
      this.getCollection<{ value?: unknown[] }>("/_apis/projects"),
      this.getCollection<{ value?: unknown[] }>("/_apis/git/repositories"),
      this.get<{ value?: unknown[] }>("/_apis/wit/workitems", { ids: "" }),
      this.get<{ value?: unknown[] }>("/_apis/work/teamsettings/iterations"),
    ]);
    const ok = (index: number) => checks[index]?.status === "fulfilled";
    const first = checks.find((item) => item.status === "fulfilled");
    // Nothing answered: the connection is not usable, so the probe fails with the translated reason
    // (login_required, forbidden...) instead of reporting "connected" with every capability off.
    if (!first) {
      const failure = checks.find((item): item is PromiseRejectedResult => item.status === "rejected");
      throw failure?.reason ?? new Error("Falha ao consultar o TFS.");
    }
    const apiVersion = first ? this.version : null;
    return azureDevOpsCapabilitiesSchema.parse({
      apiVersion,
      projects: ok(0),
      repositories: ok(1),
      pullRequests: ok(1),
      workItems: ok(2),
      boards: ok(3),
      iterations: ok(3),
    });
  }
  async listProjects(): Promise<AzureDevOpsProject[]> {
    const result = await this.getAllCollectionValues<{
      id: string;
      name: string;
      url?: string;
      state?: string;
    }>("/_apis/projects");
    return result.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url ?? null,
      state: item.state ?? null,
    }));
  }
  async listRepositories(): Promise<AzureDevOpsRepository[]> {
    const result = await this.getAllCollectionValues<{ id: string; name: string; url?: string; project?: { id?: string; name?: string } }>("/_apis/git/repositories");
    return result.map((item) => ({ id: item.id, name: item.name, url: item.url ?? null, projectId: item.project?.id ?? null, projectName: item.project?.name ?? null }));
  }
  async listBoards(): Promise<AzureDevOpsBoard[]> {
    const result = await this.getAllValues<{
      id: string;
      name: string;
      url?: string;
    }>("/_apis/work/boards");
    return result.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url ?? null,
    }));
  }
  async listPullRequests(
    repositoryId: string,
    status = "active",
  ): Promise<AzureDevOpsPullRequest[]> {
    const result = await this.getAllValues<{
      pullRequestId: number;
      title: string;
      status: string;
      createdBy?: { displayName?: string };
      sourceRefName: string;
      targetRefName: string;
      url?: string;
      creationDate?: string;
      closedDate?: string;
    }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests`,
      { "searchCriteria.status": status },
    );
    return result.map((item) => ({
      id: item.pullRequestId,
      title: item.title,
      status: item.status,
      createdBy: item.createdBy?.displayName ?? null,
      sourceRef: item.sourceRefName,
      targetRef: item.targetRefName,
      url: item.url ?? null,
      updatedAt: item.closedDate ?? item.creationDate ?? null,
    }));
  }
  async getWorkItems(ids: number[]): Promise<AzureDevOpsWorkItem[]> {
    if (ids.length === 0) return [];
    const result = await this.get<{
      value?: Array<{
        id: number;
        fields?: Record<string, unknown>;
        url?: string;
        relations?: Array<{ rel?: string; url?: string; attributes?: { name?: string; resourceSize?: number; resourceSizeBytes?: number; contentType?: string } }>;
      }>;
    }>("/_apis/wit/workitems", { ids: ids.slice(0, 200).join(","), "$expand": "relations", fields: ["System.Title", "System.Description", "Microsoft.VSTS.Common.Description", "Microsoft.VSTS.TCM.ReproSteps", "System.ReproSteps", "System.AcceptanceCriteria", "Custom.Description", "System.State", "System.WorkItemType", "System.Parent", "System.AssignedTo", "Microsoft.VSTS.Scheduling.OriginalEstimate", "Microsoft.VSTS.Scheduling.RemainingWork", "Microsoft.VSTS.Scheduling.CompletedWork"].join(",") });
    return (result.value ?? []).map((item) => ({
      id: item.id,
      title:
        typeof item.fields?.["System.Title"] === "string"
          ? item.fields["System.Title"]
          : `Work item #${item.id}`,
      description:
        ["System.Description", "Microsoft.VSTS.Common.Description", "Microsoft.VSTS.TCM.ReproSteps", "System.ReproSteps", "System.AcceptanceCriteria", "Custom.Description"]
          .map((field) => item.fields?.[field])
          .find((value): value is string => typeof value === "string") ?? null,
      state:
        typeof item.fields?.["System.State"] === "string"
          ? item.fields["System.State"]
          : "unknown",
      type:
        typeof item.fields?.["System.WorkItemType"] === "string"
          ? item.fields["System.WorkItemType"]
          : "unknown",
      parentId: typeof item.fields?.["System.Parent"] === "number" ? item.fields["System.Parent"] : null,
      originalEstimate: typeof item.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"] === "number" ? item.fields["Microsoft.VSTS.Scheduling.OriginalEstimate"] : null,
      remainingWork: typeof item.fields?.["Microsoft.VSTS.Scheduling.RemainingWork"] === "number" ? item.fields["Microsoft.VSTS.Scheduling.RemainingWork"] : null,
      completedWork: typeof item.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"] === "number" ? item.fields["Microsoft.VSTS.Scheduling.CompletedWork"] : null,
      commits: (item.relations ?? [])
        .filter((relation) => relation.rel?.toLowerCase().includes("artifactlink") && typeof relation.url === "string")
        .map((relation) => ({ id: relation.url?.split("/").pop() ?? "", message: relation.attributes?.name ?? "Commit vinculado", url: relation.url ?? null }))
        .filter((commit) => commit.id.length > 0),
      attachments: (item.relations ?? [])
        .filter((relation) => relation.rel?.toLowerCase() === "attachedfile" && typeof relation.url === "string")
        .map((relation): AzureDevOpsWorkItemAttachment | null => {
          const id = relation.url?.split("/").pop() ?? "";
          return id ? { id, name: relation.attributes?.name ?? "Anexo", contentType: relation.attributes?.contentType ?? null, size: typeof relation.attributes?.resourceSizeBytes === "number" ? relation.attributes.resourceSizeBytes : typeof relation.attributes?.resourceSize === "number" ? relation.attributes.resourceSize : null } : null;
        })
        .filter((attachment): attachment is AzureDevOpsWorkItemAttachment => attachment !== null),
      assignedTo:
        typeof item.fields?.["System.AssignedTo"] === "object" &&
        item.fields["System.AssignedTo"]
          ? String(
              (item.fields["System.AssignedTo"] as { displayName?: unknown })
                .displayName ?? "",
            ) || null
          : null,
      url: item.url ?? null,
    }));
  }
  async queryWorkItems(type: string, iterationPath?: string | null, parentId?: number | null): Promise<AzureDevOpsWorkItem[]> {
    const typeClause = type === "User Story" ? "[System.WorkItemType] IN ('User Story', 'Product Backlog Item')" : `[System.WorkItemType] = '${type.replaceAll("'", "''")}'`;
    const iterationClause = iterationPath ? ` AND [System.IterationPath] = '${iterationPath.replaceAll("'", "''")}'` : "";
    const parentClause = parentId ? ` AND [System.Parent] = ${parentId}` : "";
    const response = await this.http(this.url("/_apis/wit/wiql"), { method: "POST", headers: { "content-type": "application/json", ...(this.authorization ? { authorization: this.authorization } : {}) }, body: JSON.stringify({ query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${typeClause}${iterationClause}${parentClause} ORDER BY [System.ChangedDate] DESC` }) });
    if (!response.ok) throw Object.assign(new Error(response.statusText || "Falha no backlog."), { azureDevOps: { code: response.status === 401 ? "login_required" : "request_failed", message: response.statusText || "Falha no backlog.", status: response.status } });
    const body = (await response.json()) as { workItems?: Array<{ id: number }> };
    return this.getWorkItems((body.workItems ?? []).slice(0, 200).map((item) => item.id));
  }
  async listIterations(): Promise<
    Array<{
      id: string;
      name: string;
      path: string | null;
      startDate: string | null;
      finishDate: string | null;
      state: string | null;
    }>
  > {
    const result = await this.getAllValues<{
      id: string;
      name: string;
      path?: string;
      attributes?: {
        startDate?: string;
        finishDate?: string;
        timeFrame?: string;
      };
    }>("/_apis/work/teamsettings/iterations");
    return result.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path ?? null,
      startDate: item.attributes?.startDate ?? null,
      finishDate: item.attributes?.finishDate ?? null,
      state: item.attributes?.timeFrame ?? null,
    }));
  }
  async pullRequestDetail(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<AzureDevOpsPullRequestDetail> {
    const item = await this.get<{
      pullRequestId: number;
      title: string;
      status: string;
      createdBy?: { displayName?: string };
      sourceRefName: string;
      targetRefName: string;
      url?: string;
      creationDate?: string;
      closedDate?: string;
      description?: string;
      mergeStatus?: string;
      reviewers?: Array<{ displayName?: string }>;
    }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}`,
    );
    return {
      id: item.pullRequestId,
      title: item.title,
      status: item.status,
      createdBy: item.createdBy?.displayName ?? null,
      sourceRef: item.sourceRefName,
      targetRef: item.targetRefName,
      url: item.url ?? null,
      updatedAt: item.closedDate ?? item.creationDate ?? null,
      description: item.description ?? null,
      mergeStatus: item.mergeStatus ?? null,
      reviewers: (item.reviewers ?? [])
        .map((reviewer) => reviewer.displayName)
        .filter((name): name is string => typeof name === "string"),
    };
  }
  async pullRequestThreads(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<AzureDevOpsPullRequestThread[]> {
    const result = await this.get<{
      value?: Array<{
        id: number;
        status?: string;
        comments?: Array<{
          id: number;
          author?: { displayName?: string };
          content?: string;
          publishedDate?: string;
        }>;
      }>;
    }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads`,
    );
    return (result.value ?? []).map((thread) => ({
      id: thread.id,
      status: thread.status ?? "unknown",
      comments: (thread.comments ?? []).map((comment) => ({
        id: comment.id,
        author: comment.author?.displayName ?? null,
        content: comment.content ?? "",
        publishedAt: comment.publishedDate ?? null,
      })),
    }));
  }
  async pullRequestChanges(
    repositoryId: string,
    pullRequestId: number,
  ): Promise<AzureDevOpsPullRequestChange[]> {
    const detail = await this.get<{
      lastMergeSourceCommit?: { commitId?: string };
      lastMergeTargetCommit?: { commitId?: string };
    }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}`,
    );
    const result = await this.get<{
      changeEntries?: Array<{
        item?: { path?: string; objectId?: string; url?: string };
        newContent?: { content?: string; contentType?: string } | string;
        content?: string;
        changeType?: string;
      }>;
    }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/iterations/1/changes`,
      { includeContent: "true" },
    );
    const entries = result.changeEntries ?? [];
    const sourceCommit = detail.lastMergeSourceCommit?.commitId;
    const targetCommit = detail.lastMergeTargetCommit?.commitId;
    const hydrateLimit = 12;
    return await Promise.all(entries.map(async (entry, index) => {
      const path = entry.item?.path ?? "(caminho desconhecido)";
      let content = typeof entry.newContent === "string"
        ? entry.newContent
        : typeof entry.newContent?.content === "string"
          ? entry.newContent.content
          : typeof entry.content === "string"
            ? entry.content
            : null;
      let baseContent: string | null = null;
      let targetContent: string | null = null;
      if (index < hydrateLimit && sourceCommit && targetCommit && path !== "(caminho desconhecido)") {
        const [target, base] = await Promise.all([
          this.getText(`/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items`, { path, "versionDescriptor.version": targetCommit, "versionDescriptor.versionType": "commit", includeContent: "true" }),
          this.getText(`/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items`, { path, "versionDescriptor.version": sourceCommit, "versionDescriptor.versionType": "commit", includeContent: "true" }),
        ]);
        baseContent = base;
        targetContent = target;
        content = this.unifiedDiff(path, base, target) ?? content;
      }
      return {
      path: entry.item?.path ?? "(caminho desconhecido)",
      changeType: entry.changeType ?? "unknown",
      objectId: entry.item?.objectId ?? null,
      url: entry.item?.url ?? null,
      content,
      baseContent,
      targetContent,
      };
    }));
  }
  async commentPullRequest(
    repositoryId: string,
    pullRequestId: number,
    content: string,
  ): Promise<{ id: number }> {
    const result = await this.write<{ id: number }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads`,
      "POST",
      { comments: [{ content }], status: "active" },
    );
    return { id: result.id };
  }
  async setPullRequestStatus(
    repositoryId: string,
    pullRequestId: number,
    status: "active" | "completed" | "abandoned",
  ): Promise<{ pullRequestId: number; status: string }> {
    const result = await this.write<{ pullRequestId: number; status: string }>(
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}`,
      "PATCH",
      { status },
    );
    // Only the fields the app shows: the provider's full pull request (identities, links) stays here.
    return { pullRequestId: result.pullRequestId, status: result.status };
  }
  async createWorkItem(
    type: "Task" | "User Story",
    title: string,
    description: string,
    parentId?: number | null,
  ): Promise<{ id: number; url: string | null }> {
    const result = await this.write<{ id: number; url?: string }>(
      `/_apis/wit/workitems/$${encodeURIComponent(type)}`,
      "POST",
      [
        { op: "add", path: "/fields/System.Title", value: title },
        { op: "add", path: "/fields/System.Description", value: description },
        ...(parentId ? [{ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${this.url("/_apis/wit/workitems")}/${parentId}` } }] : []),
      ],
      "application/json-patch+json",
    );
    return { id: result.id, url: result.url ?? null };
  }
  async updateWorkItem(
    id: number,
    fields: { title?: string; description?: string; state?: string },
  ): Promise<{ id: number }> {
    const result = await this.write<{ id: number }>(
      `/_apis/wit/workitems/${id}`,
      "PATCH",
      Object.entries(fields).map(([key, value]) => ({ op: "add", path: `/fields/System.${key === "title" ? "Title" : key === "description" ? "Description" : "State"}`, value })),
      "application/json-patch+json",
    );
    return { id: result.id };
  }
  async updateWorkItemState(id: number, state: string): Promise<{ id: number }> { return this.updateWorkItem(id, { state }); }
}
