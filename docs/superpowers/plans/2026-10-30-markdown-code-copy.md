# Markdown Code Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an accessible copy action to every Markdown code block rendered in chat.

**Architecture:** Keep the behavior in `MarkdownView`, where fenced Markdown code is rendered. Use the existing clipboard pattern from `McpPage`, with local transient copied state and no backend changes.

**Tech Stack:** React, TypeScript, react-markdown, lucide-react, Vitest/Testing Library if available.

**Spec:** `docs/superpowers/specs/2026-10-30-markdown-code-copy-design.md`

## Global Constraints

- Copy only the code content, without Markdown fences.
- Preserve existing Markdown rendering and visual style.
- Use an accessible button with Portuguese labels `Copiar` and `Copiado`.
- Do not add dependencies or change backend behavior.

## Review Focus

- Empty code blocks should remain valid and copy an empty string.
- Multiline content and trailing newlines must be copied unchanged.
- Clipboard rejection must not show false success.
- Multiple code blocks must keep independent copied states.
- The action must be keyboard reachable and have an accessible label.

### Task 1: Add copy behavior to Markdown code blocks

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/brain/MarkdownView.tsx`
- Test: `apps/desktop/test/markdown-view.test.tsx` (or the existing renderer test location discovered before editing)

**Interfaces:**
- Consumes: `react-markdown` `code` renderer props and `navigator.clipboard.writeText`.
- Produces: A code block with an accessible copy button and transient `Copiado` feedback.

- [ ] **Step 1: Write the failing test**

Render a fenced multiline code block, click `button` named `Copiar`, assert `navigator.clipboard.writeText` received the exact code content, and assert the button changes to `Copiado`. Include an assertion that multiple blocks expose separate copy buttons.

- [ ] **Step 2: Run the focused test to verify it fails**

Run the repository's existing Vitest command for the new test file. Expected: failure because `MarkdownView` currently has no copy button.

- [ ] **Step 3: Implement the minimal renderer change**

Add a local `CopyCodeButton` component and a `code` renderer in `MarkdownView`. Use `useState`, `navigator.clipboard.writeText`, and the existing button/icon conventions. Wrap the `<code>` element in a relatively positioned container and place the button in the top-right without changing the code text.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same focused Vitest command. Expected: PASS.

- [ ] **Step 5: Run the relevant renderer/type checks**

Run the repository's desktop test, lint, typecheck, and build commands as available from `package.json`; confirm no regressions and inspect `git diff --check`.

