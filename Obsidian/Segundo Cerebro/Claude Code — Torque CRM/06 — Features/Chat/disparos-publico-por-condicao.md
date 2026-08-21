---
type: feature
title: Disparos — Público por Condição (Todos os Funis / Todas as Etapas)
status: active
created: 2026-08-14
updated: 2026-08-14
tags: [disparos, blast-plans, whatsapp, publico, multi-tenant, feature]
related: [disparos-falha-entrega]
owner: gabriel
---

# Disparos — Público por Condição (Todos os Funis / Todas as Etapas)

## O que é

O passo 1 do Wizard Linear de disparo (`/disparos/novo` → "Pra quem", fonte
"Por etapa do funil") passa a ter **dois eixos independentes** de escopo:

| Eixo | Opções |
|---|---|
| **Funil** | um funil específico (3 pipes system + cada custom) · **Todos os funis** |
| **Etapa** | uma etapa específica · **Todas as etapas** |

Antes, a tela exigia 1 funil **e** 1 etapa, e as Condições (tag / qualificação /
pré-qualificação / origem) ficavam travadas até haver etapa escolhida. Não havia
como disparar para "todo mundo que tem a tag Ouro", atravessando funis — que é
exatamente o pedido que originou a fatia.

## Como funciona

### Resolução do público — uma única query

`useAudienceResolve` roteia a seleção para **um** resolver, nunca fan-out. A
contagem viva na tela e o `draft.leadIds` congelado saem da mesma resposta.

| Seleção | Resolver | RPC |
|---|---|---|
| system, 1 etapa, sem condição | `stage` | `get_stage_lead_ids` |
| system, 1 etapa, com condição | `filtered` | `get_filtered_lead_ids` |
| **system, todas as etapas** (com ou sem condição) | `filtered` | `get_filtered_lead_ids` (`p_stage_key = NULL`) |
| custom, 1 etapa ou todas | `custom` | `get_custom_filtered_lead_ids` (`p_stage_id = NULL` = funil inteiro) |
| **todos os funis** | `all-funnels` | `get_all_funnels_lead_ids` |

### "Todos os funis" = união de MEMBERSHIP, deduplicada

`get_all_funnels_lead_ids` (migration `20270814000000_all_funnels_audience_resolver.sql`)
faz `UNION` de:

- `pipeline_entries` × `pipelines` com `type = 'system'` **e**
  `slug IN ('whatsapp','confirmacao','propostas')`;
- `custom_pipe_entries` (todos os funis custom).

Depois junta em `leads` (`deleted_at IS NULL`) e aplica as 4 condições.

- **Não é "base inteira".** Lead que nunca entrou em funil nenhum **não** entra.
  Filtrar direto em `leads` foi oferecido ao CTO e **recusado**.
- **Dedup obrigatório.** Lead em múltiplos pipes é invariante do domínio; sem
  dedup a mesma pessoa receberia N mensagens do mesmo disparo. O `UNION` (não
  `UNION ALL`) resolve; o join seguinte é 1:1 contra a PK de `leads`. **Não
  existe `DISTINCT` externo — e não deve ser adicionado.**
- **O `slug IN (…)` é obrigatório.** `PipelineType` inclui `upsell_base` e
  `upsell_gestao`, que também são `type = 'system'`; sem o filtro de slug a
  união arrastaria funis de carteira que a tela nunca ofereceu. Os 3 slugs
  espelham `SYSTEM_FUNNELS` em
  `src/modules/campaigns/components/disparo-wizard/audience-resolve.ts`.

### Guard rail — avisa, não trava

"Todos os funis" + zero condição é **permitido** (decisão CTO). A UI mostra um
banner com o volume resolvido; o botão **Continuar segue habilitado**
(`validateStep("audience")` continua gateando só por `audienceCount > 0`).
Predicado puro: `isBroadestSelection()`.

## Regras de negócio

- **Invariante:** `funnelKind === "all"` ⇒ `stageScope === "all"`. Os dois
  modelos de funil não compartilham vocabulário de etapa (`stage_key` slug vs.
  `stage_id` uuid), então a união só fecha ignorando etapa. Imposta em
  `applySelection()` (único setter) e re-assertada em `resolverFor()`.
- **Condições destravadas.** O bloco Condições agora depende de a seleção ser
  *resolvível* (`selectionReady`), não de haver etapa escolhida.
- **Provenance aditiva.** `buildAudienceSource()` ganha `funnelScope`
  (`"one" | "all"`) e `stageScope` (`"one" | "all"`). Nenhuma chave existente
  mudou de nome nem sumiu — descritores antigos seguem parseáveis.
- **Sem sentinela em `stageKey`.** `stage_key` é slug controlado pela org: um
  sentinela ("all", "__todas__") poderia colidir com etapa real do cliente. O
  Select de Etapa usa namespace, igual ao de Funil: `"all"` vs `"stage:<key>"`.

## Edge cases

- **system + "todas as etapas" NUNCA usa `get_stage_lead_ids`.** Aquela RPC não
  aceita `p_stage_key` NULL (é `WHERE pe.stage_key = p_stage_key`, sem guarda —
  `archive/20261228000000:64`). Rotear para `stage` resolveria **zero leads em
  silêncio**. `resolverFor` manda para `filtered` mesmo sem condição alguma.
- **custom sem `pipelineId`** continua `"none"`, mesmo com "todas as etapas".
- **Contagem cross-funil < soma dos funis** sempre que há sobreposição — é o
  dedup funcionando, não bug.
- **Destino pós-envio** (`StepPostSend`) nunca oferece "Todos os funis": mover
  para "todos os funis" não tem significado. `sameAsOrigin` fica `false` quando
  a origem é a união, o que é o comportamento correto.

## Áreas frágeis

🔴 **Multi-tenant + envio real de WhatsApp.**

O predicado de tenancy aparece **duas vezes** na RPC — uma em cada ramo da
união (`pe` e `ce`), copiado verbatim de `archive/20261228000000`. **Esquecer um
dos ramos vaza lead de outra org num caminho que envia mensagem real.**

```
<TABELA>.organization_id IN (SELECT public.get_my_organization_ids())
OR (p_organization_id IS NOT NULL
    AND public.is_master_user()
    AND <TABELA>.organization_id = p_organization_id)
```

- `SECURITY INVOKER` + `SET search_path = ''` + `GRANT` só a `authenticated`.
  **Nada de `SECURITY DEFINER`.**
- Ramo master escopado a `p_organization_id` — master operando a org B recebe
  **só** B, nunca agregado cross-org.
- Não-master que forje `p_organization_id`: `is_master_user()` é false ⇒ ramo
  inerte ⇒ nenhum acesso novo.
- `JOIN public.leads … deleted_at IS NULL` é o backstop de RLS + soft-delete.

## Débito conhecido (fora do escopo desta fatia)

- **Teto de `.in("id", lead_ids)` em `blast-plan-create`.** Medido: **39,00
  bytes por uuid** na query string do PostgREST (base 158 bytes). ⇒ ~416 ids num
  limite de 16 KB, ~836 em 32 KB. `supabase/functions/blast-plan-create/index.ts:190`
  não chunka, não capa **e descarta o `error`** (`const { data: leadRows } = …`),
  então um público grande vira plano com **zero leads, em silêncio**. Falha
  fechada (não envia errado), mas some com o disparo. Pré-existente; esta feature
  torna muito mais fácil de atingir. Chunk = fatia própria.
- **Master + `blast-plan-create`**: `orgId` sai do `team_members` do próprio
  master (`index.ts:67-75`), então criar plano como master-ghost provavelmente
  já falha. Falha fechada, não vaza. Pré-existente.

## Arquivos

| Camada | Path |
|---|---|
| Migration | `supabase/migrations/20270814000000_all_funnels_audience_resolver.sql` |
| Hook RPC | `src/modules/pipelines/hooks/model/useAllFunnelsLeadIds.ts` |
| Core puro | `src/modules/campaigns/components/disparo-wizard/audience-resolve.ts` |
| Roteamento | `src/modules/campaigns/hooks/useAudienceResolve.ts` |
| Encoding dos Selects | `src/modules/campaigns/components/disparo-wizard/use-funnel-stage-options.ts` |
| UI | `src/modules/campaigns/components/disparo-wizard/AudienceByStage.tsx` |
| Testes | `tests/unit/disparo-audience-resolve.test.ts` |

## Histórico

- 2026-08-14 — Fatia inicial: eixos Funil/Etapa independentes, RPC
  `get_all_funnels_lead_ids`, índice `idx_custom_pipe_entries_org`, banner de
  amplitude.
