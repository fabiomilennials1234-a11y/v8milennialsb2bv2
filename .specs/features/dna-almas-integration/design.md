# DNA de Almas — Design da integração por cenário

**Created:** 2026-06-19
**Spec:** [`spec.md`](./spec.md)

## 1. Arquitetura

```
Plataforma Zuvic ──POST──► lead-webhook (source=dna_api_lead, JÁ existe, prod)
   body: { source, organization_id, update_existing_if_match:true,
           fields:{ name, phone, email, dna_lead_id, plan_name, valor_pago, ... },
           tags:[ "<tag-do-evento>" ] }
                              │
            lead-webhook insere/atualiza lead + insere lead_tags
                              │
            trg_workflow_tag_added (PG, AFTER INSERT lead_tags) ──► fire_workflow_trigger('tag_added')
                              │
            process-workflow-executions cria execução do workflow cujo
            trigger_config.tag_name casa
                              │
            Workflow nativo (1 por cenário):
              [trigger tag_added] → [move_stage <stage>] → [delay] → [send_whatsapp] ...
                              │
            move_stage emite stage_changed → drips por-stage existentes (E/F/G) cascateiam
```

**Princípios:**
- Zuvic não decide stage. Manda **1 tag determinística por evento** (+ phone). Só isso.
- Mapa tag→stage→drip vive em **workflows nativos do Torque** (nosso lado, editável na UI).
- Sem edge function nova, sem n8n. `lead-webhook` já faz tudo (cria lead, tag, dispara trigger).
- `move_stage` (ação nativa `workflow-action-handler.ts:320`, params `targetStage`+`pipeType`)
  reposiciona a `pipeline_entries` → atualiza Kanban + emite `stage_changed`.

**Por que tag e não o campo `event`:** `trg_workflow_field_changed` observa só colunas de `leads`
(`company,segment,urgency,faturamento,rating,email,phone,name`) — custom fields (onde mora `event`)
NÃO disparam trigger. `trg_workflow_tag_added` dispara em INSERT de `lead_tags`. ⇒ tag é o sinal.

## 2. Estado atual em prod (baseline)

- Pipe whatsapp DNA (`e7125643-…`). Stages ativos relevantes: `novo_lead`(0), `pix_gerado`(1),
  `cartao_recusado`(2), `pago`(3), `checkout_abandonado`(4), `boleto_gerado`(5), `frio`(20).
  `novo` INATIVA. **Faltam:** `cancelado`, `inadimplente`.
- Workflows DNA existentes (prod): `DNA · E/F/G/B/C/D` (trigger `stage_changed` por to_stage).
  Drips de mensagem montados (copy do PDF). `whatsapp_instance`=0 (envio bloqueado).
- Custom fields: dna_lead_id, dna_user_id, cpf, checkout_id, plan_id, plan_name, subscription_id,
  valor_pago, event, primeiro_nome, link_checkout, codigo_pix, link_pix, link_boleto, data_vencimento.
- Tag de pago já enviada: `Cliente` (7 leads = 7 com event checkout.success/upgrade).

## 3. Mapa evento → tag → stage → drip

| Evento Zuvic | Tag (Zuvic) | Stage destino | Drip | Onda |
|---|---|---|---|---|
| checkout.success | `Cliente` | `pago` | F (onboarding) | 1 |
| checkout.upgrade | `checkout_upgrade` | `pago` | F (reativação) | 2 |
| checkout.free | `checkout_free` | `novo_lead` | — | 2 |
| checkout.error | `checkout_recusado` | `cartao_recusado` | E | 2 |
| invoice.paid | `renovacao` | mantém `pago` | opcional | 2 |
| payment.overdue | `inadimplente` | `inadimplente` (novo) | cobrança | 2 |
| subscription.canceled | `cancelado` | `cancelado` (novo) | winback | 2 |
| plan.downgrade_free | `downgrade` | `cancelado` (novo) | — | 2 |
| checkout.initiated * | `checkout_abandonado` | `checkout_abandonado` | B | 3 |
| pix.generated * | `pix_gerado` | `pix_gerado` | C | 3 |
| boleto.generated * | `boleto_gerado` | `boleto_gerado` | D | 3 |

`*` = evento que a Zuvic ainda não emite (DEP-4 / anexo §7 do pedido).

## 4. Workflows nativos a montar

Cada workflow: `trigger_type='tag_added'`, `trigger_config={tag_name:'<tag>'}`, `definition` =
sequência de nós. Dois padrões:

**Padrão A — só mover (deixa o drip por-stage cascatear):**
```
[trigger tag_added] → [move_stage targetStage=<stage>, pipeType=whatsapp]
```
Usado quando já existe drip por `stage_changed` (E/F/B/C/D já existem).
Ex.: `DNA · Pago (tag→stage)` (REQ-1.1): tag `Cliente` → move_stage `pago`. O `DNA · F` existente
(stage_changed→pago) cuida do onboarding.

**Padrão B — mover + drip embutido:** quando o cenário não tem drip por-stage (cancelado/inadimplente):
```
[trigger tag_added] → [move_stage <stage>] → [delay] → [send_whatsapp] → [delay] → [send_whatsapp] ...
```

**Lista (Onda 2):**
- `DNA · Recusado (tag→stage)` — tag `checkout_recusado` → move `cartao_recusado` (drip E cascateia).
- `DNA · Upgrade` — tag `checkout_upgrade` → move `pago`.
- `DNA · Free` — tag `checkout_free` → move `novo_lead`.
- `DNA · Inadimplente` — tag `inadimplente` → move `inadimplente` + drip cobrança (copy nova).
- `DNA · Cancelado` — tag `cancelado` → move `cancelado` + drip winback (copy nova).
- `DNA · Downgrade` — tag `downgrade` → move `cancelado`.
- `DNA · Renovação` — tag `renovacao` → (no-op de stage; opcional thank-you). Guard: só se já em `pago`.

**Onda 3:** análogos B/C/D já existem como drip por-stage; basta um `DNA · <X> (tag→stage)` Padrão A
movendo pro stage que dispara o drip — ativar quando DEP-4 existir.

## 5. "Pago mata recuperação" (REQ-1.3)

`stage_changed` dedup só cancela MESMO workflow+lead (não cross-workflow). Logo mover pra `pago`
NÃO cancela sozinho um drip E/B/C/D em andamento. Solução: **guard de stage antes de cada `send_whatsapp`**
nos drips de recuperação — nó `condition` "lead ainda está no stage <recuperação>?"; se saiu (ex. virou
pago), encerra o ramo. Aplicar em E, B, C, D (e inadimplente/cancelado se fizer sentido o inverso).

## 6. Stages novos (REQ-2.2)

Migration (ou via UI de etapas) cria em `pipeline_stages` (org DNA, pipeline_type=whatsapp):
- `cancelado` — "🔴 Cancelado", após `pago`.
- `inadimplente` — "⚠️ Inadimplente", após `pago`.
Ativos. Sem checklist_template_id (evita apply_stage_checklist no-op desnecessário).

## 7. Cross-cutting

- **avulso vs plano (REQ-X.1):** drip F ramifica por `{{custom.plan_name}}` (vazio/avulso → copy mapa
  único; plano → copy assinatura). Implementar via nó `condition` no F ou 2 workflows distintos por tag.
- **phone (DEP-3):** checkout.* sem phone → match por email reusa phone do lead (lead-webhook só
  sobrescreve phone se result.source≠phone e phone truthy → phone vazio preserva o existente).
- **instância (DEP-1):** todo `send_whatsapp` no-op sem `whatsapp_instance`. Stage move funciona sem.
- **preço (REQ-X.2):** R$98,00; preferir `{{custom.valor}}` (n8n/Zuvic manda) a hardcode.

## 8. Pedido à Zuvic (externo)

Atualizar `Desktop/Clientes/DNA de almas/PEDIDO-ZUVIC-webhooks.md` para o modelo tag-driven:
1. Enviar **1 tag determinística por evento** (tabela §3) no array `tags` do POST. (Já mandam `Cliente`.)
2. Incluir **phone** em todos os eventos de checkout.
3. Emitir os **3 eventos novos** de recuperação (DEP-4) com phone + tag.
4. Confirmar evento(s) de compra do avulso R$98 vs planos (distinção por planName).
5. API de provisionamento de acesso pós-compra (painel/PDF/senha/despertador) — cenário F.

## 9. Rollout

1. **Onda 1** (agora): `DNA · Pago (tag→stage)` + guard pago-mata-recuperação no E existente.
   Provar roteamento (tag→pago) sem envio. Não precisa Zuvic nem instância.
2. **DEP-1**: CTO conecta `whatsapp_instance` → smoke ponta-a-ponta do pago (drip F envia).
3. **Onda 2**: stages cancelado/inadimplente + 7 workflows + drips cobrança/winback. Requer DEP-2/3.
4. **Onda 3**: ativar B/C/D quando DEP-4 (eventos novos) existir.

## 10. Riscos

- Zuvic não tagueia de forma determinística → roteamento não dispara. Mitiga: validar tag por cenário
  num lead de teste antes de confiar.
- Sem `whatsapp_instance`, drips acumulam execuções falhando no envio. Aceitável pré-go-live; monitorar.
- `tag_added` dispara em qualquer tag (inclui origem WEB/INSTAGRAM) — workflows filtram por tag_name,
  então tags de origem não acionam cenário. Sem efeito colateral.
