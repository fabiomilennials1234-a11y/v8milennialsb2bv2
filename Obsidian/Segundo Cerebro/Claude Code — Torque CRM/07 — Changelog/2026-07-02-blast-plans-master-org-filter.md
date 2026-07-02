---
tipo: changelog
data: 2026-07-02
área: campaigns
tags: [changelog, disparos, blast-plans, master, multi-tenancy]
---

# Fix — painel Disparos mostrava blast plans de todas as orgs pra master

## Sintoma

Usuário master via a mesma lista de disparos concluídos em qualquer org selecionada, como se todas as orgs tivessem feito os mesmos disparos.

## Causa

`useBlastPlans` (`src/modules/campaigns/hooks/useBlastPlans.ts`) listava `blast_plans` **sem filtro client-side de `organization_id`**, confiando só na RLS. Para usuário comum a RLS de membro isola por org — sem vazamento entre tenants. Para master, a policy `master_select_all_blast_plans` (migration `20261222000000_torque_mcp_master_ghost_policies.sql`, criada pro read pack do Torque MCP / ADR-0011) libera SELECT cross-org → a query devolvia os plans de todas as orgs, mergeados.

`useMassSendJobs` (mesma tela, tabela `uazapi_sender_jobs`) já filtrava `.eq("organization_id", orgId)` e nunca foi afetado.

## Fix

`.eq("organization_id", orgId)` adicionado na query de `useBlastPlans` — defense-in-depth alinhado ao padrão do módulo (toda query filtra org explicitamente, RLS é o gate final).

## Classificação

Display bug master-only. **Não** é cross-tenant leak: nenhum usuário de cliente via dados de outra org.

## Lição

Policies master-ghost (`is_master_user()`) tornam obrigatório o filtro explícito de org em TODA query client-side de tabela coberta por elas. Auditar novas telas contra a lista de tabelas da migration `20261222000000`.
