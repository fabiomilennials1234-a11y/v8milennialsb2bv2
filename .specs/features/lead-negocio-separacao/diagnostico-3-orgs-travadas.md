# Diagnóstico — as 3 organizações travadas no backfill M4

Medido em produção em **2026-08-24 ~05:5x UTC**, por leitura (nenhuma escrita).
Responde ao item "se eu tivesse mais uma hora #2" do handoff da sessão do épico #1761.

> O handoff dizia: *"investigar as 3 orgs travadas — descobrir **qual** card diverge na
> Basic4u, **qual** `assigned_to` é cross-org na Maria Bonita. É leitura, não código, e
> destrava decisão."* Aqui está, com os identificadores.

---

## Antes: o alerta "há outra sessão trabalhando no mesmo épico" está resolvido

O handoff apontou a migration `20270824050000_deal_created_trigger_usa_deals_source` em prod e
fora do repo. Ela **está no repo** desde o merge do PR #1784 (`dac28410`, 2026-08-24 05:05 UTC) —
o handoff foi escrito 38 minutos antes disso. Junto dela veio `20270213000000_workflow_trigger_deal_created`.

As duas estão no ledger, e os gatilhos de `deals` **não se atropelam**: `a_deals_exige_procedencia`
é `BEFORE INSERT` (aborta sem procedência) e `trg_workflow_deal_created` é `AFTER INSERT` (só roda
se o BEFORE deixou passar). Conferido em prod: 0 Negócios sem procedência entre 34.966.

---

## Basic4u — 1 card, e o espelho é quem está certo

**Card `dd91cd35-c66e-4b54-8e56-1c5aab4d498e`** (lead `3762780d-c436-48df-9611-5627b52a15b8`).

| | fonte (`custom_pipe_entries`) | espelho (`pipeline_entries`) |
|---|---|---|
| funil | **Reativação** (custom) | **Propostas** (system) |
| etapa | `novo` | `vendido` |

Não é divergência de etapa: é **divergência de funil**. As duas linhas nasceram no mesmo instante
(12/05 17:15) e descasaram depois. O par é o único assim em toda a base — e já está nomeado no
comentário de `fn_sync_deal_id_to_custom_pipe_entry` em prod: *"Medido em prod 2026-07-31: 1 par
nesse estado (card dd91cd35…), 16.192 em paridade"*.

**Qual lado é verdade — o espelho.** Evidência: o lead tem 1 linha em `sale_events`, o espelho tem
`closed_at = 2026-06-09`, e o card tem 1 evento em `pipeline_stage_events`. A fonte, dizendo
`Reativação/novo`, é o lado defasado.

Se o backfill rodasse, o bounce propagaria `novo` por cima de uma venda fechada — apagando
`closed_at`, gravando evento falso e acordando dispatch e workflow. **A guarda 0b fez o trabalho
dela.** Reconciliar = alinhar a fonte ao espelho, 1 linha.

## Maria Bonita — não é 1 card, são 1.091. E é 1 pessoa

O handoff registrou "1 card com `assigned_to` de outra organização". O medido:

**1.091 dos 1.311 órfãos (83%)** apontam para o **mesmo** `team_member`:

- `d72db961-3807-4eba-865f-321dc13af7d0` — "Gestor Diego" (`testediego@gmail.com`), **ativo**, membro de **Mapila Alimentos**
- todos os 1.091 cards criados entre **06/05 12:06 e 12:09** — três minutos

Um id, 1.091 cards, janela de 3 minutos: assinatura de importação/cópia em massa, não de erro
de operação. É `pipeline_entries.assigned_to`, **não** `leads.responsible_id` — o handoff avisou
que `scripts/m6-limpeza-cross-org.sql` pode não cobrir, e o alvo aqui é a coluna do card.

Decisão que isto destrava: **um** UPDATE resolve os 1.091 (para NULL ou para um membro de Maria
Bonita). Não é caso a caso.

## Goletric Pinheiros — nenhum candidato estrutural sobreviveu

O handoff registrou `pipeline_stage_events` indo de 14547 → 14548 no dry-run: *"o bounce moveria
um card de etapa"*. Medi os cinco candidatos estruturais que explicam esse efeito. **Todos zero:**

| candidato | Pinheiros | Basic4u | Maria Bonita |
|---|---|---|---|
| etapa divergente fonte↔espelho (guarda 0b) | 0 | **1** | 0 |
| funil divergente fonte↔espelho | 0 | **1** | 0 |
| `assigned_to` cross-org | 0 | 0 | **1.091** |
| linha custom sem par no espelho | 0 | 0 | 0 |
| `stage_key` órfão em funil system | 0 | 0 | 0 |

Só sobrou `wa_drift` (`leads.pipe_whatsapp` ≠ `pipeline_entries.stage_key`): **2 cards** —
`17cd5050` (espelho `leads_antigos_inativos`, lead `esfriou`) e `9f23a778` (espelho `esfriou`,
lead `novo`). O próprio SQL do M4 marca essa medida como *"Relatório, não guarda"*, então ela
não explica o evento por si.

**Conclusão honesta: a causa de Pinheiros não é confirmável por leitura.** Ou já não existe
(a base andou desde a medição), ou é dinâmica e só aparece durante o bounce. O próximo passo é
re-rodar o dry-run — que é o padrão do runner e termina em `ROLLBACK` — e ler o `RAISE EXCEPTION`.
Sem afirmar causa a partir de números que hoje estão limpos.

---

## Interação NOVA que o handoff não podia conhecer

O M4 tem esta guarda (`scripts/backfill-lead-negocio-m4.sql:310`):

```sql
IF v_agora <> a.workflow_execs THEN
  RAISE EXCEPTION 'FAIL: workflow_executions foi de % para % — o backfill disparou automacao.', …
```

Desde 2026-08-24, `deals` tem `trg_workflow_deal_created` (`AFTER INSERT`), que chama
`fire_workflow_trigger('deal_created', …)`. O M4 insere um Negócio por card órfão — 6.089 em
Pinheiros, 4.279 na Basic4u, 1.311 em Maria Bonita.

**Hoje é inerte:** 0 organizações têm workflow ativo com `trigger_type = 'deal_created'` (medido).
`fire_workflow_trigger` não encontra workflow, não insere execução, a guarda não vê diferença.

**Deixa de ser inerte no minuto em que um cliente criar essa automação** — e o gatilho + o node
"Criar Negócio" foram para produção hoje, visíveis para 100 das 107 orgs. A partir daí, o backfill
daquela org aborta na guarda, com uma mensagem que aponta para "o backfill disparou automação"
sem dizer que a automação é do cliente.

Pré-voo para colar antes de rodar o M4 em qualquer org:

```sql
SELECT id, name, is_active FROM public.workflows
WHERE organization_id = '<org>' AND trigger_type = 'deal_created' AND is_active;
```

Se voltar linha: desative o workflow durante a janela do backfill, ou a guarda vai abortar — e
ela está certa em abortar, porque disparar automação de cliente em cima de 6.089 Negócios de
backfill é o dano que ela existe para impedir.

---

## Quadro de produção — 2026-08-24 ~05:5x UTC

| | handoff (01:2x BRT) | agora | leitura |
|---|---|---|---|
| Negócios | 34.966 | 34.966 | estável |
| Negócios sem procedência | 0 | 0 | o gate de #1761 está de pé |
| Cards órfãos | 11.719 | **11.721** | +2 |
| Órfãos fora das 3 orgs travadas | — | **42** | 99,6% dos órfãos são das 3 orgs |
| Órfãos criados desde 23/08 00:00 | 68 (~17/h) | **259** (~8,6/h) | auto-seed vivo, ritmo menor |
| Orgs com órfãos | — | 13 | |
| Orgs com `deal_manual_only` | 0 | 0 | gate existe, ninguém usa |

O corolário do "42": destravar estas 3 orgs resolve **99,6%** do problema de órfãos. Não é uma
limpeza distribuída por 13 orgs — são três decisões.
