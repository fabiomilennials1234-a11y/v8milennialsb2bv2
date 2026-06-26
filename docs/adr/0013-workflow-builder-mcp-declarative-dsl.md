# Ferramenta MCP de montagem/edição de automações — DSL declarativa + schema Zod compartilhado

**Status:** accepted (2026-06-25)
**Relacionado:** `docs/adr/0011-torque-mcp-internal-ops-server.md` (o MCP onde a tool vive), `.specs/features/.../` (plano), `CONTEXT.md` (termo *Workflow* afiado nesta decisão), `src/types/workflow.ts` (contrato de domínio portado).

## Context

Workflows (automações) são um DAG-com-ciclos armazenado em `workflows.definition` (jsonb `{nodes,edges}`). Até aqui só se monta/edita pela UI (`@xyflow/react`), e **não existe validação compartilhada** — o frontend só checa "tem trigger + nome", o executor valida nó-a-nó em runtime. É fácil produzir um grafo que quebra na execução. O CTO quer montar/editar automações via IA pelo `torque-mcp`, "muito bem estruturado".

## Decisões

1. **A tool vive no `torque-mcp` (ops/interno), mutating.** Atrás de `TORQUE_MCP_ALLOW_MUTATIONS` + `runMutation` (dry-run→confirm→audit-first), master JWT. Escreve via `db.from("workflows").insert/update` sob a RLS `master_all_workflows` (FOR ALL WITH CHECK `is_master_user()`) — sem RPC, anti-bypass satisfeito, sem migration. **Rejeitado:** expor no `crm-mcp` (customer-facing) no v1 — seria a 1ª escrita de cliente, amplia o risco multi-tenant e quebra o invariante read-only; exige ADR própria.

2. **Input DECLARATIVO (DSL) compilado pela tool, não definição crua.** A IA descreve a intenção (trigger + passos ordenados + ramos then/else, replied/timeout, variantes de split, terminais goto/end); um **compilador determinístico** gera o `{nodes,edges}` (ids estáveis, auto-layout, edges com os `sourceHandle` canônicos — `yes`/`no`, `replied`/`timeout`, `variant_<id>`, `error`). A IA nunca escreve ids/handles/posições. **Rejeitado:** input de definição crua `{nodes,edges}` — dá mais poder mas é frágil (a IA erra wiring de edge/handle silenciosamente, exatamente a classe de bug que o executor sofre).

3. **Determinismo é requisito, não conforto.** `runMutation` faz hash de `stableStringify(plan)` e re-roda `plan()` no confirm; um compile não-determinístico (UUID/`Date.now`/`Math.random`) faria todo confirm falhar com "token mismatch". O compilador é função pura da spec (ids por contador em DFS pré-ordem com ordem de ramo fixa). Efeito colateral bom: edit cuja row mudou entre dry-run e confirm → token mismatch = concorrência otimista de graça.

4. **Edição = re-spec completo (v1), sem decompilador.** Editar = a IA submete a nova spec declarativa inteira; a tool recompila e faz diff vs a definição atual no dry-run. `workflow.get` devolve a definição crua + resumo (estado atual), a IA reescreve a spec. **Rejeitado (v1):** decompilador `{nodes,edges}→DSL` (round-trip real) — dobra a superfície do engine e é frágil contra grafos da UI com formas que a DSL não expressa; vira follow-up se o re-spec doer.

5. **Validador Zod COMPARTILHADO novo** em `supabase/functions/_shared/workflow-schema/` = fonte única de verdade. **Validação de grafo** (1 trigger; trigger sem edge de entrada; edges sem ponta solta; alcançabilidade; goto válido; ciclo permitido mas warn em "ciclo quente" sem delay/wait) é estrita e universal. **Validação de config de nó** é **em camadas (tiered)**: Zod estrito p/ as ações de funil de alta frequência (send_whatsapp, move_stage, add/remove_tag, assign_*, create_followup, update_lead_field, mark_as_lost, add_to_campaign, generate_ai_message + nó copilot) e permissiva (enum + passthrough, espelha o `[key:string]: unknown` do frontend) p/ a cauda longa de ~38 ações. **Rejeitado:** validar tudo estrito (trabalho grande, diverge do frontend permissivo) ou tudo permissivo (a IA erra config sem feedback). O contrato é portado de `src/types/workflow.ts` agora, com teste de paridade de enums; executor/frontend podem adotar o schema numa slice futura (mata o drift).

6. **Segurança de ativação:** workflow criado/editado nasce **`is_active=false`** salvo ativação explícita e confirmada; edit preserva o estado salvo flag explícita. Uma automação montada por IA nunca vai ao ar silenciosamente. `trigger_type`/`trigger_config` da row são derivados do nó trigger compilado (não de arg solto) p/ a chave de dispatch não divergir do grafo.

## Consequências

- A DSL vira um **contrato**: mudá-la depois é caro (decisão 2/4). Mitigado por começar declarativa-só + tiered, expansível incrementalmente.
- O `_shared/workflow-schema` é Deno puro e **plugável** no executor + frontend depois — caminho para eliminar o drift de validação que existe hoje. Até lá, `src/types/workflow.ts` segue fonte do frontend; teste de paridade de enums guarda contra divergência.
- Sem round-trip de edição no v1: editar workflows complexos exige re-spec completo (aceito; decompilador é follow-up).
- `zod` entra no import map de `supabase/functions/deno.json`.
- Tool exposta só no `torque-mcp`, escondida quando `allowMutations=false`; nunca `customerExposed`.
- *Workflow* no `CONTEXT.md` foi afiado de "DAG" para "grafo dirigido com ciclos limitados por loop_limit" — a definição antiga teria induzido um validador que rejeita os templates de loop válidos.
