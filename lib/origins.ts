type Environment = Readonly<Record<string, string | undefined>>;

// Hostnames come only from platform configuration, never request headers.
export function codespacesHost(env: Environment): string | undefined {
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  if (!domain || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) return;
  return `${name}-3000.${domain}`;
}

export function allowedOrigins(env: Environment): Set<string> {
  const origins = new Set<string>();
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    const host = codespacesHost(env);
    if (host) {
      origins.add(`https://${host}`);
      // Codespaces can rewrite the HTTPS forwarded Origin to this local address.
      origins.add("https://localhost:3000");
    }
  }
  for (const host of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host && /^[a-z0-9-]+\.vercel\.app$/.test(host)) origins.add(`https://${host}`);
  }
  if (env.APP_ORIGIN) {
    try {
      const url = new URL(env.APP_ORIGIN);
      if (url.protocol === "https:" && url.origin === env.APP_ORIGIN) origins.add(url.origin);
    } catch { /* Invalid configuration fails closed. */ }
  }
  return origins;
}
