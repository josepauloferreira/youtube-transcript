import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTimestamp, markdownFilename, MAX_URL_LENGTH, parseYouTubeUrl, toMarkdown, transcriptText } from "../lib/transcript.ts";

const id = "dQw4w9WgXcQ";
for (const url of [
  `https://youtube.com/watch?v=${id}`, `https://www.youtube.com/watch?v=${id}&t=42`,
  `https://m.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?si=abc`,
  `https://www.youtube.com/shorts/${id}`, `https://youtube.com/shorts/${id}/`,
  `http://youtube.com/watch?v=${id}`, ` https://youtu.be/${id} `,
]) {
  test(`aceita ${url}`, () => {
    const result = parseYouTubeUrl(url);
    assert.equal(result.videoId, id);
    assert.equal(result.originalUrl, url.trim());
    assert.equal(result.canonicalUrl, `https://www.youtube.com/watch?v=${id}`);
  });
}

for (const url of [
  undefined, null, {}, "", "not-a-url", `youtube.com/watch?v=${id}`,
  `https://youtube.com.evil.test/watch?v=${id}`, `https://evil.youtube.com/watch?v=${id}`,
  `https://youtube.com@evil.test/watch?v=${id}`, `https://user:password@youtube.com/watch?v=${id}`,
  `https://youtube.com:8080/watch?v=${id}`, `ftp://youtube.com/watch?v=${id}`,
  `https://youtube.com/watch?v=${id}&v=${id}`, "https://youtube.com/watch?v=short",
  `https://youtube.com/watch?v=${id}x`, "https://youtube.com/watch?v=...........",
  `https://youtu.be/${id}/extra`, `https://youtube.com/embed/${id}`,
  `https://youtube.com/shorts/${id}/extra`, "https://127.0.0.1/watch?v=" + id,
  `https://youtube.com/watch?v=${id}\n&x=1`, `https://youtube.com\\@evil.test/watch?v=${id}`,
  "https://youtu.be/" + "a".repeat(MAX_URL_LENGTH),
  `https://youtu.be/${id}?query=${"🎬".repeat(400)}`,
]) {
  test(`rejeita entrada ${JSON.stringify(url)?.slice(0, 90)}`, () => assert.throws(() => parseYouTubeUrl(url)));
}

test("Markdown preserva link original, idioma, Unicode e todo o texto sem interpretar marcação", () => {
  const transcript = {
    originalUrl: `https://youtu.be/${id}?t=20&si=original`, videoId: id, language: "pt-BR",
    text: "Olá, ação! 日本語 🎬\n\n# Título\n```\n<script>alert(1)</script>\nFim.\n",
  };
  const markdown = toMarkdown(transcript);
  assert.ok(markdown.includes(`Link original: <${transcript.originalUrl}>`));
  assert.ok(markdown.includes("Idioma identificado: pt-BR"));
  assert.ok(markdown.includes("\n\n````text\n" + transcript.text + "\n````\n"));
  assert.equal(Buffer.from(markdown, "utf8").toString("utf8"), markdown);
  assert.equal(markdownFilename(transcript), `youtube-${id}-pt-BR.md`);
});

test("Markdown suporta muitos delimitadores sem estouro da pilha", () => {
  const text = "` palavra ".repeat(150_000);
  assert.ok(toMarkdown({ originalUrl: `https://youtu.be/${id}`, videoId: id, language: "en", text }).includes(text));
});

test("cópia e Markdown incluem link, idioma e todos os tempos reais", () => {
  const transcript = {
    originalUrl: `https://youtu.be/${id}?t=20`, videoId: id, language: "pt-BR", text: "Olá!\nAté mais.",
    segments: [{ text: "Olá!", offset: 12500, duration: 1500 }, { text: "Até mais.", offset: 3723000, duration: 2000 }],
  };
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(59999), "00:59");
  assert.equal(formatTimestamp(60000), "01:00");
  assert.equal(formatTimestamp(3723000), "01:02:03");
  assert.equal(transcriptText(transcript), "[00:12] Olá!\n\n[01:02:03] Até mais.");
  const output = toMarkdown(transcript);
  assert.ok(output.includes(transcript.originalUrl));
  assert.ok(output.includes("Idioma identificado: pt-BR"));
  assert.ok(output.includes("[00:12] Olá!\n\n[01:02:03] Até mais."));
});
