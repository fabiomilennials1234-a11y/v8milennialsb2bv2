---
type: changelog
title: Perf — etiquetas dentro da RPC da lista multi do chat
status: in-progress
created: 2026-10-19
updated: 2026-10-19
tags: [changelog, perf, whatsapp, chat, supabase, rls]
related: []
owner: claude-agent
---

# 2026-10-19 — Perf: etiquetas dentro de `get_whatsapp_conversation_list_multi`

Contexto: trilha de RAM/pool do PostgREST (Supabase Medium 4 GB). Cada refetch da
lista multi do /chat fazia a RPC + 2 idas de fan-out só para etiquetas
(`lead_tags` com `tags!inner` e `whatsapp_conversation_tags`).

## Mudanças
- **DB**: a RPC devolve `tags jsonb` no fim do retorno — `[{id,name,color}]`, nunca NULL. Corpo = 20271125 verbatim + um LATERAL pós-LIMIT. Ordem: etiquetas do lead (nome, id), depois as da conversa; repetida fica a do lead.
- **Visibilidade**: espelha a RLS das três tabelas (a função é DEFINER): lead da org pedida e não apagado; só a conversa da própria linha; `tags.organization_id = p_org`. O recorte strict_lead_owner_access vem das views `private.leads` / `private.lead_tags` de prod.
- **Forma de prod automática**: um bloco DO troca `public.<rel>` por `private.<rel>` onde a view existe (prod: as 8 relações que o corpo vivo já lê por `private.*`). Antes a troca era instrução manual no cabeçalho de 20271125.
- **ACL**: DROP+CREATE com `REVOKE ALL ... FROM PUBLIC, anon, service_role` + `GRANT EXECUTE ... TO authenticated` = ACL de prod.
- **Front (só a V5, caminho multi)**: linha com `tags` → `contato.tags` direto, e `enriquecerContatos(..., { etiquetasJaResolvidas: true })` pula o fan-out. Linha sem a coluna (banco velho, queda por caixa) → fan-out de sempre. `useWhatsAppContacts` (caixa isolada) e a clássica não mudam.

## Arquivos tocados
- `supabase/migrations/20271128000000_etiquetas_na_lista_multi.sql` (+ rollback)
- `src/modules/communication/hooks/chat/shared/enriquecerContatos.ts`, `src/modules/communication/hooks/chat/useConversasUnificadas.ts`
- `src/integrations/supabase/types.ts` (coluna `tags: Json`)
- Testes: `tests/integration/conversation-list-multi-tags.test.mjs` (PGlite, no CI), `src/modules/communication/hooks/chat/shared/enriquecerContatos.test.ts`, `src/modules/communication/hooks/chat/useConversasUnificadas.test.tsx`

## Decisões
- Strict espelhado pelas views `private.*` de prod, não por `to_regprocedure` + EXECUTE: em prod as views já aplicam o recorte pelo JWT dentro do DEFINER. Achado: o cabeçalho de 20271125 diz que o DEFINER "lê as mesmas linhas como owner" pelas views — errado, elas filtram por `auth.uid()`.
- Opt-in explícito (`etiquetasJaResolvidas`) em vez de "tem tag na linha?": `[]` é resposta válida.

## Follow-ups
- Nada aplicado em prod. Ordem de deploy indiferente.
- Depois do apply: `has_function_privilege('anon'|'service_role', ...)` = false; md5 do prosrc normalizado = md5 do corpo da migration.
