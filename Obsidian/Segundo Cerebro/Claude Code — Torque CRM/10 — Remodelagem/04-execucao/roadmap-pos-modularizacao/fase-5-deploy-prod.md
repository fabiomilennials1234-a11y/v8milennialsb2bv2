# Fase 5 — Deploy prod (event-bus)

**Branch:** `chore/event-bus-prod-deploy-runbook` (apenas pra runbook + scripts; nenhum código novo)
**Base:** `develop` (com Fases 1-4 mergeadas/validadas)
**Target PR:** `develop` (do runbook), **NÃO `main`**
**Estimate sessão:** 2-3h (excluindo janela de deploy)
**Janela:** noturna, combinada com CTO
**Pré-requisitos:**
- Fases 1, 2, 3, 4 mergeadas em `develop`.
- Smoke pré-prod verde (`Obsidian/.../smoke-pre-develop-to-main.md`).
- 48h de event-bus em dev sem `failed`.
- CTO presente e autorizando cada step.

## Constraints invariantes (NÃO violar)

1. **Esta é a única fase que toca prod.** Cada step exige autorização explícita do CTO **no momento**. Não basta a aprovação inicial — perguntar a cada operação destrutiva.
2. Push em `main` ainda **proibido** nesta fase. Modificações em `main` só na Fase 6.
3. **Ordem das operações é mandatória.** Qualquer outra ordem quebra prod (frontend deployado antes da migration → erro 42P01 em campanhas).
4. **Rollback plan pronto antes de cada step.** Documentado abaixo.
5. Sem `--no-verify`. Sem skip de hooks.

## Contexto

Fase 3 validou em dev. Esta fase replica em prod (`jsjsmuncfkbsbzqzqhfq`) com janela noturna, monitoria ativa, e CTO acompanhando.

Recursos a deployar em prod:
- Migration `20261105000000_domain_events.sql` (tabela `domain_events`).
- Edge function `event-dispatcher`.
- Linhas em `cron_config` (`event_dispatcher_url`, `cron_secret`).
- Cron schedule (`event-dispatcher-prod`, `* * * * *`).
- Frontend (Docker `:latest` → EasyPanel manual) — **última operação**, depois que cron já está rodando.

## Pre-flight checklist

Antes da janela:

```bash
git checkout develop
git pull --ff-only origin develop

# Confirmar fases 1-4 mergeadas
git log origin/develop --oneline -20 | grep -E "ci-unblock|boundaries-enforcement-real|event-bus-dev-validation|cleanup-pos-modularizacao"

# Confirmar smoke pre-prod verde
cat "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md"
# Status deve estar marcado verde pelo CTO.

# Confirmar validacao dev de 48h+
cat "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/event-bus-dev-validation.md"
# Monitoria 24h+ verde, failed=0.

# Carregar tokens
PROD_TOKEN=$(grep -E "^SUPABASE_ACCESS_TOKEN=sbp_" .env.development | tail -1 | cut -d= -f2)
# Alternativamente, CTO fornece token pessoal na janela.
PROD_REF="jsjsmuncfkbsbzqzqhfq"
DEV_REF="bcfadphgsibjzivtbjvc"
```

## Sequência mandatória (executar nesta ordem)

### Step 1 — Aplicar migration `domain_events` em prod

**Pedir autorização explícita do CTO antes.** Mostrar SQL que vai rodar.

```bash
echo "Aplicando em: ${PROD_REF}"
MIGRATION=$(cat supabase/migrations/20261105000000_domain_events.sql)

curl -s -X POST "https://api.supabase.com/v1/projects/${PROD_REF}/database/query" \
  -H "Authorization: Bearer ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d "$(jq -n --arg q "$MIGRATION" '{query: $q}')"

# Confirmar tabela criada
curl -s -X POST "https://api.supabase.com/v1/projects/${PROD_REF}/database/query" \
  -H "Authorization: Bearer ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select count(*) from domain_events"}'
# Esperado: [{"count":0}]
```

**Rollback step 1**:
```sql
DROP TABLE IF EXISTS domain_events CASCADE;
```

### Step 2 — Deploy edge function `event-dispatcher` em prod

**Pedir autorização.**

```bash
supabase functions deploy event-dispatcher --project-ref ${PROD_REF}

# Confirmar
curl -s -X OPTIONS "https://${PROD_REF}.supabase.co/functions/v1/event-dispatcher" -i | head
# Expect 200/204 + CORS headers
```

**Rollback step 2**:
```bash
supabase functions delete event-dispatcher --project-ref ${PROD_REF}
```

### Step 3 — Popular `cron_config` em prod

**Pedir autorização. Gerar secret novo, não reusar dev.**

```bash
PROD_CRON_SECRET=$(openssl rand -hex 32)
PROD_DISPATCHER_URL="https://${PROD_REF}.supabase.co/functions/v1/event-dispatcher"

# Setar secret na edge function
supabase secrets set CRON_SECRET="${PROD_CRON_SECRET}" --project-ref ${PROD_REF}

# Aplicar config no DB
curl -s -X POST "https://api.supabase.com/v1/projects/${PROD_REF}/database/query" \
  -H "Authorization: Bearer ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d "$(jq -n --arg url "$PROD_DISPATCHER_URL" --arg secret "$PROD_CRON_SECRET" '{
    query: "insert into cron_config (key, value) values (\"event_dispatcher_url\", \($url|@json)), (\"cron_secret\", \($secret|@json)) on conflict (key) do update set value = excluded.value"
  }')"

# Verificar
curl -s -X POST "https://api.supabase.com/v1/projects/${PROD_REF}/database/query" \
  -H "Authorization: Bearer ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select key, length(value) as len from cron_config where key in (\"event_dispatcher_url\",\"cron_secret\")"}'
```

**Guardar `PROD_CRON_SECRET` em local seguro** (1Password, etc). Necessário pra qualquer manutenção futura.

**Rollback step 3**:
```sql
DELETE FROM cron_config WHERE key IN ('event_dispatcher_url', 'cron_secret');
```

### Step 4 — Ativar cron em prod

**Pedir autorização.**

```sql
SELECT cron.schedule(
  'event-dispatcher-prod',
  '* * * * *',
  $$ SELECT net.http_post(
       url := (SELECT value FROM cron_config WHERE key = 'event_dispatcher_url'),
       headers := jsonb_build_object('x-cron-secret', (SELECT value FROM cron_config WHERE key = 'cron_secret')),
       body := '{}'::jsonb
     ) $$
);

-- Confirmar
SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'event-dispatcher-prod';
```

**Rollback step 4**:
```sql
SELECT cron.unschedule('event-dispatcher-prod');
```

### Step 5 — Aguardar 30 min com monitoria ativa

Cron começa a rodar a cada minuto, mas `domain_events` está vazia. Dispatcher só logará "0 pending". OK — confirma que stack está rodando sem erro.

```sql
-- A cada 5 min, checar
SELECT runid, jobid, status, return_message, start_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'event-dispatcher-prod')
ORDER BY start_time DESC
LIMIT 10;
-- Esperado: status='succeeded' em 100% dos runs.
```

Se algum `failed`, **parar e investigar `return_message` antes de prosseguir**.

### Step 6 — Deploy frontend prod (Docker → EasyPanel)

**Pedir autorização final.** Esta é a operação visível ao usuário.

1. Confirmar que `main` ainda **não** tem o código event-bus (slices 16-19 e fases 1-4 estão em develop, não em main). **PR final develop → main é Fase 6, NÃO esta.** Aqui o deploy é só do que JÁ ESTÁ EM MAIN.

   **Wait** — re-ler: o `useCampanhas.ts` migrado pra `publishEvent` está em `develop`, não em `main`. Frontend prod (`:latest` do Docker) é buildado de `main`. Então **o frontend prod atual ainda não publica eventos** mesmo se a migration/edge/cron estiverem prontos.

   Isso **inverte a ordem**: a Fase 5 prepara prod (migration + edge + cron) pra **estar lá quando** Fase 6 fizer merge develop→main e deploy do frontend.

   Ou seja: Step 6 desta fase **NÃO é deploy de frontend prod**. Frontend novo só sai na Fase 6.

2. Em vez disso, **finalizar a Fase 5 aqui**:
   - Migration ✅
   - Edge function ✅
   - cron_config ✅
   - Cron rodando ✅
   - Frontend prod ainda no estado anterior (não publica eventos) ✅ — é o estado correto.

3. Deixar prod assim por **24-48h em monitoria** antes da Fase 6:
   ```sql
   -- A cada 12h
   SELECT status, count(*)
   FROM domain_events
   WHERE published_at > now() - interval '12 hours'
   GROUP BY status;
   -- Esperado: pending=0, dispatched=0 (frontend ainda nao publica),
   --           failed=0
   ```

### Step 7 — Documentar resultado

Criar `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/event-bus-prod-deploy.md`:

```markdown
# Event-bus prod deploy — <data>

## Steps aplicados

- Step 1 — Migration domain_events: ✅ <hora>
- Step 2 — Edge event-dispatcher: ✅ <hora>
- Step 3 — cron_config: ✅ <hora>
- Step 4 — cron schedule: ✅ <hora>
- Step 5 — monitoria 30 min: ✅ N runs succeeded, 0 failed

## Estado pós-deploy

- Tabela domain_events: existe, 0 rows.
- Edge event-dispatcher: deployada.
- Cron event-dispatcher-prod: rodando a cada minuto.
- Frontend prod: estado anterior (não publica eventos). Aguardando Fase 6.

## Monitoria 24h+ pré-Fase-6

- (registrar a cada 12h)
- 12h: cron runs succeeded=<N>, failed=<M>, domain_events rows=0
- 24h: ...

## Conclusão

✅ Prod pronto para receber frontend novo (Fase 6) /
❌ Bloqueios: <listar>
```

### Step 8 — Commit do runbook

```bash
git status --short
git status --short | grep -i "feature-overview" && echo "PARAR — vault scratch"

git add "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/event-bus-prod-deploy.md"

git commit -m "docs(modularizacao): runbook + log do deploy event-bus prod (fase 5)

Documenta steps executados em prod (migration domain_events, edge
event-dispatcher, cron_config, cron schedule), horarios, resultados de
monitoria, e estado de transicao para Fase 6 (PR develop->main + deploy
frontend prod).

Frontend prod permanece no estado anterior (sem publish) ate Fase 6 —
sequencia mandatoria para evitar erro 42P01 em campanhas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin chore/event-bus-prod-deploy-runbook
gh pr create --base develop --head chore/event-bus-prod-deploy-runbook \
  --title "docs(modularizacao): runbook + log do deploy event-bus prod (fase 5)" \
  --body "Runbook + log do deploy de event-bus em prod. Frontend prod ainda no estado anterior — aguardando Fase 6."
```

## Critério de aceite

- [ ] Migration `domain_events` aplicada em prod, tabela criada.
- [ ] Edge `event-dispatcher` deployada em prod, endpoint responde.
- [ ] `cron_config` em prod com `event_dispatcher_url` + `cron_secret` (secret guardado fora do repo).
- [ ] Cron `event-dispatcher-prod` ativo, rodando `* * * * *`.
- [ ] 30 min de monitoria pós-deploy: cron runs 100% succeeded.
- [ ] 24h+ de monitoria pré-Fase-6: cron runs 100% succeeded, `domain_events` zero rows (porque frontend prod ainda não publica).
- [ ] Doc `event-bus-prod-deploy.md` criado no vault e commitado via PR.
- [ ] Frontend prod **NÃO** atualizado nesta fase.

## Riscos + mitigação

- **Aplicar SQL no DB errado.** Mitigação: cada operação faz `echo "Aplicando em: ${PROD_REF}"` antes. CTO confere project_ref antes de autorizar. Nunca usar variável errada — sempre verificar com `echo`.
- **`PROD_CRON_SECRET` perdido**. Mitigação: salvar em 1Password ANTES do step 3 fim.
- **Cron rodando antes do `cron_secret` setado** → 403. Mitigação: ordem dos steps já cobre (secret antes do schedule).
- **Edge function falha em runtime por env var faltando.** Mitigação: `supabase secrets list --project-ref ${PROD_REF}` confirma `CRON_SECRET` presente antes do step 4.
- **Frontend prod publica antes da migration estar aplicada** (impossível neste plano — frontend só sai na Fase 6). Mas se CTO insistir em deploy de frontend nesta fase: **PARAR e renegociar** — ordem quebra prod.

## Rollback completo (qualquer falha em qualquer step)

```sql
-- Em ordem reversa
SELECT cron.unschedule('event-dispatcher-prod');
DELETE FROM cron_config WHERE key IN ('event_dispatcher_url', 'cron_secret');
-- supabase functions delete event-dispatcher --project-ref jsjsmuncfkbsbzqzqhfq
DROP TABLE IF EXISTS domain_events CASCADE;
```

Confirmar com `SELECT * FROM cron.job WHERE jobname LIKE '%event-dispatcher%'` — zero rows.

Documentar rollback no `event-bus-prod-deploy.md`.

## Out of scope

- Deploy frontend prod (Fase 6).
- PR develop → main (Fase 6).
- Migração de eventos adicionais (`message.received`, etc) — projeto separado.

## Próximo passo

Fase 6 — PR develop → main + deploy frontend prod. **Apenas após 24h+ de monitoria verde pós-Fase-5.**
