# 2026-06-02 — RLS master ghost em checklists

## Mudanças
- **RLS / Permissões**: `checklists` e `checklist_items` recuperaram as policies `master_ghost_*` (presentes nas irmãs `acoes_do_dia`, `custom_pipe_entries`, `leads`, `pipeline_entries`…). Master que não é `team_member` da org-alvo voltou a conseguir criar/ler checklist (antes: `new row violates row-level security policy`).

## Arquivos tocados
- `supabase/migrations/20261114000000_master_ghost_rls_checklists.sql` — 4 policies novas (2 por tabela): `master_ghost_select_*` (FOR SELECT USING `is_master_user()`) + `master_ghost_all_*` (FOR ALL USING/WITH CHECK `is_master_user()`). Idempotente (`DROP POLICY IF EXISTS` + `BEGIN/COMMIT`).
- `tests/integration/rls-checklists-master.test.ts` — regressão: master insere/lê checklist + item em Org B (onde não é membro) → OK; admin org A insere/lê checklist com `organization_id = Org B` → RLS bloqueia / 0 rows.
- `Obsidian/.../03 — Reference/RLS Policies.md` — nova seção "Master ghost" + entrada checklists/checklist_items documentando o gap.

## Decisões
- Idioma idêntico ao das irmãs (forma zero-arg `is_master_user()`, `SECURITY DEFINER STABLE`) — sem subquery inline em `team_members`, sem risco de recursão `apply_rls()` no Realtime.
- Policies org-member (permissivas, via `get_my_organization_ids()`) **não tocadas** — combinam por OR com as ghost. Não-master continua escopado à própria org.

## Follow-ups
- **Aplicar em PROD pendente autorização CTO** (default = branch + push). Migration NÃO aplicada em prod nesta entrega.
- Auditar se há outras tabelas operacionais que perderam `master_ghost_*` no mesmo evento (audit do arquiteto indicou que só checklists/checklist_items estavam afetadas).
