# Checklist de demolição dos espelhos — SCRUM-639 (W6)

Critério D5 do épico **Funil é Funil**: **espelhos = 0**.

## Decisão de cutover

Em 2026-09-07, o CTO autorizou fechar o épico no mesmo dia e substituir a
janela temporal de sete dias por revisão técnica reforçada. O motivo objetivo:
`pg_stat_statements` 1.11 não expõe `last_call`, está sujeito a eviction LRU
e não sustenta sozinho uma afirmação de recência. A mudança está registrada na
Emenda 1 do ADR-0034 e na evidência
`revisao-final-2026-09-07.md`.

O DROP só pode ocorrer com todos os gates abaixo verdes na mesma sessão.

## Artefatos

| Arquivo | Função |
|---|---|
| `supabase/migrations/20271008000000_leitores_saem_dos_espelhos.sql` | Migra os 16 leitores SQL para fontes canônicas. Aplicada em produção. |
| `supabase/migrations/20271015000000_demolicao_dos_espelhos.sql` | Remove seis views, 18 funções de trigger e oito wrappers. |
| `supabase/migrations/rollback/20271015000000_demolicao_dos_espelhos.sql` | Restaura o catálogo imediatamente anterior ao DROP. |
| `tests/unit/espelhos-sem-leitores.test.ts` | Gate AST para `src/` e `supabase/functions/`. |
| `revisao-final-2026-09-07.md` | Evidência de paridade, dependências, n8n, rollback e validação. |

## Gates pré-apply

- [x] Branch criada do SHA exato de `origin/main`; branch Omie não participa.
- [x] Frontend da fatia de leitores publicado em produção.
- [x] 17 Edge Functions consumidoras publicadas em produção.
- [x] `20271008000000` aplicada e registrada no ledger.
- [x] Gate AST: zero acesso às seis relações em runtime.
- [x] Banco: zero função/procedure SQL ou PL/pgSQL lendo ou escrevendo espelhos.
- [x] Banco: zero view/rule externa dependente.
- [x] n8n: 108/108 workflows ativos inspecionados; zero acesso executável.
- [x] Paridade: 49.203 linhas comparadas, zero divergência.
- [x] `negocio_projetado`: 48.519/48.519 linhas, `security_invoker=on`,
      sem SELECT para `anon`.
- [x] Rollback ensaiado em transação contra produção: 6 views, 26 funções e
      18 triggers restaurados sem drift de definition, ACL, owner ou comment.
- [x] Migration de DROP ensaiada em transação e revertida.
- [ ] PR revisado, CI verde e mergeado na `main` mais recente.

## Ordem de aplicação

1. Buscar `origin/main` e rebasear se o SHA mudou.
2. Revisar e fundir migration, rollback, ADR e evidência.
3. Executar a migration a partir da `main` mergeada, junto com a linha
   `20271015000000` no ledger, dentro da mesma transação.
4. Confirmar seis views = 0, 18 funções de trigger = 0, oito wrappers = 0 e
   PostgREST recarregado.
5. Regenerar `src/integrations/supabase/types.ts` com Supabase CLI.
6. Remover tipos/casts de compatibilidade que se tornarem mortos.
7. Rodar TypeScript, lint, build, unit, Edge e testes focados.
8. Fundir a regeneração de tipos; aguardar frontend da `main` em produção.
9. Fazer smoke de funil custom, lead, dashboard, performance, API e n8n.
10. Anexar evidência final e mover SCRUM-638, SCRUM-639 e SCRUM-614 para Feito.

## Verificação pós-apply

```sql
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
 'custom_pipe_entries','custom_pipelines','custom_pipeline_stages');
-- 0

select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (
  p.proname ~ '^(pipe_whatsapp|pipe_confirmacao|pipe_propostas|custom_pipe_entries|custom_pipelines|custom_pipeline_stages)_(insert|update|delete)_fn$'
  or p.proname in ('delete_custom_pipeline','delete_system_pipeline',
    'custom_pipeline_delete_impact','system_pipeline_delete_impact',
    'get_custom_pipeline_stage_counts','get_custom_filtered_lead_ids',
    'bulk_add_to_custom_pipe','system_stage_role')
);
-- 0
```

## Rollback

```bash
node scripts/prod-sql.mjs --file supabase/migrations/rollback/20271015000000_demolicao_dos_espelhos.sql
```

Depois, remover `20271015000000` do ledger em transação controlada. O rollback
é uma única transação e notifica PostgREST para recarregar o schema.

## Fora deste DROP

| Objeto | Motivo |
|---|---|
| `pipeline_entries.stage_key` | Chave operacional ainda usada pelo motor. Migração para `stage_id` é ticket próprio. |
| `leads.pipe_whatsapp` | Coluna ainda usada por cinco funções SQL. SCRUM-222. |
| RPCs por slug/type do frontend | Permanecem até a fusão dos hooks e contratos por `pipeline_id`. |

## Limite da telemetria antiga

O script `scripts/medir-leitores-espelhos.mjs` permanece como diagnóstico
histórico. Seus deltas não autorizam nem bloqueiam este cutover. Eviction pode
reduzir contadores; `track=top` omite statements aninhados; a extensão não
fornece horário da última chamada. O gate atual usa inventário estático,
catálogo vivo, paridade total, análise de integrações e ensaio de rollback.
