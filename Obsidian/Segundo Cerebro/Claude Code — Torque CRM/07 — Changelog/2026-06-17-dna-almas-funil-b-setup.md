---
date: 2026-06-17
type: ops
branch: none (operação de dados em prod via Management API)
target: prod (jsjsmuncfkbsbzqzqhfq)
modules: [pipelines, workflows, leads]
---

# Ops — Dna de Almas migrada para o Funil B (prod)

## Pedido

CTO: arrumar o funil da org **Dna de Almas** (`d67ae17a-815d-476d-b3a9-287c7b267997`),
implementar o **Funil B** e mover todos os leads da etapa `novo` para `novo lead`.
Decisões na sessão: escopo = setup completo; executar em prod; trazer 5 leads órfãos
reais; deletar 3 de teste; ativar as automações.

## O que é "Funil B"

Não é conceito de código. São duas famílias de funil padrão + duas categorias de
template de automação (`FUNIL_A_TEMPLATES` / `FUNIL_B_TEMPLATES` em
`src/modules/workflows/lib/funnelTemplates.ts`, exibidas em Automações → Templates;
clonar = insert em `workflows`).

- **Funil B** = funil de qualificação: 1ª etapa `novo_lead` + `pre_qualificar` +
  `qualificando`/`qualificado`. Layout canônico (15 etapas ativas) replicado de **Natu
  Flores** (`249b55e0-…`), adotado idêntico por ~9 orgs.
- **Funil A** = `coletando_informacoes` / `criando_proposta`, sem `novo_lead`.

## Estado anterior (DNA)

Funil whatsapp = seed default puro (`novo, abordado, respondeu, esfriou, agendado`),
zero workflows, zero `pipe_dispatch_rules`, zero `whatsapp_instances`. 148 leads presos
em `novo` + 8 leads "órfãos" (`leads.pipe_whatsapp='novo'` SEM `pipeline_entry` →
invisíveis no Kanban).

## O que foi aplicado em prod (verificado)

1. **15 etapas Funil B** ativas (`novo_lead`→`perdido`), com nomes/cores/ordem de Natu
   Flores. Posições 0–14.
2. **5 etapas seed legacy** desativadas (`is_active=false`, posições 90–94) — mantidas,
   não hard-delete (evita string órfã; pipe canônico usa `stage_key` sem FK).
3. **148 leads** `novo`→`novo_lead` (`pipeline_entries`; denorm `leads.pipe_whatsapp`
   sincronizado por trigger).
4. **5 leads órfãos reais** trazidos pro funil (criada `pipeline_entry` em `novo_lead`).
5. **3 leads de teste** hard-deletados (Bruno Teste + 2× "Lead sem nome"; snapshot salvo).
6. **4 workflows Funil B** clonados e **ativados** (Disparo Automático, Disparo
   Pré-Qualificado, Nutrição Infinita com/sem vídeo).

Total final: **154** leads em `novo_lead`, 0 órfãos, 15 etapas ativas, 4 workflows ativos.

## Método / segurança

Aplicado via Supabase Management API (sem `db push`; org-scoped). Pré-checagem de
triggers de `pipeline_entries` confirmou que a migração de stage é segura: sem
`pipe_dispatch_rules` (sem blast de mensagem); `trg_workflow_pipeline_stage_changed`
no-op sem workflow ativo; `apply_stage_checklist` no-op (etapa destino sem template).
Snapshot completo + `rollback.sql` (148 ids + 5 órfãos + 15 etapas + 4 workflows) em
`scripts/recovery/dna_almas/` (NÃO commitado — contém token Management API).

## Pendências / risco

- 🔴 **Sem instância WhatsApp** — DNA tem zero `whatsapp_instances`. Automações ativas
  mas disparos são no-op até a org conectar um número.
- 🔴 **Ghost-stage ingest ainda vivo** — lead "Flávia Luiza Barros Machado"
  (`a544c1fa-…`) criado 22:36 caiu em `novo` (inativa) DEPOIS do deactivate → existe
  path de criação de lead (`origin='outro'`, `phone=null`) que NÃO usa
  `resolveActiveStageKey`. Roteado pro engenheiro (branch sugerida
  `fix/ghost-stage-unguarded-lead-create`). Mesma classe do changelog
  `2026-06-09-ghost-stage-ingest-guard.md`.
