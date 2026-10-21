"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { extractTranscript, SessionExpiredError } from "@/lib/client";
import { markdownFilename, MAX_URL_LENGTH, parseYouTubeUrl, toMarkdown, type Transcript } from "@/lib/transcript";
import { Icon } from "./icon";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; polling: boolean }
  | { kind: "error"; message: string }
  | { kind: "success"; transcript: Transcript; downloadUrl: string };

export function TranscriptApp() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const download = useRef<string | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const loading = state.kind === "loading";

  useEffect(() => () => {
    request.current?.abort();
    if (download.current) URL.revokeObjectURL(download.current);
  }, []);

  function clearDownload() {
    if (download.current) URL.revokeObjectURL(download.current);
    download.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    setNotice("");
    clearDownload();
    try { parseYouTubeUrl(url); }
    catch (error) { setState({ kind: "error", message: (error as Error).message }); return; }
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "loading", polling: false });
    try {
      const transcript = await extractTranscript(url.trim(), {
        signal: controller.signal,
        onPending: () => setState({ kind: "loading", polling: true }),
      });
      if (controller.signal.aborted) return;
      // Prepare before the click: mobile Safari needs a direct user gesture on the link.
      const downloadUrl = URL.createObjectURL(new Blob(["\uFEFF", toMarkdown(transcript)], { type: "text/markdown;charset=utf-8" }));
      download.current = downloadUrl;
      setState({ kind: "success", transcript, downloadUrl });
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpiredError) { window.location.replace("/"); return; }
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "O tempo de espera terminou. Tente novamente mais tarde."
        : error instanceof TypeError ? "Não foi possível conectar ao servidor. Verifique sua conexão."
        : error instanceof Error ? error.message : "Não foi possível extrair a transcrição. Tente novamente.";
      setState({ kind: "error", message });
    } finally {
      request.current = null;
    }
  }

  async function copy() {
    if (state.kind !== "success") return;
    try {
      await navigator.clipboard.writeText(toMarkdown(state.transcript));
      setNotice("Transcrição copiada com link, idioma e tempos disponíveis.");
    } catch {
      if (text.current) {
        text.current.focus();
        text.current.select();
        text.current.setSelectionRange(0, text.current.value.length);
      }
      setNotice("A cópia automática não foi permitida. O texto foi selecionado; use a opção Copiar do seu navegador.");
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/session", { method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      window.location.replace("/");
    } catch { setNotice("Não foi possível sair. Verifique sua conexão e tente novamente."); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Pular para o conteúdo</a>
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-6 sm:px-8 sm:py-8">
      <Link href="/" className="brand flex items-center gap-2.5" aria-label="YouTube Transcript — início">
        <span className="brand-mark"><Icon name="play" /></span>
        <span>YouTube <span className="font-normal text-muted">Transcript</span></span>
      </Link>
      <div className="flex items-center gap-4"><span className="native-badge hidden sm:inline-flex"><span /> Legendas originais</span><button type="button" onClick={logout} disabled={loading} className="inline-link min-h-11 text-xs">Sair</button></div>
    </header>

    <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-12 pt-8 sm:px-8 sm:pt-14">
      <div className="mb-9 sm:mb-11">
        <p className="eyebrow mb-4">MENOS PLAY. MAIS POSSIBILIDADES.</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Do YouTube para texto.<br /><span className="text-muted">Simples assim.</span></h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted">Cole o link de um vídeo e tenha as legendas completas em mãos. Prontas para copiar, ler e levar com você.</p>
      </div>

      <section className="panel overflow-hidden" aria-labelledby="form-heading">
        <div className="section-heading"><span className="step">01</span><h2 id="form-heading">Comece pelo vídeo</h2></div>
        <form onSubmit={submit} className="px-5 pb-6 sm:px-7 sm:pb-7" aria-busy={loading}>
          <label className="field-label" htmlFor="video-url">Link do YouTube</label>
          <div className="relative mt-2">
            <span className="input-icon"><Icon name="link" /></span>
            <input id="video-url" name="url" type="url" inputMode="url" required maxLength={MAX_URL_LENGTH} autoComplete="off" spellCheck={false} placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={(event) => setUrl(event.target.value)} disabled={loading} className="field pl-11" aria-describedby="url-help" />
          </div>
          <p id="url-help" className="mt-2 text-xs leading-5 text-muted">Aceita links de vídeos, youtu.be e Shorts.</p>
          <button type="submit" disabled={loading} className="primary-button mt-6 w-full">
            {loading ? <><span className="spinner" /> Extraindo legendas…</> : <>Extrair transcrição <Icon name="arrow" /></>}
          </button>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs leading-5 text-muted"><Icon name="check" className="h-3.5 w-3.5 shrink-0" /> Apenas legendas existentes. Sem geração, tradução ou resumo.</p>
        </form>
      </section>

      <div role="status" aria-live="polite" aria-atomic="true" className={loading ? "status-message mt-5" : "sr-only"}>
        {loading ? state.polling ? "As legendas estão sendo consultadas. Aguarde; a consulta termina automaticamente em até 2 minutos." : "Buscando as legendas originais do vídeo…" : state.kind === "success" ? "Transcrição extraída com sucesso." : ""}
      </div>
      {state.kind === "error" ? <div role="alert" className="error-message mt-5"><strong>Não foi possível concluir</strong><p className="mt-1 text-sm leading-6">{state.message}</p></div> : null}

      <section className="panel mt-6" aria-labelledby="result-heading" aria-busy={loading}>
        <div className="section-heading flex-wrap justify-between gap-3">
          <div className="flex items-center gap-3"><span className="step">02</span><h2 id="result-heading" ref={resultHeading} tabIndex={-1}>Sua transcrição</h2></div>
          {state.kind === "success" ? <span className="success-badge"><Icon name="check" className="h-3.5 w-3.5" /> Pronta</span> : <span className="text-xs text-muted">Texto completo</span>}
        </div>

        {state.kind === "success" ? <div className="px-5 pb-6 sm:px-7">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted"><span>Idioma: <strong className="text-foreground">{state.transcript.language}</strong></span><a href={state.transcript.originalUrl} target="_blank" rel="noopener noreferrer" className="inline-link">Abrir vídeo original ↗</a></div>
          <textarea ref={text} readOnly aria-label="Transcrição formatada com link e tempos" lang={state.transcript.language} className="transcript-text w-full resize-y" rows={14} value={toMarkdown(state.transcript)} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={copy} className="secondary-button"><Icon name="copy" /> Copiar transcrição</button>
            <a href={state.downloadUrl} download={markdownFilename(state.transcript)} target="_blank" rel="noopener" className="secondary-button"><Icon name="download" /> Baixar Markdown</a>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Arquivo .md em UTF-8, com link original, idioma e texto completo. No iPhone, se o arquivo abrir, use Compartilhar → Salvar em Arquivos.</p>
        </div> : <div className="empty-state px-6 pb-10 pt-4 text-center">
          <span className="document-mark mx-auto mb-4"><Icon name="document" className="h-6 w-6" /></span>
          <p className="text-sm font-medium">{loading ? "Seu texto está a caminho" : "O próximo passo é dar o primeiro play"}</p>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted">{loading ? "Estamos consultando as legendas do vídeo. Você pode manter esta página aberta." : "Adicione um link acima. A transcrição aparecerá aqui, pronta para copiar ou baixar."}</p>
        </div>}
      </section>
      <p role="status" aria-live="polite" aria-atomic="true" className="mt-3 text-sm text-muted">{notice}</p>
      <footer className="mt-9 flex flex-col justify-between gap-2 border-t border-line pt-5 text-xs leading-5 text-muted sm:flex-row"><span>Seu vídeo. As palavras dele.</span><span>Sem histórico · Legendas via Supadata</span></footer>
    </main>
  </div>;
}
