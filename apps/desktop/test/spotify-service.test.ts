import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IpcChannel, parseIpcInput } from "@neuralbridge/shared";
import { SPOTIFY_REDIRECT_URI } from "@neuralbridge/shared/spotify";
import {
  authorizeUrl,
  createPkceSession,
  SpotifyAuthError,
  waitForCallback,
} from "../src/main/spotify/oauth.js";
import {
  SpotifyService,
  type SpotifyConfig,
} from "../src/main/spotify/service.js";
import {
  SpotifyTokenStore,
  type SecretCipher,
} from "../src/main/spotify/token-store.js";

const CLIENT_ID = "a".repeat(32);
const cipher = (available = true): SecretCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) =>
    Buffer.from(`enc:${Buffer.from(plain).toString("base64")}`),
  decryptString: (data) =>
    Buffer.from(data.toString().slice(4), "base64").toString(),
});
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const player = (overrides: object = {}) => ({
  is_playing: true,
  progress_ms: 1000,
  device: {
    name: "PC",
    volume_percent: 40,
    supports_volume: true,
    is_restricted: false,
  },
  actions: { disallows: {} },
  item: {
    id: "t1",
    name: "Faixa",
    duration_ms: 180_000,
    artists: [{ name: "A" }, { name: "B" }],
    album: { images: [{ url: "https://i.scdn.co/image/1", width: 300 }] },
    external_urls: { spotify: "https://open.spotify.com/track/t1" },
  },
  ...overrides,
});
const tokens = (overrides: object = {}) => ({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: 10_000_000,
  scopes: ["user-read-playback-state", "user-modify-playback-state"],
  ...overrides,
});
const image = () =>
  new Response(new Uint8Array([1, 2]), {
    headers: { "content-type": "image/jpeg" },
  });

function harness(
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
  config: Partial<SpotifyConfig> = {},
  stored: object | null = tokens(),
) {
  const file = join(mkdtempSync(join(tmpdir(), "nb-spotify-")), "tokens.bin");
  const store = new SpotifyTokenStore(file, cipher());
  if (stored) store.save(stored as never);
  let current: SpotifyConfig = {
    enabled: true,
    clientId: CLIENT_ID,
    controlsEnabled: true,
    ...config,
  };
  let time = 1_000_000;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const opened: string[] = [];
  const service = new SpotifyService({
    store,
    readConfig: () => current,
    writeConfig: (next) => {
      current = next;
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    fetch: (async (input: URL | string, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, ...(init ? { init } : {}) });
      return respond(url, init);
    }) as typeof fetch,
    endpoints: {
      accounts: "https://accounts.test",
      api: "https://api.test",
      imageHosts: ["i.scdn.co"],
    },
    now: () => time,
    redirectPort: 43_912,
  });
  service.init();
  return {
    service,
    calls,
    opened,
    file,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const poll = (service: SpotifyService) =>
  (service as unknown as { poll(): Promise<void> }).poll();

afterEach(() => {
  vi.useRealTimers();
});

describe("Spotify PKCE", () => {
  it("derives an S256 challenge and sends no secret", () => {
    const session = createPkceSession();
    expect(session.verifier.length).toBeGreaterThanOrEqual(43);
    expect(session.verifier.length).toBeLessThanOrEqual(128);
    expect(session.challenge).toBe(
      createHash("sha256").update(session.verifier).digest("base64url"),
    );
    const url = new URL(
      authorizeUrl(
        "https://accounts.test",
        CLIENT_ID,
        ["user-read-playback-state"],
        session,
      ),
    );
    expect(url.pathname).toBe("/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      scope: "user-read-playback-state",
      redirect_uri: SPOTIFY_REDIRECT_URI,
      state: session.state,
      code_challenge_method: "S256",
      code_challenge: session.challenge,
    });
    expect(url.search).not.toContain(session.verifier);
  });

  it("uses the loopback literal Spotify requires, never localhost", () => {
    expect(SPOTIFY_REDIRECT_URI).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
  });
});
function get(
  port: number,
  path: string,
  host = `127.0.0.1:${port}`,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path, headers: { host } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("Spotify callback listener", () => {
  const port = 43_911;

  it("ignores a wrong state, a foreign Host and other paths, then accepts the right redirect", async () => {
    const wait = await waitForCallback("right-state", {
      port,
      timeoutMs: 5_000,
    });
    expect(await get(port, "/callback?code=x&state=wrong")).toBe(400);
    expect(
      await get(
        port,
        "/callback?code=x&state=right-state",
        `evil.test:${port}`,
      ),
    ).toBe(404);
    expect(await get(port, "/other?code=x&state=right-state")).toBe(404);
    expect(await get(port, "/callback?code=the-code&state=right-state")).toBe(
      200,
    );
    await expect(wait.code).resolves.toBe("the-code");
    await expect(get(port, "/callback")).rejects.toThrow();
  });

  it("reports a refusal, a timeout and a port in use as their own errors", async () => {
    const refused = await waitForCallback("s", { port, timeoutMs: 5_000 });
    await get(port, "/callback?error=access_denied&state=s");
    await expect(refused.code).rejects.toMatchObject({ code: "auth_denied" });
    const late = await waitForCallback("s", { port, timeoutMs: 20 });
    await expect(late.code).rejects.toBeInstanceOf(SpotifyAuthError);
    const holder = await waitForCallback("s", { port, timeoutMs: 5_000 });
    await expect(
      waitForCallback("s", { port, timeoutMs: 5_000 }),
    ).rejects.toMatchObject({ code: "port_in_use" });
    holder.cancel();
  });
});

describe("Spotify token store", () => {
  it("never writes tokens in plain text", () => {
    const { file } = harness(() => json({}));
    expect(readFileSync(file).toString()).not.toContain("refresh-1");
  });

  it("keeps nothing on disk without OS encryption", () => {
    const file = join(mkdtempSync(join(tmpdir(), "nb-spotify-")), "tokens.bin");
    const store = new SpotifyTokenStore(file, cipher(false));
    store.save(tokens() as never);
    expect(existsSync(file)).toBe(false);
    expect(store.load()).toBeNull();
  });

  it("treats a corrupt file as no connection", () => {
    const { file } = harness(() => json({}));
    expect(
      new SpotifyTokenStore(file, {
        ...cipher(),
        decryptString: () => "not json",
      }).load(),
    ).toBeNull();
  });
});

describe("Spotify service", () => {
  it("stops all Spotify activity while the independent extension is disabled", async () => {
    const { service, calls } = harness(() => json({}));
    service.setExtensionEnabled(false);
    expect(service.status().connection).toBe("disabled");
    await expect(service.connect()).resolves.toMatchObject({ connection: "disabled" });
    expect(calls).toHaveLength(0);
  });

  it("does nothing on the network while disabled, unconfigured or hidden", async () => {
    vi.useFakeTimers();
    const disabled = harness(() => json({}), { enabled: false });
    disabled.service.setActive(true);
    const empty = harness(() => json({}), { clientId: null });
    empty.service.setActive(true);
    const hidden = harness(() => json(player()));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(disabled.calls).toEqual([]);
    expect(empty.calls).toEqual([]);
    expect(hidden.calls).toEqual([]);
    expect(disabled.service.status().connection).toBe("disabled");
    expect(empty.service.status().connection).toBe("unconfigured");
  });

  it("stops polling when the HUD goes away", async () => {
    vi.useFakeTimers();
    const h = harness((url) =>
      url.includes("/image/") ? image() : json(player()),
    );
    h.service.setActive(true);
    await vi.advanceTimersByTimeAsync(11_000);
    const seen = h.calls.length;
    expect(seen).toBeGreaterThan(1);
    h.service.setActive(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.length).toBe(seen);
  });

  it("maps playback and keeps tokens out of the status", async () => {
    const h = harness((url) =>
      url.includes("/image/") ? image() : json(player()),
    );
    await poll(h.service);
    const status = h.service.status();
    expect(status.playback).toMatchObject({
      trackId: "t1",
      title: "Faixa",
      artists: "A, B",
      isPlaying: true,
      progressMs: 1000,
      durationMs: 180_000,
      device: "PC",
      volume: 40,
      hasLink: true,
    });
    expect(status.playback?.cover).toMatch(/^data:image\/jpeg;base64,/);
    expect(JSON.stringify(status)).not.toMatch(/access-1|refresh-1/);
  });

  it("survives a response missing optional fields", async () => {
    const h = harness(() => json({ item: { name: "Só o nome" } }));
    await poll(h.service);
    expect(h.service.status().playback).toMatchObject({
      title: "Só o nome",
      artists: "",
      cover: null,
      device: null,
      volume: null,
      hasLink: false,
      isPlaying: false,
    });
  });

  it("shows nothing when no player is active", async () => {
    const empty = harness(() => new Response(null, { status: 204 }));
    await poll(empty.service);
    expect(empty.service.status()).toMatchObject({
      connection: "connected",
      playback: null,
      error: null,
    });
    const odd = harness(() => json({ is_playing: true, item: null }));
    await poll(odd.service);
    expect(odd.service.status().playback).toBeNull();
  });

  it("refuses a cover from an unknown host and a link outside open.spotify.com", async () => {
    const h = harness(() =>
      json(
        player({
          item: {
            name: "X",
            album: { images: [{ url: "https://evil.test/x.jpg" }] },
            external_urls: { spotify: "https://evil.test/track" },
          },
        }),
      ),
    );
    await poll(h.service);
    expect(h.calls.some((call) => call.url.includes("evil.test"))).toBe(false);
    expect(h.service.status().playback).toMatchObject({
      cover: null,
      hasLink: false,
    });
    await h.service.openTrack();
    expect(h.opened).toEqual([]);
  });

  it("refreshes an expired token, keeping the refresh token when none is rotated", async () => {
    const h = harness(
      (url, init) => {
        if (url.endsWith("/api/token")) {
          expect(String(init?.body)).toContain("grant_type=refresh_token");
          expect(String(init?.body)).not.toContain("client_secret");
          return json({ access_token: "access-2", expires_in: 3600 });
        }
        return new Response(null, { status: 204 });
      },
      {},
      tokens({ expiresAt: 0 }),
    );
    await poll(h.service);
    expect(h.calls.at(-1)?.init?.headers).toMatchObject({
      authorization: "Bearer access-2",
    });
    expect(new SpotifyTokenStore(h.file, cipher()).load()).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-1",
    });
  });

  it("retries once after a 401 and forgets a revoked grant", async () => {
    let refreshes = 0;
    const retried = harness((url) => {
      if (url.endsWith("/api/token")) {
        refreshes += 1;
        return json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      }
      return refreshes ? new Response(null, { status: 204 }) : json({}, 401);
    });
    await poll(retried.service);
    expect(refreshes).toBe(1);
    expect(retried.service.status()).toMatchObject({
      connection: "connected",
      error: null,
    });

    const revoked = harness((url) =>
      url.endsWith("/api/token")
        ? json({ error: "invalid_grant" }, 400)
        : json({}, 401),
    );
    await poll(revoked.service);
    expect(revoked.service.status()).toMatchObject({
      connection: "disconnected",
      error: "revoked",
      playback: null,
    });
    expect(existsSync(revoked.file)).toBe(false);
  });

  it("honours Retry-After without sending anything in the meantime", async () => {
    const h = harness(() =>
      json({ error: { status: 429, message: "x" } }, 429, {
        "retry-after": "40",
      }),
    );
    await poll(h.service);
    expect(h.service.status()).toMatchObject({
      error: "rate_limited",
      retryAt: 1_040_000,
    });
    const sent = h.calls.length;
    await poll(h.service);
    expect(h.calls.length).toBe(sent);
    h.advance(41_000);
    await poll(h.service);
    expect(h.calls.length).toBe(sent + 1);
  });

  it("tells a quota from a rate limit, and Premium from a plain refusal", async () => {
    const quota = harness(() =>
      json(
        {
          error: {
            status: 429,
            message: "Too many requests",
            reason: "QUOTA_EXCEEDED",
          },
        },
        429,
      ),
    );
    await poll(quota.service);
    expect(quota.service.status().error).toBe("quota_exceeded");
    const premium = harness((url) =>
      url.includes("/pause")
        ? json({ error: { reason: "PREMIUM_REQUIRED" } }, 403)
        : json(player()),
    );
    await poll(premium.service);
    await premium.service.control({ action: "pause" });
    expect(premium.service.status().error).toBe("premium_required");
  });

  it("reports a missing device from a control", async () => {
    const h = harness((url) =>
      url.includes("/next")
        ? json({ error: { reason: "NO_ACTIVE_DEVICE" } }, 404)
        : json(player()),
    );
    await poll(h.service);
    await h.service.control({ action: "next" });
    expect(h.service.status().error).toBe("no_device");
  });

  it("blocks controls with a reason, sending nothing", async () => {
    const off = harness(() => json(player()), { controlsEnabled: false });
    await poll(off.service);
    const sent = off.calls.length;
    await off.service.control({ action: "pause" });
    expect(off.calls.length).toBe(sent);
    expect(off.service.status().controlBlock).toBe("disabled");
    const scopes = harness(
      () => json(player()),
      {},
      tokens({ scopes: ["user-read-playback-state"] }),
    );
    await poll(scopes.service);
    expect(scopes.service.status().controlBlock).toBe("reauthorize");
    const restricted = harness(() =>
      json(player({ device: { name: "TV", is_restricted: true } })),
    );
    await poll(restricted.service);
    expect(restricted.service.status().controlBlock).toBe("restricted");
    const none = harness(() => new Response(null, { status: 204 }));
    await poll(none.service);
    expect(none.service.status().controlBlock).toBe("no_device");
  });

  it("sends each control to its endpoint", async () => {
    const h = harness((url) =>
      url.includes("/me/player/")
        ? new Response(null, { status: 204 })
        : json(player()),
    );
    await poll(h.service);
    await h.service.control({ action: "pause" });
    await h.service.control({ action: "next" });
    await h.service.control({ action: "volume", volume: 55 });
    const sent = h.calls
      .filter(
        (call) =>
          call.url.includes("/me/player/") && call.init?.method !== "GET",
      )
      .map((call) => {
        const url = new URL(call.url);
        return `${call.init?.method} ${url.pathname}${url.search}`;
      });
    expect(sent).toEqual([
      "PUT /v1/me/player/pause",
      "POST /v1/me/player/next",
      "PUT /v1/me/player/volume?volume_percent=55",
    ]);
  });

  it("disconnects for good, and a new Client ID drops the old tokens", async () => {
    const h = harness(() => json(player()));
    await poll(h.service);
    expect(h.service.disconnect()).toMatchObject({
      connection: "disconnected",
      playback: null,
    });
    expect(existsSync(h.file)).toBe(false);
    const other = harness(() => json(player()));
    await other.service.configure({ clientId: "b".repeat(32) });
    expect(other.service.status().connection).toBe("disconnected");
    expect(existsSync(other.file)).toBe(false);
  });
});

describe("Spotify IPC contract", () => {
  it("accepts only known controls and well-formed configuration", () => {
    expect(() =>
      parseIpcInput(IpcChannel.spotifyControl, { action: "play" }),
    ).not.toThrow();
    expect(() =>
      parseIpcInput(IpcChannel.spotifyControl, {
        action: "volume",
        volume: 101,
      }),
    ).toThrow();
    expect(() =>
      parseIpcInput(IpcChannel.spotifyControl, { action: "seek" }),
    ).toThrow();
    expect(() =>
      parseIpcInput(IpcChannel.spotifyConfigure, { clientId: "short" }),
    ).toThrow();
    expect(() =>
      parseIpcInput(IpcChannel.spotifyConfigure, { clientSecret: "x" }),
    ).toThrow();
  });
});

describe("Spotify with nothing playing", () => {
  const none = () => new Response(null, { status: 204 });
  const heard = (id = "dev-1", name = "Notebook") =>
    player({
      device: {
        id,
        name,
        volume_percent: 40,
        supports_volume: true,
        is_restricted: false,
      },
    });
  const history = {
    items: [
      {
        track: {
          id: "old",
          name: "Tocada ontem",
          duration_ms: 200_000,
          artists: [{ name: "Banda" }],
          album: { images: [] },
        },
      },
    ],
  };
  const scoped = tokens({
    scopes: [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-recently-played",
    ],
  });
  const router =
    (state: { playing: boolean }, devices: unknown[] = []) =>
    (url: string) => {
      if (url.includes("/recently-played")) return json(history);
      if (url.includes("/me/player/devices")) return json({ devices });
      if (url.endsWith("/v1/me/player"))
        return state.playing ? json(heard()) : none();
      return image();
    };

  it("keeps showing the last track and device once playback stops", async () => {
    const state = { playing: true };
    const { service } = harness(router(state));
    await poll(service);
    state.playing = false;
    await poll(service);
    expect(service.status().playback).toMatchObject({
      remembered: true,
      isPlaying: false,
      device: "Notebook",
      canResume: true,
      canNext: false,
    });
  });

  it("remembers them across a restart", async () => {
    const state = { playing: true };
    const first = harness(router(state));
    await poll(first.service);
    const config = (
      first.service as unknown as { deps: { readConfig(): SpotifyConfig } }
    ).deps.readConfig();
    state.playing = false;
    const second = harness(router(state), config);
    await poll(second.service);
    expect(second.service.status().playback).toMatchObject({
      remembered: true,
      device: "Notebook",
    });
  });

  it("finds the last track in the history when the app never saw it play", async () => {
    const { service } = harness(router({ playing: false }), {}, scoped);
    await poll(service);
    expect(service.status().playback).toMatchObject({
      remembered: true,
      title: "Tocada ontem",
      artists: "Banda",
    });
  });

  it("lives without the history scope of an older connection", async () => {
    const { service, calls } = harness(router({ playing: false }));
    await poll(service);
    expect(service.status().playback).toBeNull();
    expect(calls.some((call) => call.url.includes("recently-played"))).toBe(
      false,
    );
  });

  it("lists the devices Spotify can see", async () => {
    const { service } = harness(
      router({ playing: false }, [
        { id: "d1", name: "Celular", type: "Smartphone", is_active: false },
      ]),
    );
    await expect(service.devices()).resolves.toEqual([
      { id: "d1", name: "Celular", type: "Smartphone", isActive: false },
    ]);
  });

  it("moves playback to the chosen device and keeps it playing", async () => {
    const state = { playing: true };
    const { service, calls } = harness(
      router(state, [
        { id: "d2", name: "Sala", type: "Speaker", is_active: false },
      ]),
    );
    await poll(service);
    await service.control({ action: "transfer", deviceId: "d2" });
    const put = calls.find(
      (call) =>
        call.init?.method === "PUT" && call.url.endsWith("/v1/me/player"),
    );
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      device_ids: ["d2"],
      play: true,
    });
  });

  it("resumes on the last device when Play is pressed", async () => {
    const state = { playing: true };
    const { service, calls, opened } = harness(
      router(state, [
        { id: "dev-1", name: "Notebook", type: "Computer", is_active: false },
        { id: "d9", name: "TV", type: "TV", is_active: false },
      ]),
    );
    await poll(service);
    state.playing = false;
    await poll(service);
    await service.control({ action: "play" });
    const put = calls.find(
      (call) =>
        call.init?.method === "PUT" && call.url.endsWith("/v1/me/player"),
    );
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      device_ids: ["dev-1"],
      play: true,
    });
    expect(opened).toEqual([]);
  });

  it("starts playback when Spotify has no active player yet", async () => {
    const state = { playing: false };
    const { service, calls } = harness(
      router(state, [
        { id: "dev-1", name: "Notebook", type: "Computer", is_active: false },
      ]),
    );
    await poll(service);
    await service.control({ action: "play" });
    const put = calls.find(
      (call) =>
        call.init?.method === "PUT" && call.url.endsWith("/v1/me/player"),
    );
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      device_ids: ["dev-1"],
      play: true,
    });
    expect(service.status().error).toBeNull();
  });

  it("opens the Spotify app when nothing is online, and plays on it", async () => {
    vi.useFakeTimers();
    const state = { playing: true };
    let online: unknown[] = [];
    const inner = router(state);
    const { service, calls, opened } = harness((url) =>
      url.includes("/me/player/devices")
        ? json({ devices: online })
        : inner(url),
    );
    await poll(service);
    state.playing = false;
    await poll(service);
    const pressed = service.control({ action: "play" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(opened).toEqual(["spotify:"]);
    online = [{ id: "pc", name: "Meu PC", type: "Computer", is_active: false }];
    await vi.advanceTimersByTimeAsync(2_000);
    await pressed;
    const put = calls.find(
      (call) =>
        call.init?.method === "PUT" && call.url.endsWith("/v1/me/player"),
    );
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      device_ids: ["pc"],
      play: true,
    });
  });

  it("says so when no device ever comes online", async () => {
    vi.useFakeTimers();
    const state = { playing: true };
    const { service } = harness(router(state));
    await poll(service);
    state.playing = false;
    await poll(service);
    const pressed = service.control({ action: "play" });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pressed).resolves.toMatchObject({ error: "no_device" });
  });
});
