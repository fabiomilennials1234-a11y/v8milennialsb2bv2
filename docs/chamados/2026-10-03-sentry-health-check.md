# Chamados — Health Check Sentry (2026-10-03)

> Rascunhos prontos para abrir em **Ajuda → Chamados**. Não consegui criar direto no sistema
> (a rotina não tem credencial do banco), então copie o texto abaixo.
> Organização Sentry: `torquecrm` · Projetos: `torque-edge`, `torque-web`, `torque-qa`.

## Resumo

| Prioridade | Serviço | Problema | Eventos | Usuários afetados |
|---|---|---|---|---|
| 🔴 Alta | torque-edge | Resumo automático de conversas não roda | 325 (desde 01/10 16:07 UTC) | 0 (processo em segundo plano) |
| 🟡 Média | torque-web | Mensagem de WhatsApp não é enviada | 4 (desde 02/10) | 3 |

- Incidentes de infraestrutura (outage): **nenhum encontrado**.
- Lentidão / performance: **sem dados** — o Sentry não retornou spans nas últimas 24h (tracing parece desligado ou sem tráfego).
- Itens resolvidos desde a última checagem: **nenhum**.

---

## Chamado 1 — 🔴 Resumos de conversas não estão sendo gerados

**Em palavras simples:** todo dia o sistema deveria ler as conversas de WhatsApp paradas há mais de 1 hora e
criar um resumo (usado pelo Oráculo). Para isso, uma rotina automática primeiro "pega uma fila de conversas".
Essa primeira etapa está falhando todas as vezes (~325 vezes em 2 dias), então **nenhum resumo novo é criado**.
Ninguém vê erro na tela, por isso passou despercebido (0 usuários afetados).

- **Link:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- **Onde no código:** `supabase/functions/summarize-conversations-batch/index.ts:41-42`
  (chama a função de banco `claim_conversation_summary_jobs`; qualquer erro vira só a frase
  "Falha ao reservar conversas para resumo", sem o motivo real).
- **Última ocorrência:** 03/10 22:17 UTC — ainda acontecendo.
- **Hipótese (não confirmada):** a função SQL em `supabase/migrations/20271019150000_oraculo_conversas_legiveis.sql:225`
  devolve colunas chamadas `id`, `lead_id`, `instance_id`, `organization_id` e usa os mesmos nomes dentro do
  `INSERT ... ON CONFLICT`. No PostgreSQL isso costuma dar *"column reference is ambiguous"*.
  Outra possibilidade: a migration não foi aplicada em produção.
- **Como investigar (dev jr):**
  1. Logo no `index.ts:42`, registre `error.message` (hoje ele é descartado).
  2. Rode `select * from claim_conversation_summary_jobs(1);` no SQL editor do Supabase e leia o erro.
  3. Se for ambiguidade, qualifique as colunas (`j.lead_id`, `EXCLUDED.lead_id`) ou renomeie os campos de retorno.
  4. Confirme que a migration foi aplicada em produção.
- **Como saber que acabou:** TORQUE-EDGE-1 para de receber eventos e `conversation_summaries` volta a ser preenchida.

## Chamado 2 — 🟡 "Falha no envio" no Chat WhatsApp

**Em palavras simples:** alguns usuários clicaram em enviar uma mensagem no chat de WhatsApp, o sistema tentou
algumas vezes, não conseguiu confirmar o envio e mostrou erro. Aconteceu 4 vezes com 3 usuários diferentes.
É pequeno por enquanto, mas é uma função central do produto.

- **Link:** https://torquecrm.sentry.io/issues/TORQUE-WEB-Z
- **Replays (para ver o que o usuário viu):**
  https://torquecrm.sentry.io/explore/replays/7c6c77e8d2eb43d481535a55194566c4/
- **Onde no código:** `src/modules/communication/hooks/chat/shared/send-recovery.ts:53`
  (esgotou as tentativas) ← `useWhatsAppSend.ts:257` (chamada à função `whatsapp-api-proxy`).
- **Página:** `/chat-whatsapp` · última ocorrência 03/10 13:46 UTC · referência de suporte `A9CB9138`.
- **Causa:** desconhecida (`error_code: unknown`, não reprocessável pelo usuário).
- **Como investigar (dev jr):**
  1. Abra os replays e veja se a mensagem chegou mesmo assim ao lead.
  2. Procure nos logs da função `whatsapp-api-proxy` o horário dos eventos (02/10 12:49 UTC e 03/10 13:46 UTC).
  3. Verifique se a instância do WhatsApp dos usuários estava desconectada.
  4. Se for instabilidade do provedor, apenas monitorar; se for bug, abrir correção.

---
_Gerado pela rotina automática de health check._
