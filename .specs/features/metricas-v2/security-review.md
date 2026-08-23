# Crivo de segurança — Métricas v2, fatias 9 e 10

**SCRUM-320** · revisão de 2026-08-20 · alvo `origin/develop` @ `ee851899`
Rubric: `.claude/skills/security-rubric/SKILL.md`

## Veredito

```
## Segurança
Bloqueia: nada
Herdado:  src/modules/analytics/hooks/useMetricCustomDefinitions.ts:12 — comentário
          nomeia a helper ERRADA de escrita (ver F1)
          CI — 4 jobs vermelhos no HEAD de develop, pgTAP entre eles (ver F2)
```

**APROVA.** Nenhum defeito de segurança em linha adicionada ou modificada pelas
fatias 9 e 10.

## Escopo revisado

Diff de `dcfb2c83` (17 arquivos), mais `b22e7237` (pgTAP) e `0139431a` (E2E/seed).

| peça | arquivo |
|---|---|
| semântica Lead ≠ Negócio | `supabase/migrations/20270813100000_metric_negocio_semantica.sql` |
| métrica personalizada | `supabase/migrations/20270813110000_metric_custom_definitions.sql` |
| painel do Estúdio | `supabase/migrations/20270811110000_metrics_studio_panels.sql` |
| motor | `fn_metric_measure`, `_metric_leaf*`, `fn_metric_tree_validate`, `_metric_tree_eval` |
| cliente | `useMetricMeasure`, `useMetricCustomDefinitions`, `useMetricsStudioReport`, `MetricComposer` |

## Checklist

| item | veredito | prova |
|---|---|---|
| **RLS** | ✅ | 4 policies em `metric_custom_definitions` (`:334`–`:363`) e 4 em `metrics_studio_panels`, **todas** via helper SECURITY DEFINER (`get_my_organization_ids`, `get_my_team_admin_organization_ids`, `get_my_team_member_ids`). **Zero** `SELECT … FROM team_members` inline — a recursão do `apply_rls` não é alcançável. INSERT e UPDATE têm `WITH CHECK`, não só `USING`. |
| **Multi-tenant** | ✅ | `fn_metric_measure` recebe `p_org_id` do cliente **mas a 1ª instrução é `PERFORM assert_org_access(p_org_id)`** (`:494`). A versão vigente no baseline (`20260101000000:1205`) exige membro **ativo** via `get_my_organization_ids()`, nega `NULL`, e libera só `service_role`, master e gestor de portfólio. |
| **EXECUTE grants** | ✅ | Todas as internas revogadas dos **três** caminhos (`PUBLIC`, `anon`, `authenticated`) e concedidas só a `service_role`: `_metric_leaf`, `_metric_leaf_stage_snapshot`, `_metric_leaf_negocios_abertos` (fatia 9 `:403`–`:416`), `_metric_tree_eval` (fatia 10 `:608`–`:611`). `fn_metric_tree_validate` é `authenticated` **por desenho** (validação em runtime pelo usuário logado) e revogada de `PUBLIC`/`anon`. |
| **Verificação do grant** | ✅ **e melhor que a rubric pede** | As duas migrations trazem bloco `DO` que roda `has_function_privilege` para `anon`, `authenticated` **e** `service_role` e **aborta a transação** se o grant estiver errado (fatia 9 `:420`–`:446`, fatia 10 `:619`+). A rubric pede a conferência manual contra o alvo do apply; aqui ela é mecânica e roda em **todo** apply. **Executou de verdade** — ver "O que foi provado por execução". |
| **search_path** | ✅ | Toda função SECURITY DEFINER nova tem `SET search_path = 'public'` (`:131`, `:222`, `:292`, `:374`, `:442` da fatia 10; `:158`, `:239`, `:305` da fatia 9). |
| **service_role não é backstop** | ✅ | O motor é SECURITY DEFINER e **bypassa RLS de propósito** — por isso o IDOR foi checado na mão. Ramo `custom`: `WHERE d.id = v_ref_id AND d.organization_id = p_org_id`, com `p_org_id` já gateado. Id adivinhado de outra org devolve zero linhas e levanta `22023`. |
| **Secrets** | ✅ | Nada no diff. `Secret Scan` verde no HEAD de develop. |
| **CORS / edge fn** | n/a | Nenhuma edge function no diff. |
| **PII** | ✅ | O relatório XLSX é montado no cliente a partir de medidas **já buscadas** pelo motor gateado; não abre caminho de dado novo. O `organizationId` vem de `useOrganization()` (auth context) em `useMetricsStudioReport.ts:38`, nunca de input. Medida é agregado, não linha de lead. |
| **Auth** | ✅ | Enforcement é server-side (RLS + `assert_org_access`). O cliente nunca envia org escolhido por usuário — `useMetricMeasure.ts:116`, `useMetricCustomDefinitions.ts:105`, `useMetricsStudioReport.ts:38`, todos de `useOrganization()`. |
| **Payment** | n/a | — |
| **Injection** | ✅ | **Zero `EXECUTE` dinâmico** no motor (ADR-0023 §3) — os hits de grep no arquivo são `EXECUTE FUNCTION` de trigger e GRANT/REVOKE. A árvore referencia só id do catálogo, filtro da allowlist e literal numérico; chave fora da allowlist é rejeitada com `22023` (`:186`). Filtros entram como parâmetro ligado, nunca concatenados. |
| **Migration = só schema** | ✅ | Os dois `DO` são: adição idempotente de FK (`sale_events_deal_id_fkey`) e os blocos de guarda. Os `INSERT`/`UPDATE` da fatia 9 tocam `metric_catalog_*` — **configuração de produto, não dado de cliente**. Guarda F4 respeitada: URL errada vira erro de schema recuperável. |

## O ponto que mais merecia ataque, e por que ele fecha

O compositor manda **árvore inline** (`kind='tree'`) para pré-visualizar antes de
existir linha gravada. Se essa prévia pulasse o validador, a allowlist não valeria
nada nesse caminho — seria a porta óbvia.

Não pula. `fn_metric_measure` (`:511`–`:534`) trata `custom` e `tree` no **mesmo
ramo** e chama `fn_metric_tree_validate(v_tree)` **antes** de `_metric_tree_eval`
nos dois casos. A prévia não é caminho privilegiado, e está escrito no código que
essa foi a intenção.

Complementos que fecham a mesma superfície:
- Validação nas **duas pontas** — trigger `BEFORE INSERT OR UPDATE` na escrita e
  `fn_metric_tree_validate` em runtime, porque a linha gravada sobrevive a uma
  mudança de validador.
- `derived_unit` é **sobrescrito pelo trigger**: payload que tente ditar a unidade
  é ignorado de propósito.
- Teto de tamanho (`pg_column_size(tree) <= 4096`) barra payload absurdo **antes**
  do parse.
- Escrita é `role = 'admin' AND is_active` via `get_my_team_admin_organization_ids()`,
  deliberadamente **mais estreita** que `get_my_admin_organization_ids()` para
  excluir o gestor de portfólio (ADR-0021), que é escopado a funis e não deveria
  definir métrica da organização inteira.

## O que foi provado por EXECUÇÃO, não por leitura

Distinção que importa: quase tudo acima é leitura de código. Isto aqui rodou.

Run `31724677074` (Tests @ `ee851899`, 2026-08-13):

- **As duas migrations aplicaram** (`Applying migration 20270813100000…` e
  `…110000…`). Como as guardas `DO` abortam a transação quando o grant está
  errado, **o apply ter concluído prova que os grants estão certos** num Postgres
  real — `anon` e `authenticated` sem EXECUTE nas internas, `service_role` com.
- **`metric_negocio_semantica_test.sql` e `metric_custom_tree_test.sql` rodaram
  e passaram.** Nenhuma linha `not ok` associada a nenhuma das duas.
- `Lint & Build` **verde**, incluindo `TSC ratchet`, `dep-cruise ratchet`,
  `Migration version lint` e `Metric anti-pattern lint (ADR-0017)`.

Cobertura das asserções que a Emenda 1 obriga (47 no total):
`PF1` profundidade 3 aceita · `PF2` **profundidade 4 recusada** · `UN1` `count ÷ count`
é razão, não percentual — onde a armadilha de 100× morre · `UN9` operador fora do
conjunto recusado · `ER1` medida fora do catálogo recusada · `ER3` **`organization_id`
nunca vem do payload** · `SC2` RLS ligada.

## Achados não-bloqueantes

### F1 — comentário nomeia a helper errada de escrita · ✅ CORRIGIDO em 2026-08-20

`src/modules/analytics/hooks/useMetricCustomDefinitions.ts:12-13` dizia que a
escrita isola por `get_my_admin_organization_ids()`. A policy usa
`get_my_team_admin_organization_ids()`, e a migration documenta em `:341`–`:345`
**por que as duas não podem ser trocadas** (a primeira inclui gestor de portfólio).

Corrigido na branch `feat/scrum-316-conversao-entre-etapas`, com o motivo
inline — sem ele, a correção seria desfeita pela próxima pessoa que achasse que
os dois nomes são sinônimos.

Não muda comportamento — é comentário. O risco é de segunda ordem e real: alguém
lê o hook, acha que a policy "diverge do doc" e a "alinha" para a helper errada,
alargando quem define métrica da organização. Correção: uma linha.

### F2 — pgTAP vermelho no agregado esconde regressão futura

O job `RLS Invariants (pgTAP)` está **failure** no HEAD de develop, junto com
`Integration Tests`, `E2E Tests` e `Workflow System Tests` — o vermelho de base
já conhecido (SCRUM-359).

As falhas **não são destas fatias**: são `rls_invariants` INV-2, `stage_role_test`,
`stage_role_money_guard_test` e a projeção de comissão. As duas suítes de métricas
passam dentro de um job que termina vermelho.

Consequência: hoje as 47 asserções só são legíveis abrindo o log. Uma regressão
futura nelas **não muda a cor do job** — ele já está vermelho. O sinal existe mas
não alarma. É argumento a mais para o SCRUM-359.

## Adendo de 2026-08-20 — medição direta, além do log de CI

A revisão acima se apoiava em leitura de código mais o log do run `31724677074`.
Depois dela, a fatia do SCRUM-316 exigiu uma branch efêmera de prod
(`tzuuakksfgfjilqfaoak`, criada e **encerrada** na mesma sessão), e isso permitiu
medir o que antes era inferência:

- **As migrations das fatias 9 e 10 aplicaram** num Postgres limpo, e os blocos
  `DO` de guarda **não abortaram** — confirmação de segunda fonte para os grants.
- **Varredura de ACL direta** (`has_function_privilege` contra o banco):

| função | anon | authenticated | service_role |
|---|---|---|---|
| `_metric_leaf` | false | false | true |
| `_metric_leaf_coorte_etapa` | false | false | true |
| `_metric_tree_eval` | false | false | true |
| `_metric_tree_unit` | false | true | true |
| `fn_metric_measure` | false | true | true |
| `fn_metric_tree_validate` | false | true | true |

  **`anon` é `false` em todas as seis.** As três internas também são `false`
  para `authenticated`. A superfície pública é exatamente a pretendida.

- **`metric_custom_tree_test.sql` passou inteiro** (48 asserções), assim como
  `metric_negocio_semantica_test.sql` (33) e `composable_metrics_engine_test.sql`
  (48) — as suítes que o job vermelho do CI impedia de ler como verdes (F2).

Isto **não** altera o veredito, que já era APROVA. Altera a força da evidência:
os itens de grant e de RLS saíram de "lido no SQL" para "medido no banco".

## Limites desta revisão

- O corpo da revisão foi **estático mais log de CI**; o adendo acima cobre parte
  disso com medição em branch efêmera. O que segue sem exercício é a **borda**:
  PostgREST e telas não foram dirigidos por um usuário.
- Nada disto está em produção. O Estúdio inteiro está atrás de
  `organizations.metrics_studio_enabled`, que **não está em prod** — e o `REVOKE`
  em prod não foi verificado porque as migrations nunca foram aplicadas lá. Quando
  forem, as guardas `DO` rodam de novo contra prod e abortam se algo divergir.
- `assert_org_access` foi verificada na versão do baseline do repo. É a mesma que
  prod deve ter após a reconciliação do ledger (#1233), mas isso não foi medido
  contra prod nesta sessão.
