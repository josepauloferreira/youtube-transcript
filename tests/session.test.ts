import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionApi } from "../lib/server/session-api.ts";
import { createApi } from "../lib/server/api.ts";
import { createSession, SESSION_COOKIE, SESSION_SECONDS, sessionFromCookie, validSession } from "../lib/server/session.ts";

const password = "personal-password-test-123456";
const now = Date.UTC(2026, 9, 21);
const env = { NODE_ENV: "test", APP_ACCESS_CODE: password, SUPADATA_API_KEY: "provider-fixture" };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/session", { method: "POST", headers: {
    "content-type": "application/json", origin: "http://localhost:3000", ...headers,
  }, body: JSON.stringify(body) });
}

test("login gera cookie HttpOnly por 30 dias, sem devolver a senha", async () => {
  const api = createSessionApi(env, () => now);
  const response = await api.login(request({ password }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.ok(cookie.includes(`Max-Age=${SESSION_SECONDS}`));
  assert.equal(cookie.includes(password), false);
  assert.equal(validSession(sessionFromCookie(cookie), password, now), true);
});

test("cookie é Secure no Codespaces e na produção, inclusive com proxy interno", async () => {
  const platform = { ...env, CODESPACE_NAME: "my-space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" };
  const prod = { ...env, NODE_ENV: "production", VERCEL_URL: "my-project.vercel.app" };
  for (const [config, origin] of [[platform, "https://localhost:3000"], [platform, "http://localhost:3000"], [prod, "https://my-project.vercel.app"]] as const) {
    const response = await createSessionApi(config, () => now).login(request({ password }, { origin }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie")!, /; Secure/);
  }
});

test("senha errada e campos inválidos não criam sessão nem expõem credenciais", async () => {
  const api = createSessionApi(env, () => now);
  for (const received of ["", "wrong", "x".repeat(257), null, {}, 123]) {
    const response = await api.login(request({ password: received }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.has("set-cookie"), false);
    assert.equal((await response.text()).includes(password), false);
  }
});

test("login e logout recusam origem externa ou ausente", async () => {
  const api = createSessionApi(env, () => now);
  for (const action of [api.login, api.logout]) {
    for (const origin of ["https://evil.example", "null", ""]) {
      const response = await action(request({ password }, { origin }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.has("set-cookie"), false);
    }
  }
});

test("login valida tipo, tamanho e JSON", async () => {
  const api = createSessionApi(env, () => now);
  assert.equal((await api.login(request({ password }, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await api.login(request({ password: "x".repeat(3000) }))).status, 413);
  assert.equal((await api.login(new Request(request({}), { body: "{" }))).status, 400);
  assert.equal((await createSessionApi({ ...env, APP_ACCESS_CODE: "" }).login(request({ password }))).status, 503);
});

test("sessão resiste a alteração, expira e é invalidada ao trocar a senha", () => {
  const token = createSession(password, now);
  assert.equal(validSession(token, password, now), true);
  assert.equal(validSession(token + ".extra", password, now), false);
  assert.equal(validSession(token.replace(/.$/, "!"), password, now), false);
  assert.equal(validSession("", password, now), false);
  assert.equal(validSession(token, "another-personal-password", now), false);
  assert.equal(validSession(token, password, now + SESSION_SECONDS * 1000), false);
  assert.equal(validSession(token, password, now - 1000), false);
});

test("sessão de login autoriza extração e status; senha no header não substitui sessão", async () => {
  const response = await createSessionApi(env, () => now).login(request({ password }));
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  let calls = 0;
  const api = createApi({ env, now: () => now, fetcher: async () => {
    calls++;
    return calls === 1 ? Response.json({ jobId: "session-job" }, { status: 202 }) : Response.json({ status: "completed", result: { content: [{ text: "Olá!", offset: 0, duration: 1000 }], lang: "pt" } });
  } });
  for (const action of [api.extract, api.status]) {
    assert.equal((await action(request({}, { "x-app-access-code": password }))).status, 401);
  }
  assert.equal(calls, 0);
  const { ticket } = await (await api.extract(request({ url: "https://youtu.be/dQw4w9WgXcQ" }, { cookie }))).json();
  assert.equal((await api.status(request({ ticket }, { cookie }))).status, 200);
  assert.equal(calls, 2);
  const expired = createApi({ env, now: () => now + SESSION_SECONDS * 1000, fetcher: async () => assert.fail("não deve consultar o provedor") });
  assert.equal((await expired.extract(request({}, { cookie }))).status, 401);
});

test("logout apaga o cookie no navegador", async () => {
  const response = await createSessionApi(env, () => now).logout(request({}));
  assert.equal(response.status, 204);
  assert.ok(response.headers.get("set-cookie")!.startsWith(`${SESSION_COOKIE}=;`));
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
});
