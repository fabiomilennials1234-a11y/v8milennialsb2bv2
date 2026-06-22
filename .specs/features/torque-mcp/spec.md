# Feature: Torque MCP — servidor MCP interno de ops/dev

> **Fonte de verdade:** este spec é um stub. A decisão e o contrato vivem em:
> - **ADR:** `docs/adr/0011-torque-mcp-internal-ops-server.md` (forma, auth, protocolo, testes, escopo, alternativas rejeitadas)
> - **Operacional:** `supabase/functions/torque-mcp/README.md` (secrets, deploy, conexão Claude)
> - **Tarefas vivas:** `./tasks.md`
> - **Vault:** `04 — Decisões/ADR-2026-06-22-torque-mcp-interno.md`
>
> O design original (servidor Deno stdio standalone) foi **abandonado** em 2026-06-22 (grill-with-docs) em favor de uma **Edge Function MCP sobre Streamable HTTP, RLS-herdado**. Não confie em versões anteriores deste arquivo.

## Resumo

MCP interno (cenário A): CTO + 3 subagentes Claude diagnosticam/recuperam estado do CRM via tools curadas e auditadas, expostas por uma edge function `supabase/functions/torque-mcp/`. Auth por `x-mcp-secret` + sign-in como master de ops → **RLS-herdado** (nunca `service_role`). Cenário B (customer-facing) adiado.

Detalhe completo: ver ADR 0011.
