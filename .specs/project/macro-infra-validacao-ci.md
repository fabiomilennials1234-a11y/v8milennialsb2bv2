# MACRO — frente de infra: validação, pgTAP, CI (#1212 / #1226 / CI-red) + separar backfill de migration

> Arquiteto (Cais) · 2026-07-27 (rev.2, fato novo: Docker ausente + push acidental em prod) · aterrado em prod/main. NÃO implementação. Macro + fatias. Issues após ratificação (o corpo do #1212 já foi corrigido — não esperou).

## Estado real medido

- **Baseline em main desde #1233** (07-23): 1 arquivo 1.8 MB + 840 em `archive/` + 15 ativas. **Ledger de prod = 18, reconciliado 1:1 com o repo.** O "840 bloqueador" é STALE.
- **Dois bloqueadores reais do ambiente** (nenhum é "840"):
  1. Linha do baseline no ledger = **marcador de 189 chars**, não o dump → `create_branch` replaya os 17 sobre schema vazio → branch quebrada.
  2. **Docker NÃO está instalado** (`docker: command not found`, medido) → `supabase db reset` não roda hoje. Homebrew disponível.

## Driver da decisão (CTO 2026-07-27): validação LOCAL elimina uma CLASSE de acidente

Hoje um `db push` com URL errada **aplicou 3 migrations em PROD sem autorização**, e o `DO $reseed$` da `20260727110100` promoveu a parede da Milennials (17→15) sozinho no apply. Blast = 1 org (a do CTO), conteúdo era o aprovado — mas o **caminho foi acidente**. Validação local **mata a classe por desenho**: sem URL, sem ref, sem `db push`, **não existe caminho físico pra prod**. Guarda por construção, não por processo. Por isso o CTO revisitou a própria proibição de rodar local pra este uso.

## Ordem (rev.3 — Docker FORA por decisão do CTO) — **F1 → F4 → (F2 ‖ F3)**

CTO decidiu: **nada de Docker; usar o Supabase de prod via BRANCH EFÊMERA forkada de prod** como ambiente canônico (não validar direto em prod, não operar sem ambiente). F1 **inverte**: cloud-branch deixa de ser aposentada e vira o caminho oficial. **F4 sobe pra logo depois da F1**: sem local, todo push roda os `DO` block — se a migration não escreve dado de cliente, uma URL errada vira erro de schema recuperável, não mudança de dado.

## F1 — ambiente canônico = BRANCH EFÊMERA de prod, com GUARDA MECÂNICA

O caminho obrigatório passa a ser `db push --db-url <branch>`, e uma URL errada escreve em prod. A guarda antiga (`--dry-run` + conferir o ref) é **disciplina, não guarda** — e disciplina foi o que falhou hoje, com gente competente. **Guarda tem que ser mecânica:**

1. **Checkout NUNCA linkado** (feito + provado: `db push` bare → `Cannot find project ref`). Estado **permanente** do repo de trabalho, documentado. Linkar = ato deliberado e temporário. 1ª linha de defesa.
2. **Wrapper `scripts/db-push-branch.sh` que RECUSA o ref de prod** — a peça que vira processo em desenho:
   - recebe a URL; **aborta se a string contiver `jsjsmuncfkbsbzqzqhfq`** (o ref de prod vira **impossível de passar por acidente**, não "proibido por convenção");
   - roda `--dry-run` primeiro, imprime a lista de migrations a aplicar, **exige confirmação explícita**, só então aplica;
   - **checagem por efeito** (anotação do Forja): o push numa branch NOVA deve reportar backfill **"0 org"**; se reportar **"1 org promovida" → tocou dado real → ABORTA e investiga** (é sinal de branch impura ou URL de prod). Isso é checagem no wrapper, não nota de rodapé.
3. **Ciclo de vida da branch:** `list_branches` **antes** de criar (nunca duas); `delete_branch` **obrigatório** ao fim; a branch **não sobrevive entre sessões**. Quem cria, mata. (Custo $0.01344/h — órfã = cobrança à toa.)
4. **`config.toml project_id` = ref de prod, commitado** → trocar por id neutro/local (`torque-crm-local`) — remove o último ref de prod do default commitado. Risco baixo (deploy usa `--project-ref`, CI/link não dependem). Ver §leitura no runbook.

**Aceite:** wrapper existe e **prova-se** que aborta com a URL/ref de prod (teste); checkout não-linkado documentado como permanente; ciclo `list→create→push-via-wrapper→delete` no runbook; `config.toml` sem ref de prod; runbook branch-first commitado.
**Risco:** o ambiente É prod-adjacente (branch de prod) — por isso a guarda mecânica é o coração da fatia, não acessório. Revisor confere que o wrapper realmente barra (não só documenta).

## F1b — separar por FERRAMENTA, não por parâmetro (correção do furo do read-only)

**Furo da minha 1ª proposta** (Pauta foi aos docs, confirmei): `read_only=true` é do **servidor inteiro** — "execute **all queries** as a read-only Postgres user", não por-projeto. Ligar quebraria também a **escrita na BRANCH** — que é como a Bancada dirigiu o dedup hoje (`execute_sql` INSERT na branch, `hit_count` 1→2→3). Read-only global mataria o fluxo de validação que acabamos de adotar.

**Correção — um único caminho de escrita, uma única guarda:**

| Caminho | Uso | Guarda mecânica |
|---|---|---|
| **MCP** | **só leitura** — medir prod, conferir estado + `create_branch`/`list_branches`/`delete_branch` | `read_only=true` (server-wide) |
| **`psql` / CLI `--db-url`** | **TODA escrita**, sempre em branch | wrapper `db-push-branch.sh` que recusa o ref de prod |

**Provado pelos docs (não assumido):**
- **`create_branch` SOBREVIVE ao `read_only`.** Docs: Branching é **grupo de feature separado** (Management API), e `read_only` restringe o **role Postgres das QUERIES** (grupo Database). São ortogonais — read-only não toca branch-management. (Confirmação empírica barata pro CTO: após ligar, `create_branch`→`delete_branch` num throwaway; reversível, $0.01/h. Não consigo flipar a config do servidor daqui, mas o desenho está provado no doc.)
- **`apply_migration` TAMBÉM cai no `read_only`** (grupo Database, roda DDL como o role Postgres → negado). **Outra porta fechada** — e não perdemos nada: DDL da branch vem via `db push` pelo wrapper, não por MCP.

**Ganho, não custo:** escrita de QA vira **script `psql` versionado** em vez de sequência de chamadas MCP manuais. O exercício do dedup de hoje **não é re-executável** por outra pessoa; assim passa a ser reproduzível. A Bancada **já** usou `psql` hoje (teste de concorrência, 10 conexões) — o caminho existe e está provado.

**Aceite:** MCP Supabase com `read_only=true` (config do CTO); documentado que TODA escrita vai por `psql`/wrapper na branch, nunca por MCP; a sobrevivência do `create_branch` confirmada (doc + 1-shot empírico opcional).

## Apêndice — validação LOCAL (se um dia houver Docker)

O runbook local que estava aqui **não morre — vira apêndice.** Se/quando Docker existir: `supabase start && db reset && run.sh` (replaya o arquivo baseline real, $0, sem caminho pra prod) é o ambiente ideal (mais seguro que branch-de-prod). Até lá, branch efêmera é o canônico. Detalhe no runbook.

## F2 — #1226: fixtures pgTAP sem JWT (7 suítes vermelhas pós-#1209)

O #1209 apertou `assert_org_access` (membro ATIVO; enum `app_role` = admin/sdr/closer/…, **não** 'membro'). Fixtures semeiam `'membro'`/sem `is_active` → morrem.
**Escopo:** corrigir os fixtures das 7 suítes — roles válidas + `is_active=true` onde o teste pressupõe acesso; helper de seed único. Roda contra o local (F1).
**Aceite:** 7 suítes verdes no `run.sh` local + CI; helper único.
**Risco:** BAIXO-MÉDIO (fixture de permissões — revisor confere que não mascara furo de RLS).

## F3 — CI-red: 136 arquivos de teste falhando na main

**Escopo:** inventariar os 136 (vitest) por cluster de causa (types.ts stale, mocks supabase, ratchets driftados, enum `app_role`); corrigir em ONDAS por cluster; travar um **baseline verde** (ratchet que barra regressão nova). Não consertar o mundo numa PR. **Cada onda declara: corrigiu-causa vs silenciou** (e por quê).
**Aceite:** falhas → zero por onda documentada; ratchet verde; a próxima fatia não paga mais a dupla-prova.
**Risco:** MÉDIO (volume; risco de mascarar defeito — declaração corrigiu/silenciou por onda).

## F4 (NOVO, fatia própria) — separar BACKFILL de MIGRATION

**Causa medida:** a `20260727110100` junta "mudar schema" + "reescrever parede de cliente" no MESMO apply — foi isso que transformou o push acidental em **mudança de dado de cliente**. Varredura (feita) dos DO-blocks que escrevem dado de cliente no apply, em main:

| Migration | DO | writes de dado de cliente | Natureza |
|---|---|---|---|
| `20260724100100_seed_default_dashboard` | 1 | 11 | **seed de painel de cliente no apply** — refatorar |
| `20260727110100_tv_reseed_legacy_to_native` | 1 | 15 | **reescreve painel de cliente no apply** — refatorar |
| `20260101000000_baseline_prod_schema` | 1 | 83 | dump (dados de referência do snapshot) — caso à parte, não é backfill |

**Padrão — DUAS regras (refinamento CTO), não uma. `migration = só schema`, sempre.**
- **(a) Backfill de PRODUÇÃO, uma vez** (caso do `tv_reseed_legacy_to_native` — promover widget legado de org real): migration **cria a fn, NÃO chama**; humano invoca **deliberadamente**, com **backup + idempotência** (padrão S1: `dashboard_composition_backup` antes). Assim `db push` acidental muda schema, nunca dado de cliente.
- **(b) Seed de AMBIENTE LOCAL** (caso do `fn_seed_default_dashboard` quando o alvo é o stack local): vai pro **`supabase/seed.sql`**, que roda no `db reset` local e **NUNCA** num `db push` remoto — separação **garantida pela ferramenta**, não por disciplina. Importa agora que adotamos local: no `db reset` a gente QUER a parede semeada pra exercitar; enfiar tudo em "RPC deliberada" faria todo `db reset` virar ritual manual → ambiente chato → ambiente não-usado.
- **Lint (a peça que faz valer sem depender de memória):** barra `INSERT/UPDATE/DELETE` de tabela de dado-de-cliente dentro de `DO`/apply de migration nova.

**TRAVA DAQUI PRA FRENTE, NÃO REVERTE** (ratificado CTO): as 2 já rodaram e o estado promovido é **exatamente o que o CTO aprovou** — reverter seria desfazer o pedido pra refazer igual. O valor é o **mecanismo** + tornar o re-seed **re-invocável à parte** (a fn `_fn_reseed_..._unchecked` já existe nas duas).

**Inventário (varredura feita):** `seed_default_dashboard` (11 writes) → regra (b) seed.sql; `tv_reseed_legacy_to_native` (15) → regra (a) invocação deliberada; `baseline_prod_schema` (83) = dump, **caso à parte**, não é backfill.
**Aceite:** nenhuma migration NOVA escreve dado de cliente no apply; seed local em `seed.sql`; backfill de prod = fn + invocação deliberada c/ backup; lint verificável contra reincidência.
**Risco:** MÉDIO — mexe no MECANISMO de 2 migrations já aplicadas (sem reverter estado). Área frágil (dado de cliente) → revisor.

## Riscos transversais
- Tocar ledger de prod (só F1b-rejeitada): [[stale-checkout-db-push-trap]] / [[migration-timestamp-collisions]]. Caminho recomendado não toca.
- Mascarar defeito (F2/F3): cada correção declara causa vs silêncio.
- Cron/pg_net/Realtime fora do local: documentado em F1, não é buraco escondido.

## CONTEXT PACKET — CP (infra rev.2)
**Alvo:** #1212 (corpo FEITO + runbook local + matriz cobre/não-cobre), #1226 (7 fixtures + helper), CI-red (ondas + ratchet), F4 backfill-separation (refatorar seed_default_dashboard + tv_reseed + guard). Paths: `supabase/tests/run.sh`, `supabase/tests/*.sql`, `supabase/migrations/2026072410{0100},2026072711{0100}`, `.specs`/vault runbook.
**Descartado:** "840 é bloqueador" (baseline feito, ledger=18); popular statements do baseline no ledger; local "já funciona hoje" (Docker ausente — corrigido); consertar CI numa PR.
**Achado provado:** ledger baseline-row=189 chars (marcador); Docker ausente; 2 migrations escrevem dado de cliente no apply (seed_default_dashboard, tv_reseed) — a raiz do push-acidental virar mudança-de-dado.
**Aberto (CTO):** cloud-branch fica (com guard) ou aposenta de vez? F4 refatora as 2 já-aplicadas ou só trava daqui pra frente (as 2 já rodaram; o valor é o mecanismo + re-invocabilidade)?
