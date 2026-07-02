---
type: adr
title: "Pin search_path em SECURITY DEFINER (hardening 42883)"
status: accepted
created: 2026-06-23
updated: 2026-06-23
tags: [adr, db, security, multi-tenant, search-path, definer]
related: ["[[ADR-2026-06-22-torque-mcp-interno]]", "[[2026-06-24-torque-mcp-s5-s6-crm-mcp-c1]]"]
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-06-23 — Pin search_path em SECURITY DEFINER (hardening 42883)

**Data:** 2026-06-23
**Status:** accepted
**Escopo:** Todas as funções `SECURITY DEFINER` e funções de trigger no schema `public` (DB dev + prod).

> Não há ADR equivalente em `docs/adr/` do repo — esta é uma decisão de hardening de DB, materializada em migration, não uma decisão de arquitetura de produto. Este registro é a fonte canônica. Cross-link: a ferramenta que expôs o problema está em [[ADR-2026-06-22-torque-mcp-interno]] (`docs/adr/0011-torque-mcp-internal-ops-server.md`).

## Contexto

Uma função `SECURITY DEFINER` com `search_path` mutável resolve nomes **não-qualificados** contra o `search_path` do **caller** em runtime. Isso é duas feridas ao mesmo tempo:

1. **Superfície de privilege-escalation.** Um caller hostil prepende um schema com um objeto malicioso que faz shadow de uma referência não-qualificada dentro da função — que roda como owner. Em multi-tenant isso vira bypass de RLS / roubo de dados.
2. **Causa-raiz de uma classe recorrente de incidente 42883.** Uma função (definer ou trigger) sem `search_path` próprio **herda** o path do caller. Quando o caller é uma RPC hardened com `SET search_path = ''` (ex.: `bulk_delete_leads`, `restore_lead`), qualquer referência não-qualificada a um objeto de `public` **não resolve** → `ERROR 42883 ... does not exist` → o statement aborta → a operação inteira falha.

O incidente disparador foi o outage de delete/restore de lead: o trigger `leads_derive_uf_from_ddd` (criado em `20261211100000_lead_uf_and_map`, sem `SET search_path`, chamando `uf_from_ddd(...)` não-qualificado) quebrava todo delete porque o caminho de delete passa por `bulk_delete_leads` (definer, `search_path=''`). Corrigido pontualmente em `20261224000000_fix_leads_uf_trigger_search_path.sql` — mas o ponto-fraco era sistêmico, não pontual.

A varredura veio da tool `schema.audit_definer` do torque-mcp (PR #866, `bfe1cac3`): **58 funções `SECURITY DEFINER` em `public` na prod rodavam com `search_path` mutável.**

Já havia havido uma rodada anterior — PR #648 (`f6a608c2`, 2026-06-01) pinou os definers da época em `public, pg_temp`. Mas funções novas se acumulam sem pin entre rodadas (drift). É exatamente por isso que a correção precisa ser **idempotente e re-rodável**, e por que a auditoria (`schema.audit_definer`) virou ferramenta permanente, não one-shot.

## Forças em jogo

**Restrições do CTO:**
- Segurança é construída desde o primeiro commit, não fase de otimização. Fechar a superfície de hijack é inegociável.
- Migration deve ser prod-neutral em comportamento: não pode mudar o resultado de nenhuma função que funciona hoje.

**Restrições técnicas:**
- Pinar em `''` (vazio) foi a **causa** do scar leads_uf — remove `public` e quebra referências não-qualificadas. Não pode recorrer.
- Conjuntos de funções diferem entre dev e prod → lista hardcoded de assinaturas dá drift. A migration precisa se adaptar ao DB.
- Migration imutável após apply (regra do vault) → tem que ser idempotente e auto-guardada (uma função que não pode ser alterada não pode abortar a migration inteira).

**Restrições de segurança/multi-tenant:**
- Funções definer fazem bypass de RLS — qualquer fresta de shadowing escala entre tenants.

## Opções consideradas

### Opção (a) — Pinar em `''` (search_path vazio)
Vantagem: máximo isolamento, nenhum schema implícito.
Desvantagem (vetada): foi exatamente o que quebrou `leads_derive_uf_from_ddd` (referências `public` não-qualificadas deixam de resolver → 42883). Reintroduziria o outage.

### Opção (b) — Pinar em `public, extensions` ⭐ ESCOLHIDA
Vantagem: **mantém `public`** → o modo de falha do leads_uf não pode recorrer; e o path fica FIXO independente do caller → fecha o hijack. `pg_catalog` é sempre buscado primeiro (implícito); `extensions` cobre funções de extensão não-qualificadas. Análise dos corpos das 58: toda referência cross-schema (`net.*`, `auth.*`, `cron.*`, `vault.*`) já é schema-qualificada (resolve independente do path); só refs não-qualificadas de `public`/`extensions` dependem do path — e ambos os schemas estão presentes.
Desvantagem: levemente mais permissivo que `''`, mas sem exposição prática dado que todo cross-schema é qualificado.

### Opção (c) — Corrigir caso a caso conforme estoura
Vantagem: zero risco de regressão em massa.
Desvantagem (vetada): foi o que produziu o scar leads_uf — reativo, deixa a classe inteira viva, cada nova função definer é um novo bug latente.

## Decisão

**Adotada opção (b).** Pinar toda função definer/trigger não-pinada de `public` em `search_path = public, extensions`, via migration dinâmica idempotente.

### D1 — `public, extensions`, NUNCA `''`
A escolha é deliberada e documentada no header da migration: manter `public` neutraliza o modo de falha do leads_uf; o path fica determinístico independente do caller, fechando o privilege-escalation. `ALTER FUNCTION ... SET search_path` **não toca o corpo** da função — só o contexto de resolução — e é reversível (`RESET search_path`).

### D2 — DO-block dinâmico, idempotente, por-função guardado
Migration `20261227000000_pin_definer_search_path.sql`: itera `pg_proc` × `pg_namespace` filtrando `prosecdef = true` em `public` que ainda não têm `search_path=%` em `proconfig`, e `ALTER`a cada uma dentro de um `BEGIN ... EXCEPTION WHEN OTHERS` (uma função inalterável não aborta o lote). Adapta-se a cada DB (dev/prod têm conjuntos diferentes) e só toca funções não-pinadas → re-rodável sem efeito colateral.

### D3 — Sweep companheiro dos triggers non-definer
A `audit_definer` só varre `prosecdef = true` → **perdeu as funções de trigger non-definer** (foi assim que o leads_uf 42883 ficou escondido). A migration companheira `20261229000000_pin_trigger_search_path.sql` (PR #868, `65ef937f`) faz o mesmo sweep nas **35 funções de trigger não-pinadas** da prod. Esse arquivo foi **re-timestampado de `20261228000000`** (PR #871, `f9e536e2` / merge `53669f66`) porque `20261228000000_disparo_audience_rpcs_master_branch.sql` já tomara aquela versão e fora aplicada em prod — colisão de versão resolvida sem mudar conteúdo. O ponto-cego do auditor foi fechado de vez pela tool `schema.audit_triggers` (PR #873, `dd1dbfdb`, S5 do torque-mcp).

## Consequências

### Positivas
- Privilege-escalation via search_path hijack fechado em 58 definers + 35 triggers; resolução agora é determinística independente do caller.
- A classe inteira de incidentes 42883 "unqualified call sob caller hardened" não pode recorrer — não só o leads_uf pontual.
- Migration re-rodável + tool de auditoria permanente (`schema.audit_definer` / `schema.audit_triggers`) cobrem o drift: funções novas que entrem sem pin são detectáveis e a migration pode ser re-aplicada conceitualmente via novo sweep.

### Negativas
- `public, extensions` é levemente mais permissivo que `''`. Mitigação: todo acesso cross-schema nas funções já é qualificado; risco prático nulo.
- Migration imutável: um sweep futuro de funções novas exige uma migration nova (não editar esta).

### Pendências geradas
- LOW: rodar `schema.audit_definer` / `schema.audit_triggers` periodicamente para pegar drift de funções novas (toda nova função definer/trigger nasce sem pin se o autor esquecer).
- LOW: `is_master_user` foi confirmada pinada por este sweep dinâmico (achado "ship-blocker" do crm-mcp era falso alarme — ela lê `proconfig` vivo, não o `CREATE`).

## Status

**Accepted.** Aplicado em **dev** (`bcfadphgsibjzivtbjvc`) — commit verifica `unpinned → 0` e `has_feature` resolve pós-pin. Aplicado em **prod** (`jsjsmuncfkbsbzqzqhfq`) conforme registro de operação (re-auditoria `schema.audit_definer` via MCP → `unpinned=0`). Revert disponível: `scripts/recovery/definer_pin_revert_prod.sql` (RESET nas 58 funções).

## Evidência (PRs / SHAs / migrations)

| Item | Referência |
|---|---|
| Migration definers (58 funcs) | `supabase/migrations/20261227000000_pin_definer_search_path.sql` |
| PR / merge definers | PR #867 — merge `e76b32a7` — commit `04e98055` (2026-06-23) |
| Migration triggers (35 funcs) | `supabase/migrations/20261229000000_pin_trigger_search_path.sql` |
| PR / merge triggers | PR #868 — `65ef937f` (sweep) |
| Re-timestamp p/ colisão de versão | PR #871 — `f9e536e2` — merge `53669f66` (vs `20261228000000_disparo_audience_rpcs_master_branch.sql`) |
| Tool que expôs (audit definer) | `schema.audit_definer` — PR #866 — `bfe1cac3` |
| Fecha ponto-cego (audit triggers) | `schema.audit_triggers` — PR #873 — `dd1dbfdb` |
| Scar leads_uf (incidente disparador) | `supabase/migrations/20261224000000_fix_leads_uf_trigger_search_path.sql` — trigger `leads_derive_uf_from_ddd` (de `20261211100000_lead_uf_and_map`), call `uf_from_ddd` não-qualificada sob `bulk_delete_leads`/`restore_lead` |
| Rodada anterior (prior art / drift) | PR #648 — `f6a608c2` (2026-06-01) — pinou em `public, pg_temp`; funções novas reacumularam sem pin |
| Revert | `scripts/recovery/definer_pin_revert_prod.sql` |
| ADR adjacente (tool torque-mcp) | `docs/adr/0011-torque-mcp-internal-ops-server.md` · [[ADR-2026-06-22-torque-mcp-interno]] |

## Alternativas rejeitadas

- **`SET search_path = ''`** — causa direta do outage leads_uf (remove `public`, quebra refs não-qualificadas → 42883). Vetada por D1.
- **Lista hardcoded de assinaturas** — drift entre dev/prod e a cada função nova. Substituída pelo DO-block dinâmico (D2).
- **Correção caso-a-caso** — reativa, mantém a classe viva (foi o que gerou o scar). Substituída pelo sweep em massa.
