---
date: 2026-06-29
type: changelog
title: "Fix/Ops — DNA de Almas: contrato Zuvic vira tag-driven (sys:*) + ghost-stage guard"
status: shipped
created: 2026-06-29
updated: 2026-06-29
branch: fix/lead-webhook-ghost-stage-active-resolve
target: main + prod (jsjsmuncfkbsbzqzqhfq)
modules: [communication, leads, pipelines, workflows]
related: ["[[2026-06-17-dna-almas-funil-b-setup]]", "[[2026-06-09-ghost-stage-ingest-guard]]"]
owner: CTO (Gabriel)
tags: [changelog, dna-de-almas, zuvic, partner-webhook, lead-webhook, ghost-stage, tag-driven, recovery]
---

# Fix/Ops — DNA de Almas: contrato Zuvic vira tag-driven (sys:*) + ghost-stage guard

## Contexto

A **Zuvic** (plataforma que integra a org **Dna de Almas**, `d67ae17a-815d-476d-b3a9-287c7b267997`)
mudou o contrato dos webhooks: passou a mandar **tags geridas pela plataforma com prefixo
`sys:`** (ex.: `sys:assinante`, `sys:cliente`) + um `place_in_pipe` herdado do funil dela.

Esse contrato novo brigava com o nosso modelo em dois pontos:

1. **`place_in_pipe` apontava p/ stage inativa.** A Zuvic mandava `{pipe:whatsapp, stage:"novo"}`,
   mas a DNA desativou a etapa `novo` e usa `novo_lead` como 1ª etapa (Funil B — ver
   [[2026-06-17-dna-almas-funil-b-setup]]). Coluna do Kanban é keyed por `stage_key` → o lead
   caía em `novo` (inativa) = **invisível**. ~50 leads/dia perdidos no escuro.
2. **Roteamento do funil errado.** A Zuvic roteia `checkout.success`/`upgrade` →
   `confirmacao`/`ganho`. Na DNA, `confirmacao` é o funil de **REUNIÃO** (não tem `ganho`/`upgrade`)
   → um assinante pago cairia numa coluna inexistente ou nos lembretes de reunião (D-5/D-3/D-1).

Decisão CTO: **roteamento tag-driven canônico** — quando há tag `sys:*`, quem posiciona o lead
no funil são os **workflows nativos tag→stage** do Torque, não o `pipe`/`stage` do caller. Isso
elimina a dependência de a Zuvic mudar o lado dela.

## O que mudou

### 1. `lead-webhook` — ghost-stage guard no `place_in_pipe` (#922, `7de07ff3`)

O bloco `place_in_pipe` resolvia o stage só contra etapas **ativas** (por `stage_key` ou nome).
No no-match gravava o **literal cru** → lead some do Kanban. Agora, no no-match, cai em
**`resolveActiveStageKey()`** (a mesma guarda já usada no seed de `getOrCreateLead`) e remapeia
p/ a **1ª etapa ativa** do pipe. Só mantém o literal quando a org **não tem nenhuma etapa ativa**
no pipe (nada p/ onde remapear). Genérico: protege qualquer org cuja integração externa mande um
slug de stage desativado/renomeado. Mesma classe de [[2026-06-09-ghost-stage-ingest-guard]].

### 2. `partner-webhook` — roteamento tag-driven quando há tag `sys:` (`c7339222`)

Antes: `if (body.pipe || body.stage)` repassava `place_in_pipe` sempre. Agora calcula
`hasPlatformTag` (qualquer tag que, normalizada `trim().toLowerCase()`, começa com `sys:`) e só
repassa o pipe/stage do caller **quando NÃO há tag `sys:`** (`(body.pipe || body.stage) &&
!hasPlatformTag`). Com tag `sys:`, dropa o pipe/stage do caller e deixa o workflow nativo
posicionar. Eventos sem `sys:` (ex.: `lead.created` com tag de origem WEB) seguem repassando como
antes — e aí o ghost-stage guard do `lead-webhook` cobre stage inativa.

> **Estado:** este fix vive na branch `fix/lead-webhook-ghost-stage-active-resolve` e **ainda não
> foi mergeado em `main`** (sem PR# associado na data desta entry; `tests/unit/partner-webhook-tag-driven.test.ts`
> não está em `origin/main`). Pendente de PR/merge + deploy da edge function.

### 3. Recovery em prod — reconciliação do contrato + drips (#924, `b7792c72`)

Scripts aplicados em prod **nesta sessão** (`a1e5c42e`), trazidos p/ `main` fora do build graph
(nenhum código de app/migration/edge fn) em `scripts/recovery/dna_almas/`:

- **`apply_19`** (bleed-stop): retag de 9 workflows tag→stage p/ `sys:*`, ativa Onda-3
  (Abandonado/PIX), desativa workflow `Upgrade` órfão, cria stage+workflow `pix_abandonado`,
  **backfill de 50 leads `novo` → `novo_lead`** (+ `apply_19_rollback`).
- **`apply_20`**: os 2 drips que faltavam — **Assinante** (boas-vindas) + **PIX abandonado**
  (recuperação), guardados por `stage_changed`, voz "Marina".
- **`apply_21`**: conserta merge-fields dos drips antigos que o contrato novo da Zuvic não envia
  (`primeiro_nome` → `{{nome}}`; `link_checkout` → `checkout_url`/oferta).
- **`smoke_pago_*`**: E2E ao vivo provado em prod (`sys:cliente` → pago → drip running) + cleanup total.

## Arquivos tocados

- `supabase/functions/lead-webhook/index.ts` — import + ghost-stage guard via `resolveActiveStageKey()` no no-match (#922).
- `tests/unit/lead-webhook-ghost-stage.test.ts` — **novo**. Remap quando inativo; no-op quando ativo. 66 testes existentes do lead-webhook seguem verdes.
- `supabase/functions/partner-webhook/index.ts` — gate `hasPlatformTag` (`sys:` prefix) no repasse de `place_in_pipe` (`c7339222`, branch, não-mergeado).
- `tests/unit/partner-webhook-tag-driven.test.ts` — **novo** (na branch). 3 casos: dropa c/ `sys:`, repassa s/ `sys:`, repassa s/ tag.
- `.specs/features/dna-almas-integration/` — spec/design/tasks/go-live-hardening (#924).
- `scripts/recovery/dna_almas/apply_11..21` + `apply_19_rollback` + `qenv.py` + `smoke_pago_*` (#924).

## Impacto

- **DNA de Almas**: leads voltam a aparecer no Kanban (em vez de represados na coluna `novo`
  inativa); assinantes pagos posicionados pela tag `sys:*` via workflow nativo, sem cair em
  lembretes de reunião. 50 leads presos resgatados via backfill.
- **Todas as orgs**: o ghost-stage guard do `lead-webhook` (#922) é genérico — qualquer
  integração externa que mande um `stage` desativado/renomeado agora remapeia p/ a 1ª etapa ativa.

## Follow-ups

- **Mergear + deployar** o fix tag-driven do `partner-webhook` (`c7339222`) — abrir PR e deploy
  da edge function em prod (hoje só na branch).
- Deploy da edge function `lead-webhook` em prod (merge em `main` não autodeploya edge fns).
- Confirmar com a Zuvic se ela ainda emite `confirmacao`/`ganho` p/ a DNA (o fix neutraliza, mas
  é ruído no payload).
