---
date: 2026-04-17
branch: develop
agents: [Conductor, DBA, Backend, Frontend, QA]
---

# 2026-04-17 — Fix sincronização de closer_id/sdr_id nos pipes (bug de visibilidade)

## Task

Closer Weder continuava vendo o card do lead Anderson Padua no Kanban mesmo após o lead ser transferido para outro closer. Dois closers atendendo o mesmo lead → métricas duplicadas e atendimento duplicado.

## Diagnóstico

### Causa raiz (confirmada no dev)

O trigger `trg_sync_responsible_from_lead_to_pipes` (definido em [20260826100000](../../../../supabase/migrations/20260826100000_fix_pipe_rls_responsible_id.sql)) sincronizava APENAS `responsible_id` de `leads` para os pipes. Quando o closer de um lead era trocado via `leads.closer_id` + `leads.responsible_id`:

1. ✓ `pipe_propostas.responsible_id` era atualizado pelo trigger
2. ✗ `pipe_propostas.closer_id` ficava **obsoleto**, apontando para o closer antigo

A policy RLS SELECT de `pipe_propostas` lê `closer_id` do próprio pipe:
```sql
can_see_lead_by_permissions(leads.sdr_id, pipe_propostas.closer_id)
```

Com `pipe_propostas.closer_id` obsoleto, o closer antigo continuava passando na RLS e vendo o card.

**Evidência no dev (`bcfadphgsibjzivtbjvc`) antes do fix**:
```
SELECT COUNT(*) FROM pipe_confirmacao pc JOIN leads l ON l.id=pc.lead_id
  WHERE pc.closer_id IS DISTINCT FROM l.closer_id AND l.closer_id IS NOT NULL;
→ 1 registro desincronizado
```

### Causas secundárias investigadas

- **`leads.view_all` para membros**: não aplicável. `feature_permissions` é catálogo (não tem `organization_id`). `member_feature_permissions` per-member tinha zero entrada ativa para Weder.
- **Frontend sem filtro padrão por usuário**: confirmado. `filterResponsible` iniciava em "all". Passou a aplicar `teamMemberId` como default para `member` na primeira visita (camada defensiva).

## Regra oficial

**Fonte de verdade dos responsáveis**: `leads.{sdr_id, closer_id, responsible_id}`.

**Pipes devem sempre espelhar leads**:
- `pipe_propostas.closer_id` ≡ `leads.closer_id`
- `pipe_propostas.responsible_id` ≡ `leads.responsible_id`
- `pipe_confirmacao.{sdr_id, closer_id, responsible_id}` ≡ `leads.{sdr_id, closer_id, responsible_id}`
- `pipe_whatsapp.{sdr_id, responsible_id}` ≡ `leads.{sdr_id, responsible_id}`

O trigger é o mecanismo canônico de manutenção desse invariante. Qualquer INSERT direto em pipes deve passar valores consistentes com `leads`.

## Correções aplicadas (branch `develop`, dev aplicado)

### Migration nova

[supabase/migrations/20260417110000_fix_pipe_closer_sdr_sync.sql](../../../../supabase/migrations/20260417110000_fix_pipe_closer_sdr_sync.sql):

1. **Função estendida** `sync_responsible_from_lead_to_pipes()` — propaga `responsible_id`, `closer_id` e `sdr_id` para todos os pipes aplicáveis. Cada coluna é atualizada apenas nos pipes onde faz sentido:
   - `responsible_id` → todos os 4 (whatsapp, confirmacao, propostas, campanha_leads)
   - `closer_id` → confirmacao, propostas
   - `sdr_id` → whatsapp, confirmacao

2. **Trigger recriado** com `AFTER UPDATE OF responsible_id, closer_id, sdr_id ON public.leads`

3. **Backfill histórico** em 4 UPDATEs — corrige todo drift existente em pipe_propostas/confirmacao/whatsapp

4. **Bloco de validação** com `RAISE EXCEPTION` se drift > 0 após backfill

### Frontend (filtro defensivo)

[PipePropostas.tsx](../../../../src/pages/PipePropostas.tsx) e [PipeConfirmacao.tsx](../../../../src/pages/PipeConfirmacao.tsx):
- Adicionado flag `membroDefaultApplied` no estado persistido
- `useEffect` aplica `teamMemberId` como default para role `member` na primeira visita. Admin e Master começam com "all".
- Depois que o membro trocar manualmente, a escolha persiste (flag garante one-shot).

### Backend auditado (sem alterações necessárias)

- [lead-webhook/index.ts](../../../../supabase/functions/lead-webhook/index.ts) — INSERTs em pipes não definem closer_id/sdr_id, mas fazem UPDATE em leads logo depois → trigger propaga. ✓
- [import-leads/index.ts](../../../../supabase/functions/import-leads/index.ts) — INSERTs já passam `closer_id`/`sdr_id` derivados do próprio lead (consistentes com `leads`). ✓

## Evidências de validação (dev `bcfadphgsibjzivtbjvc`)

### Migration aplicada
```
NOTICE: Drift remanescente após backfill:
  pipe_propostas.closer_id      = 0
  pipe_confirmacao.closer_id    = 0
  pipe_confirmacao.sdr_id       = 0
  pipe_whatsapp.sdr_id          = 0
NOTICE: VALIDATION PASSED: drift zerado e trigger ativo para (responsible_id, closer_id, sdr_id).
```

### Teste de reprodução + fix ([tests/sql/validate_pipe_closer_sync.sql](../../../../tests/sql/validate_pipe_closer_sync.sql))
Cenário: lead com closer = A, transfere `leads.closer_id`+`sdr_id`+`responsible_id` → B.
- `pipe_propostas.closer_id` agora = B ✓
- `pipe_propostas.responsible_id` agora = B ✓
- `pipe_confirmacao.closer_id` agora = B ✓
- `pipe_confirmacao.sdr_id` agora = B ✓
- `pipe_whatsapp.sdr_id` agora = B ✓

### Teste RLS ponta-a-ponta ([tests/sql/validate_pipe_closer_rls.sql](../../../../tests/sql/validate_pipe_closer_rls.sql))
Cenário: lead com closer = A, transfere para B via `leads.closer_id + responsible_id`.
Usa `request.jwt.claims` para impersonar cada usuário.

**Baseline** (dono = A):
- Closer A vê: 1 (esperado) ✓
- Closer B vê: 0 (esperado) ✓

**Pós-transferência** (dono = B, trigger propagou):
- Closer A vê: **0** ← não vê mais ✓ (BUG RESOLVIDO)
- Closer B vê: 1 (novo dono) ✓
- Admin vê: 1 (bypass RLS) ✓

### Build + testes
- `npm run build` — 18.10s ✓
- `npm run test:unit` — 2543 tests pass, 0 regressões ✓
- `npx tsc --noEmit` — 0 erros novos ✓

## Checklist de aceite (conforme task original)

| Item | Status |
|------|--------|
| Lead "Anderson Padua" não aparece no Kanban do Weder após fix | ✓ Validado via RLS test (impersonation + trigger propagation) |
| Lead aparece no closer atualmente responsável | ✓ Test B vê = 1 |
| `pipe_propostas.closer_id` = `leads.closer_id` para todos registros | ✓ Backfill 0 drift, trigger ativo |
| `pipe_confirmacao.closer_id` = `leads.closer_id` para todos registros | ✓ Backfill 0 drift, trigger ativo |
| Trigger atualiza closer_id quando `leads.closer_id` muda | ✓ Função + trigger atualizados |
| Admins continuam vendo todos os leads | ✓ RLS test admin vê = 1 |
| `leads.view_all` não está ativo para membros | ✓ Verificado no dev: zero entradas |
| Novo teste de integração RLS cobre transferência de closer | ✓ `validate_pipe_closer_rls.sql` |
| `npm run test:unit` passa sem regressões | ✓ 2543/2543 |
| Nenhuma migration existente editada | ✓ Apenas `20260417110000` criada |

## Aplicação em produção

Migration `20260417110000_fix_pipe_closer_sdr_sync.sql` está pronta para `jsjsmuncfkbsbzqzqhfq`. Conteúdo é idempotente: backfill usa `IS DISTINCT FROM` + `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`. O bloco de validação no final garante falha imediata se drift persistir.

Comando para aplicar (dentro da regra operacional — requer autorização explícita do CTO):
```bash
SUPABASE_DB_PASSWORD='<senha-prod>' \
  node -e "... (mesmo padrão do tools/apply-migration.mjs apontando para db.jsjsmuncfkbsbzqzqhfq.supabase.co) ..."
```

**Produção `jsjsmuncfkbsbzqzqhfq` NÃO foi tocada nesta sessão.**
