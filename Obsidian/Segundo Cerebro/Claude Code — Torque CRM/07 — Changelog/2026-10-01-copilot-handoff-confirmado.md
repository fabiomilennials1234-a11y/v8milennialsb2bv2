# 2026-10-01 — Confirmação e encaminhamento comercial real

## Problema reproduzido

No teste autorizado com WhatsApp real, o agente anunciou entrega ao vendedor
sem executar a transferência. O card também avançava por contagem de turnos,
antes da confirmação, e uma correção do cliente foi interpretada como aceite.

## Mudança

- Contexto do funil disponível para mover cards mesmo sem qualificação.
- Execução sequencial opt-in das ferramentas de cadastro, movimentação e
  transferência, com resultados reais e interrupção em caso de falha.
- Confirmação conservadora do resumo e movimentação explícita configuráveis.
- Recibo permite somente a confirmação final da transferência; o próximo
  inbound preserva `WAITING_HUMAN` e a pausa do atendimento.
- Falhas de escrita de cadastro deixam de retornar sucesso.

Contrato e flags documentados em `supabase/functions/agent-message/CLAUDE.md`.
Demais agentes preservam o fluxo existente quando as flags não estão ativas.

## Validação

96 testes em nove suites; regressões de movimentação e confirmação falharam
antes da correção. ESLint dos novos módulos/testes e `git diff --check` passaram.
Teste real isolado em contato técnico, com dados fictícios e exclusão de métricas:
resumo corrigido antes de confirmar, cadastro atualizado, etapa de vendedor,
`WAITING_HUMAN`, confirmação final entregue e silêncio após novo inbound.

Não houve migration nem branch Supabase temporária. QA real em produção foi
explicitamente autorizado na sessão, com backup do contexto e das funções.
Deploy seletivo preservou os demais arquivos live: agent-message v286,
whatsapp-webhook v123 e copilot-batch-processor v59. O webhook live ainda usa
entrypoint monolítico; o patch equivalente está no handler modular deste repo.

## Limites

Flags habilitadas somente no agente testado. Reconhecimento de confirmação
é conservador em português; mensagens ambíguas voltam à conferência.
Cobertura de mensagens reais não comprova todos os canais, anexos ou idiomas.
O teste não representa uma compra e não deve gerar faturamento ou despacho.
