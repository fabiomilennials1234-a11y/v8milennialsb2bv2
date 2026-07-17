#!/bin/bash
# =============================================================================
# Arquiteto Router Hook — UserPromptSubmit (entry-point do harness)
# Injeta o roteamento do pipeline arquiteto→[design|engenheiro]→arquiteto como
# contexto a cada prompt. NÃO decide — só garante que o pipeline fica top-of-mind.
# A classificação (conversacional / trivial / roteável) fica com o modelo,
# usando as regras "quando NÃO agir" da própria skill arquiteto.
# stdout deste hook = contexto adicional injetado no turno.
# =============================================================================

cat <<'EOF'
[Harness Torque — roteamento] Antes de agir, classifique o pedido:
- Conversacional ("explica X", "como funciona Y") → responda direto, SEM rotear.
- Trivialidade mecânica pura (typo, rename, ajuste de 1 linha) → engenheiro direto.
- Qualquer outra coisa (feature, bug, refactor, schema, edge fn, mudança visual) → invoque a skill `arquiteto`: sanity-check (vale fazer?) → arquitetura (se aplicável) → dispatch design/engenheiro → fecha ciclo com commit + push em branch nova.
Áreas frágeis tocadas (Copilot, WhatsApp/Uazapi, Permissões, RLS, multi-tenant, PII, payment) = rigor extra + seção Segurança obrigatória. Default deploy = dev; prod só com pedido explícito.
EOF
