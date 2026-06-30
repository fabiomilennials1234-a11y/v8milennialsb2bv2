---
type: adr
title: "Roteamento tag-driven canônico (partner webhooks)"
status: accepted
created: 2026-06-29
updated: 2026-06-29
tags: [adr, communication, leads, pipelines, partner-webhook, tag-driven, ghost-stage, dna-de-almas]
related: ["[[2026-06-29-dna-de-almas-integration]]", "[[2026-06-17-dna-almas-funil-b-setup]]", "[[2026-06-09-ghost-stage-ingest-guard]]"]
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-06-29 — Roteamento tag-driven canônico (partner webhooks)

**Data:** 2026-06-29
**Status:** accepted
**Escopo:** `supabase/functions/partner-webhook/index.ts`, `supabase/functions/lead-webhook/index.ts`, `_shared/pipeline-adapter.ts` (`resolveActiveStageKey`). Afeta ingestão de leads de parceiros externos (DNA de Almas / Zuvic) e, no guard, **toda org** com integração externa.

> Não há ADR-irmão em `docs/adr/` cobrindo esta decisão (os mais recentes são `0011`/`0012`/`0013`). Esta nota é o **registro canônico** da decisão. Histórico operacional: [[2026-06-29-dna-de-almas-integration]].

## Contexto

A **Zuvic** (plataforma de checkout que integra a org **Dna de Almas**, `d67ae17a-815d-476d-b3a9-287c7b267997`) mudou o contrato dos webhooks. Passou a POSTar no `partner-webhook` (que repassa internamente p/ o `lead-webhook`) dois sinais ao mesmo tempo:

1. **Tags geridas pela plataforma com prefixo `sys:`** — ex.: `sys:assinante`, `sys:cliente`.
2. **Um `place_in_pipe`** (`pipe`/`stage`) herdado do funil da própria Zuvic.

Esse contrato brigava com o nosso modelo em dois pontos, e o sintoma era grave e silencioso:

- **Stage inativa → lead invisível.** A Zuvic mandava `{pipe:whatsapp, stage:"novo"}`, mas a DNA **desativou** a etapa `novo` e usa `novo_lead` como 1ª etapa (Funil B — ver [[2026-06-17-dna-almas-funil-b-setup]]). A coluna do Kanban é keyed por `stage_key`; o lead caía em `novo` (inativa) e **sumia do funil**. ~50 leads/dia perdidos no escuro.
- **Funil errado.** A Zuvic roteia `checkout.success`/`upgrade` → `confirmacao`/`ganho`. Na DNA, `confirmacao` é o funil de **REUNIÃO** (não tem `ganho`/`upgrade`) → um assinante **pago** cairia numa coluna inexistente ou nos lembretes de reunião (D-5/D-3/D-1).

A causa-raiz do roteamento por nome cru: o `partner-webhook` repassava o `place_in_pipe` do caller sempre que havia `pipe`/`stage`, e nossos **workflows nativos `tag→stage`** gatilhavam pelo **nome cru** da tag — que o novo contrato Zuvic não emitia mais. Resultado combinado: **zero disparo** e 50 leads represados em `whatsapp/novo` (inativa), invisíveis. Não decidir agora deixaria a integração no escuro indefinidamente (perda contínua de leads pagos).

## Forças em jogo

**Restrições do CTO:**
- Não depender de a Zuvic mudar o lado dela (não controlamos o roadmap do parceiro).
- O fix deve ser **genérico** — não um band-aid só p/ a DNA.
- Tag `sys:*` é o **canônico** de posicionamento: a plataforma decide o funil, não o caller.

**Restrições técnicas:**
- Coluna do Kanban é keyed por `stage_key`; gravar um `stage` que não casa nenhuma etapa **ativa** = lead some.
- Já existe a guarda `resolveActiveStageKey()` (usada no seed de `getOrCreateLead`) — reusar, não reinventar.
- `partner-webhook` é fino: valida API key + monta `leadPayload` e delega ao `lead-webhook`. O gate tem que viver onde o `place_in_pipe` é montado.

**Restrições de segurança/multi-tenant:**
- `partner-webhook` roda com `SERVICE_ROLE_KEY` + `validateApiKey` (escopo por org via API key). O gate de tag não muda o posture de auth; só decide se repassa `place_in_pipe`.

## Opções consideradas

### Opção (a) — Pedir à Zuvic p/ parar de mandar `confirmacao`/`ganho` e usar nossos stage_keys
Vantagem: payload limpo na origem.
Desvantagem (vetada pelo CTO): depende do parceiro; lento; frágil; não protege as outras orgs.

### Opção (b) — Roteamento tag-driven canônico + ghost-stage guard ⭐ ESCOLHIDA
Vantagem: a posição no funil passa a ser **nossa** (workflow `tag→stage`); neutraliza o `place_in_pipe` ruidoso sem mudar a Zuvic; o guard é genérico e cobre qualquer integração externa.
Desvantagem: o `place_in_pipe` da Zuvic vira ruído no payload (ainda chega, só é ignorado quando há `sys:`).

### Opção (c) — Só o ghost-stage guard no `lead-webhook` (sem gate no `partner-webhook`)
Vantagem: resolve o "lead invisível".
Desvantagem: **não** resolve o funil errado — o assinante pago ainda seria remapeado p/ a 1ª etapa ativa do funil de **reunião** em vez de ser posicionado pela tag. Insuficiente sozinho.

## Decisão

**Adotada opção (b).** Roteamento **tag-driven** é o canônico para webhooks de parceiro, com defesa em profundidade em duas camadas:

### D1 — `partner-webhook`: ignora `pipe`/`stage` do caller quando há tag `sys:` (`c7339222`)
Calcula `hasPlatformTag` — normaliza as tags (`trim().toLowerCase()`) e checa prefixo `sys:`. Só repassa `place_in_pipe` quando **não** há tag de plataforma:

```ts
if ((body.pipe || body.stage) && !hasPlatformTag) {
  leadPayload.place_in_pipe = { pipe: body.pipe ?? "whatsapp", stage: body.stage ?? "novo" };
}
```

Com tag `sys:*`, dropa o `place_in_pipe` do caller e deixa o **workflow nativo `tag→stage`** posicionar o lead. Eventos **sem** `sys:` (ex.: `lead.created` com tag de origem WEB) seguem repassando como antes.

### D2 — `lead-webhook`: ghost-stage guard no `place_in_pipe` (#922, `7de07ff3`)
No `place_in_pipe`, quando o `stage` não casa `stage_key` nem nome de etapa **ativa**, em vez de gravar o literal cru (lead some do Kanban), cai em **`resolveActiveStageKey()`** e remapeia p/ a **1ª etapa ativa** do pipe. Só mantém o literal quando a org **não tem nenhuma etapa ativa** no pipe (nada p/ onde remapear). É a rede de segurança para os eventos **sem** `sys:` que ainda repassam pipe/stage. Mesma classe de [[2026-06-09-ghost-stage-ingest-guard]] e do guard de inserts em `pipe_*` views (#831, `33fe65bc`).

### D3 — Reconciliação operacional em prod (`a1e5c42e`, artefatos #924 `b7792c72`)
A decisão de código foi acompanhada de recovery aplicado em prod na mesma sessão (`scripts/recovery/dna_almas/`): `apply_19` (retag de 9 workflows `tag→stage` p/ `sys:*`, ativa Onda-3, desativa workflow `Upgrade` órfão, cria stage+workflow `pix_abandonado`, **backfill de 50 leads `novo`→`novo_lead`**, + `apply_19_rollback`); `apply_20` (drips Assinante + PIX abandonado); `apply_21` (conserta merge-fields que o contrato novo não envia). Smoke E2E ao vivo provado (`sys:cliente` → pago → drip running) + cleanup.

## Consequências

### Positivas
- **DNA de Almas**: leads voltam a aparecer no Kanban; assinantes pagos posicionados pela tag `sys:*` via workflow nativo, sem cair em lembretes de reunião. 50 leads represados resgatados.
- **Todas as orgs**: o ghost-stage guard (#922) é genérico — qualquer integração externa que mande um `stage` desativado/renomeado agora remapeia p/ a 1ª etapa ativa, em vez de o lead sumir.
- **Desacopla** o posicionamento de funil do parceiro: a plataforma decide via tag, não o caller. Elimina a dependência de mudança no lado Zuvic.

### Negativas
- O `place_in_pipe` da Zuvic continua chegando como **ruído** no payload quando há `sys:` (ignorado, mas presente).
- Depende dos **workflows `tag→stage`** estarem corretos (foi exatamente o que `apply_19` reconciliou) — a tag sozinha não posiciona se não houver workflow `sys:* → stage`.

### Pendências geradas
- **HIGH**: mergear + deployar o fix tag-driven do `partner-webhook` (`c7339222`) — **ainda só na branch** `fix/lead-webhook-ghost-stage-active-resolve`, fora de `origin/main` (sem PR# na data; `tests/unit/partner-webhook-tag-driven.test.ts` não está em `origin/main`). #922 (`7de07ff3`, ghost-stage guard) **já está em `origin/main`**, mas merge em main **não autodeploya edge fn** — deploy de `lead-webhook` em prod é manual.
- **MEDIUM**: confirmar com a Zuvic se ela ainda emite `confirmacao`/`ganho` p/ a DNA (o fix neutraliza, mas é ruído).
- **LOW**: instância WhatsApp da DNA em 0 (DEP-1) — go-live dos drips ainda gated.

## Alternativas rejeitadas

- **Pedir à Zuvic p/ corrigir o payload na origem** — depende do parceiro, lento, não protege outras orgs.
- **Só o ghost-stage guard, sem gate de tag** — resolve "lead invisível" mas não o "funil errado"; remaparia o assinante pago p/ a 1ª etapa do funil de reunião.

## Evidência

| Item | Referência |
|---|---|
| `partner-webhook` tag-driven (gate `sys:`) | `c7339222` — `supabase/functions/partner-webhook/index.ts` (+16/−1); branch `fix/lead-webhook-ghost-stage-active-resolve`, **não em `origin/main`** |
| `lead-webhook` ghost-stage guard | `7de07ff3` (#922) — `supabase/functions/lead-webhook/index.ts` (+19/−6); via `resolveActiveStageKey` de `_shared/pipeline-adapter.ts`; **em `origin/main`** |
| Testes | `tests/unit/partner-webhook-tag-driven.test.ts` (3 casos, branch); `tests/unit/lead-webhook-ghost-stage.test.ts` (em `origin/main`); 66 testes do lead-webhook seguem verdes |
| Recovery prod (reconciliação) | `a1e5c42e` — `scripts/recovery/dna_almas/apply_19..21` + `apply_19_rollback` + `smoke_pago_*` |
| Artefatos da integração | `b7792c72` (#924) — `.specs/features/dna-almas-integration/` + `scripts/recovery/dna_almas/` |
| Classe ghost-stage (precedente) | #831 `33fe65bc` (guard inserts em `pipe_*` views) · [[2026-06-09-ghost-stage-ingest-guard]] |
| Org DNA de Almas | `d67ae17a-815d-476d-b3a9-287c7b267997` |
