# 2026-08-06 — Excluir instância de WhatsApp estourava `statement timeout`

**Sintoma no cliente:** `whatsapp-api-proxy: DB delete failed: canceling statement due to statement timeout` ao excluir uma instância. Chamado da **Goletric Perdizes** (instância `c7e4ba84…`, 8 tentativas falhadas em 06/08 entre 14:52 e 16:43, todas em `runtime_logs`). Não é exclusivo dela — mesmo erro na org `5595bbe2…` em 04/08.

## Causa

`deleteInstance` nulificava `whatsapp_messages.instance_id` num UPDATE único e depois deletava a linha da instância. Os dois caminhos batem no mesmo custo:

```
UPDATE whatsapp_messages SET instance_id = $1 WHERE instance_id = $2
  → média 22,7s / pico 53,4s   (pg_stat_statements, PROD)
```

`whatsapp_messages` tem **4,4 GB e 18 índices**, 7 deles contendo `instance_id` — nenhum update é HOT, então cada linha reescreve os 18. O teto que vale para a chamada do proxy é o do PostgREST: `authenticator` está em **8s** (`anon` 3s, `authenticated` 15s; `service_role` não tem override próprio).

Dois defeitos somados:

1. **o erro do UPDATE não era checado** (`await` sem ler o retorno) — ele estourava, era revertido em silêncio, e as linhas continuavam apontando para a instância;
2. o `DELETE` então caía no cascade `ON DELETE SET NULL`, que executa **o mesmo UPDATE de 22s**, e estourava de novo.

Escala do caso concreto: 20.424 mensagens + 13.723 `whatsapp_media_jobs` + 1.299 `whatsapp_health_checks` pendurados na instância. Agravante secundário: **12 colunas com FK para `whatsapp_instances` não tinham índice** — cada DELETE fazia seq scan nelas.

## Conserto

- **`whatsapp_instance_delete_step(p_instance_id, p_reassign_to, p_batch)`** (migration `20270806000020`) — SECURITY DEFINER, faz **um lote por chamada** e devolve `{done, phase, touched, remaining}`. Fases: mensagens → media jobs → health checks → summary → linha. Idempotente: reentrar continua de onde parou. `GRANT` só para `service_role`.
- **O lote (1.000) é dimensionado para os 8s do `authenticator`, não para o `set_config('statement_timeout','55s')` da função.** O Postgres arma o timer quando o statement começa; mudar o GUC dentro da função não re-agenda o timer da chamada em curso. Medição que fixa o número (pg_stat_statements, variante por ctid): **3.000 linhas = 8,1s de média, 18,4s de pico** → 1.000 ≈ 2,7s. O `set_config` fica como bônus para chamada via psql/Management API.
- **`p_reassign_to`** (opcional) migra o histórico para outra instância da mesma org em vez de orfanar — ver [[excluir-instancia-apaga-historico-chat]]. Sem ele, o comportamento é o histórico: mensagens ficam com `instance_id` NULL e somem do chat.
- **`whatsapp_conversation_summary` é deixada de propósito** apontando para o UUID morto quando não há destino: é o rastro que permite restaurar recriando a instância com o **mesmo UUID**.
- Índice nas 12 colunas de FK órfãs de índice.
- `_shared/whatsapp-instance-delete.ts` — o laço, separado do edge function para ser testável (`tests/unit/whatsapp-instance-delete.test.ts`, 5 casos). Se não terminar dentro de 110s, o proxy devolve `pending` **com progresso** em vez de erro, e a UI pede pra clicar de novo. Uma instância de ~20k mensagens leva ~38 idas e voltas e cabe numa chamada só.

## Deploy

1. migration `20270806000020` (manual, `supabase db push`)
2. `supabase functions deploy whatsapp-api-proxy --project-ref jsjsmuncfkbsbzqzqhfq`

O merge em `main` sobe só o frontend — e este PR não muda frontend. Sem os dois passos acima, nada muda em produção.
