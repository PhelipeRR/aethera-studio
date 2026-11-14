import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { FAKE_AGENTS, launchApp } from "./app";

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
  return hud;
}

const flags = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => ({
    focusable:
      BrowserWindow.getAllWindows()
        .find((item) => item.webContents.getURL().includes("companion=hud"))
        ?.isFocusable() ?? false,
  }));

/** The panel closes on blur, and the main window takes the focus back in a test run while no user is there to keep it. */
const holdPanel = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((item) => item.webContents.getURL().includes("companion=hud"))
      ?.removeAllListeners("blur");
  });

test("keeps the pause visible, reachable by keyboard, and leaves the mascot click-through", async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.evaluate(() =>
    window.neuralbridge.neura.updateSettings({
      enabled: true,
      meetingConsent: true,
    }),
  );
  const hud = await findHud(app);
  await holdPanel(app);
  await expect(hud.locator("main")).toHaveClass(/companion-hud--mascot/);

  await hud.getByRole("button", { name: "Expandir Companion" }).click();
  await hud.evaluate(() =>
    window.neuralbridge.neura.startMeeting({
      sourceId: "manual-transcript",
      platform: "teams",
      consent: true,
      userPreferredLanguage: "pt-BR",
      translationEnabled: false,
    }),
  );
  await expect(hud.getByTestId("neura-badge")).toHaveText("Reunião");

  await hud.getByRole("button", { name: "Expandir Companion" }).click();
  await hud.getByRole("button", { name: "Void", exact: true }).focus();
  await hud.keyboard.press("Enter");
  await expect(hud.getByTestId("neura-activity")).toHaveText(
    "Acompanhando reunião",
  );
  await hud.keyboard.press("Tab");
  await expect(hud.locator(":focus")).toBeVisible();
  const pause = hud.getByRole("button", { name: "Pausar tudo" });
  await pause.focus();
  await expect(pause).toBeFocused();
  await hud.keyboard.press("Enter");
  await expect(hud.getByTestId("neura-activity")).toHaveText("Pausada");

  await hud.getByRole("button", { name: "Minimizar para a cápsula" }).click();
  await expect(hud.getByTestId("neura-badge")).toHaveText("Void pausado");
  // Measured on the text nodes once the shell has settled: elements stretch to their box and cannot show this cut.
  await expect(hud.locator(".companion-shell")).toHaveCSS("width", "406px");
  const fit = await hud.locator(".companion-capsule__copy").evaluate((copy) => {
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const rights: number[] = [];
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      rights.push(range.getBoundingClientRect().right);
    }
    return {
      text: Math.max(...rights),
      room: copy.getBoundingClientRect().right,
    };
  });
  expect(fit.text).toBeLessThanOrEqual(fit.room);
  await hud.screenshot({
    path: "artifacts/neura-hud-capsule.png",
    omitBackground: true,
  });
  await app.close();
});
const suggestion = {
  suggestionId: "00000000-0000-4000-8000-0000000000c1",
  correlationId: "00000000-0000-4000-8000-0000000000c2",
  sessionId: "00000000-0000-4000-8000-0000000000c3",
  utteranceId: "00000000-0000-4000-8000-0000000000c4",
  text: "Podemos fechar a entrega na sexta e revisar os riscos na segunda de manhã.",
  translation: null,
  sourceExcerpt: "Quando entregamos?",
  decision: { responseLanguage: "pt-BR", reason: "meeting" },
  confidence: 0.9,
  status: "pending",
  actions: ["copy"],
  delivery: "manual",
  preprocessing: "fallback",
  createdAt: new Date().toISOString(),
};

test("a suggestion comes out of the mascot in silence, without taking focus or showing in a capture", async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.evaluate(() =>
    window.neuralbridge.neura.updateSettings({
      enabled: true,
      meetingConsent: true,
    }),
  );
  const hud = await findHud(app);
  await hud.evaluate(() => {
    const memo = window as unknown as { voices: number };
    memo.voices = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function replay(this: HTMLMediaElement) {
      memo.voices += 1;
      return play.call(this);
    };
    const say = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (utterance) => {
      memo.voices += 1;
      say(utterance);
    };
  });
  await hud.evaluate(() =>
    window.neuralbridge.neura.startMeeting({
      sourceId: "manual-transcript",
      platform: "teams",
      consent: true,
      userPreferredLanguage: "pt-BR",
      translationEnabled: false,
    }),
  );
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) =>
            window.webContents.getURL().includes("companion=hud"),
          )
          ?.isContentProtected(),
      ),
    )
    .toBe(true);

  const state = await hud.evaluate(() => window.neuralbridge.neura.state());
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, { value, item }) => {
      const send = (next: unknown) =>
        BrowserWindow.getAllWindows()
          .find((window) =>
            window.webContents.getURL().includes("companion=hud"),
          )
          ?.webContents.send("neura:changed", next);
      const memo = globalThis as unknown as {
        copied: number;
        rejected: number;
      };
      memo.copied = 0;
      memo.rejected = 0;
      ipcMain.removeHandler("neura:suggestion:copy");
      ipcMain.handle("neura:suggestion:copy", () => {
        memo.copied += 1;
        return { ...item, status: "copied" };
      });
      ipcMain.removeHandler("neura:suggestion:decide");
      ipcMain.handle("neura:suggestion:decide", () => {
        memo.rejected += 1;
        send({ ...value, suggestions: [{ ...item, status: "dismissed" }] });
        return { ...item, status: "dismissed" };
      });
      send({ ...value, suggestions: [item] });
    },
    { value: state, item: suggestion },
  );

  const bubble = hud.getByRole("article", { name: "Sugestão de resposta" });
  await expect(bubble).toContainText("Podemos fechar a entrega");
  await expect(hud.locator("[data-mascot-state]")).toHaveAttribute(
    "data-mascot-state",
    "waiting",
  );
  await hud.waitForTimeout(500);
  await bubble.screenshot({
    path: "artifacts/motion/suggestion-bubble.png",
    omitBackground: true,
  });
  const box = await bubble.boundingBox();
  const view = await hud.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(
    (box?.x ?? -1) >= 0 &&
      (box?.y ?? -1) >= 0 &&
      (box?.x ?? 0) + (box?.width ?? 0) <= view.width &&
      (box?.y ?? 0) + (box?.height ?? 0) <= view.height,
  ).toBe(true);

  await bubble.getByRole("button", { name: "Copiar" }).click();
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as unknown as { copied: number }).copied),
    )
    .toBe(1);
  await bubble.getByRole("button", { name: "Descartar sugestão" }).click();
  await expect(bubble).toHaveCount(0);
  expect(await flags(app)).toMatchObject({ focusable: false });
  expect(
    await hud.evaluate(() => (window as unknown as { voices: number }).voices),
  ).toBe(0);
  await app.close();
});

test("answers aloud and beeps with the HUD collapsed to the mascot", async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.evaluate(() =>
    window.neuralbridge.neura.updateSettings({ enabled: true }),
  );
  const hud = await findHud(app);
  await expect(hud.locator("main")).toHaveClass(/companion-hud--mascot/);
  await hud.evaluate(() => {
    const memo = window as unknown as { contexts: number; oscillators: number };
    memo.contexts = 0;
    memo.oscillators = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function oscillator(
      this: AudioContext,
    ) {
      memo.oscillators += 1;
      return create.call(this);
    };
  });
  const state = await hud.evaluate(() => window.neuralbridge.neura.state());
  await app.evaluate(({ BrowserWindow, ipcMain }, value) => {
    const memo = globalThis as unknown as { spoken: string[] };
    memo.spoken = [];
    ipcMain.removeHandler("neura:speak");
    ipcMain.handle("neura:speak", (_event, input: { text: string }) => {
      memo.spoken.push(input.text);
      throw new Error("no voice in this test");
    });
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().includes("companion=hud"),
    );
    window?.webContents.send("neura:wake");
    window?.webContents.send("neura:changed", {
      ...value,
      lastResponse: {
        correlationId: "00000000-0000-4000-8000-0000000000d1",
        outcome: "done",
        message: "Abrindo o Teams.",
        speak: true,
        at: new Date().toISOString(),
      },
    });
  }, state);
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { spoken: string[] }).spoken,
      ),
    )
    .toEqual(["Abrindo o Teams."]);
  await expect
    .poll(() =>
      hud.evaluate(
        () => (window as unknown as { oscillators: number }).oscillators,
      ),
    )
    // Two notes for the wake cue, and one tick for the "Preparando a voz" bubble.
    .toBe(3);
  await app.close();
});

test("talks from the main panel, with no project", async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.evaluate(() =>
    window.neuralbridge.neura.updateSettings({ enabled: true }),
  );
  const hud = await findHud(app);
  await holdPanel(app);
  await page.evaluate(() => window.neuralbridge.companion.openHudPanel());
  await hud.getByLabel("Falar com o Void").fill("próxima música");
  await hud.getByRole("button", { name: "Enviar para o Void" }).click();
  await expect(hud.getByTestId("neura-chat-reply")).not.toContainText(
    "Pensando",
  );
  await expect(hud.getByTestId("neura-chat-reply")).toContainText(
    "próxima música",
  );
  await expect(
    hud.getByRole("heading", { name: "Eventos recentes" }),
  ).toBeVisible();
  await app.close();
});
