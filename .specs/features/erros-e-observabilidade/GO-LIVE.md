# Go-live — erros e observabilidade (ADR-0038)

Runbook da virada para produção. Nada aqui roda sem o CTO: **merge em `main` deploya o
front sozinho** (webhook do EasyPanel), e edge function, migration e DML em prod são botão
do humano.

Estado em 2026-09-30: todas as fatias escritas, pilha em PRs draft (#2189–#2199), validação
na branch efêmera em andamento (seção 2). Nada mergeado.

## 0. A pilha

| Ordem | PR | Fatia | Base | O que muda em prod |
|---|---|---|---|---|
| 1 | #2189 | ADR-0038 + SPEC | `main` | só docs |
| 2 | #2190 | S0 source map | `main` | `/assets/*.map` passa a 404 |
| 3 | #2191 | S1–S3 contrato | `main` | nenhum erro some em silêncio; toast com código |
| 4 | #2193 | S4 migração | #2191 | ~240 sítios sem texto técnico; lint trava a volta |
| 5 | #2196 | S4b estados falsos | #2193 | falha de carga não vira "aguardando ativação"/"assinatura expirada"/404 |
| 6 | #2197 | S5 edge 500 | #2196 | 500 com frase PT + `request_id`; exceção no `runtime_logs` (só depois do redeploy) |
| 7 | #2198 | S7b alerta de cron | #2197 | migration: alerta só de falha sustentada, auto-resolve |
| 8 | #2199 | S6 Sentry | #2198 | front: SDK só com DSN; edge: só com `SENTRY_DSN_EDGE` |

A S6 traz o merge da #2190 (precisa do `sourcemap: 'hidden'`). Cada PR é consistente sozinho:
o front pode ir para prod em qualquer ponto da pilha.

## 1. Ações humanas no Sentry (bloqueiam a validação da S6)

O token de upload **nunca** passa pelo chat: vai direto no EasyPanel. O DSN pode passar
(é público por desenho, vai no bundle).

1. Organização na **região EU** (não muda depois). Assinar o DPA.
2. Projetos: `torque-web` (plataforma React) e `torque-edge` (Deno). Plano Developer basta.
3. Em **cada** projeto, Settings → Security & Privacy:
   - *Prevent Storing of IP Addresses*: **ligado**.
   - *Data Scrubber* e *Use Default Scrubbers*: **ligados**.
   - *Additional Sensitive Fields*: `phone`, `telefone`, `email`, `cpf`, `cnpj`, `nome`, `name`.
   - `torque-web`, *Allowed Domains*: `torquecrm.com.br` e `*.torquecrm.com.br` (DSN usado de
     outra origem é recusado).
4. Settings → Client Keys → a chave → *Rate Limit*: 200 eventos/hora por projeto. Cota grátis é
   5k/mês; um laço de erro não pode queimá-la numa tarde.
5. Um terceiro DSN só para QA (projeto `torque-qa`, ou o mesmo projeto com
   `VITE_SENTRY_ENVIRONMENT=branch`) — é o que a validação da seção 2 usa.
6. Token de organização (Settings → Auth Tokens → *Organization Tokens*, escopo `org:ci`: só
   sobe source map e cria release). Nunca token pessoal.
7. Regras de alerta (S7a) — ver SPEC, seção S7a.

## 2. Validação na branch efêmera (antes de qualquer merge)

Uma branch só, criada com `./scripts/supabase-branch.sh criar erros-adr-0038`, derrubada ao fim
com ausência confirmada em `list_branches`. Front local com `npm run dev:branch`.

| # | Cenário | Esperado | Resultado |
|---|---|---|---|
| A | senha errada no login | frase PT, sem código técnico | ✅ (S1–S4, rodada anterior) |
| B | rede caída numa mutation | "Sem conexão…" + código | ✅ (rodada anterior) |
| C | RPC inexistente | fallback PT + código + "Falar com suporte"; Chamado sai com o mesmo código no `support_context` | ✅ (rodada anterior) |
| D | edge devolve erro de negócio (`create-org-user` duplicado) | a frase PT do corpo | ✅ (rodada anterior) |
| E | S4b: consulta do membro falha no boot | "Não conseguimos carregar sua conta" + tentar de novo; nunca "aguardando ativação" | ⏳ |
| F | S4b: RPC de assinatura falha | "Não conseguimos confirmar sua assinatura"; acesso fechado; sem 404 | ⏳ |
| G | S5: função de QA que lança (deploy só na branch) | 500 `{error: frase PT, code: server.unavailable, request_id}`, `X-Request-ID`, CORS; linha `unhandled_exception` no `runtime_logs` com o mesmo `request_id` | ⏳ |
| H | S7b: `check_cron_job_health()` na branch | roda; job com 3/5 falhas abre 1 alerta; volta a passar e resolve (`auto_recovered`); `authenticated` não executa | ⏳ |
| I | S6 sem DSN | nenhum request a `*.sentry.io`; chunk `sentry-*.js` nunca baixado | ⏳ |
| J | S6 com DSN de QA (front) | erro provocado aparece no Sentry: stack desminificada, tags `reference`/`error_code`/`organization_id`/`role`/`session_id`, `user.id` só UUID, URL sem query, replay mascarado; o código do toast acha o evento | ⏳ DSN |
| K | S6 com DSN de QA (edge) | a função de QA gera evento com `function`, `request_id`, `session_id`; o `request_id` é o da resposta 500 | ⏳ DSN |
| L | recusa esperada (RLS `access_denied`, sessão vencida) | **não** vira evento, vira rastro no próximo | ⏳ DSN |

## 3. Sequência em produção

### 3.1 Pré-voo

- [ ] `main` verde no que é da pilha (o lint de `supabase/functions/_shared/quotes/*` é herdado).
- [ ] Número do ADR: `0038` continua livre em `docs/adr/` da `main`.
- [ ] Versão da migration S7b (`20271101000000`): conferir colisão no ledger de prod
      (`list_migrations`). Colidiu → renomear o arquivo **na hora de aplicar**.
- [ ] Capturar a definição atual para rollback:
      `SELECT pg_get_functiondef('public.check_cron_job_health()'::regprocedure);` → salvar.

### 3.2 Front (merge)

1. EasyPanel, build args — **antes** do merge da S6 (sem DSN o SDK fica desligado, então a
   ordem não quebra nada, mas assim a S6 já sobe ligada):
   `VITE_SENTRY_DSN` (torque-web), `VITE_SENTRY_ENVIRONMENT=production`,
   `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT=torque-web`. Opcional:
   `VITE_SENTRY_REPLAY_ON_ERROR_RATE` (padrão 1), `VITE_APP_VERSION` (release; sem ele o
   release é a versão do `package.json`).
2. Merge na ordem da tabela da seção 0. Depois de cada merge, *retarget* do próximo para `main`.
   **Sem `--delete-branch`** até a pilha inteira entrar — apagar a base fecha o PR de cima.
3. Cada merge deploya o front. Conferir o `CreatedAt` da imagem na VPS contra o `mergedAt`.

### 3.3 Migration S7b

Receita cirúrgica (vault `05 — How-to/aplicar-migration-prod.md`): só este arquivo, não o `db
push` do repo (arrasta os pendentes). Depois:

```sql
SELECT has_function_privilege('authenticated', 'public.check_cron_job_health()', 'EXECUTE'); -- false
SELECT public.check_cron_job_health();  -- como service_role/postgres; alerts_created esperado ~0
```

### 3.4 Limpeza dos alertas antigos (DML, manual)

19.692 alertas `critical` abertos em 2026-09-30, zero resolvidos. Simular antes, guarda
dentro da query:

```sql
-- 1. quanto vai mudar
SELECT count(*) FROM public.system_alerts
WHERE category IN ('cron_job_failure', 'cron_job_stale')
  AND resolved_at IS NULL
  AND created_at < '<instante do apply da S7b>';

-- 2. só se o número bater com o de cima
UPDATE public.system_alerts
SET resolved_at = now(),
    metadata = metadata || jsonb_build_object('resolved_reason', 'adr-0038-ruido')
WHERE category IN ('cron_job_failure', 'cron_job_stale')
  AND resolved_at IS NULL
  AND created_at < '<instante do apply da S7b>';
```

### 3.5 Edge functions

169 funções usam o `withErrorBoundary`; a S5 e a S6 só valem em cada uma depois do redeploy
dela (o `_shared/` vai no bundle).

1. `supabase secrets set SENTRY_DSN_EDGE=<torque-edge> SENTRY_ENVIRONMENT=production --project-ref jsjsmuncfkbsbzqzqhfq`
2. **Pré-voo de drift, por função** — deploy a partir de `main` reverte o que estiver em prod
   e não estiver na `main` (já aconteceu). Para cada função do lote:
   `supabase functions download <fn>` e `diff` contra a `main`. Diferença que não seja o
   `_shared/` desta pilha → a função fica fora do lote até reconciliar.
3. Deploy só de um checkout da `main` atualizada, com o `cd` na mesma linha do comando. Lotes:
   1. As que o front chama direto (`supabase.functions.invoke`) — é onde o 500 PT aparece para o
      cliente.
   2. `agent-message`, `whatsapp-webhook`, `whatsapp-api-proxy` (áreas frágeis — uma de cada vez,
      olhando o `runtime_logs` entre elas).
   3. O resto.

### 3.6 Fumaça em produção

- [ ] Front: provocar um erro (console da aba logada:
      `setTimeout(() => { throw new Error("fumaça adr-0038") })`) → evento no Sentry com stack
      desminificada, `organization_id`, `role`, `session_id`, `user.id` só UUID.
- [ ] `/assets/index-*.js.map` → 404.
- [ ] Toast de erro de verdade → o código acha o evento (busca `reference:<código>`).
- [ ] Edge: primeira `unhandled_exception` real no `runtime_logs` tem evento no Sentry com o
      mesmo `request_id`.
- [ ] `system_alerts`: nas 24 h seguintes, `cron_job_failure` na casa de unidades.

## 4. Rollback

| Peça | Como desfazer | Custo |
|---|---|---|
| Sentry front | tirar `VITE_SENTRY_DSN` do EasyPanel e rebuildar | SDK some do bundle |
| Sentry edge | `supabase secrets unset SENTRY_DSN_EDGE` | no-op na próxima invocação |
| S7b | reaplicar a definição salva no pré-voo | a limpeza de alertas não volta (e não precisa) |
| Front S1–S6 | revert do merge na `main` | deploy automático |
| Edge S5 | redeploy da função a partir do commit anterior | por função |

## 5. Depois

- Rotina semanal de 15 min (vault `05 — How-to/triagem-semanal-de-erros.md`): top issues por
  eventos e por orgs → issue no GitHub (`needs-triage`), resolvido ou ignorado com motivo.
- Passo 3 (catálogo por domínio) e Passo 4 (UX de permissão): duas semanas de Sentry depois.

## Divergências da SPEC, decididas na implementação

| SPEC | Implementado | Por quê |
|---|---|---|
| `src/core/observability/sentry.ts`, init antes do `render` | `src/shared/errors/sentry*.ts`, import dinâmico com fila de boot | SDK fora do caminho crítico (32 KB gz + 43 KB gz do replay, ambos lazy); a fila não perde erro de boot |
| `supabaseIntegration` | sem ela | todo erro do Supabase já passa pelo contrato; ela relataria de novo (cota em dobro) |
| `browserTracingIntegration`, `tracesSampleRate: 0.1` | sem tracing | o pedido é defeito + passo a passo, e o rastro já dá o passo a passo; liga depois se precisar |
| `lazyLoadIntegration("replayIntegration")` (CDN) | replay no nosso chunk, depois do idle | a CSP não libera o CDN do Sentry, e não deveria |
| `sendDefaultPii: false` | `dataCollection` com tudo desligado | SDK v11 trocou a opção; os padrões novos coletam cookie, header, corpo e query |
| `setUser`/`setTags` no login | identidade no `beforeSend`, lida de `setReportIdentity` | vale também para evento capturado sozinho pelo SDK |
| edge `reportException` com `await flush` | `captureUnhandled` em `EdgeRuntime.waitUntil` | o envio não segura a resposta 500 |
| — | captura automática passa pela régua do contrato | rejeição sem `catch` de recusa esperada não vira evento; a que a tela já relatou não vira duplicata |
| — | `enhanceFetchErrorMessages: "report-only"` | o SDK reescreveria "Failed to fetch" em tempo de execução, e o app lê essa mensagem |
