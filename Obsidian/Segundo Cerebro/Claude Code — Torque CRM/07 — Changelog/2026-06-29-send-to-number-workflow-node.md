---
type: changelog
title: 2026-06-29 — Workflow node send_to_number — enviar p/ número fixo + resumo da conversa
status: shipped
created: 2026-06-29
updated: 2026-06-29
tags: [workflows, whatsapp, anti-retry-storm]
related: []
owner: gabriel
---

# 2026-06-29 — Workflow node `send_to_number` — enviar p/ número fixo + resumo da conversa

PR **#923** (merge `54a76a3f`, em cima de `7de07ff3`/#922). Branch = `c593ac5c` (feature) + `34ce0270` (guarda anti-retry-storm M1+L1). Squash-merge em `main`.

## Mudanças

- **Nova action de workflow `send_to_number`**: envia uma mensagem de WhatsApp para um ou mais números **FIXOS** (não o número do lead), com template que usa as mesmas variáveis do `send_whatsapp` (`resolveVariables`) e um toggle que anexa o **resumo da conversa do lead** (IA) + o telefone do lead.
- **Caso de uso**: disparo de reativação a partir de um número compartilhado. Quando o lead responde, o workflow avisa o número de um vendedor com o resumo da conversa + o telefone do lead, para ele assumir.
- **Handler novo** `send-to-number.ts`: resolve o template contra o lead, reusa `summarizeConversation` (de `ai-operations.ts`, sem duplicar a chamada LLM), envia via `sendTextViaInstance` (1 msg por número, **sem associar ao lead**), normaliza/dedupe números (`normalizeBrazilianPhone`), agrega falhas parciais (parcial = sucesso, p/ não reenviar; só-config-inválida = não-retryable).
- **UI (ActionPanel)**: form com lista repetível de números (add/remove), `Textarea` com `VariableInserter` e checkbox "Resumir conversa do lead ao enviar". Entrada na categoria Comunicação, label "Enviar p/ número fixo".
- **Guarda anti-retry-storm (M1+L1)** — code review pegou que o caminho de falha total era retryable por padrão → instância FROM deslogada faria o executor martelar a Uazapi com 5xx por ~6.5min (a classe documentada de dead-session storm). Correções, todas escopadas ao handler + seu teste (**nenhum arquivo compartilhado tocado**):
  - **M1.1 — pre-flight de saúde da instância** (`isInstanceLive`): `session_dead_since != null` OU status fora de `{open, connected}` → retorna `{success:false, retryable:false}` ("instância WhatsApp deslogada/indisponível") **antes** de qualquer envio. Instância ausente também vira `retryable:false`.
  - **L1 — pre-flight por destinatário** via `recipientGate` (`/chat/check`), espelhando `send-whatsapp.ts`. Números provadamente fora do WhatsApp são pulados e reportados em `data.skipped`. Se TODOS forem inacessíveis → `retryable:false`, zero envios.
  - **M1.2 — classificação da falha total**: permanente (instância morta, ou todos fora do WhatsApp) → `retryable:false`. Só deixa `retryable` default (transitório) quando a instância está viva E os destinatários passaram no pre-flight, mas o envio falhou — blip genuíno. Não força `retryable:false` em toda falha total.

## Arquivos tocados

- `supabase/functions/_shared/action-handlers/send-to-number.ts` — **novo**. Handler da action (resolve template + summarize + send + pre-flights + classificação de retry).
- `supabase/functions/_shared/workflow-action-handler.ts` — case `send_to_number` no switch.
- `supabase/functions/_shared/workflow-schema/enums.ts` — registra `send_to_number` como action conhecida; porta também o trigger `scheduled_date` que faltava em `TRIGGER_TYPES` (parity test estava vermelho em `main`).
- `supabase/functions/_shared/workflow-schema/dsl-schema.ts` — validação tiered (exige `notifyPhones` não-vazio + `messageTemplate`).
- `src/types/workflow.ts` — `+ "send_to_number"` em `WorkflowActionType`; campos `notifyPhones?: string[]` / `includeConversationSummary?: boolean` em `ActionNodeData`; label + categoria Comunicação.
- `src/modules/workflows/components/sidebar-panels/ActionPanel.tsx` — form da action (lista de números, template, checkbox de resumo).
- `tests/unit/action-handlers/send-to-number.test.ts` — **novo**. Unit do handler.
- `supabase/functions/_shared/workflow-schema/dsl-schema.test.ts` — casos `send_to_number`.

## Decisões

- **Envio desassociado do lead**: `sendTextViaInstance` direto (não o caminho que grava `channel_messages`/timeline do lead) — a mensagem vai para um vendedor, não é parte da conversa do lead.
- **Reuso do summarizer**: `summarizeConversation` já existente, sem segunda chamada LLM. Summarizer lançando exceção ou resumo vazio **ainda enviam** (o telefone do lead é anexado de qualquer forma) — o aviso ao vendedor não pode depender da IA.
- **Guarda escopada ao handler**: M1+L1 não tocam módulos compartilhados (`isInstanceLive` é helper local), evitando regressão na classe de send geral. Espelha o gate de `send-whatsapp.ts` em vez de centralizar — decisão consciente de não mexer no caminho comum nesta entrega.
- **Semântica de retry**: parcial = sucesso (não reenvia os que já saíram). Permanente (instância morta / todos fora do WhatsApp) = `retryable:false`. Transitório (instância viva + destino válido + envio falhou) = retryable default.
- **`leadId = null`**: usa a instância org-default e nunca consulta o resolver strict-write.

## QA

- Testes do handler: **19** (12 iniciais + 7 na correção M1+L1). Cobrem: instância deslogada/status fechado → sem envio nem storm; destino fora do WhatsApp pulado em `data.skipped`; todos fora do WhatsApp → `retryable:false` sem envio; misto válido+inválido; `leadId=null` usa instância org-default; summarizer lançando exceção / resumo vazio ainda enviam.
- DSL: 4 casos `send_to_number` em `dsl-schema.test.ts`.
- Deno `workflow-schema` 28/28 verde; vitest `action-handlers` 285/285 verde (no commit da feature).

## Follow-ups

- **Deploy** (não automático): merge em `main` só builda imagem frontend. As edge functions que importam o handler (`workflow-action-handler.ts` no executor de workflows) e o frontend precisam de deploy manual para o node aparecer/funcionar em prod.
- **Centralização do pre-flight**: o gate de instância morta + `recipientGate` foi copiado de `send-whatsapp.ts` para o handler. Há dívida em centralizar a guarda de dead-session no helper de dispatch compartilhado (mesma decisão pendente da classe dead-session storm).
