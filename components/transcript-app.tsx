"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { extractTranscript, SessionExpiredError } from "@/lib/client";
import { extractPlaylist, type PlaylistProgress, type PlaylistResult } from "@/lib/playlist-client";
import { parseYouTubeSource } from "@/lib/playlist";
import { markdownFilename, MAX_URL_LENGTH, toMarkdown, type Transcript } from "@/lib/transcript";
import { Icon } from "./icon";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; mode: "video" | "playlist"; progress?: PlaylistProgress }
  | { kind: "error"; message: string }
  | { kind: "video"; transcript: Transcript; downloadUrl: string }
  | { kind: "playlist"; result: PlaylistResult; downloadUrl: string };

export function TranscriptApp() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [notice, setNotice] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const request = useRef<AbortController | null>(null);
  const download = useRef<string | null>(null);
  const mounted = useRef(true);
  const text = useRef<HTMLTextAreaElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const loading = state.kind === "loading";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      if (download.current) URL.revokeObjectURL(download.current);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    setNotice("");
    setCancelling(false);
    if (download.current) URL.revokeObjectURL(download.current);
    download.current = null;
    let source: ReturnType<typeof parseYouTubeSource>;
    try { source = parseYouTubeSource(url); }
    catch (error) { setState({ kind: "error", message: (error as Error).message }); return; }
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "loading", mode: source.kind });
    try {
      if (source.kind === "playlist") {
        const result = await extractPlaylist(url.trim(), {
          signal: controller.signal,
          onProgress: (progress) => { if (mounted.current) setState({ kind: "loading", mode: "playlist", progress }); },
        });
        if (!mounted.current) return;
        const downloadUrl = URL.createObjectURL(new Blob([result.archive], { type: "application/zip" }));
        download.current = downloadUrl;
        setState({ kind: "playlist", result, downloadUrl });
      } else {
        const transcript = await extractTranscript(url.trim(), { signal: controller.signal, onPending: () => {} });
        if (!mounted.current || controller.signal.aborted) return;
        // Prepare before the click so mobile browsers can follow a direct download link.
        const downloadUrl = URL.createObjectURL(new Blob(["\uFEFF", toMarkdown(transcript)], { type: "text/markdown;charset=utf-8" }));
        download.current = downloadUrl;
        setState({ kind: "video", transcript, downloadUrl });
      }
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (error) {
      if (!mounted.current) return;
      if (controller.signal.aborted) { setState({ kind: "idle" }); setNotice("Coleta cancelada."); return; }
      if (error instanceof SessionExpiredError) { window.location.replace("/"); return; }
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "O tempo de espera terminou. Tente novamente mais tarde."
        : error instanceof TypeError ? "Não foi possível conectar ao servidor. Verifique sua conexão."
        : error instanceof Error ? error.message : "Não foi possível concluir a extração. Tente novamente.";
      setState({ kind: "error", message });
    } finally {
      request.current = null;
    }
  }

  async function copy() {
    if (state.kind !== "video") return;
    try {
      await navigator.clipboard.writeText(toMarkdown(state.transcript));
      setNotice("Transcrição copiada.");
    } catch {
      text.current?.focus();
      text.current?.select();
      setNotice("Texto selecionado. Use a opção Copiar do navegador.");
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/session", { method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      window.location.replace("/");
    } catch { setNotice("Não foi possível sair. Verifique sua conexão e tente novamente."); }
  }

  const progress = state.kind === "loading" ? state.progress : undefined;
  const status = loading
    ? progress?.phase === "packing" ? "Preparando o ZIP…"
    : state.mode === "video" ? "Buscando legendas…"
    : !progress?.total ? "Lendo playlist…"
    : `${progress.processed} de ${progress.total} vídeos consultados · ${progress.succeeded} coletados`
    : state.kind === "video" ? "Transcrição pronta."
    : state.kind === "playlist" ? `ZIP pronto. ${state.result.succeeded} de ${state.result.playlist.videoIds.length} vídeos coletados.` : "";

  return <div className="app-shell">
    <a className="skip-link" href="#main">Pular para o conteúdo</a>
    <header className="site-header">
      <Link href="/" className="brand">YouTube Transcript</Link>
      <button type="button" onClick={logout} disabled={loading} className="text-button">Sair</button>
    </header>

    <main id="main" className="main-content">
      <h1>Transcrições do YouTube</h1>
      <p className="intro">Cole o link de um vídeo ou de uma playlist.</p>
      <form onSubmit={submit} aria-busy={loading} className="extract-form">
        <label className="field-label" htmlFor="video-url">Link do YouTube</label>
        <div className="input-row">
          <input id="video-url" name="url" type="url" inputMode="url" required maxLength={MAX_URL_LENGTH} autoComplete="off" spellCheck={false} placeholder="https://www.youtube.com/…" value={url} onChange={(event) => setUrl(event.target.value)} disabled={loading} className="field" aria-describedby="url-help" />
          <button type="submit" disabled={loading} className="primary-button">{loading ? <><span className="spinner" /> Extraindo…</> : "Extrair"}</button>
        </div>
        <p id="url-help" className="help-text">Vídeo em Markdown. Playlist em ZIP, com um arquivo por vídeo.<br />Links com <code>list=</code> coletam a playlist inteira.</p>
      </form>

      <div role="status" aria-live="polite" aria-atomic="true" className={loading ? "progress-section" : "sr-only"}>
        <p>{status}</p>
      </div>
      {loading && progress && progress.total > 0 ? <progress className="collection-progress" aria-label="Vídeos consultados" value={progress.processed} max={progress.total} /> : null}
      {loading ? <div className="loading-actions">
        <p className="help-text">{state.mode === "playlist" ? "Mantenha esta página aberta durante a coleta." : "A consulta pode levar até 2 minutos."}</p>
        <button type="button" className="text-button" disabled={cancelling || progress?.phase === "packing"} onClick={() => { setCancelling(true); request.current?.abort(); }}>{cancelling ? "Cancelando…" : "Cancelar"}</button>
      </div> : null}
      {state.kind === "error" ? <p role="alert" className="error-message">{state.message}</p> : null}

      {state.kind === "video" ? <section className="result" aria-labelledby="result-heading">
        <div className="result-header">
          <h2 id="result-heading" ref={resultHeading} tabIndex={-1}>Transcrição</h2>
          <a href={state.transcript.originalUrl} target="_blank" rel="noopener noreferrer" className="inline-link">Abrir vídeo</a>
        </div>
        <p className="help-text">Idioma: {state.transcript.language}</p>
        <textarea ref={text} readOnly aria-label="Transcrição formatada com link e tempos" lang={state.transcript.language} className="transcript-text" rows={14} value={toMarkdown(state.transcript)} />
        <div className="result-actions">
          <a href={state.downloadUrl} download={markdownFilename(state.transcript)} target="_blank" rel="noopener" className="secondary-button"><Icon name="download" /> Baixar Markdown</a>
          <button type="button" onClick={copy} className="secondary-button"><Icon name="copy" /> Copiar</button>
        </div>
        <p className="help-text">No iPhone, se o arquivo abrir, use Compartilhar → Salvar em Arquivos.</p>
      </section> : null}

      {state.kind === "playlist" ? <section className="result" aria-labelledby="result-heading">
        <div className="result-header">
          <h2 id="result-heading" ref={resultHeading} tabIndex={-1}>{state.result.failures.length ? "Coleta parcial" : "Playlist pronta"}</h2>
          <a href={state.result.playlist.originalUrl} target="_blank" rel="noopener noreferrer" className="inline-link">Abrir playlist</a>
        </div>
        <p className="result-summary">{state.result.succeeded} de {state.result.playlist.videoIds.length} vídeos coletados.</p>
        {state.result.stopReason ? <p className="help-text">{state.result.stopReason}</p> : null}
        <div className="result-actions"><a href={state.downloadUrl} download={`playlist-${state.result.playlist.playlistId}.zip`} target="_blank" rel="noopener" className="primary-button"><Icon name="download" /> Baixar ZIP</a></div>
        <p className="help-text">{state.result.succeeded ? "Um Markdown por vídeo, com link, idioma e tempos disponíveis." : "Nenhuma transcrição disponível. O ZIP contém apenas o relatório."} O arquivo LEIA-ME.md registra o resultado da coleta.</p>
        {state.result.failures.length ? <details className="failures"><summary>{state.result.failures.length} vídeos sem arquivo</summary><ul>{state.result.failures.map((failure) => <li key={failure.videoId}><a href={`https://www.youtube.com/watch?v=${failure.videoId}`} target="_blank" rel="noopener noreferrer" className="inline-link">{failure.videoId}</a><p>{failure.message}</p></li>)}</ul></details> : null}
      </section> : null}
      <p role="status" aria-live="polite" aria-atomic="true" className="notice">{notice}</p>
      <footer className="site-footer">Apenas legendas existentes · Sem histórico</footer>
    </main>
  </div>;
}
