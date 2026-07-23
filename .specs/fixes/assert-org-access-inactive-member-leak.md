# Furo #1209 — membro desativado lê receita, ranking e comissão

**Data**: 2026-07-22
**Issue**: #1209
**Classe**: segurança — permissões, multi-tenant, PII, dinheiro
**Estado**: **APLICADO E VERIFICADO EM PROD** em 2026-07-22, autorização explícita
do CTO. Versão gravada em `supabase_migrations.schema_migrations`:
**`20260722205847`** / `assert_org_access_require_active_member`.

> ⚠️ **Drift de bookkeeping (conhecido)**: o prefixo do arquivo no repo é
> `20270726000000`; aplicar por MCP grava o relógio real (`20260722205847`). São
> a MESMA mudança sob dois identificadores. Reconciliar quando o programa
> resolver o drift de ledger. Não reaplique o arquivo do repo achando que falta.

## O defeito

`public.assert_org_access(uuid)` é o gate de tenancy dos leitores canônicos do
ADR-0017. Os leitores são `SECURITY DEFINER`, portanto **bypassam RLS** e não
têm nenhuma outra rede de proteção — o gate é a única coisa entre um usuário e
o dado de dinheiro da organização.

O gate checava apenas a **existência** do vínculo:

```sql
-- membro ativo da org        <<< o comentário mentia
IF p_org_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.team_members
  WHERE organization_id = p_org_id AND user_id = auth.uid()
) THEN RETURN; END IF;
```

Falta `AND is_active = true`. A função irmã `get_my_organization_ids()` — que
governa as policies RLS — sempre fez certo. As duas divergiram em silêncio.

Consequência: **desativar um membro no produto nunca revogou a leitura de
receita, ranking e comissão.** O membro perde a UI, mantém o dado.

## Levantamento em produção (`jsjsmuncfkbsbzqzqhfq`, 2026-07-22)

| Métrica | Valor |
|---|---|
| Vínculos em `team_members` | 223 |
| Vínculos com `is_active = false` | 15 |
| Vínculos inativos com `user_id` não nulo | 13 |
| **Pares (user, org) com vínculo APENAS inativo** | **12** |
| **Usuários distintos afetados** | **12** |
| **Organizações distintas expostas** | **5** |

Os 12 pares são a exposição real: usuários sem nenhum vínculo ativo naquela org
que, ainda assim, passavam no gate. A diferença entre 15 e 12 são vínculos
inativos de usuários que também possuem vínculo ativo na mesma org (acesso
legítimo por outra via) ou com `user_id` nulo.

## Quem realmente perde acesso — CORREÇÃO ao item B da revisão

O revisor alertou que "2 pessoas ativas perdem leitura". **Esse número está
errado e não deve ir para o PR.** Ele não cruzou os 12 pares com `master_users`.

Apuração ao vivo em prod (2026-07-22):

| Grupo | Qtd | Efeito |
|---|---|---|
| Masters entre os 12 | **3** | **NÃO são cortados** — `is_master_user()` é avaliado ANTES do ramo de vínculo |
| Não-masters | **9** | Perdem a leitura, como deveria ter sido desde sempre |

Os 3 masters são exatamente os 3 logins mais recentes do conjunto
(`milennialswebservices@`, `gabrielgipp04@`, `maycosguerreiro@`), todos com
`master_users.is_active = true`. Foi isso que criou a ilusão de "pessoas ativas
sendo cortadas": eles parecem ativos porque logam direto, mas entram pelo ramo
master, não pelo vínculo.

**Por que staff da casa fica `is_active = false` em `team_members`**: a coluna é
**assento pago**, não acesso. Prova em `org_resolve_quota`, chave `max_users`:

```sql
COUNT(*) FROM team_members
WHERE organization_id = ... AND is_active = true AND NOT is_master_user(user_id)
```

Master é descontado do assento de propósito. Então marcar staff como inativo é o
mecanismo de não cobrar assento — e o acesso deles vem do caminho master.

Perfil dos 9 efetivamente cortados: login mais recente em **2026-06-02** (7
semanas antes do corte), **2 nunca logaram**. Nenhuma organização fica órfã —
todas mantêm 3-4 membros ativos.

## Segundo defeito encontrado — o gestor de portfólio estava quebrado

`get_my_organization_ids()` resolve duas dimensões de acesso:

```sql
SELECT organization_id FROM public.team_members
WHERE user_id = auth.uid() AND is_active = true
UNION
SELECT * FROM public.get_my_gestor_organization_ids();
```

O swap com `UNION` (ADR-0021, Gestor de Portfólio) **está aplicado e vivo em
prod** — confirmado lendo `pg_get_functiondef` no banco. O cabeçalho do arquivo
`20270211000001_gestor_portfolio_helper_union_swap.sql` diz "NÃO APLICADO" e
está desatualizado. Confie no banco, não no arquivo.

`assert_org_access` nunca contemplou o ramo do gestor. Verificado em prod:

| Fato | Valor |
|---|---|
| Gestores ativos | 1 |
| Bindings em `gestor_organizations` | 3 |
| Esse gestor é `team_member` de alguma das 3 orgs? | **não** |
| Esse gestor é master? | **não** |

Logo o gate **já o rejeitava** — os leitores canônicos estavam inacessíveis
para o gestor hoje. Isso inverte o risco levantado no brief: incluir o ramo do
gestor não é afrouxamento, é a correção de um segundo defeito. Apertar
`is_active` sem incluir o gestor teria mantido ele quebrado.

## A correção

`assert_org_access` passa a **delegar** a regra de vínculo para
`get_my_organization_ids()`, em vez de reimplementá-la:

```sql
IF EXISTS (
  SELECT 1 FROM public.get_my_organization_ids() AS org_id
  WHERE org_id = p_org_id
) THEN RETURN; END IF;
```

Fonte única de verdade: quem enxerga a org via RLS é exatamente quem passa no
gate dos leitores `SECURITY DEFINER`. Elimina a classe de bug (drift entre as
duas funções), não só a instância. Evolução futura do modelo de acesso chega
nos dois caminhos de uma vez.

Preservado, na ordem original: `service_role` → `master` → membro ativo /
gestor. Adicionado guard explícito de `p_org_id IS NULL`.

Sem recursão: `get_my_organization_ids()` é `SECURITY DEFINER STABLE` e não lê
nenhuma tabela cujas policies chamem de volta o gate. `auth.uid()` lê o GUC do
JWT e não é afetado por `SECURITY DEFINER`.

## Escopo estendido — `assert_org_member(uuid)`

Auditando as irmãs, `assert_org_member` carrega o **mesmo defeito**: checa
vínculo sem `is_active` e ignora o gestor. Ela guarda os leitores de dinheiro
da Carteira:

`get_portfolio_clients`, `get_portfolio_kpis`, `get_revenue_at_risk`,
`get_vendedor_ranking`, `get_pending_orders`

Mesmo bug, mesma classe de dado — e `get_portfolio_*` é justamente a superfície
do Gestor de Portfólio. Corrigida na mesma migration. Fechar só
`assert_org_access` seria trancar a porta da frente e deixar a dos fundos
aberta.

## Arquivos

- `supabase/migrations/20270726000000_assert_org_access_require_active_member.sql` — NOVA
- `supabase/tests/assert_org_access_test.sql` — NOVA (pgTAP, plan 25)
- `supabase/tests/run.sh` — registra a suíte nova nos dois caminhos (pg_prove e psql)

## Prova (pgTAP, plan 25)

Cinco caminhos de decisão, mais regressão e planted-failure:

| Bloco | Afirma |
|---|---|
| (a) | assinatura, `EXECUTE` p/ authenticated+service_role, `anon` negado |
| (b) | membro **ATIVO** passa na própria org, bloqueado em org alheia |
| (c) | membro **DESATIVADO** é bloqueado — nos dois gates |
| (d) | **master** passa cross-org |
| (e) | **service_role** passa (mesmo com `sub` de usuário desativado) |
| (f) | **gestor** passa nas orgs que gerencia, bloqueado nas outras; gestor desativado perde acesso |
| (g) | `p_org_id NULL` nunca concede |
| (h) | regressão: membro ativo **continua** lendo `get_sales_metrics`; desativado não |
| (i) | **planted-failure**: replanta a definição antiga e prova que sob ela o desativado passava e o gestor era bloqueado |

O bloco (i) é o que torna a suíte load-bearing: sem ele, (c) e (f) poderiam
estar verdes por acidente.

## Aplicação em PROD — 2026-07-22

Aplicado direto em produção por decisão do CTO, porque **não existe ambiente de
validação neste programa hoje**: Docker travado em diálogo de senha do macOS,
dev aposentado (404 migrations atrás, sem a função), e branch efêmera impossível
(a única branch está em `MIGRATIONS_FAILED` desde 2026-03-11 — o repo não
replaya do zero, morre em jan/2026). Rollback capturado e testado antes de
qualquer escrita.

### Baseline capturado em prod ANTES da escrita — o furo provado ao vivo

| # | Caso | Antes |
|---|---|---|
| 8 | Desativado na org que o desativou (`assert_org_access`) | **PASSOU** ← o furo |
| 13 | Desativado (`assert_org_member`) | **PASSOU** ← furo na Carteira |
| 4,5,6 | Gestor nas 3 orgs que gerencia | **BLOQUEOU** ← gestor quebrado |
| 1,2,3,9 | Master / ativo / org alheia / service_role | corretos |

### Validação DEPOIS da escrita — 14/14 no gate

Todos os 14 casos bateram com o esperado, incluindo a inversão dos 5 que estavam
errados. Impersonação via `set_config('request.jwt.claims', …, true)` dentro de
um único `DO` block (o escopo local não sobrevive entre statements — testar em
dois statements dá falso resultado).

### Validação dos 9 leitores — 8/8

Master lê dado real (`get_portfolio_clients` total=39, `get_portfolio_kpis`
total_clients=39, `get_sales_metrics`/`get_ranking`/`get_commission_ledger`/
`get_funnel_flow` todos com payload). Membro ativo segue lendo a própria org.
Desativado recebe vazio em todos.

> `get_funnel_flow` exige `p_pipeline_id` (valida e levanta erro próprio se
> nulo) — não é regressão, é contrato da função. Validado com pipeline real.

### FALSO ALARME registrado — os 5 leitores da Carteira "não levantam"

Na primeira passada, `get_portfolio_kpis` com usuário desativado pareceu **ler**.
Investigado antes de qualquer decisão de rollback. Causa: os 5 leitores da
Carteira têm handler deliberado no final do corpo:

```sql
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'access_denied' THEN RETURN NULL; END IF;  -- ou payload vazio
  RAISE;
```

O gate **dispara** normalmente; a função converte `access_denied` em payload
vazio por design (estado vazio na UI em vez de crash). Confirmado por asserção
direta: desativado recebe `NULL` / `total=0, rows=0` / `[]` em todos os cinco.
**Nenhum dado vazou.**

Lição para quem for testar esses leitores: **ausência de exceção não é prova de
leitura**. Asserte o conteúdo do payload, não o fato de não ter levantado.

### Rollback

Capturado em `pg_get_functiondef` antes da escrita, salvo em arquivo e
**testado executando de verdade** contra sandbox local (exit 0, e comprovou que
restaura o comportamento antigo — o desativado volta a passar). Não foi
necessário acionar.

## Histórico do bloqueio (resolvido pela decisão de aplicar em prod)

**Dev (`bcfadphgsibjzivtbjvc`) não serve como alvo de verificação.** Após
`supabase link`, `supabase migration list` mostra:

- 840 migrations locais
- **436 aplicadas em dev**
- **404 só locais** (faltando em dev)

Entre as faltantes está `20261114000011_guard_definer_analytics_rpcs.sql`, que
**cria** `assert_org_access`, e `20270211000000/000001` (fundação + swap do
gestor). Ou seja: **a função que este fix corrige não existe em dev**, e a
stack inteira do ADR-0017 tampouco. Aplicar só esta migration lá criaria uma
função órfã sobre um schema que não a suporta; rodar `db push` aplicaria 404
migrations de uma vez, o que é decisão do CTO, não minha.

**Alvo correto de verificação = Postgres local** (`supabase start`), que aplica
as 840 migrations do zero — exatamente o que o CI faz e o que o `run.sh`
documenta. Isso ficou bloqueado nesta sessão porque o Docker Desktop parou num
diálogo de senha de administrador do macOS.

Para destravar:

```bash
# aprovar o prompt do Docker Desktop, então:
supabase start
bash supabase/tests/run.sh
```

## Item 3 do brief — o furo se repete em outro lugar? Sim, em 23 funções

Varredura no catálogo de prod: funções `SECURITY DEFINER` em `public` que
checam vínculo do usuário em `team_members` via `auth.uid()` **sem** filtrar
`is_active` e **sem** delegar aos helpers. 25 no total; 2 corrigidas aqui,
**23 remanescentes**.

Ordenadas por raio de alcance, não por gravidade isolada:

### Tier 1 — predicados de RLS (29 policies afetadas)

Estas são as piores: alimentam policies, então o membro desativado continua
satisfazendo o predicado em toda tabela que as usa.

| Função | Policies usando |
|---|---|
| `is_user_responsible` (3 sobrecargas) | **15** |
| `is_campanha_viewer` | **9** |
| `is_campanha_member` | **5** |

### Tier 2 — resolvedor compartilhado

| Função | Chamada por |
|---|---|
| `resolve_org_for_rpc` | 5 funções |
| `is_responsible_in_same_org` | 1 função |

`resolve_org_for_rpc` é especialmente feio: resolve a org do chamador com
`LIMIT 1` sem `is_active`, então além de não revogar, pode resolver para a org
errada quando há múltiplos vínculos.

### Tier 3 — leitores diretos (dinheiro / PII / LGPD)

`get_revenue_attribution`, `get_funnel_conversion`, `get_pipeline_velocity`,
`export_lead_data` (LGPD), `get_email_thread`, `get_unified_conversations`,
`get_lead_field_changes`, `get_import_batches`, `get_workflow_node_stats`

### Tier 4 — escritores e operações destrutivas

`generate_api_key` (emite credencial de API!), `create_org_sandbox`,
`seed_demo_data`, `remove_demo_data`, `rollback_import_batch`,
`track_recent_view`, `check_sla_breaches`

**Recomendação**: fatia dedicada, atacando Tier 1 primeiro — 29 policies é um
raio maior que os 2 gates corrigidos aqui. A correção estrutural é a mesma:
delegar aos helpers em vez de reimplementar a regra de vínculo. Vale considerar
um invariante pgTAP novo (INV-5) em `rls_invariants.sql`, ratcheted contra
baseline 23, para impedir que a classe volte a crescer.
