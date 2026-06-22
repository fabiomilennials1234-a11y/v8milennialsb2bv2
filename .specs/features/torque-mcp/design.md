# Design: Torque MCP

> **Fonte de verdade:** este design é um stub. A arquitetura vive em:
> - **ADR:** `docs/adr/0011-torque-mcp-internal-ops-server.md`
> - **Operacional + layout de código:** `supabase/functions/torque-mcp/README.md`
> - **Tarefas vivas:** `./tasks.md`
>
> O design stdio standalone anterior foi **abandonado** (2026-06-22). Atual = Edge Function MCP / Streamable HTTP / RLS-herdado.

## Camadas (resumo)

```
Claude (MCP remoto, URL + x-mcp-secret)
  → Edge Function torque-mcp (Deno.serve)
      L1 HTTP: CORS/OPTIONS + gate x-mcp-secret + JSON-RPC (single/batch)
      L2 Auth: signInAsMaster → client RLS-scoped (cache no isolate)
      L3 Dispatch: initialize / tools/list (gated) / tools/call
      L4 Tools: SELECT direto RLS-on (NUNCA RPC SECURITY DEFINER)
  → Postgres (RLS ON; master-ghost policies dão cross-org)
```

Decisões-chave (anti-bypass SECURITY DEFINER, negociação de protocolVersion, gating de mutating, master-ghost migration p/ 5 tabelas): ver ADR 0011 + comentários no código (`supabase/functions/torque-mcp/lib/`).
