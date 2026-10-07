# Deploy do front na Cloudflare (teste em `*.workers.dev`)

Este guia serve o **mesmo front que está no ar** em `torquecrm.com.br` a partir da Cloudflare, numa URL de teste separada. O objetivo é provar que a Cloudflare entrega exatamente o que o nginx entrega hoje.

A publicação de rotina é do CI: a cada push na `main`, o GitHub Actions builda e publica em degraus, com rollback automático (ver [Pipeline de deploy (CI)](#pipeline-de-deploy-ci)). Os comandos à mão de [Publicar](#publicar-quatro-comandos) continuam valendo para a fase de teste e para o ensaio local.

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

## Pipeline de deploy (CI)

Depois do corte, o `cf:extract` deixa de servir: o nginx não serve mais nada para ser copiado. Quem publica passa a ser o GitHub Actions, a cada push na `main`.

- **Workflow:** `.github/workflows/deploy-front-cloudflare.yml`.
- **Verificação de PR:** `.github/workflows/verify-front-cloudflare.yml`. Roda sem segredo nenhum e só quando o PR toca o front: `build:dual`, `cf:prepare`, `cf:typecheck`, `wrangler types --check` e `vitest tests/unit/cloudflare`.

> **O merge do PR do pipeline já é o primeiro deploy real**, no `workers.dev`. Os dois secrets já existem (`front-build/SENTRY_AUTH_TOKEN` e `front-production/CLOUDFLARE_API_TOKEN`). Confira a execução pelas [checagens da primeira execução](#checagens-da-primeira-execução-o-merge).

### O que acontece num push na `main`

| Job | Environment | O que faz |
|---|---|---|
| `build` | `front-build` | 1. `cf:ci:check-env`: falha **antes** da build se faltar `VITE_*` obrigatória, ou se alguma `VITE_*` tiver cara de segredo.<br>2. `npm ci --ignore-scripts`.<br>3. `build:dual`, com os mesmos `VITE_*` e defaults do `Dockerfile` (o teste `build-env-drift` quebra se divergirem). O `SENTRY_AUTH_TOKEN` existe só neste step.<br>4. `cf:prepare -- --from dist`.<br>5. Sobe `cloudflare/.assets` como artifact por 3 dias. **Nunca** o `dist/`, que ainda tem os source maps. |
| `deploy` | `front-production` | `node scripts/cloudflare/ci-deploy.mjs`, com o `CLOUDFLARE_API_TOKEN` só neste step. |

O `ci-deploy` publica em degraus:

0. **Confere que o commit ainda é o HEAD da `main`** (`git ls-remote`). Se não for (re-run de uma execução antiga, ou um push mais novo já na fila), **não publica** e sai com o código 4 (OBSOLETO); quem publica é a execução do HEAD.
   - **Repositório público** (hoje): a consulta funciona sem credencial.
   - **Repositório privado:** o step recebe o token do próprio job (`GITHUB_TOKEN`, só `contents: read`).
     - O `ci-deploy` o entrega ao git como header `AUTHORIZATION`, só para `https://github.com/`, por variável de ambiente do git (`GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`, o mesmo header do `actions/checkout`).
     - O token nunca vai na linha de comando (visível no `ps`), nem na URL, nem no log, e o wrangler não o recebe.
     - Funciona igual nos dois casos.
   - O git roda fora de qualquer repositório: num diretório temporário vazio, com `GIT_CEILING_DIRECTORIES`, sem config global e sem config de sistema. Um `url.<x>.insteadOf` no `.git/config` do checkout não redireciona a consulta.
   - Se a consulta falhar (rede, GitHub fora, token sem acesso), o deploy **para no passo 0, sem publicar**. É a falha segura.
1. **Guarda a versão anterior**, a que está em 100 % (`wrangler deployments status --json`). Se a deployment estiver dividida entre duas versões, alguém está no meio de algo, e o CI **não publica**.
2. **Sobe a versão nova sem tráfego:** `wrangler versions upload --tag <sha> --message "GitHub Actions run <id>"`. O id da versão sai do arquivo ND-JSON do wrangler (`WRANGLER_OUTPUT_FILE_PATH`), não do texto do terminal.
3. **Põe a nova a 0 %:** `wrangler versions deploy <nova>@0% <anterior>@100%`.
4. **Smoke A** na versão nova, com o header `Cloudflare-Workers-Version-Overrides: torque-front="<nova>"`. Toda resposta do Worker tem de trazer `X-Torque-Version: <nova>` (ver [Prova de versão](#prova-de-versão-x-torque-version)). Ele tenta de novo por até 2 min (propagação). Se falhar, a deployment volta para `<anterior>@100%` e o job fica vermelho. **A versão nova nunca recebe tráfego sem passar no A.**
5. **Promove:** `wrangler versions deploy <nova>@100%`.
6. **Aplica as configurações de domínio do `wrangler.jsonc`:** `wrangler triggers deploy` (`workers_dev` e `preview_urls`). O wrangler marca esse comando como experimental.
7. **Smoke B**, sem override. Ele espera até `X-Torque-Version` ser a nova e só então avalia o resto, tentando por até 3 min.
8. **Se o B falhar** (ou o passo 5 ou 6), o rollback é automático: `wrangler versions deploy <anterior>@100%`, seguido de um smoke autoconsistente da anterior, e o job fica vermelho.

Não há canário percentual: a nova vai de 0 % a 100 %.

**Prazos.** Todo comando do wrangler tem prazo:

| Comando | Prazo |
|---|---|
| `versions upload` | 300 s |
| `deployments status`, `versions deploy`, `triggers deploy` | 60 s cada |
| `git ls-remote` | 15 s |

Toda requisição do smoke tem 10 s, e cada rodada do smoke tem 60 s no total. No pior caso, com tudo estourando, o `ci-deploy` leva 1.275 s (≈ 21,3 min). A conta está no comentário do job `deploy`, e o teste `deploy-workflow` a refaz a partir das constantes do código. Por isso o step tem 24 min e o job, 30.

**Job cancelado ou estourou o prazo.** O runner manda `SIGINT`/`SIGTERM` ao `ci-deploy`. O step usa `exec node`, então o sinal chega direto ao node. Se o sinal cair entre a promoção e o B verde, o `ci-deploy`:

1. mata o wrangler em voo;
2. volta a anterior a 100 %, antes do `SIGKILL` (≈ 10 s depois);
3. sai com 130 ou 143.

- **Antes de tentar o rollback**, o `ci-deploy` grava no Summary um resumo provisório: "rollback para X em andamento; se este resumo não mudar, rode o workflow com `rollback_to=X`". Um `SIGKILL` no meio do rollback não deixa o Summary vazio.
- **Se o rollback falhar**, o Summary traz o `rollback_to` para rodar à mão.
- **Se o B fechar PASS enquanto o rollback do sinal ainda roda**, o fluxo principal espera o rollback terminar, e o resultado é o do rollback, nunca "PROMOVIDO". O fim da execução é um só (`createFinish` é idempotente).

Dois casos-limite, aceitos:

- **`SIGTERM` durante o smoke A** deixa a deployment em `nova@0% anterior@100%`. É inofensivo: a nova não recebe tráfego. O próximo deploy trata, porque ele toma como anterior a versão que está em 100 %.
- **`SIGTERM` com o `versions deploy <nova>@100%` em voo** tem uma corrida pequena. O handler mata o wrangler local, mas o pedido pode já ter chegado à Cloudflare. O rollback é enviado depois e, portanto, é aplicado depois. Mesmo assim, **confira com o smoke**:
  ```bash
  npm run cf:smoke -- --url <CF_SMOKE_URL> --expect-version <anterior> --allow-missing-version
  ```

**Códigos de saída do `ci-deploy`:**

| Código | Significado |
|---|---|
| 0 | publicado (ou drill OK) |
| 1 | falhou; se depois da promoção, já com rollback |
| 2 | uso: argumento, token ou artefato faltando; nada publicado |
| 3 | BLOQUEADO: desafio da zona |
| 4 | OBSOLETO: não é o HEAD da `main` |
| 130 / 143 | interrompido |

O resumo de cada execução aparece na página da execução, no **Summary**: versões, resultado de cada etapa e as primeiras falhas do smoke.

**Um deploy por vez.** O grupo `front-cloudflare-production` não cancela o que está rodando, e a fila guarda **um** pendente só: o que chega por último substitui o que estava esperando. Ver o efeito disso no rollback em [Rollbacks](#rollbacks-três-caminhos).

### Prova de versão (`X-Torque-Version`)

Toda resposta que o **Worker** gera leva `X-Torque-Version: <version id>`: páginas, SPA, LPs, redirects, 404, 405, 500 e a API. O id vem do binding `version_metadata` (`CF_VERSION_METADATA` no `wrangler.jsonc`). Os arquivos de `/assets/*` saem direto do servidor de assets, sem Worker, e não levam o header.

**Por que existe.** Medido em 2026-10-07: um override para uma versão que não está na deployment é **ignorado em silêncio**, e a resposta vem 200 com a versão atual. Sem a prova, um commit que muda só o código do Worker passaria no A e no B contra a versão **anterior**.

**O que cada smoke exige:**

| Smoke | `X-Torque-Version` |
|---|---|
| A | = nova (`--override` implica `--expect-version`) |
| B | = nova; repete até ser, e só então avalia |
| Depois de um rollback, automático ou manual | = alvo **ou ausente** (`--allow-missing-version`): a versão alvo pode ser de antes do header, mas outro id nunca serve |

**Primeiro deploy.** A versão publicada hoje (`20d8f008-…`) é de antes do header. Medido contra o `workers.dev` em 2026-10-07:

| Smoke | Resultado |
|---|---|
| autoconsistente | PASS |
| `--assets` | PASS |
| `--expect-version 20d8f008-…` | FAIL nos dois index (`sem X-Torque-Version`), sem avaliar o resto |
| `--expect-version 20d8f008-… --allow-missing-version` | PASS |

No merge, isso vira:

- o A e o B exigem a versão **nova**, que já sai deste código com o header;
- se o A falhar só por `sem X-Torque-Version`, o override pegou a anterior (propagação), e as novas tentativas do A cobrem isso;
- o rollback para a `20d8f008-…` passa, com o header ausente.

### O smoke (`npm run cf:smoke`)

```bash
npm run cf:smoke -- --url https://torque-front.torquecrm.workers.dev                            # autoconsistente
npm run cf:smoke -- --url https://torque-front.torquecrm.workers.dev --assets cloudflare/.assets  # contra o artefato
```

Opções: `--override <version-id>`, `--expect-version <version-id>`, `--allow-missing-version` e `--retry-for <segundos>`.

- **Com `--assets`**, o host tem de servir exatamente aqueles arquivos. Este é o modo do deploy.
- **Sem `--assets`** (autoconsistente), a referência é o próprio host: o `/` sem cookie tem de ser o `/index.classic.html` que ele serve, e assim por diante. Este é o modo do rollback, quando não há artefato local da versão.

O que ele confere:

- o `/` com cada variante de cookie de `cookie-cases.json`;
- `sw.js` e `sw.classic.js`;
- os chunks de entrada dos dois index: 200, mesmo sha256 do artefato, `Cache-Control` imutável e headers do app;
- `<chunk>.map` dá 404;
- `/api/v1/leads` sem `Accept-Encoding`: 401, sem gzip, envelope `{"error":{…}}`;
- uma CSP só, e os headers de `cloudflare/headers.json`;
- a rota do SPA (`/leads`);
- `X-Robots-Tag` presente no `workers.dev` e ausente no domínio real;
- `X-Torque-Version`, quando há versão esperada.

O resultado sai como **PASS** (código 0), **FAIL** (1) ou **BLOQUEADO** (3):

- **BLOQUEADO** significa que alguma resposta veio com `cf-mitigated: challenge`. É o desafio da zona, e o smoke não chegou ao Worker. Não é defeito da versão:
  - no A, nada é promovido;
  - no B, nada é desfeito, porque o A já provou a versão pelo `X-Torque-Version`; o job fica vermelho para alguém olhar.
- **Controle negativo, medido em 2026-10-07:** contra o nginx de produção, o smoke dá FAIL exatamente nas duas divergências conhecidas, a Div12 (cookie com vírgula) e a Div9 (CSP duplicada na API).

### Rollbacks: três caminhos

Rollback troca só a versão do código e dos assets. Não mexe em rotas, domínio, variáveis nem secrets. Vale para qualquer uma das 100 últimas versões.

1. **Automático.** Acontece no passo 8 acima, ou num `SIGINT`/`SIGTERM` entre a promoção e o B verde, sem ninguém fazer nada.
2. **Botão no GitHub.** **Actions** → **Deploy Front (Cloudflare)** → **Run workflow**. Preencha `rollback_to` com o version id, que aparece no Summary da execução ou em `wrangler versions list`. O job `rollback` roda `versions deploy <id>@100%` e um smoke autoconsistente.
3. **Local**, com o `wrangler login` do CTO:
   ```bash
   WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler deployments list --name torque-front
   WRANGLER_SEND_METRICS=false npx --prefix cloudflare wrangler rollback <version-id> --name torque-front
   ```

> **O rollback manual (2 e 3) dura só até o próximo push na `main`.** O push seguinte builda o HEAD e publica de novo, inclusive o defeito. Depois de um rollback manual:
> 1. **reverta o commit culpado** (`git revert`, PR, merge);
> 2. só então mergeie outra coisa.
>
> **Na fila, um substitui o outro.** O grupo de concorrência guarda um pendente só:
> - um push novo que chega enquanto um rollback espera na fila **cancela o rollback**;
> - um rollback disparado enquanto um deploy espera **cancela o deploy**.
>
> Confira no Actions que o rollback rodou de fato.

**Drill de rollback.** **Run workflow** com `drill` marcado. O pipeline publica, passa no B e força o rollback automático, para exercitar o caminho que só roda quando produção quebra. O drill só é aceito enquanto `CF_SMOKE_URL` for `*.workers.dev`; o `ci-deploy` recusa no domínio real.

### Segredos e variáveis

Os dois environments já existem no GitHub, os dois restritos à branch `main`. Os jobs também se recusam a rodar fora da `main`.

| Onde | Nome | Tipo | Valor |
|---|---|---|---|
| `front-build` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_META_APP_ID`, `VITE_META_WA_CONFIG_ID` | variável | Obrigatórias: são as que o bundle no ar usa. Sem elas, o `check-build-env` para a build. |
| `front-build` | `VITE_CALENDAR_SERVICE_URL` | variável | Opcional. Nenhum código lê. |
| `front-build` | `SENTRY_AUTH_TOKEN` | **secret** (já existe) | Token de **organização** (`sntrys_`, escopo `org:ci`). Ver [Sentry](#sentry-na-build). |
| `front-production` | `CLOUDFLARE_API_TOKEN` | **secret** (já existe) | Token da conta, **Workers → Editor**, só no Worker `torque-front`. |
| `front-production` | `CLOUDFLARE_ACCOUNT_ID` | variável | id da conta (32 hex) |
| `front-production` | `CF_SMOKE_URL` | variável | `https://torque-front.torquecrm.workers.dev` até o corte; `https://torquecrm.com.br` depois. |

As demais (`VITE_INVITE_API_URL`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_REPLAY_ON_ERROR_RATE`) ficam vazias, como no EasyPanel: com o convite vazio, o app cai no Supabase. Os defaults do `Dockerfile` (DSN do Sentry, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL`, `VITE_CHAT_*`, `VITE_UI_SWITCH`) estão escritos no workflow. O EasyPanel não sobrescreve nenhum deles (medido em 2026-10-07).

`VITE_APP_VERSION` fica **vazia** na fase de prova: a produção mostra `0.0.0`, e assim a paridade bate byte a byte. Ela passa a `sha-<sha>` num PR separado.

Sem `CLOUDFLARE_API_TOKEN`, ou com `CLOUDFLARE_ACCOUNT_ID` fora do formato, o `ci-deploy` para antes de chamar o wrangler (código 2, `Nada foi publicado.`).

O step do `ci-deploy` recebe também o `GITHUB_TOKEN` do próprio job (`${{ github.token }}`). Ele não é um secret cadastrado e só tem `contents: read`. Serve para o passo 0 funcionar mesmo se o repositório virar privado.

### O que aparece no log

O repositório é **público**: qualquer pessoa vê o log e baixa o artifact.

**Aparece:**

- os version ids, a tag (sha do commit), o resultado de cada etapa e as falhas do smoke;
- do wrangler, só o que passa pela **lista de permissão** do `ci-deploy` (`filterWranglerOutput`): os blocos `[ERROR]`/`[WARNING]` e as linhas de progresso conhecidas, como `Total Upload`, `Worker Version ID`, `Deployed torque-front version … at 100%` e os bindings;
- o resto da saída do wrangler é **contado e descartado**, com uma linha `(wrangler …: N linha(s) fora do log público)`;
- o artifact, que é o `cloudflare/.assets`: o mesmo que o site serve, já sem source map.

**Não aparece:**

- **e-mail.** O `deployments status --json` traz o `author_email` de quem publicou (`cli.js:354655`); esse stdout nunca é ecoado, e só o `id@pct` vai ao log. Qualquer e-mail que sobre em outra linha vira `<email>`;
- **a saída de `whoami`.** Num erro de autenticação, o wrangler imprime o nome da conta, as contas com ids, as permissões do token e, com token de usuário, o e-mail (`cli.js:363433-363455` e `351240-351370`). Ela é cortada inteira, do primeiro marcador até o fim;
- **id de conta.** Qualquer id de 32 hex, como o `/accounts/<id>/` das mensagens de erro, vira `<id>`;
- **o `GITHUB_TOKEN` do job.** Ele só existe no step do `ci-deploy` e vai só para o `git ls-remote`, por variável de ambiente do git. Não vai em argv, nem na URL, nem no ambiente do wrangler, e o stderr do git é descartado. O GitHub também mascara o token se ele aparecer em texto;
- **segredo e ambiente.** O workflow não usa `set -x`, não despeja o ambiente e não interpola input em script. O teste `deploy-workflow` garante isso, e os testes do `ci-deploy` provam o filtro com a saída real de um erro de autenticação.

Para ver a saída inteira do wrangler, rode o comando à mão, com o `wrangler login` do CTO, fora do CI.

### Checagens da primeira execução (o merge)

O merge do PR é a primeira execução real. Confira no log e no Summary:

- [ ] **Passo 0** (HEAD da `main`): `ok`, com o sha do merge.
- [ ] **O token por Worker basta?**
  - `deployments status` e `versions upload` leem `/workers/services/torque-front`.
  - `versions deploy` cria a deployment.
  - `triggers deploy` escreve em `/workers/scripts/torque-front/subdomain`.
  - Um 403 em qualquer um deles leva ao plano B do token: **Account** → **Workers Scripts** → **Edit**.
- [ ] **`--tag` (sha de 40 caracteres) e `--message` aceitos?** `wrangler versions list --name torque-front` deve mostrar a tag.
- [ ] **O override pega a versão nova?** O smoke A passa com `X-Torque-Version` = nova.
  - Se ele falhar só por `versão <anterior> respondeu` ou `sem X-Torque-Version` até o fim das novas tentativas, o override não chegou à nova em 2 min. Nada foi promovido.
- [ ] **O override vale para `/assets/*`?** O A pede os chunks de entrada da versão nova a 0 %.
  - Se ele falhar **só** nos `/assets/*` com 404, o override não alcança o servidor de assets, e o A precisa deixar de exigir os chunks (decisão do arquiteto).
  - Nada foi promovido.
- [ ] **O B passa** com `X-Torque-Version` = nova.
- [ ] **O drill**, rodado à mão logo depois, ainda no `workers.dev`, sai `DRILL OK`.
- [ ] **Paridade do artefato do CI × produção, no mesmo sha:**
  1. Espere o EasyPanel publicar o mesmo commit.
  2. Baixe o artifact da execução.
  3. Rode:
     ```bash
     npm run cf:parity -- --a https://torquecrm.com.br --b https://torque-front.torquecrm.workers.dev --assets <artifact baixado> --all-assets
     ```
  4. Tem de dar `FAIL 0`. O `/50x.html` sai como Div13 (é da imagem do nginx, não da build).
  - **A paridade depende do `SENTRY_AUTH_TOKEN`.** Com ele, o plugin do Sentry injeta os debug ids (determinísticos), como no EasyPanel. Sem ele, os bundles divergem em todos os chunks, e isso não é defeito do Worker.
  - Medido em 2026-10-07: com o build do CI de `9641c07f2` (Node 24, `npm ci --ignore-scripts`, ambiente limpo, plugin ligado) contra prod no Worker local, deu `FAIL 0` (597 casos, Div13 ×1).

### Sentry na build

Medido em 2026-10-07, com `@sentry/vite-plugin` 5.4.0 e `SENTRY_AUTH_TOKEN=invalido` numa build local:

- o plugin registra `Invalid token (http status: 401)` em `releases new` e em `sourcemaps upload`;
- a build **sai 0**;
- os debug ids continuam injetados (459 arquivos com `_sentryDebugIds`).

Ou seja, **upload falho não bloqueia o deploy**, e não foi preciso código para isso. Nesse caso, sobram source maps no `dist/` (227 na medição); o `cf:prepare` os tira.

**Sem token nenhum**, o plugin nem entra:

- a build sai sem upload e sem debug ids;
- o bundle deixa de ser byte a byte o do EasyPanel (ver a paridade acima);
- o `cf:prepare` tira os 461 maps;
- o `check-build-env --sentry-token` só **avisa** (`::warning::`) e deixa a build seguir.

Só um token **pessoal** (`sntryu_`) para a build.

A interface clássica herda o plugin: `classic/vite.config.ts` faz `mergeConfig` da config da raiz.

### Ordem do corte

**Pré-condições.** Todas, **antes** de anexar o Custom Domain:

- [ ] Checklist **(a)–(o)** abaixo resolvido (em [Checklist antes do corte](#checklist-antes-do-corte-fase-dns-fora-deste-guia)).
- [ ] Os itens de corte do pipeline em produção:
  - **C1**, a prova de versão (`X-Torque-Version`);
  - **C2**, só o HEAD da `main` publica;
  - **C3**, prazos e rollback no `SIGINT`/`SIGTERM`.
  - E o **drill** rodado com `DRILL OK`.
- [ ] **C4: ruleset na `main`** (decisão do CTO). Quem mergeia na `main` publica produção, então a `main` precisa de:
  - **PR obrigatório** (nada de push direto);
  - **revisão de code owner obrigatória**;
  - `dismiss_stale_reviews_on_push`: um push depois da aprovação derruba a aprovação;
  - `require_last_push_approval`: quem fez o último push não aprova o próprio PR;
  - **bloqueio de force-push e de deleção** da `main`;
  - **bypass do admin só via PR**, nunca push direto.
- [ ] **O `CODEOWNERS` do PR #2260 na `main`.** Ele cobre:
  - `.github/workflows/`;
  - o próprio `CODEOWNERS`;
  - `cloudflare/`, `scripts/cloudflare/` e `scripts/ui-classic/`;
  - `package*.json` e `Dockerfile`;
  - `vite.config.ts` e `classic/vite.config.ts`.
- [ ] **Prova do ruleset:** um PR de um colaborador com `write` mexendo em `.github/workflows/` tem de ficar **bloqueado**, sem a aprovação do code owner.
- [ ] **Agentes nunca aprovam PR.** Eles usam a mesma conta do CTO: uma aprovação de agente seria o CTO aprovando o próprio PR.
- [ ] **Workers Paid** ativo (já assinado), item (e).
- [ ] **TTL baixo** nos registros do domínio, dias antes, item (f).
- [ ] **Email Obfuscation** e **Rocket Loader** desligados na zona, item (o).
- [ ] **Bot Fight Mode** desligado, item (c).
- [ ] **Token da Cloudflare rotacionado DEPOIS de o ruleset estar ativo:** um token novo, com o mesmo escopo, no secret `CLOUDFLARE_API_TOKEN`, e o antigo revogado.
  - O token da fase de teste passou por terminais e chats.
  - Rotacionar antes do ruleset deixaria a janela aberta: quem tem `write` poderia mudar um workflow sem revisão e usar o token novo.

**Resíduos aceitos** (conhecidos, sem conserto previsto):

- **Self-merge do admin via PR.** O bypass existe para o CTO e passa por PR, então fica registrado. Não há segunda pessoa revisando.
- **`rollback_to` pode ser acionado por quem tem `write`.** O `workflow_dispatch` pede só `write`. O dano máximo é voltar para uma das 100 últimas versões, e o próximo push na `main` publica o HEAD de novo.

**Ordem:**

1. **Anexar o domínio, uma vez, fora do deploy:** **Workers & Pages** → `torque-front` → **Settings** → **Domains & Routes** → **Add** → **Custom Domain** → `torquecrm.com.br` (e `www`, item (m)).
   - **Nunca** coloque `routes` nem `custom_domain` no `wrangler.jsonc`. O deploy só mexe em rotas e domínios que estão no config (`cli.js:160183-160300`).
   - Em CI, sem terminal, um `custom_domain` no config sobrescreve origem e DNS sem perguntar (`cli.js:159598-159600`).
   - O teste `wrangler-config` impede `routes` no arquivo.
2. **Trocar a variável:** `CF_SMOKE_URL` = `https://torquecrm.com.br` no environment `front-production`.
3. **Abrir um PR** com `workers_dev: false` no `wrangler.jsonc`, ajustando o teste `wrangler-config.test.ts`. O `triggers deploy` do pipeline desliga o `*.workers.dev` no deploy desse PR (item (d)).

### Quarentena e desligamento do EasyPanel

1. **Durante os 7 dias seguintes ao corte**, o EasyPanel continua de pé, como volta rápida pelo DNS (item (f)).
2. **Passados os 7 dias**, e só então:
   1. Desative o hook de deploy **627383107** no EasyPanel.
   2. Pare o app no EasyPanel.
3. **Enquanto o `Dockerfile` existir**, o teste `build-env-drift` mantém os dois builds iguais. Ao apagar o `Dockerfile`, apague também esse teste.

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

Nada disto toca `torquecrm.com.br`. Os três caminhos de rollback do pipeline (automático, botão no GitHub e local) estão em [Rollbacks: três caminhos](#rollbacks-três-caminhos).

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
| Div13 | `/50x.html` abre o app (200, o index do SPA) quando o artefato é do CI | A página é da **imagem do nginx**, não da build: o `cf:extract` a traz, o `build:dual` não. Na Cloudflare ninguém a usa (o Worker gera os próprios erros). Com o artefato do `cf:extract`, o arquivo existe e a comparação é a normal. |

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
- **Nenhum segredo no repositório.** A conta vem do `wrangler login` (à mão) ou, no CI, do `CLOUDFLARE_ACCOUNT_ID` e do `CLOUDFLARE_API_TOKEN` do environment `front-production`. O `cloudflare/wrangler.jsonc` não tem `account_id` nem token.
- **Pipeline sem segredo à mostra:**
  - cada segredo chega a um step só: o do Sentry na build, o da Cloudflare no `ci-deploy`;
  - as actions são fixadas por SHA;
  - `npm ci` roda sem scripts de instalação;
  - não há cache de pacote nos jobs com segredo;
  - a saída do wrangler passa por uma lista de permissão antes do log público: sem e-mail, sem `whoami`, sem id de conta (ver [O que aparece no log](#o-que-aparece-no-log));
  - o teste `deploy-workflow` garante as regras do workflow; os testes do `ci-deploy` garantem o filtro.
- **`X-Torque-Version` só expõe o id da versão.** Nem a tag (sha) nem o timestamp do `version_metadata` saem (teste `worker.test.ts`). Conhecer o id não dá acesso a nada: o override só seleciona versões da deployment atual, e nenhuma delas tem mais privilégio que a que está no ar.

---

## Checklist antes do corte (fase DNS, fora deste guia)

Nada disto é feito agora. É o que precisa estar resolvido antes de `torquecrm.com.br` apontar para a Cloudflare.

**Deploy e custo**

- [x] **(a) Pipeline de deploy.** Feito em `.github/workflows/deploy-front-cloudflare.yml`: `build:dual` com os `VITE_*` e defaults do `Dockerfile` e upload de source map, `cf:prepare`, e `versions upload` + `versions deploy` em degraus com token de escopo mínimo. Ver [Pipeline de deploy (CI)](#pipeline-de-deploy-ci). Os dois secrets já existem.
- [ ] **(e) Workers Paid (US$ 5/mês).** No plano gratuito, o Worker atende 100 mil requisições por dia e tem 10 ms de CPU por requisição. Com o domínio de verdade, toda navegação e toda chamada à API passam pelo Worker (os arquivos de `/assets/` não contam).
- [x] **(l) Checagens no CI:** `npm run cf:typecheck` e `wrangler types --check` rodam em todo PR que toca o front (`.github/workflows/verify-front-cloudflare.yml`), junto com `build:dual`, `cf:prepare` e os testes.

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

- [ ] **(c) Proteções contra robô na API.** Browser Integrity Check, Bot Fight Mode e Security Level podem responder 403 ou desafio para clientes-máquina em `/api/v1/*`. Crie uma regra de exceção para esse caminho, depois re-rode a paridade e o smoke no domínio real. **Bot Fight Mode fica desligado**: ele não aceita exceção por caminho, e desafiaria também o smoke do pipeline (BLOQUEADO).
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
| `scripts/cloudflare/lib.mjs` | Utilidades comuns aos scripts, inclusive a trava do destino. |
| `scripts/cloudflare/smoke.mjs` | `cf:smoke`: o contrato do deploy num host só (com `--assets` ou autoconsistente, com ou sem override). |
| `scripts/cloudflare/ci-deploy.mjs` | `cf:ci:deploy`: deploy em degraus com rollback automático, e o rollback manual (`--rollback-to`). |
| `scripts/cloudflare/check-build-env.mjs` | `cf:ci:check-env`: `VITE_*` obrigatórias e sem segredo antes da build; `--sentry-token` confere o token do Sentry. |
| `.github/workflows/deploy-front-cloudflare.yml` | Pipeline de produção: jobs `build`, `deploy` e `rollback`. |
| `.github/workflows/verify-front-cloudflare.yml` | Verificação de PR, sem segredo. |
| `tests/unit/cloudflare/` | Testes: `npx vitest run tests/unit/cloudflare`. |

### Por que o wrangler fica isolado em `cloudflare/`

O wrangler exige Node 22, e a build de produção (`Dockerfile`) usa Node 20 com `npm install` na raiz. Isolado, ele não entra na imagem e não altera o `package-lock.json` da raiz.

### Atualizar o wrangler

1. Troque a versão exata em `cloudflare/package.json`.
2. Rode `npm --prefix cloudflare install`.
3. Rode `npm --prefix cloudflare run types`, para regerar `cloudflare/worker-configuration.d.ts`.
4. Ajuste o `compatibility_date` no `wrangler.jsonc`. Ele não pode passar da data do runtime que vem com o wrangler, que aparece na terceira linha do `worker-configuration.d.ts` (`// Runtime types generated with workerd@… AAAA-MM-DD`).
