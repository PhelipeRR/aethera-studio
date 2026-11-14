import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { freshDataDir, launchApp } from "./app";
import { largestJump, sampleMascotPath } from "./companion-motion-probe";

const MAX_FRAME_JUMP = 60;

async function findHud(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(() =>
      app.windows().some((page) => page.url().includes("companion=hud")),
    )
    .toBe(true);
  const hud = app
    .windows()
    .find((page) => page.url().includes("companion=hud"));
  if (!hud) throw new Error("HUD window not found");
  await expect(
    hud.getByRole("main", { name: "Singularity Companion" }),
  ).toBeVisible();
  return hud;
}

const seeded = (mode = "mascot") => {
  const dataDir = freshDataDir();
  writeFileSync(
    join(dataDir, "preferences.json"),
    JSON.stringify({
      theme: "dark",
      companionHud: {
        visible: true,
        x: null,
        y: null,
        mode,
        alwaysOnTop: true,
      },
    }),
  );
  return dataDir;
};
const mascotBox = (hud: Page) =>
  hud.locator(".companion-mascot").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { x: window.screenX + box.left, y: window.screenY + box.top };
  });
const toCompact = (hud: Page) => hud.locator(".companion-mascot").click();
const toPanel = (hud: Page) =>
  hud.locator(".companion-capsule__toggle").click();
const settle = (hud: Page) => hud.waitForTimeout(700);

test("keeps the mascot continuous from mascot to panel at the default anchor", async () => {
  const { app } = await launchApp(seeded());
  const hud = await findHud(app);
  const first = sampleMascotPath(hud, 700);
  await toCompact(hud);
  expect(largestJump(await first)).toBeLessThan(MAX_FRAME_JUMP);
  const second = sampleMascotPath(hud, 700);
  await toPanel(hud);
  expect(largestJump(await second)).toBeLessThan(MAX_FRAME_JUMP);
  await app.close();
});
test("returns the mascot to the exact anchor after collapsing", async () => {
  const { app } = await launchApp(seeded());
  const hud = await findHud(app);
  await settle(hud);
  const before = await mascotBox(hud);
  await toCompact(hud);
  await settle(hud);
  await toPanel(hud);
  await settle(hud);
  await hud.keyboard.press("Escape");
  await settle(hud);
  await toCompact(hud);
  await settle(hud);
  const after = await mascotBox(hud);
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
  await app.close();
});

test("ends in the last requested mode after rapid clicks", async () => {
  const { app, dataDir } = await launchApp(seeded());
  const hud = await findHud(app);
  const errors: string[] = [];
  hud.on("pageerror", (error) => errors.push(error.message));
  for (let index = 0; index < 11; index += 1) {
    await toCompact(hud);
    await hud.waitForTimeout(40);
  }
  await settle(hud);
  await expect(hud.locator("main")).toHaveClass(/companion-hud--compact/);
  await expect(hud.locator(".companion-capsule")).toHaveCount(1);
  expect(errors).toEqual([]);
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"))
          .companionHud.mode,
    )
    .toBe("compact");
  await app.close();
});

test("lets clicks through while content exits", async () => {
  const { app } = await launchApp(seeded("expanded"));
  const hud = await findHud(app);
  await settle(hud);
  await hud.keyboard.press("Escape");
  const leaving = hud.locator(".companion-panel");
  if (await leaving.count()) {
    expect(await leaving.getAttribute("inert")).not.toBeNull();
    expect(
      await leaving.locator("xpath=ancestor-or-self::*[@data-hud-hit]").count(),
    ).toBeLessThanOrEqual(1);
  }
  await settle(hud);
  await expect(leaving).toHaveCount(0);
  await app.close();
});

test("leaves no focus on an inert element after Esc", async () => {
  const { app } = await launchApp(seeded("expanded"));
  const hud = await findHud(app);
  await settle(hud);
  await hud.getByRole("button", { name: "Minimizar para a cápsula" }).focus();
  await hud.keyboard.press("Escape");
  await expect
    .poll(() =>
      hud.evaluate(() => document.activeElement?.closest("[inert]") == null),
    )
    .toBe(true);
  await settle(hud);
  await expect(hud.locator(".companion-capsule")).toBeVisible();
  await app.close();
});

test("reopens in the saved mode without animating from stale values", async () => {
  const { app, page } = await launchApp(seeded("compact"));
  const hud = await findHud(app);
  await settle(hud);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes("companion=hud"))
      ?.destroy(),
  );
  await expect
    .poll(
      () =>
        app.windows().filter((item) => item.url().includes("companion=hud"))
          .length,
    )
    .toBe(0);
  await page.evaluate(() =>
    window.neuralbridge.companion.setHudVisibility(true),
  );
  const reopened = await findHud(app);
  await expect(reopened.locator("main")).toHaveClass(/companion-hud--compact/);
  const samples = await sampleMascotPath(reopened, 300);
  expect(largestJump(samples)).toBeLessThan(2);
  await app.close();
});

test("ignores a late getHudState after a click", async () => {
  const { app } = await launchApp(seeded());
  await app.evaluate(({ ipcMain }) => {
    const late = ipcMain as unknown as {
      _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
    };
    const original = late._invokeHandlers.get("companion:hud:state");
    if (original)
      late._invokeHandlers.set("companion:hud:state", async (...args) => {
        const value = await original(...args);
        await new Promise((done) => setTimeout(done, 800));
        return value;
      });
  });
  const hud = await findHud(app);
  await hud.reload();
  await expect(hud.locator(".companion-mascot")).toBeVisible();
  await toCompact(hud);
  await hud.waitForTimeout(1200);
  await expect(hud.locator("main")).toHaveClass(/companion-hud--compact/);
  await app.close();
});

test("does not animate with reduced motion", async () => {
  const { app } = await launchApp(seeded());
  const hud = await findHud(app);
  await hud.emulateMedia({ reducedMotion: "reduce" });
  await hud.reload();
  await expect(hud.locator(".companion-mascot")).toBeVisible();
  await settle(hud);
  const path = sampleMascotPath(hud, 500);
  await toCompact(hud);
  const samples = await path;
  const positions = new Set(
    samples.map((sample) => `${Math.round(sample.x)},${Math.round(sample.y)}`),
  );
  expect(positions.size).toBeLessThanOrEqual(2);
  await app.close();
});

async function dragMascot(
  app: ElectronApplication,
  hud: Page,
  by: { x: number; y: number },
): Promise<void> {
  const at = await mascotBox(hud);
  const moveCursor = (x: number, y: number) =>
    app.evaluate(
      ({ screen }, point) => {
        screen.getCursorScreenPoint = () => point;
      },
      { x, y },
    );
  const box = await hud.locator(".companion-mascot").boundingBox();
  if (!box) throw new Error("no mascot");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await moveCursor(at.x + 50, at.y + 45);
  await hud.mouse.move(cx, cy);
  await hud.mouse.down();
  await hud.mouse.move(cx - 20, cy - 20);
  await moveCursor(at.x + 50 + by.x, at.y + 45 + by.y);
  await hud.mouse.move(cx - 30, cy - 30);
  await expect
    .poll(async () => Math.round((await mascotBox(hud)).x))
    .toBe(Math.round(at.x + by.x));
}

test("settles a drop that has to move the stage without a jump", async () => {
  const { app, dataDir } = await launchApp(seeded());
  const hud = await findHud(app);
  await settle(hud);
  await dragMascot(app, hud, { x: -600, y: -300 });
  const path = sampleMascotPath(hud, 700);
  await hud.mouse.up();
  expect(largestJump(await path)).toBeLessThan(MAX_FRAME_JUMP);
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"))
          .companionHud.x,
    )
    .not.toBeNull();
  await app.close();
});

test("settles the snap to a screen edge without a jump", async () => {
  const dataDir = freshDataDir();
  writeFileSync(
    join(dataDir, "preferences.json"),
    JSON.stringify({
      theme: "dark",
      companionHud: {
        visible: true,
        x: 400,
        y: 300,
        mode: "mascot",
        alwaysOnTop: true,
      },
    }),
  );
  const { app } = await launchApp(dataDir);
  const hud = await findHud(app);
  await settle(hud);
  const area = await app.evaluate(
    ({ screen }) => screen.getPrimaryDisplay().workArea,
  );
  await dragMascot(app, hud, { x: area.x + 9 - 400, y: 0 });
  const path = sampleMascotPath(hud, 700);
  await hud.mouse.up();
  expect(largestJump(await path)).toBeLessThan(16);
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"))
          .companionHud.x,
    )
    .toBe(area.x);
  await app.close();
});

const twoSessions = (app: ElectronApplication) =>
  app.evaluate(({ ipcMain }) => {
    const at = new Date().toISOString();
    const session = (index: number, agent: string) => ({
      sessionId: `00000000-0000-4000-8000-00000000000${index}`,
      taskId: `00000000-0000-4000-8000-00000000001${index}`,
      agent,
      projectId: null,
      providerSessionId: `p${index}`,
      status: "running",
      connection: "connected",
      startedAt: at,
      updatedAt: at,
    });
    ipcMain.removeHandler("companion:sessions");
    ipcMain.handle("companion:sessions", () => ({
      items: [session(1, "claude"), session(2, "codex")],
      nextOffset: null,
    }));
  });

test("slides the detail on session change without remounting the panel", async () => {
  const { app } = await launchApp(seeded("expanded"));
  await twoSessions(app);
  const hud = await findHud(app);
  await hud.reload();
  const codex = hud.getByRole("button", { name: /Codex/ }).first();
  await expect(codex).toBeVisible();
  await settle(hud);
  await hud.locator(".companion-panel").evaluate((node) => {
    (window as unknown as { panel: Element }).panel = node;
  });
  await codex.click();
  await expect(codex).toHaveAttribute("aria-pressed", "true");
  await expect(hud.locator(".companion-detail-slide")).toHaveCount(2);
  await settle(hud);
  await expect(hud.locator(".companion-detail-slide")).toHaveCount(1);
  await expect(
    hud.getByRole("heading", { name: "Codex", level: 1 }),
  ).toBeVisible();
  expect(
    await hud
      .locator(".companion-panel")
      .evaluate(
        (node) => node === (window as unknown as { panel: Element }).panel,
      ),
  ).toBe(true);
  await app.close();
});

test("switches session while the panel expands", async () => {
  const { app } = await launchApp(seeded("compact"));
  await twoSessions(app);
  const hud = await findHud(app);
  await hud.reload();
  await settle(hud);
  await toPanel(hud);
  const codex = hud.getByRole("button", { name: /Codex/ }).first();
  await codex.click();
  await settle(hud);
  await expect(codex).toHaveAttribute("aria-pressed", "true");
  await app.close();
});

test("leaves the capsule corners click-through", async () => {
  const { app } = await launchApp(seeded("compact"));
  const hud = await findHud(app);
  await settle(hud);
  const hit = await hud.evaluate(() => {
    const box = document
      .querySelector(".companion-shell")
      ?.getBoundingClientRect();
    return box
      ? document
          .elementFromPoint(box.left + 2, box.top + 2)
          ?.closest("[data-hud-hit]") != null
      : null;
  });
  expect(hit).toBe(false);
  await app.close();
});

test("does not jump on the first move of a drag from the default corner", async () => {
  const { app } = await launchApp(seeded());
  const hud = await findHud(app);
  await settle(hud);
  const at = await mascotBox(hud);
  const moveCursor = (x: number, y: number) =>
    app.evaluate(
      ({ screen }, point) => {
        screen.getCursorScreenPoint = () => point;
      },
      { x, y },
    );
  const box = await hud.locator(".companion-mascot").boundingBox();
  if (!box) throw new Error("no mascot");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await moveCursor(at.x + 50, at.y + 45);
  await hud.mouse.move(cx, cy);
  await hud.mouse.down();
  const path = sampleMascotPath(hud, 500);
  await hud.mouse.move(cx - 20, cy - 20);
  await moveCursor(at.x + 45, at.y + 41);
  await hud.mouse.move(cx - 21, cy - 21);
  expect(largestJump(await path)).toBeLessThan(12);
  await hud.mouse.up();
  await app.close();
});

test("keeps the session card clear of the chat", async () => {
  const dataDir = seeded("expanded");
  const { app, page } = await launchApp(dataDir);
  await page.evaluate(() =>
    window.neuralbridge.neura.updateSettings({ enabled: true }),
  );
  await twoSessions(app);
  const hud = await findHud(app);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((item) => item.webContents.getURL().includes("companion=hud"))
      ?.removeAllListeners("blur");
  });
  await hud.reload();
  await expect(hud.getByLabel("Falar com o Void")).toBeVisible();
  await hud.getByLabel("Falar com o Void").fill("próxima música");
  await hud.getByRole("button", { name: "Enviar para o Void" }).click();
  await expect(hud.getByTestId("neura-chat-reply")).not.toContainText(
    "Pensando",
  );
  const edges = await hud.evaluate(() => ({
    cta:
      document.querySelector(".companion-cta")?.getBoundingClientRect()
        .bottom ?? 0,
    card:
      document.querySelector(".companion-detail")?.getBoundingClientRect()
        .bottom ?? 0,
    chat:
      document.querySelector(".companion-chat")?.getBoundingClientRect().top ??
      0,
  }));
  expect(edges.cta).toBeLessThanOrEqual(edges.card);
  expect(edges.card).toBeLessThanOrEqual(edges.chat);
  await app.close();
});

test('shows a thinking bubble while Neura works, and clears it', async () => {
  const dataDir = seeded();
  const { app, page } = await launchApp(dataDir);
  await page.evaluate(() => window.neuralbridge.neura.updateSettings({ enabled: true }));
  const hud = await findHud(app);
  await hud.reload();
  await expect(hud.getByRole("main", { name: "Singularity Companion" })).toBeVisible();
  await page.evaluate(() => { void window.neuralbridge.neura.input({ text: "explique a fase atual" }).catch(() => undefined); });
  await expect(hud.getByTestId("neura-thinking")).toContainText("Pensando");
  await expect(hud.getByTestId("neura-thinking")).toBeHidden({ timeout: 20_000 });
  await app.close();
});

test('the eyes follow the pointer, also from outside the HUD', async () => {
  const { app } = await launchApp(seeded());
  const hud = await findHud(app);
  const face = hud.locator(".nb-mascot__face");
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes("companion=hud"));
    window?.webContents.send("companion:cursor", { x: -2_000, y: 0 });
  });
  await expect.poll(() => face.evaluate((node) => (node as SVGGElement).style.translate)).toMatch(/^-/);
  await app.close();
});

