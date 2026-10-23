"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "Não foi possível entrar. Tente novamente.");
      }
      setPassword("");
      window.location.replace("/");
    } catch (error) {
      setError(error instanceof TypeError ? "Verifique sua conexão e tente novamente." : error instanceof Error ? error.message : "Não foi possível entrar.");
      setLoading(false);
    }
  }

  return <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-10">
    <div className="brand mb-10">YouTube Transcript</div>
    <section aria-labelledby="login-title">
      <h1 id="login-title">Entrar</h1>
      <p id="login-help" className="help-text">Use sua senha para acessar as transcrições.</p>
      <form onSubmit={login} aria-busy={loading} className="mt-6">
        <label htmlFor="password" className="field-label">Senha pessoal</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={loading} value={password} onChange={(event) => setPassword(event.target.value)} className="field mt-2 px-3" aria-describedby="login-help" />
        <button type="submit" disabled={loading} className="primary-button mt-5 w-full">{loading ? <><span className="spinner" /> Entrando…</> : "Entrar"}</button>
      </form>
      {error ? <p role="alert" className="error-message mt-4">{error}</p> : null}
    </section>
  </main>;
}
