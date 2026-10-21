import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../lib/server/api.ts";
import { MAX_POLLS, WORKFLOW_TIMEOUT_MS } from "../lib/transcript.ts";
import { MAX_EXTERNAL_BYTES } from "../lib/server/supadata.ts";
import { allowedOrigins } from "../lib/origins.ts";
import { createSession, SESSION_COOKIE } from "../lib/server/session.ts";

const code = "test-access-code-123456789";
const key = "test-provider-key-should-never-leak";
const original = "https://youtu.be/dQw4w9WgXcQ?t=20";
const env = { NODE_ENV: "test", APP_ACCESS_CODE: code, SUPADATA_API_KEY: key };
const now = 1_000_000;
const providerTranscript = { content: "Olá mundo!\nTexto completo 🎬", lang: "pt-BR", availableLangs: ["pt-BR"] };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/transcript", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: `${SESSION_COOKIE}=${createSession(code, now)}`, ...headers },
    body: JSON.stringify(body),
  });
}

function fixture(responses: (() => Response | Promise<Response>)[], overrides = env, clock = () => now) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    const response = responses.shift();
    assert.ok(response, "não deve realizar chamadas externas inesperadas");
    return response();
  };
  return { api: createApi({ env: overrides, fetcher, now: clock }), calls };
}

test("extração síncrona usa exclusivamente native, texto completo e URL canônica", async () => {
  const { api, calls } = fixture([() => Response.json(providerTranscript)]);
  const response = await api.extract(request({ url: original, mode: "generate", lang: "en" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "completed", transcript: { originalUrl: original, videoId: "dQw4w9WgXcQ", language: "pt-BR", text: providerTranscript.content, segments: [] },
  });
  const { url, init } = calls[0];
  assert.equal(url.origin, "https://api.supadata.ai");
  assert.equal(url.pathname, "/v1/transcript");
  assert.equal(url.searchParams.get("mode"), "native");
  assert.equal(url.searchParams.get("text"), "false");
  assert.equal(url.searchParams.get("url"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(url.searchParams.has("lang"), false);
  assert.equal(new Headers(init?.headers).get("x-api-key"), key);
  assert.equal(init?.redirect, "error");
  assert.equal(init?.cache, "no-store");
  assert.ok(init?.signal instanceof AbortSignal);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

for (const nested of [true, false]) {
  test(`fluxo assíncrono queued → active → completed, envelope ${nested}`, async () => {
    const { api, calls } = fixture([
      () => Response.json({ jobId: "job_123-abc" }, { status: 202 }),
      () => Response.json({ status: "queued" }), () => Response.json({ status: "active" }),
      () => Response.json({ status: "completed", ...(nested ? { result: providerTranscript } : providerTranscript) }),
    ]);
    let data = await (await api.extract(request({ url: original }))).json();
    assert.equal(data.status, "pending");
    for (let i = 0; i < 3; i++) data = await (await api.status(request({ ticket: data.ticket }))).json();
    assert.equal(data.status, "completed");
    assert.equal(data.transcript.text, providerTranscript.content);
    assert.equal(data.transcript.originalUrl, original);
    assert.equal(calls.length, 4);
    assert.ok(calls.slice(1).every(({ url }) => url.pathname === "/v1/transcript/job_123-abc" && !url.search));
  });
}

for (const action of ["extract", "status"] as const) {
  for (const received of ["", "wrong", "x".repeat(257)]) {
    test(`${action}: rejeita sessão inválida antes de consultar o provedor (${received.length})`, async () => {
      const { api, calls } = fixture([]);
      const response = await api[action](request({ url: original }, { cookie: `${SESSION_COOKIE}=${received}` }));
      assert.equal(response.status, 401);
      assert.equal(calls.length, 0);
      const body = await response.text();
      assert.ok(!body.includes(code) && !body.includes(key));
    });
  }
  test(`${action}: rejeita Origin ausente, null, malicioso e cabeçalhos de proxy falsificados`, async () => {
    const { api, calls } = fixture([]);
    for (const origin of ["null", "https://evil.example", "http://localhost:3000.evil.example", ""]) {
      const response = await api[action](request({}, { origin, "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }));
      assert.equal(response.status, 403);
    }
    assert.equal(calls.length, 0);
  });
}

test("Codespaces aceita a origem encaminhada e a reescrita HTTPS do proxy", async () => {
  const platform = { ...env, CODESPACE_NAME: "my-space-123", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" };
  const { api } = fixture([() => Response.json(providerTranscript), () => Response.json(providerTranscript)], platform);
  for (const origin of ["https://my-space-123-3000.app.github.dev", "https://localhost:3000"]) {
    const response = await api.extract(request({ url: original }, { origin, host: "localhost:3000" }));
    assert.equal(response.status, 200);
  }
  for (const origin of ["https://other-3000.app.github.dev", "https://localhost:3001", "https://evil.example"]) {
    assert.equal((await api.extract(request({ url: original }, { origin }))).status, 403);
  }
});

test("reescrita HTTPS local exige Codespaces e também funciona para status", async () => {
  const origin = "https://localhost:3000";
  const local = fixture([]);
  assert.equal((await local.api.extract(request({ url: original }, { origin, "x-forwarded-host": "my-space-123-3000.app.github.dev" }))).status, 403);
  const platform = { ...env, CODESPACE_NAME: "my-space-123", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" };
  const { api } = fixture([
    () => Response.json({ jobId: "abc" }, { status: 202 }),
    () => Response.json({ status: "completed", result: providerTranscript }),
  ], platform);
  const { ticket } = await (await api.extract(request({ url: original }, { origin }))).json();
  assert.equal((await api.status(request({ ticket }, { origin }))).status, 200);
});

test("produção só permite origens exatas da plataforma ou configuração explícita", () => {
  const origins = allowedOrigins({ NODE_ENV: "production", APP_ORIGIN: "https://transcript.example.com", VERCEL_URL: "preview-123.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "transcript.vercel.app", CODESPACE_NAME: "space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" });
  assert.deepEqual([...origins].sort(), ["https://preview-123.vercel.app", "https://transcript.example.com", "https://transcript.vercel.app"].sort());
  assert.equal(allowedOrigins({ NODE_ENV: "production", APP_ORIGIN: "https://example.com/path" }).size, 0);
});

test("configuração ausente falha com mensagem segura", async () => {
  for (const field of ["APP_ACCESS_CODE", "SUPADATA_API_KEY"] as const) {
    const { api, calls } = fixture([], { ...env, [field]: "" });
    const response = await api.extract(request({ url: original }));
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
    assert.ok(!(await response.text()).includes(key));
  }
});

test("valida URL, JSON, Content-Type e tamanho antes da chamada externa", async () => {
  const { api, calls } = fixture([]);
  assert.equal((await api.extract(request({ url: "https://evil.example" }))).status, 400);
  assert.equal((await api.extract(request({ url: "x".repeat(9000) }))).status, 413);
  assert.equal((await api.extract(request({ url: original }, { "content-type": "text/plain" }))).status, 415);
  const malformed = request({});
  const broken = new Request(malformed, { body: "{" });
  assert.equal((await api.extract(broken)).status, 400);
  assert.equal((await api.extract(request([]))).status, 400);
  assert.equal(calls.length, 0);
});

for (const [upstream, expected, errorCode] of [
  [206, 422, "NO_CAPTIONS"], [402, 402, "CREDITS_EXHAUSTED"], [429, 429, "RATE_LIMITED"],
  [403, 422, "VIDEO_UNAVAILABLE"], [404, 422, "VIDEO_UNAVAILABLE"],
  [401, 503, "PROVIDER_CONFIG"], [500, 502, "UPSTREAM_ERROR"], [502, 502, "UPSTREAM_ERROR"],
] as const) {
  test(`mapeia erro externo ${upstream} sem vazar a resposta`, async () => {
    const { api } = fixture([() => Response.json({ message: key, details: code }, { status: upstream })]);
    const response = await api.extract(request({ url: original }));
    assert.equal(response.status, expected);
    const body = await response.json();
    assert.equal(body.error.code, errorCode);
    assert.ok(!JSON.stringify(body).includes(key) && !JSON.stringify(body).includes(code));
  });
}

test("job failed tem tratamento de ausência de legendas", async () => {
  const { api } = fixture([
    () => Response.json({ jobId: "abc" }, { status: 202 }),
    () => Response.json({ status: "failed", error: { error: "transcript-unavailable", message: key } }),
  ]);
  const { ticket } = await (await api.extract(request({ url: original }))).json();
  const response = await api.status(request({ ticket }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "NO_CAPTIONS");
});

test("ticket não pode ser forjado, alterado, reutilizado após expiração ou usado com outro código", async () => {
  let clock = now;
  const { api, calls } = fixture([() => Response.json({ jobId: "abc" }, { status: 202 })], env, () => clock);
  const { ticket } = await (await api.extract(request({ url: original }))).json();
  for (const value of ["abc", ticket + ".extra", ticket.replace(/.$/, "!"), ticket.slice(0, -43) + "💥".repeat(21) + "a"]) {
    assert.equal((await api.status(request({ ticket: value }))).status, 400);
  }
  const [payload, signature] = ticket.split(".");
  const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
  changed.jobId = "another-job";
  assert.equal((await api.status(request({ ticket: Buffer.from(JSON.stringify(changed)).toString("base64url") + "." + signature }))).status, 400);
  const otherCode = "another-test-access-code";
  const other = fixture([], { ...env, APP_ACCESS_CODE: otherCode });
  assert.equal((await other.api.status(request({ ticket }, { cookie: `${SESSION_COOKIE}=${createSession(otherCode, now)}` }))).status, 400);
  clock += WORKFLOW_TIMEOUT_MS;
  assert.equal((await api.status(request({ ticket }))).status, 408);
  assert.equal(calls.length, 1);
});

test("polling termina após o limite de consultas sem reiniciar extração", async () => {
  const { api, calls } = fixture([
    () => Response.json({ jobId: "abc" }, { status: 202 }),
    ...Array.from({ length: MAX_POLLS }, () => () => Response.json({ status: "queued" })),
  ]);
  let { ticket } = await (await api.extract(request({ url: original }))).json();
  for (let i = 0; i < MAX_POLLS; i++) {
    const response = await api.status(request({ ticket }));
    const data = await response.json();
    if (i === MAX_POLLS - 1) {
      assert.equal(response.status, 408);
      assert.equal(data.error.code, "POLL_LIMIT");
    } else ticket = data.ticket;
  }
  assert.equal(calls.length, MAX_POLLS + 1);
});

for (const [name, responder, expected] of [
  ["JSON inválido", () => new Response("not json"), 502],
  ["corpo externo ausente", () => new Response(null), 502],
  ["resposta excessiva sem Content-Length", () => new Response("x".repeat(MAX_EXTERNAL_BYTES + 1)), 502],
  ["Content-Length excessivo", () => new Response("{}", { headers: { "content-length": String(MAX_EXTERNAL_BYTES + 1) } }), 502],
  ["sem conteúdo", () => Response.json({ content: "", lang: "pt" }), 422],
  ["idioma inválido", () => Response.json({ content: "abc", lang: "../../evil" }), 502],
  ["jobId inseguro", () => Response.json({ jobId: "../evil" }, { status: 202 }), 502],
  ["timeout", () => { throw new DOMException(key, "TimeoutError"); }, 504],
  ["falha de rede", () => { throw new TypeError(key); }, 502],
] as const) {
  test(`trata ${name}`, async () => {
    const { api } = fixture([responder]);
    const response = await api.extract(request({ url: original }));
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes(key));
  });
}

test("preserva todos os segmentos se o provedor retornar chunks", async () => {
  const segments = [{ text: "Primeiro", offset: 0, duration: 1500 }, { text: "Último", offset: 3723000, duration: 2000 }];
  const { api } = fixture([() => Response.json({ content: segments, lang: "pt" })]);
  const data = await (await api.extract(request({ url: original }))).json();
  assert.equal(data.transcript.text, "Primeiro\nÚltimo");
  assert.deepEqual(data.transcript.segments, segments);
});

test("fluxo assíncrono preserva os tempos originais sem gerar nem traduzir", async () => {
  const segments = [{ text: "Olá!", offset: 12500, duration: 2000 }];
  const { api } = fixture([
    () => Response.json({ jobId: "timestamps" }, { status: 202 }),
    () => Response.json({ status: "completed", result: { content: segments, lang: "pt" } }),
  ]);
  const { ticket } = await (await api.extract(request({ url: original }))).json();
  const result = await (await api.status(request({ ticket }))).json();
  assert.deepEqual(result.transcript.segments, segments);
});

test("recusa segmentos com tempos ausentes ou inválidos", async () => {
  for (const offset of [undefined, -1, null, "1000"]) {
    const { api } = fixture([() => Response.json({ content: [{ text: "Olá", offset, duration: 1000 }], lang: "pt" })]);
    assert.equal((await api.extract(request({ url: original }))).status, 502);
  }
});
