---
type: changelog
title: Front na Cloudflare — pipeline de deploy no GitHub Actions
status: in-progress
created: 2026-10-07
updated: 2026-10-07
tags: [changelog, infra, cloudflare, deploy, front, ci, seguranca]
related: ["[[2026-10-06-front-cloudflare-workers-fase-teste]]"]
owner: claude-agent
---

# 2026-10-07 — Pipeline de deploy do front na Cloudflare

## Por quê
O corte do front para Cloudflare Workers dependia de um pipeline de deploy. Sem ele, depois do corte o `cf:extract` copiaria um nginx que não serve mais nada. Era o item (a) do checklist do corte, e o bloqueante.

## O que entrou
- **`.github/workflows/deploy-front-cloudflare.yml`**: dispara no push da `main` e no `workflow_dispatch` (inputs `rollback_to` e `drill`). Tem dois jobs, cada um no seu environment:
  - `build` (`front-build`): `check-env` → `npm ci --ignore-scripts` → `build:dual` com o token do Sentry só nesse step → `cf:prepare` → artifact de `cloudflare/.assets` por 3 dias;
  - `deploy` (`front-production`): `ci-deploy` com o token da Cloudflare só nesse step;
  - mais o job `rollback`, que só roda com `rollback_to`.
- **Regras do workflow**:
  - `permissions: {}` no topo;
  - `actions/*` fixadas por SHA;
  - concurrency `front-cloudflare-production`, que não cancela deploy em andamento;
  - sem cache de pacote nos jobs com segredo.
- **`scripts/cloudflare/ci-deploy.mjs`**: publica em degraus. Guarda a anterior (`deployments status --json`), roda `versions upload` (o id sai do ND-JSON) e põe a nova a 0 %. Depois faz o smoke A com override, promove a 100 %, roda `triggers deploy` e o smoke B. Qualquer falha depois da promoção faz rollback automático. Se o A falhar, a nova nunca recebe tráfego. Também tem o modo `--rollback-to`, e falha cedo sem `CLOUDFLARE_API_TOKEN`.
- **`scripts/cloudflare/smoke.mjs`** (`cf:smoke`): o contrato do deploy num host só. Tem dois modos: `--assets` (sha256 contra o artefato) e autoconsistente. Aceita `--override` e `--retry-for`. Resultado:
  - PASS (0), FAIL (1) ou BLOQUEADO (3);
  - BLOQUEADO = `cf-mitigated: challenge`.
- **`scripts/cloudflare/check-build-env.mjs`** (`cf:ci:check-env`):
  - 5 `VITE_*` obrigatórias;
  - nenhuma `VITE_*` com cara de segredo (mesma varredura do `cf:prepare`);
  - `--sentry-token`: sem token, só aviso; token pessoal `sntryu_` bloqueia.
- **`.github/workflows/verify-front-cloudflare.yml`**: verificação de PR, sem segredo, com filtro de caminhos. Roda `build:dual`, `cf:prepare`, `cf:typecheck`, `wrangler types --check` e os testes.
- **Testes novos**:
  - `smoke`: 30 testes (36 na volta 2);
  - `ci-deploy`: 36 (54 na volta 2);
  - `check-build-env`: 18;
  - `build-env-drift`: 8 (Dockerfile × workflow, enquanto o Dockerfile existir);
  - `deploy-workflow`: 26 (invariantes de segurança dos dois workflows; 28 na volta 2).
- **`package.json`**:
  - scripts `cf:smoke`, `cf:ci:check-env` e `cf:ci:deploy`;
  - `yaml` 2.9.0 declarado como devDependency (já estava no lock por transitividade).
- **`docs/DEPLOY_CLOUDFLARE.md`**: seção "Pipeline de deploy (CI)", com:
  - os três rollbacks e o drill;
  - segredos e variáveis, e o passo a passo do CTO;
  - as checagens da primeira execução;
  - Sentry, ordem do corte, quarentena do EasyPanel e Bot Fight Mode desligado.
  - Os itens (a) e (l) do checklist estão fechados.

## Medido
- **Sentry**: `@sentry/vite-plugin` 5.4.0 com token inválido registra o 401 e a build sai 0. Upload falho não bloqueia, sem código novo.
- **Override de versão**: para uma versão fora da deployment, o override é ignorado em silêncio (200 com a versão atual). Na volta 2 isso virou prova de versão (`X-Torque-Version`, C1).
- **Smoke real** no `workers.dev`: PASS nos dois modos, autoconsistente e com assets. Contra o nginx de produção dá FAIL, só na Div12 e na Div9 (controle negativo).

## Volta 2 (revisor REPROVA B1, QA FALHA F1, itens de corte)
- **B1, log público:**
  - antes, o `ci-deploy` ecoava o stdout do wrangler cru: o `author_email` do `deployments status` e, em erro de autenticação, o `whoami` (conta, ids, permissões do token, e-mail);
  - agora o `status` não ecoa nada; o resto passa por `filterWranglerOutput`, uma **lista de permissão**: blocos [ERROR]/[WARNING] + progresso conhecido;
  - o whoami é cortado inteiro; e-mail vira `<email>` e id de 32 hex vira `<id>`.
  - Provado com a saída real de um erro de autenticação do wrangler (token falso, só leitura).
- **F1, paridade:** Div13 (`/50x.html` é da imagem do nginx, não da build). A paridade do artefato do CI de `9641c07f2` contra prod, no Worker local, deu **FAIL 0** (597 casos).
- **C1, prova de versão:**
  - binding `version_metadata`; o Worker responde `X-Torque-Version` em toda resposta que gera;
  - o smoke A e o B exigem a versão nova; o B espera a propagação;
  - o rollback aceita a anterior ou header ausente (versão de antes do header).
  - Fecha o buraco do override ignorado em silêncio.
- **C2, sha velho:** antes do upload, `git ls-remote` confere que o sha é o HEAD da main; se não for, sai 4 (OBSOLETO). Provado na CLI real: `86412c0` contra o HEAD `9641c07` saiu 4, sem chamar o wrangler.
- **C3, prazos e interrupção:**
  - cada comando do wrangler tem prazo (e é morto ao estourar); o smoke tem 10 s por requisição e 60 s por rodada;
  - SIGINT/SIGTERM entre a promoção e o B verde fazem rollback;
  - o step usa `exec node`, com timeout de 24 min (pior caso de 1.275 s); o job tem 30.
- **N1:** `overwrite: true` no artifact (para o re-run).
- **Doc:**
  - "O que aparece no log" e "Prova de versão";
  - rollback manual só dura até o próximo push; fila de um pendente só;
  - pré-condições do corte (C1–C4, Workers Paid, TTL, Email Obfuscation/Rocket Loader, token rotacionado);
  - o merge é o primeiro deploy (os secrets já existem);
  - a paridade depende do `SENTRY_AUTH_TOKEN`.
- **Testes:** 390 em `tests/unit/cloudflare` (ci-deploy 54, smoke 36, deploy-workflow 28, parity 22, worker 49, wrangler-config 7).

## Polimento pré-commit (revisor APROVA, QA PASSA)
- **NB1**: o `finish` é idempotente, e o fluxo principal espera o handler de sinal (`completeRun`). Um B que fecha PASS durante o rollback do SIGINT não sai mais como PROMOVIDO.
- **NB2**: o handler grava um resumo provisório ("rollback para X em andamento; se não mudar, `rollback_to=X`") antes de tentar o rollback.
- **Repo privado** (passo 0):
  - com `GITHUB_TOKEN` do job, o `git ls-remote` manda `AUTHORIZATION` só para github.com, via `GIT_CONFIG_*` (nunca argv);
  - sem token, segue público;
  - o wrangler não recebe o token.
  - Provado com um shim do git: argv sem o token. Com token falso, o GitHub recusa: o header é enviado e a falha é segura.
- **Doc**:
  - C4 virou ruleset na `main` (PR obrigatório, code owner, stale dismiss, last-push approval, sem force-push e sem deleção, bypass só via PR);
  - CODEOWNERS do #2260; prova com colaborador `write`;
  - token rotacionado DEPOIS do ruleset; agentes nunca aprovam PR;
  - resíduos aceitos;
  - SIGTERM durante o A e com o promove em voo.

## Produção
Sem mudança. Nada foi publicado. O merge do PR é o primeiro deploy real (no `workers.dev`): os dois secrets já existem.

## Pendente
- Merge = primeira execução. Conferir as checagens do doc:
  - o override alcança `/assets/*`?
  - o token por Worker basta?
  - paridade Node 24 × Node 20.
- O drill de rollback no `workers.dev`.
- Corte: domínio anexado fora do deploy, depois `CF_SMOKE_URL`, depois o PR com `workers_dev: false`. Em seguida, 7 dias de quarentena do EasyPanel.
