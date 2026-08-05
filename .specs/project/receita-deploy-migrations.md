# Receita do apply de migrations — deploy de 07/08/2026

Ensaiada de ponta a ponta em branch efêmera (`yyvzakfeddnulpgdkgbm`) em
2026-08-04, contra o mesmo conjunto de arquivos que vai para produção.
**Uma única falha em todo o conjunto**, e ela é previsível.

> Este documento existe para que sexta não tenha descoberta. Se algo divergir
> do que está escrito aqui, **pare** — divergência não prevista num apply de 22
> migrations não se resolve improvisando.

---

## 1. O número correto: são 22, não 41

A primeira versão do roadmap dizia **41 migrations pendentes**. Estava errado:
a contagem incluía `supabase/migrations/archive/`, que o `supabase db push`
ignora corretamente por estar em subdiretório.

| | |
|---|---|
| Arquivos na raiz de `supabase/migrations/` | **48** |
| Já aplicados em produção | 26 |
| **Pendentes reais** | **22** |
| Arquivadas (não entram, e não devem) | 20 |

As 22, em ordem de aplicação:

```
20260727140000  20270203000000  20270204000000  20270215000000
20270216000000  20270728000000  20270728000001  20270728000002
20270728000003  20270729000010  20270730000010  20270730000020
20270730000030  20270730000040  20270730000050  20270731000010
20270803000010  20270803000020  20270803000030  20270803000040
20270803000050  20270805000010
```

As 11 do meio (`20270730000010` … `20270803000050`) são a fatia 2.
`20270805000010` aposenta os funis de carteira.

---

## 2. A única falha, e o reparo

```
Applying migration 20270203000000_omie_foundation.sql...
ERROR: relation "omie_connections" already exists (SQLSTATE 42P07)
```

**Causa:** `omie_connections` já existe no schema — em prod, verificado por
consulta direta em 2026-08-04. A migration tenta criar de novo e aborta.

**Reparo:** marcar como aplicada. O objeto já está lá; não há o que executar.

```bash
supabase migration repair --status applied 20270203000000 --db-url "$DBURL"
```

Depois disso o push retoma e **completa sem mais nenhum erro** — provado na
branch: 22 de 22 aplicadas.

---

## 3. A sequência, literal

Com `$DBURL` = a connection string de produção.
**Cada comando só roda se o anterior terminou como descrito.**

```bash
# 3.1 — Estado inicial. Anote o número; ele tem que bater com o esperado.
supabase migration list --db-url "$DBURL"
#      esperado: 57 versões, a última 20270807000003

# 3.2 — Primeira tentativa. Vai falhar no omie, e é esperado.
supabase db push --db-url "$DBURL"
#      esperado: aplica até 20270204000000 e para com 42P07 em 20270203000000

# 3.3 — O reparo.
supabase migration repair --status applied 20270203000000 --db-url "$DBURL"

# 3.4 — Segunda tentativa. Completa.
supabase db push --db-url "$DBURL"
#      esperado: nenhum erro

# 3.5 — Verificação (ver seção 5)
```

⚠️ **A guarda `scripts/db-push-branch.sh` recusa o ref de produção, por
desenho.** O apply em prod é botão do humano e passa por fora dela, com
autorização explícita — não tente contornar o script.

---

## 4. O que a branch NÃO conseguiu ensaiar

A branch nasce do baseline do repo; **produção tem 31 migrations que não
existem no repo** (billing, VoIP, feature_catalog, aplicadas direto por outra
frente). Os dois estados não são idênticos.

Medido: das 22 pendentes, **apenas 2 tocam objetos dessa área**, e são as duas
de Omie — `20270203000000` (a falha conhecida) e `20270204000000`. As
migrations de billing, VoIP e feature_catalog **não cruzam** com nenhuma das
22.

Ou seja: o risco de divergência está concentrado exatamente onde a receita já
prevê reparo. Ainda assim, **alinhar com a outra frente antes de sexta**
continua valendo — se eles aplicarem mais alguma coisa até lá, este documento
precisa ser refeito.

---

## 5. Verificação pós-apply

Roda depois do 3.4. Todas as linhas devem bater.

```sql
SELECT
  (SELECT count(*) FROM supabase_migrations.schema_migrations)              AS ledger,        -- 79
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('abrir_negocio','mover_negocio')) AS fns,      -- 2
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='leads' AND column_name='claimed_by')                  AS claimed_by,    -- 1
  (SELECT count(*) FROM pg_indexes
    WHERE tablename IN ('pipeline_entries','custom_pipe_entries')
      AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%pipeline_id, lead_id%') AS travas,     -- 0
  (SELECT count(*) FROM pipeline_stages
    WHERE pipeline_type IN ('upsell_base','upsell_gestao') AND is_active)   AS carteira_ativa,-- 0
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='deals' AND column_name='pipeline_id')                 AS deals_pipeline;-- 0
```

**`travas = 0` é a linha que importa mais.** É o que torna a recompra
possível; se ela vier diferente de zero, a fatia 2 não valeu e o backfill não
deve rodar.

---

## 6. Estado provado na branch

Depois das 22, com o seed de QA:

- 280 tabelas
- `abrir_negocio` e `mover_negocio` presentes
- 0 travas de unicidade
- funis de carteira aposentados (0 etapas ativas)
- três pedidos de ERP do mesmo lead viraram três Negócios ganhos no mesmo
  funil — a recompra rodando

Branch encerrada após o ensaio.

---

## 7. O backfill M4 — ensaiado e cronometrado

Ensaio em branch efêmera com **4.221 cards**, o mesmo tamanho da maior org real
(Basic4u). Seed: `supabase/qa-seed/volume-m4-seed.sql`.

| medida | valor |
|---|---|
| M4 na maior org, dry-run | **1,9 s** |
| M4 na maior org, com commit | **1,7 s** |
| Orgs a backfillar | 67 |
| Cards totais | 38.898 |
| **Projeção do backfill inteiro** | **≈ 16 segundos** |

O M4 é set-based — um `INSERT..SELECT` mais um `UPDATE`, por org — e não um
laço. O custo não cresce como se temia: a leitura na maior org custa **76 ms**
(medido por `EXPLAIN ANALYZE` direto em produção, com índice
`idx_pipeline_entries_org` e hash joins em memória).

**O passo 6 da sexta não é o gargalo que o roadmap sugeria.** O tempo de
parede do backfill inteiro é da ordem de meio minuto, não de dezenas de
minutos. O que continua caro é a decisão de rodar, não a execução.

### Gatilhos: verificado, não suposto

O passo 2b do M4 é um `UPDATE` em `pipeline_entries`, que tem **11 gatilhos
ROW de UPDATE**. A pergunta que importava era se algum dispararia envio.
Resposta, lida do catálogo em produção:

- **Guardados por `stage_key IS DISTINCT FROM`** (o M4 só toca `deal_id`, então
  não disparam): histórico de etapa, `stage_changed_at`, evento de etapa e —
  o mais importante — **`trg_workflow_pipeline_stage_changed`**.
- **Guardados por dentro:** `apply_stage_checklist` (retorna cedo quando a
  etapa não muda), `set_pipeline_entry_stage_changed`, `update_updated_at`.
- **`trigger_pipeline_entries_dispatch`**: o agendamento de disparo está sob
  `IF TG_OP = 'INSERT'`. O `UPDATE` não enfileira nada.
- **`fn_capture_meeting_event`**: exige `TG_OP='INSERT'` ou mudança de etapa.

**Nenhum envio dispara, nenhum evento espúrio nasce.** As próprias guardas do
M4 confirmam ao fim da execução: *"sale/meeting/lead_products/stage_events/
lead_history/checklists/scheduled_msgs/workflow_execs/webhook_deliveries
inalterados"*.

Um risco teórico ficou de fora por dado, não por sorte:
`enforce_closed_at_on_final_stage` não tem guarda de etapa e carimbaria
`closed_at = NOW()` em card de etapa final sem data. Medido em prod: dos 801
cards em `vendido`/`perdido`, **801 já têm `closed_at`**. Exposição zero.

---

*Ensaiado em 2026-08-04. Se a data do deploy mudar, reconferir o ledger de
produção antes de usar esta receita — outra frente aplica migrations direto em
prod.*
