# ADR — MCP interno de ops/dev (Torque MCP) como Edge Function, RLS-herdado — 2026-06-22

## Status
Aceita (escopo: cenário A — interno). **Revisada 2026-06-22**: a forma mudou de servidor Deno stdio standalone → **Edge Function MCP sobre Streamable HTTP**. Decisão canônica + alternativas rejeitadas em `docs/adr/0011-torque-mcp-internal-ops-server.md`. Cenário B (customer-facing) adiado.

## Contexto
Operação/diagnóstico do CRM é reativa e artesanal. Padrão recorrente (memória + `scripts/recovery/*.sql`): lead sumiu → query manual cruzando `lead_history`+`audit_log`+pipes; disparo travado em `queued`; WhatsApp dead session; prompt de Copilot em 3 lugares; migrations colididas. Recovery = script ad-hoc sob pressão, não-auditado, não-repetível. 64% dos leads sem trilha de auditoria.

Cenário A (interno): CTO + 3 subagentes Claude diagnosticam/recuperam via tools curadas e auditadas. Cenário B (customer-facing) adiado — amplifica a ferida multi-tenant (vazamento anon ~60k; master-ghost recorrente; RLS some em rebuild).

## Decisão
Construir A como **Edge Function** `supabase/functions/torque-mcp/`, não servidor stdio standalone.

Princípio nuclear: **o MCP não cria superfície de segurança nova — herda o posture do master via RLS no Postgres.**

1. **Forma:** Edge Function expondo MCP sobre Streamable HTTP **stateless**. Reusa `_shared`, deploya pelo pipeline existente, alcançável remoto pelo Claude. (Rejeitado: stdio standalone — toolchain própria, vive fora do sistema, exige Docker local; Node monorepo — não reusa `_shared` Deno.)
2. **Auth:** gate `x-mcp-secret` (espelha `x-cron-secret`) + a fn faz `signInWithPassword` com creds de um master de ops (secrets) → JWT master no client de dados (**RLS ON**). Claude nunca toca JWT que expira. (Rejeitado: JWT pass-through — expira; service_role — bypassa RLS = anti-pattern do vazamento anon.)
3. **Protocolo:** hand-roll JSON-RPC (`initialize`/`tools/list`/`tools/call`) + zod p/ args, sem transport do SDK (express/node:http arrisca no edge runtime). Handler = função pura → unit-testável sem Docker.
4. **Anti-bypass:** tools nunca chamam RPC `SECURITY DEFINER` (ex.: `api_get_lead`) pelo master client — fazem `.from().select()` direto com RLS ON, senão o teste-âncora passa falso.
5. **Testes:** Deno unit local (lógica/dispatch/gate) + RLS-âncora e integração no **CI** (job `integration-tests` já sobe Supabase local + seed). (Rejeitado: Docker local; dev-remoto suja ambiente.)
6. **Escopo S1:** espinha + read pack (`lead.get`, `lead.trace_history`, `conversation.get`, `whatsapp.instance_status`, `blast.status`, `copilot.dump_prompt`). Build vertical: espinha+`lead.get` tracer (com teste-âncora) → cada tool em red-green. Mutating pack depois, atrás de `TORQUE_MCP_ALLOW_MUTATIONS`.

Default **dev** (`bcfadphgsibjzivtbjvc`). Prod só com pedido explícito. Spec viva: `.specs/features/torque-mcp/`.

## Alternativas consideradas
Detalhe completo em `docs/adr/0011`. Resumo: stdio standalone (rejeitado — fora do sistema); Node monorepo (rejeitado — não reusa `_shared`); JWT pass-through / service_role (rejeitados — expira / bypassa RLS); SDK transport (rejeitado — express/node:http no edge runtime); Docker local / dev-remoto p/ testes (rejeitados — blocker / suja ambiente).

## Consequências
- Blast radius do `x-mcp-secret` (rotação é a mitigação); creds master em secrets da fn; cache de sessão no isolate + refresh.
- Depende de master-ghost policies existirem (gap conhecido) — `rls.check_access` audita; tool retorna vazio honesto quando falta.
- Toda mutação (fase 2) → `audit_log` actor=`mcp` (fecha "hard-delete sem rastro").
- Trabalho stdio anterior (projeto standalone, 10 units verdes) teve a **lógica pura migrada** (guardrails/redact/registry) pra `supabase/functions/torque-mcp/lib/`; o resto (deno.json/server.ts) foi deletado.
