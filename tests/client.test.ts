import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTranscript } from "../lib/client.ts";
import { MAX_POLLS } from "../lib/transcript.ts";

const transcript = { text: "Texto completo", language: "pt", originalUrl: "https://youtu.be/dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" };
const completed = { status: "completed", transcript };

test("cliente aceita resultado imediato sem polling", async () => {
  let calls = 0;
  const result = await extractTranscript(transcript.originalUrl, {
    signal: new AbortController().signal, onPending: () => assert.fail("não deveria aguardar"),
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, "/api/transcript");
      assert.equal(new Headers(init?.headers).has("x-app-access-code"), false);
      assert.equal(init?.credentials, "same-origin");
      return Response.json(completed);
    },
  });
  assert.deepEqual(result, transcript);
  assert.equal(calls, 1);
});

test("cliente faz polling com intervalo, encaminha ticket atualizado e autentica cada consulta", async () => {
  let calls = 0;
  let pending = 0;
  const pauses: number[] = [];
  const result = await extractTranscript(transcript.originalUrl, {
    signal: new AbortController().signal, onPending: () => { pending++; },
    pause: async (ms) => { pauses.push(ms); },
    fetcher: async (url, init) => {
      assert.equal(new Headers(init?.headers).has("x-app-access-code"), false);
      assert.equal(init?.credentials, "same-origin");
      if (calls > 0) {
        assert.equal(url, "/api/transcript/status");
        assert.deepEqual(JSON.parse(String(init?.body)), { ticket: `ticket-${calls}` });
      }
      calls++;
      return Response.json(calls === 4 ? completed : { status: "pending", ticket: `ticket-${calls}` });
    },
  });
  assert.deepEqual(result, transcript);
  assert.equal(pending, 3);
  assert.deepEqual(pauses, [2000, 2000, 2000]);
});

test("cliente limita polling e não repete a extração", async () => {
  let calls = 0;
  await assert.rejects(extractTranscript(transcript.originalUrl, {
    signal: new AbortController().signal, onPending: () => {}, pause: async () => {},
    fetcher: async () => { calls++; return Response.json({ status: "pending", ticket: "ticket" }); },
  }), /limite de consultas/);
  assert.equal(calls, MAX_POLLS + 1);
});

test("cliente interrompe o polling se a página for desmontada", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(extractTranscript(transcript.originalUrl, {
    signal: controller.signal, onPending: () => controller.abort(), pause: async () => {},
    fetcher: async () => { calls++; return Response.json({ status: "pending", ticket: "ticket" }); },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("cliente identifica sessão expirada para voltar ao login", async () => {
  await assert.rejects(extractTranscript(transcript.originalUrl, {
    signal: new AbortController().signal, onPending: () => assert.fail(),
    fetcher: async () => Response.json({ error: { message: "Sessão expirada." } }, { status: 401 }),
  }), /sessão expirou/);
});
