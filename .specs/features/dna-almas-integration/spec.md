# DNA de Almas — Integração de funil por cenário de checkout

**Created:** 2026-06-19
**Scope:** Medium-Large
**Owner:** Backend + DBA (workflows nativos + stages) · CTO (ops: instância, envs) · Zuvic (eventos/tags)
**Org:** Dna de Almas `d67ae17a-815d-476d-b3a9-287c7b267997` (prod `jsjsmuncfkbsbzqzqhfq`)
**Source:** Doc Zuvic `webhooks-guia-dna-de-alamas.pdf` (v2026-06-19) + investigação prod (sessão 2026-06-19)

## Contexto

A plataforma DNA de Almas (Zuvic, gateway Veepag) já POSTa leads direto no nosso
`lead-webhook` (`source=dna_api_lead`) desde 2026-05-27 — 167 leads, 149 com phone.
**Mas manda o lead pelado, sem rotear por cenário**: tudo cai na 1ª coluna (ou na coluna
`novo` desativada → invisível). Pagos (checkout.success/upgrade) ficam em `novo_lead`, não
em `pago`. Recusado/abandono/PIX/boleto não chegam com sinal nenhum.

Produto vendido em **dois modelos coexistentes**: mapa avulso R$98,00 (pagamento único) +
planos recorrentes (ex. "Plano mensal"). A doc Zuvic expõe 8 eventos, modelo assinatura:
`checkout.success/free/error/upgrade`, `subscription.canceled`, `plan.downgrade_free`,
`invoice.paid`, `payment.overdue`. **NÃO existem** `lead.created`/`product.purchased` nem
os 3 de recuperação (`checkout.initiated`/`pix.generated`/`boleto.generated`).

Decisão arquitetural (CTO): **roteamento nativo no Torque**, lógica do nosso lado. Sinal de
gatilho = **tag** (custom field NÃO dispara workflow trigger; `tag_added` dispara — confirmado
`trg_workflow_tag_added` AFTER INSERT em `lead_tags`, prod). Zuvic só envia uma tag determinística
por evento + phone. n8n `DNA · Ingestão` (l0Ye4j8…) fica aposentado (redundante).

## Goals

- Lead cai na coluna certa do funil conforme o cenário de checkout — automático, sem intervenção.
- Disparos (WhatsApp) por cenário via workflows nativos do Torque (drips E/F/G já existentes + novos).
- Lógica de mapeamento 100% no Torque (tag→stage→drip); dependência da Zuvic reduzida a "enviar tag + phone".
- Cobrir o ciclo de assinatura (renovação, inadimplência, churn) além de pago/recusado.

## Non-goals

- Reativar/usar o n8n `DNA · Ingestão` (aposentado — Zuvic posta direto).
- Caminho A (Zuvic montar `place_in_pipe`) — descartado a favor de tag-driven nativo.
- E-mail/SMS dos cenários (só WhatsApp nesta entrega; e-mail = passada futura via `webhook_call`→SMTP).
- Cálculo numerológico dinâmico do F5 (despertador) — simplificar/deferir.

## Dependências externas (bloqueiam ondas)

- **DEP-1 (CTO):** provisionar `whatsapp_instance` na DNA (hoje 0). **Gate de TODO disparo** —
  sem número conectado `send_whatsapp` é no-op. Roteamento de stage funciona sem isso; envio não.
- **DEP-2 (Zuvic):** enviar **tag determinística por evento** no POST (já enviam `Cliente` no pago).
- **DEP-3 (Zuvic):** incluir `phone` nos eventos de checkout (hoje `checkout.error` só tem email).
- **DEP-4 (Zuvic):** emitir 3 eventos novos de recuperação (`checkout.initiated`/`pix.generated`/
  `boleto.generated`) com phone + tag. Destrava Onda 3.

## Requisitos rastreáveis

### Onda 1 — Pago nativo (ZERO dependência Zuvic além do que já chega)

**REQ-1.1** — Lead com tag `Cliente` (enviada hoje no checkout.success) deve ser movido para o
stage `pago` automaticamente.
- Aceitação: inserir tag `Cliente` num lead de teste em `novo_lead` → lead em `pago` em <30s; `lead_history` registra move.
- Impl: workflow nativo `DNA · Pago (tag→stage)`, trigger `tag_added` (tag_name=`Cliente`), nó `move_stage`(pago).

**REQ-1.2** — Entrada em `pago` dispara o drip F (onboarding) já montado.
- Aceitação: move pra `pago` → `stage_changed` → execução do workflow `DNA · F` criada (envio depende de DEP-1).
- Impl: reusa `DNA · F — Pós-compra` existente (trigger stage_changed to_stage=pago).

**REQ-1.3** — Mover para `pago` cancela qualquer drip de recuperação ativo do lead (E/B/C/D).
- Aceitação: lead em drip E que recebe tag `Cliente` → execuções E pausam/cancelam; só F segue.
- Impl: nó condição "ainda no stage X?" antes de cada `send_whatsapp` dos drips de recuperação (guard pré-envio).

### Onda 2 — Recusado + ciclo de assinatura (requer DEP-2 + DEP-3)

**REQ-2.1** — `checkout.error` (tag `checkout_recusado`) → stage `cartao_recusado` + drip E.
- Aceitação: tag `checkout_recusado` → lead em `cartao_recusado` → drip E executa.
- Nota: `checkout.error` só traz email → match por email reusa lead existente (com phone).

**REQ-2.2** — Stages novos `cancelado` e `inadimplente` no pipe whatsapp da DNA (ativos).
- Aceitação: stages existem em `pipeline_stages`, visíveis no Kanban.

**REQ-2.3** — `subscription.canceled` (tag `cancelado`) → stage `cancelado` + drip winback.
**REQ-2.4** — `plan.downgrade_free` (tag `downgrade`) → stage `cancelado`.
**REQ-2.5** — `payment.overdue` (tag `inadimplente`) → stage `inadimplente` + drip cobrança.
**REQ-2.6** — `invoice.paid` (tag `renovacao`) → mantém `pago` (sem regressão de stage); drip opcional.
**REQ-2.7** — `checkout.upgrade` (tag `checkout_upgrade`) → `pago` + drip reativação.
**REQ-2.8** — `checkout.free` (tag `checkout_free`) → `novo_lead` (sem drip).
- Aceitação cada um: tag correspondente → stage correto + execução do drip previsto (envio gated DEP-1).

### Onda 3 — Recuperação de checkout não concluído (requer DEP-4)

**REQ-3.1** — `checkout.initiated` (tag `checkout_abandonado`) → `checkout_abandonado` + drip B.
**REQ-3.2** — `pix.generated` (tag `pix_gerado`) → `pix_gerado` + drip C.
**REQ-3.3** — `boleto.generated` (tag `boleto_gerado`) → `boleto_gerado` + drip D.
- Stages + workflows B/C/D já montados em prod (is_active toggle). Só plugam quando os eventos existirem.

### Cross-cutting

**REQ-X.1** — Copy dos drips distingue avulso (R$98) vs plano por `planName` quando relevante (F).
**REQ-X.2** — Preço R$98,00 em toda copy nova; merge field `{{custom.valor}}` preferido a hardcode.
**REQ-X.3** — Idempotência: re-envio do mesmo evento/tag não re-dispara (lead_tags upsert ignoreDuplicates
já garante; tags distintas por cenário).

## Verificação

- Teste por cenário: inserir tag → assert stage + assert execução de workflow criada (sem depender de envio).
- Smoke pós-DEP-1: 1 lead descartável por cenário ponta-a-ponta (tag→stage→drip→WhatsApp), cleanup total.
- Regressão: lead pago não volta pra recuperação; `invoice.paid` não regride stage.
