# Plano de observação — 7 dias pós-rollout (Funil é Funil, SCRUM-638)

Janela: 2026-09-02 → 2026-09-09. Rodar 1×/dia via
`node scripts/prod-sql.mjs "<query>"` (worktree qualquer com o script).
Baseline medido em 2026-09-02 na varredura da 638 — os limiares abaixo
derivam dele.

Complemento fora do SQL: os 4xx do `lead-webhook` NÃO caem em
`runtime_logs` (o retorno 4xx acontece antes do `logRuntime`). Contá-los
exige os edge logs, cuja retenção observada é curta (~24-48h) — por isso a
checagem é DIÁRIA. Query pronta no §Q1b.

---

## Q1 — lead-webhook: intenção vs desfecho (funil pedido virou card?)

```sql
SELECT created_at::date AS dia,
  count(*) AS ingests,
  count(*) FILTER (WHERE payload_snapshot->'place_in_pipe' != 'null'::jsonb) AS com_intencao,
  count(*) FILTER (WHERE payload_snapshot->>'placed_in_pipe' = 'false') AS intencao_nao_virou_card,
  count(*) FILTER (WHERE payload_snapshot->'place_in_pipe' = 'null'::jsonb
                   AND payload_snapshot ? 'place_in_pipe') AS sem_intencao_fallback_padrao,
  count(*) FILTER (WHERE status='error') AS erros_500
FROM runtime_logs
WHERE module='lead' AND action='webhook_ingest' AND created_at >= now() - interval '2 days'
GROUP BY 1 ORDER BY 1;
```

**Alerta:** `intencao_nao_virou_card > 0` em qualquer dia (baseline: 0 em
37 ingests pós-deploy); `erros_500 > 2/dia`; queda de `ingests` de uma org
que enviava (ver Q1c) — robô silenciado é a falha que não gera erro.

### Q1b — 4xx do lead-webhook (edge logs, Management API)

Rodar com o helper (mesmo token do prod-sql; script ficou em
`scratchpad/edge-logs.mjs` da sessão da 638 — recriar se preciso, é um
GET em `/v1/projects/jsjsmuncfkbsbzqzqhfq/analytics/endpoints/logs.all`):

```sql
select r.status_code as sc, count(*) as n
from function_edge_logs
cross join unnest(metadata) as m
cross join unnest(m.response) as r
cross join unnest(m.request) as req
where req.url like '%lead-webhook%'
group by sc order by n desc
```

**Alerta:** qualquer `404` ou `409` (são os códigos novos
`pipeline_not_found`/`pipeline_inactive` — baseline pós-deploy: **0**);
`400 > 30/dia` (baseline ~14-28/48h, são validações pré-épico:
telefone/email ausente, UUID inválido).

### Q1c — orgs que pararam de mandar (robô morto sem erro)

```sql
WITH antes AS (
  SELECT organization_id, count(*) AS n
  FROM runtime_logs
  WHERE module='lead' AND action='webhook_ingest'
    AND created_at >= now() - interval '9 days' AND created_at < now() - interval '2 days'
  GROUP BY 1 HAVING count(*) >= 3
), depois AS (
  SELECT organization_id, count(*) AS n
  FROM runtime_logs
  WHERE module='lead' AND action='webhook_ingest' AND created_at >= now() - interval '2 days'
  GROUP BY 1
)
SELECT o.name, a.n AS semana_anterior, coalesce(d.n,0) AS ultimas_48h
FROM antes a LEFT JOIN depois d USING (organization_id)
JOIN organizations o ON o.id=a.organization_id
WHERE coalesce(d.n,0) = 0 ORDER BY a.n DESC;
```

**Alerta:** org com `semana_anterior >= 10` e `ultimas_48h = 0`.

---

## Q2 — workflows: assinatura de erro nova

```sql
WITH depois AS (
  SELECT left(coalesce(error,'(sem msg)'), 90) AS err, count(*) AS n
  FROM workflow_executions
  WHERE started_at >= now() - interval '1 day' AND status='failed' GROUP BY 1
), antes AS (
  SELECT DISTINCT left(coalesce(error,'(sem msg)'), 90) AS err
  FROM workflow_executions
  WHERE started_at >= '2026-08-18' AND started_at < now() - interval '1 day'
    AND status='failed'
)
SELECT d.err, d.n, (a.err IS NULL) AS assinatura_nova
FROM depois d LEFT JOIN antes a USING (err)
ORDER BY assinatura_nova DESC, n DESC LIMIT 15;
```

**Alerta:** `assinatura_nova = true` com `n >= 3` OU mensagem citando
funil/etapa/pipeline. Baseline: falhas 18-59/dia, todas de assinaturas
conhecidas (WhatsApp desconectado, mídia Uazapi, etapa inválida).
Referência de taxa: falhas/dia > 80 = investigar mesmo sem assinatura nova.

---

## Q3 — dispatch: fila e freio do funil custom

```sql
SELECT
  (SELECT count(*) FROM pipelines WHERE type='custom' AND stage_dispatch_enabled) AS toggle_custom_ligado,
  (SELECT count(*) FROM scheduled_pipe_messages
    WHERE status='pending' AND scheduled_at < now() - interval '15 minutes') AS fila_atrasada,
  (SELECT count(*) FROM scheduled_pipe_messages
    WHERE created_at >= now() - interval '1 day') AS agendadas_24h;
```

**Alerta:** `fila_atrasada > 5` (baseline: 0). `toggle_custom_ligado > 0`
NÃO é erro — é adoção da feature nova (D11): anotar QUAL org ligou e
observar os disparos dela no dia seguinte (freio triplo deve segurar).
Baseline: 0.

---

## Q4 — copilot: ações de funil em dead letter

```sql
SELECT created_at::date AS dia, action, count(*), max(left(error_message,120)) AS exemplo
FROM runtime_logs
WHERE module='copilot' AND status IN ('error','failed')
  AND (action LIKE '%update_pipeline_stage%' OR error_message ILIKE '%funil%'
       OR error_message ILIKE '%pipeline%' OR error_message ILIKE '%etapa%')
  AND created_at >= now() - interval '2 days'
GROUP BY 1,2 ORDER BY 1,3 DESC;
```

**Alerta:** `dead_letter:update_pipeline_stage > 2/dia` (baseline: 1
incidente isolado em 01/09, "Etapa inválida" — validação funcionando,
não regressão); qualquer erro novo citando funil custom por id.

---

## Q5 — dinheiro: sale_events e desfechos vs semana anterior

```sql
SELECT
  (SELECT count(*) FROM sale_events WHERE created_at >= now() - interval '1 day') AS vendas_24h,
  (SELECT round(count(*)/7.0,1) FROM sale_events
    WHERE created_at >= now() - interval '8 days' AND created_at < now() - interval '1 day') AS media_7d,
  (SELECT count(*) FROM deals WHERE created_at >= now() - interval '1 day') AS deals_24h,
  (SELECT round(count(*)/7.0,1) FROM deals
    WHERE created_at >= now() - interval '8 days' AND created_at < now() - interval '1 day') AS deals_media_7d,
  (SELECT count(*) FROM pipeline_entries WHERE created_at >= now() - interval '1 day') AS entries_24h,
  (SELECT round(count(*)/7.0,1) FROM pipeline_entries
    WHERE created_at >= now() - interval '8 days' AND created_at < now() - interval '1 day') AS entries_media_7d;
```

**Alerta:** `vendas_24h = 0` por 2 dias úteis seguidos (baseline
~6/dia); `deals_24h` ou `entries_24h` < 30% da média 7d em dia útil.
`commissions` segue em 0 desde antes do épico (produtor morto, memória
"outcome só backfill") — não é sinal deste rollout.

---

## Fora do plano diário (uma vez, meio da semana)

- **Analytics RPCs**: `get_funnel_conversion`/`get_analytics_pipeline_metrics`
  têm gate de auth (via Management API voltam vazio/access_denied — é o
  gate, não bug). Validar pela UI logada em 1 org com funil custom ativo
  (Chique Distribuidora: funis mercos têm eventos casáveis).
- **Caveat conhecido (pré-existente, não regressão)**: ~70% dos eventos
  `stage_changed` do `lead_history` nascem com `metadata` vazio → o
  `get_funnel_conversion` subconta "entradas" desses produtores. Candidato
  a issue de follow-up, fora da 638.
