import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { parsePlaylistUrl, parseYouTubeSource, MAX_PLAYLIST_VIDEOS } from "../lib/playlist.ts";
import { extractPlaylist } from "../lib/playlist-client.ts";
import { createApi } from "../lib/server/api.ts";
import { createSession, SESSION_COOKIE } from "../lib/server/session.ts";
import { markdownFilename, toMarkdown } from "../lib/transcript.ts";

const playlistId = "PLlaN88a7y2_plecYoJxvRFTLHVbIVAOoc";
const url = `https://www.youtube.com/playlist?list=${playlistId}`;
const ids = ["dQw4w9WgXcQ", "xvFZjo5PgG0", "abcdefghijk"];
const password = "test-password-for-playlist";
const env = { NODE_ENV: "test", APP_ACCESS_CODE: password, SUPADATA_API_KEY: "test-key-never-exposed" };
const segments = [{ text: "Olá 🎬 日本語\n```", offset: 12500, duration: 2000 }, { text: "Final", offset: 3723000, duration: 300 }];
const captions = { content: segments, lang: "pt-BR" };

function fixture(responses: Array<Response | (() => Response)>) {
  const calls: URL[] = [];
  const api = createApi({ env, fetcher: async (input) => {
    calls.push(new URL(String(input)));
    const response = responses.shift();
    assert.ok(response, "não deve repetir extrações nem fazer chamadas externas inesperadas");
    return typeof response === "function" ? response() : response;
  } });
  const fetcher: typeof fetch = async (path, init) => {
    const request = new Request(`http://localhost:3000${path}`, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${createSession(password)}` },
    });
    if (path === "/api/playlist") return api.playlist(request);
    if (path === "/api/transcript") return api.extract(request);
    assert.equal(path, "/api/transcript/status");
    return api.status(request);
  };
  return { api, fetcher, calls };
}

for (const input of [url, `http://youtube.com/playlist?list=${playlistId}&si=abc`, `https://m.youtube.com/watch?v=${ids[0]}&list=${playlistId}`, `https://youtu.be/${ids[0]}?list=${playlistId}`]) {
  test(`detecta e normaliza playlist: ${input}`, () => {
    assert.equal(parsePlaylistUrl(input).canonicalUrl, url);
    assert.equal(parseYouTubeSource(input).kind, "playlist");
  });
}

test("vídeos sem list continuam no fluxo individual", () => {
  assert.equal(parseYouTubeSource(`https://youtu.be/${ids[0]}`).kind, "video");
});

for (const input of [undefined, {}, "", "https://evil.example/playlist?list=" + playlistId, `https://youtube.com.evil.test/playlist?list=${playlistId}`, `https://user@youtube.com/playlist?list=${playlistId}`, `https://youtube.com:8080/playlist?list=${playlistId}`, `ftp://youtube.com/playlist?list=${playlistId}`, `https://youtube.com/playlist?list=${playlistId}&list=${playlistId}`, "https://youtube.com/playlist?list=../../evil", `https://youtube.com/playlist/extra?list=${playlistId}`, `https://youtube.com/playlist?list=${playlistId}\n&x=1`, `https://youtube.com/playlist?list=${playlistId}&x=${"🎬".repeat(300)}`]) {
  test(`rejeita playlist inválida: ${String(input).slice(0, 90)}`, () => assert.throws(() => parsePlaylistUrl(input)));
}

test("playlist → API autenticada → native/polling → ZIP preserva exatamente o Markdown individual", async () => {
  const { fetcher, calls } = fixture([
    Response.json({ videoIds: [ids[0]], shortIds: [ids[0], ids[1]], liveIds: [ids[2]] }),
    Response.json(captions),
    Response.json({ jobId: "pending-short" }, { status: 202 }),
    Response.json({ status: "completed", result: captions }),
    Response.json(captions),
  ]);
  const progress: number[] = [];
  const result = await extractPlaylist(url, { signal: new AbortController().signal, fetcher, pause: async () => {}, onProgress: (state) => progress.push(state.processed) });
  assert.equal(result.succeeded, 3);
  assert.deepEqual(result.failures, []);
  assert.equal(calls[0].pathname, "/v1/youtube/playlist/videos");
  assert.equal(calls[0].searchParams.get("id"), playlistId);
  assert.equal(calls[0].searchParams.get("limit"), "5000");
  assert.deepEqual(progress, [0, 0, 1, 2, 3, 3]);
  const files = unzipSync(result.archive);
  assert.equal(Object.keys(files).length, 4);
  for (const videoId of ids) {
    const transcript = { videoId, originalUrl: `https://www.youtube.com/watch?v=${videoId}`, language: "pt-BR", text: segments.map((s) => s.text).join("\n"), segments };
    const file = files[markdownFilename(transcript)];
    assert.deepEqual([...file.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(new TextDecoder().decode(file), toMarkdown(transcript));
  }
  assert.match(new TextDecoder().decode(files["LEIA-ME.md"]), /Todos os vídeos encontrados foram coletados/);
  for (const call of calls.filter((call) => call.pathname === "/v1/transcript")) {
    assert.equal(call.searchParams.get("mode"), "native");
    assert.equal(call.searchParams.get("text"), "false");
    assert.equal(call.searchParams.has("lang"), false);
  }
});

test("vídeo sem legenda e vídeo privado são relatados; os demais continuam", async () => {
  const { fetcher } = fixture([
    Response.json({ videoIds: ids, shortIds: [], liveIds: [] }),
    new Response(null, { status: 206 }), new Response(null, { status: 404 }), Response.json(captions),
  ]);
  const result = await extractPlaylist(url, { signal: new AbortController().signal, fetcher, pause: async () => {}, onProgress: () => {} });
  assert.equal(result.succeeded, 1);
  assert.equal(result.failures.length, 2);
  const files = unzipSync(result.archive);
  assert.equal(Object.keys(files).length, 2);
  const report = new TextDecoder().decode(files["LEIA-ME.md"]);
  assert.match(report, /não tem legendas/);
  assert.match(report, /indisponível/);
});

for (const status of [402, 429, 401]) {
  test(`falha global do provedor ${status} interrompe cobranças e preserva arquivos coletados`, async () => {
    const { fetcher, calls } = fixture([
      Response.json({ videoIds: ids, shortIds: [], liveIds: [] }),
      Response.json(captions), new Response(null, { status }),
    ]);
    const result = await extractPlaylist(url, { signal: new AbortController().signal, fetcher, pause: async () => {}, onProgress: () => {} });
    assert.equal(calls.length, 3);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failures.length, 2);
    assert.ok(result.stopReason);
    assert.equal(Object.keys(unzipSync(result.archive)).length, 2);
  });
}

test("cancelamento preserva o ZIP parcial e não consulta os próximos vídeos", async () => {
  const controller = new AbortController();
  const { fetcher, calls } = fixture([Response.json({ videoIds: ids, shortIds: [], liveIds: [] }), Response.json(captions)]);
  const result = await extractPlaylist(url, {
    signal: controller.signal, fetcher, pause: async () => {},
    onProgress: (state) => { if (state.processed === 1) controller.abort(); },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failures.length, 2);
  assert.match(result.stopReason!, /cancelada/);
  assert.equal(Object.keys(unzipSync(result.archive)).length, 2);
});

test("coleta sem legendas produz somente relatório e informa zero arquivos", async () => {
  const { fetcher } = fixture([Response.json({ videoIds: [ids[0]], shortIds: [], liveIds: [] }), new Response(null, { status: 206 })]);
  const result = await extractPlaylist(url, { signal: new AbortController().signal, fetcher, pause: async () => {}, onProgress: () => {} });
  assert.equal(result.succeeded, 0);
  const files = unzipSync(result.archive);
  assert.deepEqual(Object.keys(files), ["LEIA-ME.md"]);
  assert.match(new TextDecoder().decode(files["LEIA-ME.md"]), /0 de 1/);
});

test("rota de playlist exige sessão, origem e JSON antes de consultar o provedor", async () => {
  const { api, calls } = fixture([]);
  const headers = { origin: "http://localhost:3000", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${createSession(password)}` };
  for (const [override, expected] of [[{ cookie: "" }, 401], [{ origin: "https://evil.example" }, 403], [{ "content-type": "text/plain" }, 415]] as const) {
    const response = await api.playlist(new Request("http://localhost:3000/api/playlist", { method: "POST", headers: { ...headers, ...override }, body: JSON.stringify({ url }) }));
    assert.equal(response.status, expected);
  }
  assert.equal((await api.playlist(new Request("http://localhost:3000/api/playlist", { method: "POST", headers, body: JSON.stringify({ url: "https://evil.example" }) }))).status, 400);
  assert.equal(calls.length, 0);
});

for (const [data, message] of [
  [{ videoIds: [], shortIds: [], liveIds: [] }, /vazia/],
  [{ videoIds: ["../evil"], shortIds: [], liveIds: [] }, /serviço externo/],
  [{ videoIds: ids }, /serviço externo/],
  [{ videoIds: Array(MAX_PLAYLIST_VIDEOS).fill(ids[0]), shortIds: [], liveIds: [] }, /5.000/],
] as const) {
  test(`playlist vazia, inválida ou no limite não é exportada silenciosamente: ${message}`, async () => {
    const { fetcher, calls } = fixture([Response.json(data)]);
    await assert.rejects(extractPlaylist(url, { signal: new AbortController().signal, fetcher, onProgress: () => {} }), message);
    assert.equal(calls.length, 1);
  });
}
