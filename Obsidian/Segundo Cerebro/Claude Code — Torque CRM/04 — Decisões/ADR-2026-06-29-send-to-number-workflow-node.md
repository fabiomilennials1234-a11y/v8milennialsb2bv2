---
type: adr
title: "Workflow node send_to_number — envio p/ número fixo + resumo da conversa"
status: accepted
created: 2026-06-29
updated: 2026-06-29
tags: [adr, workflows, communication, whatsapp, dead-session]
related: []
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-06-29 — Workflow node `send_to_number`

**Data:** 2026-06-29
**Status:** accepted
**Escopo:** `src/modules/workflows/` (editor de Automações DAG) + `supabase/functions/_shared/action-handlers/` (executor) + `_shared/workflow-schema/` (validação/DSL).

## Contexto

O editor de Automações (workflows DAG) só sabia enviar WhatsApp **para o número do
lead**: todos os action-types de envio (`send_whatsapp`, `send_whatsapp_audio`,
`send_whatsapp_image`, etc. — ver `docs/adr/0012-unified-whatsapp-message-node.md`)
resolvem o destinatário a partir do próprio lead e gravam a mensagem no thread de
chat dele (`whatsapp_messages` lead-scoped).

Caso de uso real (pedido do CTO): disparo de **reativação a partir de um número
compartilhado**; quando o lead responde, o workflow precisa avisar **o número de um
vendedor** (fixo, não o lead) com o **resumo da conversa do lead (IA) + o telefone do
lead**, para o vendedor assumir o atendimento manualmente. Nenhum node existente
fazia isso — o destino é um terceiro (operador/vendedor), não o lead.

Construir essa notificação como handler de WhatsApp toca a **classe frágil mais cara
do sistema**: o *dead-session retry storm*. Quando a instância FROM está deslogada, a
Uazapi devolve 5xx opaco e o executor **martela a API por ~6,5min** (3 retries com
backoff) — documentado em incidentes Bertin/Bennedita. Qualquer novo caminho de envio
que devolva `retryable` por padrão herda essa tempestade.

## Forças em jogo

**Restrições do CTO:**
- Reativação por número compartilhado + handoff humano com contexto (resumo + telefone do lead).
- Permitir **múltiplos** números de destino (lista repetível na UI).
- Reusar o template/variáveis do `send_whatsapp` (mesmo mental para quem monta automação).

**Restrições técnicas:**
- Não duplicar a chamada LLM de resumo — reusar `summarizeConversation` existente.
- Não associar a mensagem ao lead (não poluir o thread de chat do lead com aviso de operador).
- Não forçar a instância do responsável do lead (handoff sai de número compartilhado/default da org).
- Aditivo: novo `case` no `switch(actionType)` do `workflow-action-handler.ts`, sem rewrite.

**Restrições de segurança/resiliência:**
- **Anti-retry-storm**: falha permanente (instância morta, destino fora do WhatsApp) **não pode** ser `retryable` — senão repete a tempestade dead-session já catalogada.

## Opções consideradas

### Opção (a) — Reusar `send_whatsapp` com um campo "override de destino"
Vantagem: zero node novo.
Desvantagem: `send_whatsapp` é lead-scoped por contrato (grava `whatsapp_messages` do
lead, resolve instância do responsável); enfiar destino fixo nele quebra invariantes e
contamina o thread do lead. Vetada.

### Opção (b) — Novo action-type `send_to_number` dedicado ⭐ ESCOLHIDA
Vantagem: semântica limpa (destinos fixos, sem associação ao lead), template reusa o
mesmo resolver de variáveis, handler isolado (nenhum arquivo compartilhado de envio
tocado → blast radius mínimo). Validação tiered no schema/DSL.
Desvantagem: +1 entrada na categoria "Comunicação" do picker (contra a tendência de
unificar nodes do ADR 0012) — aceito por ser um envio genuinamente diferente (terceiro, não o lead).

### Opção (c) — Notificação fora do WhatsApp (e-mail/webhook ao vendedor)
Vantagem: não toca a superfície dead-session.
Desvantagem: vendedor vive no WhatsApp; e-mail/webhook não entrega o handoff onde ele
trabalha. Vetada pelo CTO.

## Decisão

**Adotada opção (b).** Novo `WorkflowActionType` `send_to_number` ("Enviar p/ número
fixo", categoria Comunicação). Sub-decisões:

### D1 — Modelo do node
`ActionNodeData` ganha `notifyPhones?: string[]` (lista de destinos fixos) e
`includeConversationSummary?: boolean` (toggle "Resumir conversa do lead ao enviar").
O template usa o **mesmo resolver de variáveis** do `send_whatsapp` (`{{nome}}`,
`{{telefone}}`, `{{empresa}}`, `{{custom.x}}`...), resolvido **contra o lead**.
UI: `ActionPanel.tsx` renderiza lista repetível (add/remove) + Textarea com
`VariableInserter` + checkbox.

### D2 — Execução desacoplada do lead
Handler `_shared/action-handlers/send-to-number.ts`. Envia via `sendTextViaInstance`
(adapter do provider) — **deliberadamente NÃO** o gateway lead-scoped — 1 mensagem por
número, **sem** gravar `whatsapp_messages` associado ao lead. Números são
normalizados (`normalizeBrazilianPhone`) e dedupados. Instância FROM = a selecionada
no node ou a **default da org**; `leadId` **não** é passado à resolução de instância
(para o strict-write não forçar a instância do responsável do lead).

### D3 — Resumo sem duplicar LLM
Com `includeConversationSummary=true`, reusa `summarizeConversation` (mesma lógica de
IA já existente, sem segunda chamada) e anexa **resumo + telefone do lead** à
mensagem. Se o summarizer lançar exceção ou vier vazio, **ainda envia** (telefone do
lead é anexado de qualquer forma) — o handoff nunca é bloqueado pelo resumo.

### D4 — Anti-retry-storm: `retryable:false` por classificação (M1 + L1 da review)
Guarda escopada **só** em `send-to-number.ts` (nenhum arquivo compartilhado tocado):
- **M1.1** — pré-flight de saúde da instância (`isInstanceLive`): `session_dead_since != null`
  OU `status` fora de `{open, connected}` → retorna `{success:false, retryable:false}`
  ("instância WhatsApp deslogada/indisponível") **antes** de qualquer envio. Instância
  ausente também → `retryable:false`.
- **L1** — pré-flight por destinatário via `recipientGate` (`/chat/check`), espelhando
  `send-whatsapp.ts`. Números provadamente fora do WhatsApp são pulados e reportados em
  `data.skipped`. Se **todos** forem inacessíveis → `retryable:false`, zero envios.
- **M1.2** — classificação da falha total: permanente (instância morta, ou todos fora do
  WhatsApp) → `retryable:false`; só deixa `retryable` default (transitório) quando a
  instância está **viva** E os destinatários passaram no pré-flight, mas o envio falhou
  (blip genuíno). **Não** força `retryable:false` em toda falha total.

### D5 — Sucesso parcial = sucesso
Falhas parciais agregadas: se ao menos um número recebeu, a ação é sucesso (para o
executor **não reenviar** a todos). Config inválida/vazia (`notifyPhones` sem nenhum
número válido) é erro **permanente** (`retryable:false`) — retry não conserta número ruim.

### D6 — Registro no schema/DSL
`send_to_number` entra em `workflow-schema/enums.ts` (action conhecida) e
`dsl-schema.ts` com **validação tiered** (exige `notifyPhones` não-vazio +
`messageTemplate`). No mesmo PR, portado o trigger `scheduled_date` que faltava em
`TRIGGER_TYPES` (parity test estava vermelho em main).

## Consequências

### Positivas
- Handoff humano com contexto (resumo IA + telefone) entregue **no WhatsApp do vendedor**.
- Blast radius mínimo: handler novo + schema aditivo; **nenhum** arquivo de envio compartilhado alterado.
- Fecha a porta do dead-session storm **por construção** neste caminho (classificação up-front), em vez de depender de um helper central.
- Cobertura: 19 testes do handler (instância deslogada/fechada sem envio nem storm; destino fora do WhatsApp em `data.skipped`; todos fora → `retryable:false`; misto válido+inválido; `leadId=null` usa instância org-default e nunca consulta o resolver strict-write; summarizer com exceção/resumo vazio ainda envia) + 4 casos DSL.

### Negativas
- +1 entrada no picker "Comunicação" — fricção cognitiva contra a unificação do ADR 0012 (aceito: envio a terceiro é semanticamente distinto).
- Mensagem enviada não fica no thread do lead (por design) → o aviso ao vendedor **não** aparece no histórico de chat do lead. Esperado, mas é um lugar a menos de auditoria visível na UI.
- A guarda anti-storm é **local** ao handler. A decisão de centralizar a checagem de sessão morta no dispatch helper (classe inteira) permanece em aberto (ver Pendências).

### Pendências geradas
- MEDIUM: centralizar o pré-flight `isInstanceLive` + `recipientGate` no dispatch helper compartilhado, para todos os caminhos de envio ungated (semi-auto / pipe-rule / campaign-rule / scheduled-user / carteira / blast) herdarem a mesma guarda.
- LOW: avaliar telemetria de `data.skipped` (destinos fora do WhatsApp) para alertar o operador de números mortos na config do node.

## Alternativas rejeitadas

- **Reusar `send_whatsapp` com override de destino** — quebra o contrato lead-scoped e polui o thread do lead.
- **Notificação por e-mail/webhook** — não entrega o handoff onde o vendedor trabalha (WhatsApp).
- **`retryable:false` em toda falha total** — descartado: mascararia blips transitórios genuínos (instância viva + destino válido + envio falhou), que devem reentrar na fila.

## Evidência

- **PR #923** — `feat(workflows): node send_to_number — enviar p/ número fixo + resumo da conversa do lead` — squash-merge `54a76a3f` em `origin/main`.
  - Commit `c593ac5c` — `feat(workflows): ação "Enviar p/ número fixo" (send_to_number)`.
  - Commit `34ce0270` — `fix(workflows): send_to_number — guarda anti-retry-storm (M1+L1) na ação`.
- **Arquivos** (do diff de `54a76a3f`):
  - `src/types/workflow.ts` — `+"send_to_number"` em `WorkflowActionType`; `notifyPhones?: string[]` + `includeConversationSummary?: boolean` em `ActionNodeData`; label `"Enviar p/ número fixo"`.
  - `supabase/functions/_shared/action-handlers/send-to-number.ts` — handler novo (221 linhas finais), com `isInstanceLive`, `recipientGate`, `resolveDestinations`, reuso de `summarizeConversation` e `sendTextViaInstance`.
  - `supabase/functions/_shared/workflow-action-handler.ts` — `case "send_to_number"` no switch.
  - `supabase/functions/_shared/workflow-schema/enums.ts` + `dsl-schema.ts` — registro + validação tiered (+ `scheduled_date` em `TRIGGER_TYPES`).
  - `src/modules/workflows/components/sidebar-panels/ActionPanel.tsx` — lista repetível de números + checkbox de resumo.
  - `tests/unit/action-handlers/send-to-number.test.ts` (19 testes) + `dsl-schema.test.ts` (4 casos `send_to_number`).
- **ADR relacionado:** `docs/adr/0012-unified-whatsapp-message-node.md` (node WhatsApp unificado — contexto da categoria "Comunicação" do picker).
- **Classe dead-session storm:** incidentes Bertin/Bennedita (`fix/whatsapp-send-skip-dead-session`, pré-flight `/chat/check`) — mesma mitigação aplicada aqui localmente.

> **Deploy:** PR mergeado em `origin/main`; deploy das edge functions (executor) é **manual** (não há autodeploy de edge fn em merge — ver reference de deploy). Confirmar deploy do executor antes de habilitar o node em automações de prod.
