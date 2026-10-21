# YouTube Transcript

MVP em Next.js (App Router), TypeScript e Tailwind CSS, na raiz do repositório. Busca **apenas legendas existentes** de vídeos do YouTube pela Supadata. Exibe e copia o texto completo com link original, idioma e tempos das legendas, no mesmo formato do Markdown UTF-8 para download. Não gera texto por IA, traduz ou resume. Sem banco, histórico ou autenticação externa.

## Instalação e uso

Requer Node.js 24 (veja `.nvmrc`). No Codespaces, mantenha a configuração existente de `.devcontainer/devcontainer.json`.

```bash
nvm use
npm ci
cp .env.example .env.local
```

Preencha `.env.local`:

| Variável | Uso |
| --- | --- |
| `SUPADATA_API_KEY` | Chave da Supadata, usada exclusivamente no servidor. |
| `APP_ACCESS_CODE` | Senha pessoal de login, de 16 a 256 caracteres. O nome da variável foi mantido para aproveitar a configuração existente da Vercel. Prefira um valor aleatório ASCII, sem espaços; por exemplo, gerado com `openssl rand -hex 24`. |
| `APP_ORIGIN` | Opcional. Origem HTTPS exata de um domínio próprio, como `https://transcript.example.com`, sem caminho nem barra final. |

Não use o prefixo `NEXT_PUBLIC_` para segredos. `.env.local` e os demais arquivos `.env*` são ignorados pelo Git; `.env.example` é a única exceção. Nenhuma credencial é incluída neste repositório.

```bash
npm run dev
```

O servidor escuta em **0.0.0.0:3000**. Abra a porta 3000 na aba **Ports** do Codespaces e use sua URL encaminhada. No desenvolvimento local, abra `http://localhost:3000`.

Entre com sua senha pessoal (o mesmo valor antes usado como código de acesso). A sessão dura 30 dias neste navegador; não é preciso repetir a senha a cada extração. Use **Sair** para encerrar o acesso neste dispositivo. Depois cole uma URL `youtube.com/watch?v=…`, `youtu.be/…` ou `youtube.com/shorts/…` e selecione **Extrair transcrição**. Também são aceitos os hosts exatos `www.youtube.com` e `m.youtube.com`. O vídeo precisa estar disponível publicamente e ter legendas acessíveis. Legendas automáticas já existentes na plataforma também podem ser retornadas.

A interface segue a preferência claro/escuro do sistema. Possui labels, foco visível, navegação por teclado, anúncios de carregamento/erro e texto selecionável. A senha não fica no armazenamento do navegador. Um cookie assinado e HttpOnly mantém a sessão; o resultado permanece somente na memória da página. Trocar `APP_ACCESS_CODE` invalida as sessões existentes.

**Download móvel:** o link aponta diretamente para um Blob preparado após a extração, sem operação assíncrona no clique. A cópia e o arquivo `.md` usam exatamente o mesmo Markdown, com link original, idioma e todo o texto acompanhado de timestamps `[mm:ss]` ou `[hh:mm:ss]`. O download inclui BOM UTF-8. Os tempos vêm dos segmentos originais da Supadata; se o serviço devolver apenas texto, nenhum tempo é inventado. O Blob continua válido enquanto o resultado estiver aberto. Chrome no Android usa o download do navegador. No Safari do iPhone, se houver pré-visualização em vez de download, use **Compartilhar → Salvar em Arquivos**. A cópia exige permissão do navegador; se falhar, o texto é selecionado para cópia manual.

## Integração e limites

Implementação com `fetch`, sem SDK adicional, baseada na documentação oficial consultada em 21/10/2026:

- [Supadata — Transcript](https://docs.supadata.ai/get-transcript): `GET /v1/transcript` com `mode=native` e `text=false` para preservar os segmentos com `offset` e `duration` em milissegundos; sem parâmetro `lang` ou fallback para geração.
- [Supadata — erros](https://docs.supadata.ai/errors/list): ausência de legendas (`206`), plano/créditos (`402`), indisponibilidade (`403`/`404`), limite (`429`) e falhas externas.
- `200` retorna texto imediato; `202` retorna um job. `GET /v1/transcript/{jobId}` aceita `queued`, `active`, `completed` e `failed`. O parser suporta o resultado direto e o envelope `result` mostrado nos exemplos oficiais.

O login usa `POST /api/session` (`{ "password": "…" }`); `DELETE /api/session` encerra a sessão no navegador. A senha é validada no servidor, com comparação de hashes em tempo constante. O cookie de sessão tem prazo de 30 dias, `HttpOnly`, `SameSite=Strict`, caminho `/` e `Secure` em HTTPS/produção. Não há cadastro, banco ou provedor externo de login. As rotas internas `POST /api/transcript` (`{ "url": "…" }`) e `POST /api/transcript/status` (`{ "ticket": "…" }`) exigem `Content-Type: application/json`, `Origin` permitido e sessão válida no servidor. O antigo header `x-app-access-code` não concede acesso. Status exige também um token HMAC emitido na extração, vinculado ao job, link e prazo. O cliente recebe mensagens próprias; corpos de erro da Supadata e credenciais não são expostos nem registrados. Respostas internas e chamadas externas não são armazenadas em cache.

Limites:

- URL: 2.048 caracteres; ID: exatamente 11 caracteres válidos. Hosts exatos, sem credenciais, portas ou caminhos extras. A Supadata recebe uma URL HTTPS canônica, sem parâmetros fornecidos pelo usuário.
- Corpo da solicitação: 8 KiB; resposta externa: 2.000.000 bytes, contados durante a leitura do stream, inclusive sem `Content-Length`. Conteúdo acima do limite é recusado integralmente, sem truncar o texto.
- Timeout externo: 15 segundos por chamada, abrangendo o corpo; redirects não são seguidos. Cliente: 25 segundos por requisição e 120 segundos para o fluxo completo. Funções Vercel: limite de 30 segundos.
- Polling: intervalo de 2 segundos, até 30 consultas, com prazo de 120 segundos no token. Sem repetição automática da extração ou fallback. A consulta para em sucesso, erro, expiração ou ao sair da página. O contador do token limita a sequência normal; como a aplicação é sem estado, não impede replay de um token ainda válido por alguém com uma sessão válida.

`APP_ACCESS_CODE` é a senha pessoal deste aplicativo de um único usuário, sem cadastro de contas ou mecanismo distribuído de limitação de tentativas. Não inclua segredos nos links de vídeos. Consultas nativas podem consumir créditos inclusive quando não há legendas, conforme a documentação da Supadata.

## Origin e proxy do Codespaces

Não há comparação da origem externa com o hostname interno `localhost`. A origem permitida do Codespaces é calculada a partir de `CODESPACE_NAME` e `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, com a porta 3000. O mesmo hostname exato é usado no [`allowedDevOrigins` do Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins); não são usados curingas. Reinicie `npm run dev` se as variáveis da plataforma mudarem.

No desenvolvimento dentro do Codespaces, também é aceita a origem exata `https://localhost:3000`, pois o proxy pode reescrever o `Origin` HTTPS encaminhado para esse endereço interno. Essa exceção não é habilitada em produção nem no desenvolvimento fora do Codespaces.

As rotas não confiam em `Host`, `Forwarded` ou `X-Forwarded-Host` enviados pelo cliente para autorizar uma origem. Em produção, são aceitas apenas `https://VERCEL_URL`, `https://VERCEL_PROJECT_PRODUCTION_URL` (hosts `vercel.app` exatos) e o `APP_ORIGIN` explícito. Origens ausentes, `null` ou desconhecidas são recusadas. Para domínio próprio na Vercel, configure `APP_ORIGIN` antes do deploy.

A porta pode continuar privada: abra-a autenticado no GitHub. Para verificação automatizada, a [documentação do GitHub](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace) permite autenticar a URL encaminhada com `X-Github-Token`; não exponha esse token nem o adicione ao código da aplicação.

## Verificações

```bash
npm run lint
npm run typecheck
npm test
npm run build
# Executa as quatro verificações acima, em sequência:
npm run check
```

Os testes usam o runner nativo do Node.js 24 e chamadas externas simuladas. Cobrem login, cookies, sessão alterada/expirada, logout, URLs válidas e maliciosas, preservação do Markdown/Unicode e dos tempos, autorização nas duas rotas, origens com proxy, integração síncrona e assíncrona, tokens alterados/expirados, polling limitado, timeouts, tamanho máximo e erros do provedor. Não consomem créditos e não precisam de segredos.

Os testes de sessão incluem login seguido de extração e polling, cookies seguros no Codespaces e em produção, expiração e troca de senha. A validação real em aparelhos físicos continua sendo uma checagem manual.

`npm run typecheck` gera os tipos de rotas antes do TypeScript, funcionando também em checkout limpo. `npm run build` não precisa das credenciais; as rotas recusam extrações em runtime quando a configuração estiver ausente. `npm start` serve o build de produção na porta 3000.

O audit da instalação identificou um aviso sem correção compatível publicada em `braces`, transitivo das ferramentas de lint do Next.js (cinco entradas no audit completo). Não é dependência de produção; `npm audit --omit=dev` não apontou vulnerabilidades. O ESLint 9 é mantido por compatibilidade com os plugins atuais do Next.js.

## Deploy na Vercel

1. Importe o repositório na Vercel, selecione **Next.js**, diretório raiz `./` e Node.js **24.x**.
2. Configure `SUPADATA_API_KEY` e `APP_ACCESS_CODE` nas variáveis de ambiente de Production e, se necessário, Preview. Não use variáveis públicas. Configure `APP_ORIGIN` se usar domínio próprio.
3. Use a instalação `npm ci` e o build `npm run build`. Não são necessários banco, serviços adicionais ou arquivo de configuração da Vercel.
4. Após publicar, abra a URL HTTPS, entre com a senha pessoal, extraia um vídeo público com legendas e teste copiar/baixar. Mudanças em variáveis exigem novo deploy.

Para validar a integração real, é necessário fornecer uma chave válida da Supadata e a senha pessoal em `.env.local`. Os testes simulados não comprovam a disponibilidade de um vídeo específico, o saldo da conta ou o download em aparelhos físicos.
