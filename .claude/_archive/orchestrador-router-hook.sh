#!/bin/bash
# =============================================================================
# Orchestrador Router Hook — UserPromptSubmit (entry-point do harness)
# Injeta o roteamento do time (orchestrador → ramo → build → [revisor ‖ qa] →
# arquiteto) como contexto a cada prompt. NÃO decide — só garante que o
# pipeline fica top-of-mind. A classificação (conversacional / trivial /
# roteável) e a coordenação ficam com o orchestrador.
# stdout deste hook = contexto adicional injetado no turno.
# =============================================================================

cat <<'EOF'
[Harness Torque — roteamento] Antes de agir, classifique o pedido:
- Conversacional ("explica X", "como funciona Y") → responda direto, SEM rotear.
- Trivialidade mecânica pura (typo, rename, ajuste de 1 linha) → engenheiro direto.
- Qualquer outra coisa (bug, feature, refactor, schema, edge fn, mudança visual) → invoque a skill `orchestrador`: grill-with-docs → grill-me (se ambíguo) → classifica tipo → roteia pro ramo → coordena o pipeline com loops de reprovação (cap 2× → escala CTO).
Ramos: BUG→diagnosticador→engenheiro→[revisor ‖ qa]→arquiteto | FEATURE/REFACTOR→arquiteto(macro)→engenheiro(+design ‖)→[revisor ‖ qa]→arquiteto(versiona) | VISUAL→design→engenheiro→[revisor ‖ qa]→arquiteto.
Fan-out: `revisor` e `qa` vão na MESMA mensagem (duas chamadas do Agent tool no mesmo bloco), com o mesmo Context Packet. Pré-condição: lint+test:unit+build verdes no output do engenheiro. Serialize (revisor primeiro) só se: build vermelho, ou RLS/multi-tenant/permissões não revisado, ou payment/efeito externo irreversível, ou migration destrutiva.
Junção: APROVA+PASSA→arquiteto | qualquer REPROVA/FALHA→engenheiro UMA volta com os dois feedbacks fundidos. REPROVA de segurança bloqueia mesmo com QA PASSA.
Context Packet: todo brief carrega o CP VERBATIM (spec em `.claude/skills/_shared/context-packet.md`). Cada papel devolve CP-v(N+1); orchestrador propaga e funde. Sem CP, cada hop re-explora o repo do zero.
Áreas frágeis (Copilot, WhatsApp/Uazapi, Permissões, RLS, multi-tenant, PII, payment) = rubric de segurança OBRIGATÓRIO no revisor + bloqueante. Default deploy = dev; prod só com pedido explícito; arquiteto prepara PR, humano deploya.
EOF
