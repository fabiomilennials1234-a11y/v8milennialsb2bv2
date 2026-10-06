# Deploy do front na Cloudflare (teste em `*.workers.dev`)

Este guia serve o **mesmo front que está no ar** em `torquecrm.com.br` a partir da Cloudflare, numa URL de teste separada. O objetivo é provar que a Cloudflare entrega exatamente o que o nginx entrega hoje.

**Produção não é afetada.** O domínio `torquecrm.com.br` continua apontando para o nginx no EasyPanel, porque nada aqui mexe em DNS. Se algo der errado, basta apagar o Worker (ver [Desfazer](#desfazer)).

Este guia é o par do [`DEPLOY_EASYPANEL.md`](./DEPLOY_EASYPANEL.md), que continua valendo para produção.

---

## Glossário (três linhas)

- **Worker**: um programa pequeno que roda nos servidores da Cloudflare. Aqui ele faz o papel do nginx: escolhe a interface pelo cookie, aplica os headers de segurança e repassa `/api/v1/*` para o Supabase.
- **workers.dev**: o endereço de teste gratuito que a Cloudflare dá a todo Worker, no formato `https://torque-front.<seu-subdominio>.workers.dev`.
- **wrangler**: a ferramenta de linha de comando da Cloudflare. Ela já vem instalada neste repositório, em `cloudflare/`; não é preciso instalar nada global.

> Os comandos `npx … wrangler` deste guia começam com `WRANGLER_SEND_METRICS=false`, que desliga a telemetria do wrangler. Copie a linha inteira.

---

## Antes de começar (uma vez só)

1. **Node 22 ou mais novo.** Rode `node -v` no terminal; o número precisa começar com `v22` ou mais. Se não, instale a versão LTS em [nodejs.org](https://nodejs.org).
2. **Criar a conta na Cloudflare.**
   1. Abra [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) e crie a conta.
   2. Confirme o e-mail.
   3. O plano gratuito basta para o teste.
3. **Instalar o wrangler deste repositório** (na raiz do repo):
   ```bash
   npm --prefix cloudflare ci
   ```
4. **Entrar na conta pelo terminal:**
   ```bash
   WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler login
   ```
   1. O navegador abre uma página da Cloudflare pedindo permissão.
   2. Clique em **Allow**.
   3. Volte ao terminal e confira com o comando abaixo, que deve mostrar seu e-mail e o nome da conta:
   ```bash
   WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler whoami
   ```

   O login dá ao terminal acesso à **conta Cloudflare inteira**. Ao terminar o teste, saia (ver [Ao terminar](#ao-terminar)).

---

## Publicar: quatro comandos

Rode todos na raiz do repositório, nesta ordem.

### 1. Baixar o front que está no ar

```bash
npm run cf:extract
```

O comando baixa, só lendo, as duas interfaces (V5 e clássica) e todos os arquivos delas para `cloudflare/.prod-dist/`. A saída esperada é algo como `ok: 536 arquivos`.

O front é baixado em vez de buildado por um motivo: a build do EasyPanel usa variáveis (versão, Sentry…) que mudam o nome de cada arquivo. Uma build local não sairia idêntica, e a comparação do passo 4 não teria contra o que comparar.

### 2. Preparar o que vai para a Cloudflare

```bash
npm run cf:prepare -- --from cloudflare/.prod-dist
```

Este passo faz quatro coisas:

- copia o front para `cloudflare/.assets/`;
- apaga os source maps;
- gera os arquivos de configuração do servidor de arquivos da Cloudflare (`_headers` e `.assetsignore`);
- **recusa** a build se encontrar qualquer coisa com cara de segredo: `.env`, chave privada, `sb_secret_`, token `service_role`, `.git`, source map disfarçado etc.

Se recusar, a mensagem diz o arquivo e o motivo. Não publique nada até entender o porquê.

### 3. Publicar

```bash
npm run cf:deploy
```

Na **primeira vez**, se a conta ainda não tem subdomínio `workers.dev`, o terminal pergunta `Would you like to register a workers.dev subdomain now?`. Responda `y` e digite um nome (por exemplo `torque`).

No fim, o terminal mostra a URL, algo como `https://torque-front.torque.workers.dev`. Guarde-a.

### 4. Provar que é igual à produção

Troque `<URL>` pela URL do passo 3:

```bash
npm run cf:parity -- --a https://torquecrm.com.br --b <URL> --assets cloudflare/.assets --all-assets
```

O comando compara, URL por URL, a produção (A) com a Cloudflare (B), cerca de 600 casos. A última linha é o resultado, no formato:

```
TOTAL … casos — PASS … · EXPECTED-DIFF … · FAIL 0
```

O que vale é o **`FAIL 0`**. Os outros números mudam conforme o front que está no ar.

- **`FAIL 0`**: a Cloudflare entrega o mesmo que o nginx. Pronto.
- **`EXPECTED-DIFF`**: diferenças **de propósito**, todas listadas em [Diferenças intencionais](#diferenças-intencionais). Não é problema.
- **`FAIL` maior que zero**: alguma coisa difere de verdade. O detalhe aparece logo abaixo de cada linha `FAIL` (`↳ …`). Não siga adiante e mande a saída para o time.
- **`ABORTADO: prod redeployou`**: alguém fez merge na `main` e o EasyPanel publicou uma versão nova durante o teste. Repita os passos 1, 2 e 3; depois o 4.

---

## Ensaio local (opcional, não precisa de conta)

Este ensaio roda a mesma checagem na sua máquina, antes de publicar.

1. Faça os passos 1 e 2 acima.
2. Num **segundo terminal**, suba o Worker local e deixe-o aberto:
   ```bash
   npm run cf:dev
   ```
3. Espere aparecer `Ready on http://localhost:8787`.
4. No primeiro terminal, rode a comparação contra o Worker local:
   ```bash
   npm run cf:parity -- --a https://torquecrm.com.br --b http://localhost:8787 --assets cloudflare/.assets --all-assets
   ```
5. Para parar o Worker local, use `Ctrl+C` no segundo terminal.

---

## Teste manual no navegador

Abra a URL `workers.dev` e confira, nesta ordem:

1. **A interface clássica carrega.** Sem cookie, é a clássica, igual à produção.
2. **A V5 carrega com o cookie.**
   1. Abra o DevTools (`F12`) → **Console**.
   2. Rode `document.cookie = "torque_ui=v5; path=/"`.
   3. Recarregue a página: deve abrir a V5.
3. **O login funciona.** Login e leitura de dados vão direto ao Supabase.
4. **Telas que chamam edge function falham.** O DevTools mostra um erro de **CORS**, e isso é **esperado**: as edge functions só aceitam origens conhecidas (`supabase/functions/_shared/cors.ts`, `ALLOWED_ORIGINS`), e a URL de teste não está na lista. No ensaio local (`localhost`) elas funcionam, porque `localhost` é aceito.

> **Não reprove o teste por espaçamento quebrado na V5.** Hoje a V5 **em produção** sai com o texto espaçado errado ("CRM   de   Vendas", "2 0 2 6") quando o service worker controla a página. Na Cloudflare acontece o mesmo, porque é o mesmo front. A causa é do próprio front:
> - a CSP do `sw.js` não tem `fonts.gstatic.com` em `connect-src`;
> - a fonte Noto Color Emoji (#2246) está sem `unicode-range`.
>
> Há tarefa separada para isso.

---

## Logs

- **Ao vivo, no terminal:**
  ```bash
  WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler tail torque-front
  ```
  `Ctrl+C` para sair.
- **No painel:** [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **torque-front** → **Logs**.

Cada requisição que passa pelo Worker gera uma linha assim:

```json
{"method":"GET","path":"/leads","route":"spa","status":200,"ms":3}
```

- **A linha do Worker nunca tem** headers (como `X-API-Key`), corpo ou query string, porque a query da API pode carregar dado de lead.
- **O caminho também é limpo.** Links de e-mail e de pagamento carregam token no caminho: `/reset-password/<token>` (válido por 1 hora) e `/checkout/<token>`. A regra é **negar por padrão**:
  - **Caminho inteiro**, só nas rotas de estrutura conhecida: API (`/api/v1/*`), landing pages (`/lp/*`), páginas fixas (`/sobre`, `/privacidade`, `/.well-known/security.txt`), index, service worker e o redirect de `/api/v1`. Mesmo nelas, os tokens conhecidos viram marcador: `/api/v1/checkout/<token>` vira `/api/v1/checkout/:token`.
  - **Todo o resto** (telas do app, 404, 405, erro) grava **só o primeiro pedaço** do caminho, mais `/*` se houver outros: `/checkout/<token>` vira `/checkout/*`, `/configuracoes/usuarios` vira `/configuracoes/*`, e `/leads` continua `/leads`.
  - Se o primeiro pedaço não parece rota do app (mais de 32 caracteres, ou com algo além de letras, números e `-`; maiúscula vira minúscula), ele vira `:seg`. Por exemplo, um token solto em `/<token>` vira `/:seg`.
  - Assim, nem um token que ninguém listou chega ao log.
- O log automático da Cloudflare, que gravaria a URL inteira e os headers, está **desligado** em `cloudflare/wrangler.jsonc` (`invocation_logs: false`). A query também é cortada das URLs que a plataforma registra (`redact_query_string: true`).
- Os arquivos de `/assets/` **não aparecem** nos logs, porque saem direto do servidor de arquivos, sem passar pelo Worker.

> **Cuidado com o `wrangler tail`.** Além das linhas do Worker, ele mostra no terminal a URL de cada requisição, **com a query string e com o caminho como veio**, inclusive o token de `/reset-password/<token>` e de `/checkout/<token>` (link de pagamento). Use só para olhar, na hora. **Não cole a saída do `tail`** em chat, issue ou documento.

---

## Desfazer

Nada disto toca `torquecrm.com.br`.

- **Voltar para a versão anterior:**
  1. Liste as versões:
     ```bash
     WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler deployments list --name torque-front
     ```
  2. Volte para a versão escolhida:
     ```bash
     WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler rollback <version-id> --name torque-front
     ```
- **Apagar o Worker inteiro** (a URL `workers.dev` deixa de existir):
  ```bash
  WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler delete torque-front
  ```

---

## Ao terminar

Saia da conta no terminal. O `wrangler login` deixa gravado um acesso à conta Cloudflare inteira:

```bash
WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler logout
```

---

## Diferenças intencionais

O comando de paridade conhece estas diferenças e as marca como `EXPECTED-DIFF`. Elas valem para qualquer host B: o Worker local e o `workers.dev`.

| Div | O que muda | Por quê |
|---|---|---|
| Div1 | `/.well-known/security.txt` passa a responder 200 | Em produção dá 404 só porque o nginx bloqueia todo caminho com ponto. O arquivo existe para ser lido. |
| Div2 | `/lp/` (pasta sem página) dá 404 em vez de 403 | O 403 revela que a pasta existe. |
| Div3 | `/landing/`, `/api/`, `/landing` e `/api` abrem o app em vez de 301 → 403 | Não são rotas de usuário. O Worker não lista pastas. |
| Div4 | Redirect de pasta (`/lp/v1` → `/lp/v1/`, `/api/v1` → `/api/v1/`) com endereço relativo | **Bug de produção hoje:** o nginx manda para `http://torquecrm.com.br:8080/…`, um link quebrado. O conserto no nginx (`absolute_redirect off;`) é tarefa separada. |
| Div5 | Erro gerado pelo Worker vem com `Cache-Control: no-store` | Erro não deve ficar em cache. Hoje o nginx manda cache de 600 s no 404 das LPs e nenhum no 404 de dotfile. |
| Div6 | `manifest.webmanifest` sai como `application/manifest+json` | É o tipo correto. Hoje sai `application/octet-stream`. |
| Div7 | A compressão (br/gzip) é diferente | A comparação usa o conteúdo já descomprimido. Aparece só como nota e não conta como diferença. |
| Div8 | `X-Robots-Tag: noindex, nofollow` em `*.workers.dev`, nas respostas do Worker | A cópia de teste não entra no Google. Os arquivos de `/assets/` saem sem ele, porque não passam pelo Worker. Pôr o header no `_headers` o levaria junto para o domínio real no corte, e JS/CSS indexado é inofensivo. |
| Div9 | Respostas de `/api/v1/*` com cada header de segurança uma vez só | Hoje saem duplicados (Supabase + nginx), com duas CSPs. A política efetiva é a mesma. |
| Div10 | Erros do proxy da API (413 corpo grande, 502, 504) em JSON | Seguem o formato de erro da API, `{"error":{"code","message"}}`, em vez da página HTML do nginx. |
| Div11 | `/assets/<algo que não existe>` dá 404 para qualquer extensão | Hoje `/assets/x.json` devolve a tela do app (200), um acidente da regra do nginx. Na Cloudflare, `/assets/*` é servido direto pelo servidor de arquivos e nunca passa pelo Worker. |
| Div12 | No cookie, `,` também separa pares: `a=1,torque_ui=v5` num header só abre a V5 (em produção, a clássica) | A Cloudflare junta headers `Cookie` repetidos num só, separados por `, `, e o HTTP/2 manda o cookie em pedaços. Só com `;` como separador, quem tem a V5 cairia na clássica. O app nunca grava vírgula no cookie, e o RFC 6265 proíbe o servidor de gravar. |

---

## Segurança: o que está garantido

- **Source map nunca sai.** Há quatro camadas:
  - o `cf:prepare` apaga os `.map`;
  - o `cf:prepare` recusa source map com outro nome ou embutido no JS;
  - o `.assetsignore` impede o upload deles;
  - a paridade confere que nenhuma URL `.map` devolve source map.
- **Build com segredo não é publicada.** O `cf:prepare` recusa a build e diz o motivo. Ele procura chave privada (PEM/PGP), `sb_secret_`, token `service_role` e tokens de Sentry, Stripe, GitHub, OpenAI e Anthropic.
- **Os scripts não apagam o que não é deles.** `cf:extract` e `cf:prepare` só escrevem em pasta oculta dentro de `cloudflare/` (`cloudflare/.prod-dist`, `cloudflare/.assets`), que é apagada antes. Um `--out .` é recusado.
- **API pública (`/api/v1/*`).** O Worker:
  - repassa a `X-API-Key` do cliente sem tocar nela;
  - nunca acrescenta credencial;
  - aceita no máximo 1 MiB de corpo e espera até 30 s pela resposta;
  - só pede resposta comprimida ao Supabase se o cliente pediu: quem chama sem `Accept-Encoding` (um `curl` simples) recebe JSON legível, como no nginx;
  - só fala com `…supabase.co/functions/v1/api/v1/`, e caminho com `..` disfarçado é recusado.
- **Nenhum segredo no repositório.** A conta vem do `wrangler login`; `cloudflare/wrangler.jsonc` não tem `account_id` nem token.

---

## Checklist antes do corte (fase DNS, fora deste guia)

Nada disto é feito agora. É o que precisa estar resolvido antes de `torquecrm.com.br` apontar para a Cloudflare.

**Deploy e custo**

- [ ] **(a) Pipeline de deploy.** Hoje não existe. O `cf:extract` copia o que o nginx serve; depois do corte, o nginx não serve mais nada e o processo vira circular. Antes do corte é preciso um CI que faça:
  1. `npm run build:dual` com os mesmos `VITE_*` do EasyPanel, mais o upload de source map para o Sentry;
  2. `npm run cf:prepare -- --from dist`;
  3. `wrangler deploy` com um token de API de escopo mínimo (só Workers do `torque-front`), guardado em secret do CI.
- [ ] **(e) Workers Paid (US$ 5/mês).** No plano gratuito, o Worker atende 100 mil requisições por dia e tem 10 ms de CPU por requisição. Com o domínio de verdade, toda navegação e toda chamada à API passam pelo Worker (os arquivos de `/assets/` não contam).
- [ ] **(l) Checagens no CI:** `npm run cf:typecheck` e `WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler types --check`.

**DNS e domínio**

- [ ] **(b) A zona precisa ir para a Cloudflare.** Custom Domain exige que a zona `torquecrm.com.br` esteja na Cloudflare, ou seja, trocar os nameservers saindo da Hostinger. Antes, copie **todos** os registros: MX, `send.` (Resend), `calls.`, n8n e o que mais houver.
- [ ] **(f) Rollback de DNS.** Baixe o TTL dias antes. Deixe escrito como voltar os registros para o nginx.
- [ ] **(d) `workers_dev: false` depois do corte.** Senão o `*.workers.dev` continua sendo uma segunda origem pública do mesmo front.
- [ ] **(m) `www.torquecrm.com.br`.** Hoje ele serve o mesmo front (200, nginx). Precisa de Custom Domain também, ou de um redirect para `torquecrm.com.br`.
- [ ] **(n) HTTP → HTTPS.** Hoje o Traefik responde 308 de `http://` para `https://`. Na Cloudflare:
  - ligue **Always Use HTTPS**;
  - fixe a versão mínima de TLS (**Minimum TLS Version**).
- [ ] **Consertar o `:8080` no nginx** (Div4), independente desta mudança.
- [ ] **Incluir a nova origem em `ALLOWED_ORIGINS`**, se ela for diferente de `torquecrm.com.br`.

**Proteções da Cloudflare**

- [ ] **(c) Proteções contra robô na API.** Browser Integrity Check, Bot Fight Mode e Security Level podem responder 403 ou desafio para clientes-máquina em `/api/v1/*`. Crie uma regra de exceção para esse caminho, depois re-rode a paridade e o smoke no domínio real.
- [ ] **(o) Recursos que reescrevem o HTML.** **Email Obfuscation** e **Rocket Loader** injetam script e alteram o HTML. Desligue os dois na zona **antes** de rodar a paridade no domínio real.

**Smoke no `workers.dev` antes do corte**

O emulador local pode diferir da Cloudflare de verdade; estes itens só se provam lá.

- [ ] **(g) API com chave.** Use uma chave de API de uma organização **de teste**: GET, POST e PATCH em `/api/v1/*` funcionam pelo `workers.dev`.
- [ ] **(h) Cookie em pedaços (HTTP/2).** Este comando deve mostrar o arquivo de entrada da V5 (o mesmo `index-….js` do `cloudflare/.assets/index.html`):
  ```bash
  curl --http2 -s -H 'cookie: a=1' -H 'cookie: torque_ui=v5' https://<URL>/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
  ```
- [ ] **(i) Compressão negociada com o cliente.**
  1. Sem compressão, o comando não pode mostrar `037 213` (gzip) no começo:
     ```bash
     curl -s https://<URL>/api/v1/leads | od -c | head -1
     ```
  2. Com a lista do Chrome (`gzip, deflate, br, zstd`), a resposta tem de chegar legível.
     - Abra `https://<URL>/api/v1/leads` no Chrome, que já manda essa lista. Deve aparecer o JSON de erro, legível: `{"error":{"code":"unauthorized",…}}`.
     - **Não use o `curl` do macOS para isto.** Ele só decodifica gzip e deflate, então daria falso FAIL. Rode `curl -V | tail -1`: só use o `curl` se aparecerem `brotli` e `zstd` na lista.
- [ ] **(j) Logs da plataforma não guardam token nem query.**
  1. Gere duas sondas únicas:
     ```bash
     P=PROBE$(openssl rand -hex 6)
     curl -s -o /dev/null "https://<URL>/reset-password/$P?q=$P"
     curl -s -o /dev/null "https://<URL>/checkout/$P?q=$P"
     ```
  2. No painel (**Workers & Pages** → **torque-front** → **Logs**), procure o valor de `$P` em **todos** os campos dos eventos, não só na linha do Worker. O metadado do evento pode carregar a URL; o `redact_query_string` cobre a query, mas não o caminho.
  3. Se aparecer em qualquer campo, decida no ADR, **antes do corte**, entre duas saídas:
     - `observability.logs.enabled: false`;
     - aceitar, com a retenção mínima.
- [ ] **(k) Sentry.** O Sentry recusa a origem `workers.dev`, então erros do teste não chegam lá. No corte, confira que a origem nova é aceita.
- [ ] **Escrever o ADR do corte de DNS.**

---

## Referência técnica

| Arquivo | Papel |
|---|---|
| `cloudflare/wrangler.jsonc` | Configuração do Worker: nome, assets, `run_worker_first`, variável `API_UPSTREAM`, logs. |
| `cloudflare/headers.json` | Fonte única dos headers (espelho do `Dockerfile`). O teste `headers-drift` quebra se os dois divergirem. |
| `cloudflare/src/routing.ts` | Regras de rota, na mesma precedência do nginx. É uma função pura. |
| `cloudflare/src/worker.ts` | Entrada do Worker: busca o arquivo, aplica headers e grava o log. |
| `cloudflare/src/api-proxy.ts` | Proxy de `/api/v1/*` para a edge function `api`. |
| `cloudflare/src/headers.ts` | Aplica os perfis de header, sempre substituindo e nunca juntando. |
| `scripts/cloudflare/extract-prod.mjs` | `cf:extract`: baixa o front no ar. |
| `scripts/cloudflare/prepare-assets.mjs` | `cf:prepare`: copia, limpa, varre segredos e gera `_headers` e `.assetsignore`. |
| `scripts/cloudflare/parity.mjs` | `cf:parity`: comparação A × B. |
| `scripts/cloudflare/cookie-cases.json` | Variantes do cookie `torque_ui` medidas em produção (usadas pela paridade e pelos testes). |
| `scripts/cloudflare/lib.mjs` | Utilidades comuns aos três scripts, inclusive a trava do destino. |
| `tests/unit/cloudflare/` | Testes: `npx vitest run tests/unit/cloudflare`. |

### Por que o wrangler fica isolado em `cloudflare/`

O wrangler exige Node 22, e a build de produção (`Dockerfile`) usa Node 20 com `npm install` na raiz. Isolado, ele não entra na imagem e não altera o `package-lock.json` da raiz.

### Atualizar o wrangler

1. Troque a versão exata em `cloudflare/package.json`.
2. Rode `npm --prefix cloudflare install`.
3. Rode `npm --prefix cloudflare run types`, para regerar `cloudflare/worker-configuration.d.ts`.
4. Ajuste o `compatibility_date` no `wrangler.jsonc`. Ele não pode passar da data do runtime que vem com o wrangler, que aparece na terceira linha do `worker-configuration.d.ts` (`// Runtime types generated with workerd@… AAAA-MM-DD`).
