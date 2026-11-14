# TFS Work Item AI Assistance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich TFS Bugs, Tasks and User Stories with secure attachment previews, complete work-item context, and an approval-gated AI workflow for code proposals and Task creation.

**Architecture:** Keep TFS authentication and attachment fetching in the Electron main process. Expose only validated, bounded metadata and image data to the renderer. Reuse the existing project list, TaskEngine read-only execution, Git patch authorization/application, and TFS prepare/execute write approval instead of creating parallel mutation paths.

**Tech Stack:** TypeScript, Electron IPC, Zod, React, TanStack Query, Azure DevOps/TFS REST APIs, existing Git and TaskEngine services.

**Spec:** User request in the current conversation: TFS attachments/images, AI proposal for Bugs and User Stories, project selection/detection, reviewed diff/plan, explicit approval, and reviewed Task creation.

## Global Constraints

- Never expose TFS tokens, cookies, attachment URLs, or credentials to the renderer, logs, or telemetry.
- AI analysis is read-only and must not mutate a project or TFS work item.
- Code changes require an explicit project selection and a second explicit approval before patch application.
- TFS writes use the existing prepare/approve/execute flow and remain auditable.
- Preserve existing PR review, `videoProductionRunRender`, and read-only Azure/TFS flows.
- Bound attachment size, image count, prompt size, and returned proposal size.
- Preserve HTML/Markdown descriptions and sanitize rendered HTML in the renderer.

## Review Focus

- A work item with `AttachedFile` relations must show only safe image thumbnails; non-image files remain labeled without being fetched into the renderer.
- A TFS description can be HTML, Markdown, empty, or contain tables/images; it must render safely and retain structure.
- A large PR/work item must not freeze or resize the page; every modal section has bounded internal scrolling.
- A project proposal must remain read-only until patch approval, and an invalid/stale patch must be rejected before application.
- Suggested Tasks must preserve the selected parent US and require a final approval before each TFS write.

---

### Task 1: Secure Work Item Context and Attachments

**Files:**
- Modify: `packages/orchestrator/src/integrations/azure-devops-client.ts`
- Modify: `packages/shared/src/azure-devops.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/channels.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `packages/orchestrator/test/azure-devops-client.test.ts`

**Interfaces:**
- Produces `AzureDevOpsWorkItem.attachments: Array<{ id: string; name: string; contentType: string | null; size: number | null }>`.
- Produces `azureDevOpsWorkItemAttachment({ id, workItemId, attachmentId }): Promise<{ name: string; contentType: string; data: string }>` where `data` is a bounded image data URL created in the main process.

- [ ] Write client tests for `AttachedFile` relation mapping, non-image metadata, and bounded image response handling.
- [ ] Add explicit attachment metadata to the work-item REST projection without returning the remote URL to the renderer.
- [ ] Add a main-process attachment fetch that uses the authenticated Azure client, accepts only image media types, enforces a byte limit, and returns a safe data URL.
- [ ] Add strict IPC schemas and preload exposure for the metadata and attachment method.
- [ ] Run the focused Azure client tests and typecheck.

### Task 2: Imported Projects and AI Proposal Contract

**Files:**
- Modify: `packages/shared/src/azure-devops.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/channels.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/features/integrations/AzureDevOpsSprintBoard.tsx`
- Test: `apps/desktop/src/renderer/src/features/integrations/AzureDevOpsSprintBoard.test.tsx` or the project’s existing UI test location

**Interfaces:**
- Consumes `window.neuralbridge.projects.list()` and existing `useStartTask`.
- Produces a typed `AzureDevOpsAiProposal` containing `summary`, `plan`, `projects`, `files`, `patch`, and `suggestedTasks`.

- [ ] Add a project selector populated from imported Neura projects, including an explicit “detectar projetos” option for US analysis.
- [ ] Define the proposal schema with bounded strings, project IDs, relevant files, optional unified patch, and suggested TFS Tasks.
- [ ] Build a read-only prompt containing work-item HTML/Markdown description, state, criteria, metrics, commits, safe attachment data, selected/detected projects, and relevant file context.
- [ ] Start the proposal through the existing TaskEngine with `access: 'read-only'`; normalize the response into the strict proposal schema.
- [ ] Test that missing project selection blocks code-fix proposals, while US planning may request project detection without writing.

### Task 3: Bug/Task/US Modal Experience

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/integrations/AzureDevOpsSprintBoard.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Create or modify: focused renderer component/test files if the current monolithic board file permits extraction

**Interfaces:**
- Consumes Task 1 work-item context and Task 2 proposal contract.
- Produces modal actions: `Analisar e propor correção com IA`, `Sugerir desenvolvimento`, `Detectar projetos`, `Preparar criação das Tasks`, and `Aprovar e aplicar`.

- [ ] Render descriptions through the existing safe Markdown/HTML renderer, preserving tables and explicit empty states.
- [ ] Load image attachments lazily, show bounded thumbnails, and open a separate enlarged-image modal without exposing TFS URLs.
- [ ] Show work-item metrics and commits in the edit modal, with consistent Bug/Task/US tags and internal card scroll only.
- [ ] Add AI provider selection locally to the modal and show loading, error, plan, file list, proposed diff, and suggested Tasks in the same modal.
- [ ] Make suggested Tasks editable/checkable before creation and preserve US parentage.
- [ ] Add UI tests for attachment thumbnails, modal overflow, proposal rendering, and explicit approval controls.

### Task 4: Safe Patch and TFS Task Creation

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/integrations/AzureDevOpsSprintBoard.tsx`
- Modify: `packages/shared/src/azure-devops.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `packages/orchestrator/test/azure-devops-client.test.ts` and renderer integration tests

**Interfaces:**
- Consumes `AzureDevOpsAiProposal` and existing `projects.authorizePatch/applyPatch` plus `azureDevOpsWritePrepare/Execute`.
- Produces one approved patch application and one auditable prepare/execute operation per selected suggested Task.

- [ ] Validate proposed unified diff against the selected project before presenting the approval action; reject malformed, empty, or stale patches.
- [ ] Create a review branch/patch proposal using existing Git authorization primitives, without commit/push by default.
- [ ] Require explicit approval before applying the patch, and show the exact project and files affected.
- [ ] Prepare selected TFS Task creations with the selected US as parent, display the operations, and execute only after the final approval.
- [ ] Test that canceling or closing the modal leaves both project files and TFS unchanged.

### Task 5: End-to-End Verification and Documentation

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `docs/STATUS.md`
- Modify: `packages/orchestrator/test/azure-devops-client.test.ts`
- Add/update: Playwright or renderer integration tests for the modal flow

- [ ] Run focused unit tests, renderer typecheck, ESLint, and the critical UI flow.
- [ ] With an authenticated TFS session, verify real work-item description/attachments, read-only proposal, prepared Task creation, and persistence only after approval.
- [ ] Record commands, results, and any environment-only blockers in `docs/PLAN.md` and `docs/STATUS.md`.
- [ ] Mark only verified criteria complete; leave real-TFS validation pending if the user session is not authenticated.
