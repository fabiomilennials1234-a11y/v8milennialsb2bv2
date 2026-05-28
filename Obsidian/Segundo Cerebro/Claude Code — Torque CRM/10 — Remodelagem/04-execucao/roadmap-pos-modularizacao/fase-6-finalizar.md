# Fase 6 — Finalizar (PR develop → main + deploy frontend prod)

**Branch:** `release/modularizacao-completa` (opcional, pode ser PR direto de develop)
**Target PR:** `main` (ÚNICA fase que mira main)
**Estimate sessão:** 1h + acompanhamento merge + deploy
**Janela:** noturna ou baixo-tráfego, combinada com CTO
**Pré-requisitos:**
- Fases 1-5 completas e validadas.
- Fase 5 com **24-48h+ de monitoria prod verde** (cron rodando, zero `failed`).
- Smoke pré-prod (`Obsidian/.../smoke-pre-develop-to-main.md`) verde.
- CTO presente e autorizando.

## Constraints invariantes (NÃO violar)

1. **Esta é a primeira fase que toca `main`.** Cada operação destrutiva exige autorização explícita do CTO na sessão.
2. NUNCA `git push --force main`. NUNCA `git reset --hard` em main.
3. **PR develop → main = squash-merge OU merge commit** — confirmar padrão do repo (default: merge commit, preserva slices individuais; squash perde granularidade da modularização).
4. **Deploy frontend prod é manual via EasyPanel** após Docker `:latest` ficar pronto. Não automatizado.
5. Sem `--no-verify`. Sem skip de hooks. Sem `--no-edit` em rebase.
6. Antes de começar: `git checkout develop && git pull --ff-only origin develop`. Confirmar Fase 5 verde 24h+.

## Contexto

Develop está pronta com toda modularização (slices 0-19), análises, fixes, roadmap e fases 1-4. Prod está pronta com event-bus infrastructure (Fase 5). Frontend prod ainda no estado antigo (Docker `:latest` do branch main pré-modularização). Esta fase fecha o ciclo:

1. PR develop → main (squash ou merge).
2. Push em main dispara build Docker `ghcr.io :latest`.
3. Deploy manual EasyPanel puxa `:latest`.
4. Frontend novo entra em prod — `useCampanhas.publishEvent` começa a publicar.
5. Monitoria intensiva de 48h.
6. Tag de release + ADR atualizado.

## Pre-flight checklist

```bash
git checkout develop
git pull --ff-only origin develop

# Confirmar fases 1-5 mergeadas
for fase in "ci-unblock" "boundaries-enforcement-real" "event-bus-dev-validation" "cleanup-pos-modularizacao" "event-bus-prod-deploy-runbook"; do
  git log origin/develop --oneline | grep "$fase" || echo "PARAR — Fase '$fase' nao mergeada"
done

# Confirmar Fase 5 verde 24h+
cat "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/event-bus-prod-deploy.md" | grep -A2 "Monitoria 24h"

# Confirmar prod pronto (cron rodando)
PROD_TOKEN=$(grep -E "^SUPABASE_ACCESS_TOKEN=sbp_" .env.development | tail -1 | cut -d= -f2)
PROD_REF="jsjsmuncfkbsbzqzqhfq"

curl -s -X POST "https://api.supabase.com/v1/projects/${PROD_REF}/database/query" \
  -H "Authorization: Bearer ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select jobname, schedule from cron.job where jobname = \"event-dispatcher-prod\""}'
# Esperado: 1 row com schedule * * * * *

# Confirmar cron sucesso recente
curl -s -X POST "https://api.supabase.com/v1/projects/${PROD_REF}/database/query" \
  -H "Authorization: Bearer ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d "{\"query\":\"select status, count(*) from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'event-dispatcher-prod') and start_time > now() - interval '6 hours' group by status\"}"
# Esperado: status=succeeded com count alto, sem failed.

# Confirmar develop diverge de main (deve ter ~30+ commits)
git fetch origin main
git rev-list --count origin/main..origin/develop
# Esperado: numero alto (todas as slices + fixes + fases)
```

## Tarefas

### 1. Atualizar ADR de conclusão

`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-28-modularizacao-conclusao.md`:

Adicionar seção "Validação prod":

```markdown
## Validação prod (Fase 6 — <data>)

- Migration domain_events aplicada em prod: <hora>
- Edge event-dispatcher deployada em prod: <hora>
- Cron event-dispatcher-prod ativo: <hora>
- Monitoria 24h pre-Fase-6: cron succeeded=<N>, failed=0
- PR develop -> main mergeado: <hora>
- Frontend prod deployado via EasyPanel: <hora>
- Monitoria 48h pos-deploy: domain_events processados=<N>, failed=<M>

## Status

Modularizacao concluida e validada em prod. Padrao monolito modular operacional.
```

Commitar em branch `chore/adr-conclusao-validada` antes do PR final (pra que entre na merge):

```bash
git checkout -b chore/adr-conclusao-validada
git add "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-28-modularizacao-conclusao.md"
git commit -m "docs(adr): atualiza ADR conclusao com validacao prod (fase 6)"
git push -u origin chore/adr-conclusao-validada
gh pr create --base develop --head chore/adr-conclusao-validada \
  --title "docs(adr): atualiza ADR conclusao com validacao prod" \
  --body "Marker de validacao prod no ADR de modularizacao."
# Esperar merge em develop
```

### 2. Smoke pré-merge final

Rodar checklist em `smoke-pre-develop-to-main.md`. CTO acompanhando. Toda jornada principal:
- Login + onboarding
- Lead CRUD + import
- Kanban whatsapp/confirmacao/propostas
- Chat WhatsApp envio
- Copilot ativação + conversa
- Campaign criar + mover lead → **observar `domain_events` recebe `lead.stage_changed`** (esse é o teste piloto event-bus)
- Workflow trigger por stage change → execution criada (era o caso de uso do event-bus)

Se algum smoke falhar, **PARAR a fase 6** e investigar. Senão prosseguir.

### 3. Abrir PR develop → main

**Pedir autorização do CTO explícita pra abrir o PR final.**

```bash
# Sync uma ultima vez
git checkout develop
git pull --ff-only origin develop

# Abrir PR contra main
gh pr create --base main --head develop \
  --title "release: modularizacao completa (monolito modular)" \
  --body "$(cat <<'EOF'
## Summary

PR final da modularização do Torque CRM. Reorganização por bounded context (14 módulos em `src/modules/<bc>/`), enforcement real via dep-cruise ratchet, event-bus piloto operacional em prod desde Fase 5.

### Slices entregues

- 0-15: planning + tooling + skeleton + 13 BCs + edge functions doc-only.
- 16: cleanup longtail (esvaziamento de `src/components/`, `src/hooks/`, `src/pages/` root).
- 17: docs + ESLint boundaries flip warn → error.
- 18: ADR conclusão + smoke checklist.
- 19: event-bus piloto (`domain_events` + dispatcher + handler + 1 call site).

### Fases pós-modularização

- Fase 1: CI unblock (security audit non-blocking).
- Fase 2: enforcement real (dep-cruise ratchet com baseline).
- Fase 3: event-bus validado end-to-end em dev por 24h+.
- Fase 4: limpeza (dead code, docs).
- Fase 5: deploy prod do event-bus (migration + edge + cron) — frontend ainda no estado anterior.
- Fase 6 (esta): PR develop → main + deploy frontend prod via EasyPanel manual.

### Pre-flight verde

- [x] CI verde em develop nos últimos N pushes.
- [x] dep-cruise ratchet baseline mantido (zero violations novas).
- [x] Smoke pré-prod verde.
- [x] Fase 5 prod: cron rodando, zero failures em 48h.
- [x] Event-bus testado fim-a-fim em dev.

### Deploy

1. Após merge: GitHub Actions builda Docker image `ghcr.io/.../torque-crm:latest` + `:sha-<short>`.
2. Deploy manual via EasyPanel UI (VPS Hostinger) puxa `:latest`.
3. Frontend novo entra em prod — `useCampanhas.publishEvent` começa a publicar.
4. Monitoria intensiva de 48h pelo CTO.

### Rollback plan

Se frontend novo introduzir regressão:
1. EasyPanel rollback para image anterior (`:sha-<prev>`).
2. Manter event-bus prod infrastructure rodando (migration + edge + cron) — não é destrutivo nem requer rollback.
3. Investigar regressão em sessão isolada (`fix/...` branch saindo de main pós-rollback).

### Refs

- Análise pragmática: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/analise-pos-modularizacao.md`
- ADR conclusão: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-28-modularizacao-conclusao.md`
- Roadmap fases: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-pos-modularizacao/_INDEX.md`
- SPEC: `.specs/features/modularizacao/SPEC.md`
- Smoke pré-prod: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 4. Aguardar revisão + merge

**CTO faz o merge** (não a sessão). Strategy: **merge commit** (não squash). Razão: preserva o histórico de slices — futuro `git log` mostra cada slice como commit individual, perda total de granularidade se squash.

Confirmar pós-merge:

```bash
git fetch origin
git log origin/main --oneline | head -25
# Esperado: ver o merge commit + slices 0-19 + fases 1-5 + ADR
```

### 5. Acompanhar build Docker

```bash
# Após merge, GH Actions builda imagem
gh run list --workflow=docker-image.yml --limit 3
# Aguardar status: completed + success
```

Quando verde:
```bash
gh run view <run-id> --json conclusion,name
# conclusion: "success"
```

### 6. Deploy manual EasyPanel

**CTO faz** (sessão não tem acesso). Esta é a operação visível.

Após deploy:
- Confirmar versão nova em prod: navegar pra qualquer página, abrir console, conferir `__APP_VERSION__` ou hash do bundle.
- Testar 1 fluxo principal (login + dashboard).

### 7. Monitoria intensiva 48h

```sql
-- A cada 4h nas primeiras 24h, depois a cada 12h:

-- 7.1 Cron rodando
SELECT status, count(*)
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'event-dispatcher-prod')
AND start_time > now() - interval '4 hours'
GROUP BY status;
-- Esperado: succeeded N, failed 0.

-- 7.2 Eventos sendo publicados (frontend novo deveria estar publicando)
SELECT event_type, status, count(*)
FROM domain_events
WHERE published_at > now() - interval '4 hours'
GROUP BY event_type, status;
-- Esperado: lead.stage_changed status=dispatched > 0.

-- 7.3 Errors
SELECT event_type, last_error, count(*)
FROM domain_events
WHERE status = 'failed'
AND published_at > now() - interval '4 hours'
GROUP BY event_type, last_error;
-- Esperado: zero rows. Se nao, investigar imediatamente.

-- 7.4 Sentry / logs
-- (verificar via dashboard)
```

### 8. Tag de release

Após 48h verde:

```bash
git checkout main
git pull --ff-only origin main

VERSION="v$(date +%Y.%m.%d)-modularizacao"
git tag -a "${VERSION}" -m "Modularização do Torque CRM concluída e validada em prod.

- 14 bounded contexts em src/modules/
- API publica via index.ts por modulo
- Enforcement via dep-cruise ratchet
- Event-bus piloto operacional (lead.stage_changed)
- Slices 0-19 + Fases pos-modularizacao 1-6 mergeadas e validadas

Ver: Obsidian/.../04 — Decisões/ADR-2026-05-28-modularizacao-conclusao.md"

git push origin "${VERSION}"

# Criar release no GitHub
gh release create "${VERSION}" \
  --title "Modularização completa" \
  --notes "Vide ADR de conclusão em vault. Modularização concluída e validada em prod."
```

### 9. Marcar ADR como "concluído"

Atualizar `ADR-2026-05-28-modularizacao-conclusao.md`:

```markdown
**Status:** ✅ Concluído e validado em prod (Fase 6 — <data>)
```

Commitar em chore branch + PR pra develop final.

## Critério de aceite

- [ ] Fase 5 verde 24h+ antes do PR.
- [ ] Smoke pré-merge verde.
- [ ] PR develop → main aberto + revisado + CTO mergeou.
- [ ] Estratégia de merge: merge commit (preserva slices).
- [ ] Docker `:latest` buildado com sucesso.
- [ ] Frontend novo deployado em EasyPanel.
- [ ] 48h de monitoria pós-deploy: zero `domain_events.status='failed'`, zero regressão Sentry.
- [ ] Tag de release criada.
- [ ] ADR marcado concluído.

## Riscos + mitigação

- **Frontend novo introduz regressão crítica.** Mitigação: rollback EasyPanel para image anterior (mantém event-bus prod rodando, só frontend volta). Investigar em sessão isolada.
- **PR develop → main com conflito** (improvável pois develop está sempre à frente de main): resolver em sessão antes do merge, nunca force-push.
- **Squash-merge erroneamente aplicado.** Mitigação: CTO confirma strategy antes de clicar merge.
- **Tag aplicada em commit errado.** Mitigação: `git log origin/main --oneline | head -3` antes do tag — confirmar SHA correto.
- **Monitoria 48h pega regressão.** Mitigação: rollback EasyPanel imediato, comunicar CTO.

## Out of scope (definitivo — projetos separados)

- Migração de eventos adicionais (`message.received`, `lead.created`, etc).
- Redução dos 973 deep-imports (sprints incrementais de Fase 2 ratchet).
- Mudança de stack (vite 6→8, etc).
- Consolidação de `integrations` com edge functions.

## Conclusão do projeto modularização

Após Fase 6 verde, projeto **modularização** está oficialmente concluído. Próximos projetos:
- Eventos adicionais (event-bus expansion).
- Redução incremental de deep-imports (ratchet em N sprints).
- Possível consolidação `integrations`.
