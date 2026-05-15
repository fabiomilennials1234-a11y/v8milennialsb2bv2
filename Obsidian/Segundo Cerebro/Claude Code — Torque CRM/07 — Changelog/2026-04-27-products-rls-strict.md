---
type: changelog
title: "2026-04-27 — RLS strict products: drop master permissive policies"
status: shipped
created: 2026-04-27
updated: 2026-04-27
tags: [uncategorized]
related: []
owner: gabriel
---

# 2026-04-27 — RLS strict products: drop master permissive policies

## Bug reportado pelo CTO

Produtos cadastrados na org Milennials apareciam em outras orgs.
Citação: *"nenhuma org tirando a milennials tem que ter essa visualização"*.

## Auditoria

### Frontend (limpo)
Hooks centralizados filtram corretamente:
- `useProducts()`           — `.eq("organization_id", organizationId)`
- `useActiveProducts()`     — idem + `is_active=true`
- `useProductsWithVariants()` — idem
- `useUpsellClientProducts(clientId)` — filtra por client_id; embedded `products` herda RLS

### Banco (limpo)
```
Total produtos: 633
Org nula:       0

Top 5 orgs por count:
  258  c491550a (cliente)
  187  163874dd (Basic4u)
  163  73a7cec9 (VitrineVET)
   13  6030520a (Milennials)
    6  5595bbe2
```

Zero produto Milennials atribuído a outra org. Zero null. Banco íntegro.

### RLS (causa raiz)

```sql
-- migration 20260224000000 (correta — restritiva)
CREATE POLICY "products_select_own_org"
ON public.products FOR SELECT
USING (organization_id IN (
  SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
));

-- migration 20260131200001 (PERMISSIVA DEMAIS — causa do leak)
CREATE POLICY "master_select_all_products"
ON public.products FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_products"
ON public.products FOR ALL
USING (public.is_master_user());
```

**Como o leak acontecia**: master user logado em qualquer org via OrgSwitcher recebia TODOS os produtos via RLS bypass. Frontend filtra com `.eq` mas qualquer query *sem* WHERE explícito ou com algum bug visual que ignora `organizationId` retornaria todos os 633 produtos — incluindo Milennials — pra masters em outras orgs.

Importantíssimo: master users em PROD incluem usuários de **outras orgs**, não só Milennials. Lista de masters:
```
23b65a30
6575eb1d  ← Gabriel (Basic4u admin)
89fcd7ae
5cacda3f
fc7f90b8  ← Marcelo (Basic4u admin)
3a0fd478
6fd9328e
```

Ou seja, dois admins da Basic4u são masters. Quando logam, RLS retorna todos produtos (inclui Milennials).

## Fix aplicado

Migration `20260427180000_products_strict_org_isolation.sql`:

1. **DROP** `master_select_all_products`
2. **DROP** `master_all_products`
3. **DROP** `master_select_all_product_variants` (idempotente — não existia em PROD)
4. **DROP** `master_all_product_variants` (idempotente)
5. **DROP** `master_select_all_product_materials` (idempotente)
6. **DROP** `master_all_product_materials` (idempotente)
7. **DROP** legacy permissive (`Products visíveis para autenticados`, `Apenas admins podem gerenciar products` — idempotente)
8. **Garantir** policies org-scoped vigentes (idempotente)

Aplicado em PROD via `supabase db push --include-all`. NOTICES confirmaram drop bem-sucedido das master policies (skip em outras = já não existiam).

## Comportamento pós-fix

| Cenário | Antes | Depois |
|---|---|---|
| User normal Basic4u → SELECT products | só Basic4u (correto) | só Basic4u (correto) |
| User normal Basic4u → SELECT products de Milennials | só Basic4u (frontend filter já bloqueia) | bloqueio agora também via RLS |
| Master logado em Basic4u via OrgSwitcher → SELECT products | **TODOS 633** (leak) | só os da org atual selecionada (via team_member virtual) |
| Master sem team_member em org X → tentar SELECT products de X | TODOS via RLS bypass | retorna 0 (sem membership ativa) |

## Side effects

**Master que precisava ver products de outra org** agora deve usar o **OrgSwitcher** (já existente no UI, `src/hooks/useOrgSwitcher.ts`). OrgSwitcher cria `team_member` virtual via `buildVirtualTeamMember()` — o ID dele aparece na query `team_members WHERE user_id`, então RLS retorna products dessa org.

Master sem ENTRY no banco team_members daquela org **NÃO** consegue setar via OrgSwitcher → não vê products. Comportamento esperado (defesa em depth).

**Pages master/* que listam products cross-org**: nenhuma encontrada via grep. Não há regressão visual identificada.

## Validação

- `supabase db push --include-all` em PROD: Finished sem erro.
- `npm run test:unit` — 71 passed em 5 arquivos relevantes (smoke + agent-engine + ai-action-executor).
- `npm run build` — verde, 8.76s.
- Sanity check via anon key: retorna `[]` (esperado — sem auth = zero rows).
- Sanity check via service_role: retorna 633 (esperado — service_role bypassa RLS).

## Promoção pra `main`

Code commitado em `develop` (`b740f8e`). Migration aplicada em PROD direto via `db push`. Quando `develop` → `main` for promovido, código e schema ficam alinhados.

```
develop:  ee6d014..b740f8e
main:     0aa3f5f (intacto)
PROD DB:  migration 20260427180000 aplicada
DEV DB:   schema defasado (24 migrations pending — não aplicadas nesta sessão)
```

## Refs

- [[Permissoes]] — autoridade RLS multi-tenant
- [[ADR-2026-04-27-refactor-agent-engine-modular]] — refactor copilot completo (ainda na sessão)
- Caso reportado pelo CTO no Slack/sessão direta
