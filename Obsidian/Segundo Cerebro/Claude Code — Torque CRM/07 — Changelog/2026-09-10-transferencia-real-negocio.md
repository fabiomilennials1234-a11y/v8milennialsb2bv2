---
type: changelog
title: Transferência real após etapa de ganho
status: draft
created: 2026-09-10
tags: [pipelines, negocios, historico]
---

# Transferência real após etapa de ganho

Ao entrar numa etapa positiva com destino configurado, o kanban transferia pelo lead: criava outra entrada no destino ou movia uma venda diferente já existente ali. A transição agora usa o ID da entrada original e a RPC `mover_negocio`, passando pela etapa de ganho e pelo destino na mesma transação. Abrir um negócio novo continua sendo uma operação distinta.

O histórico em `pipeline_stage_events` passa a guardar os nomes dos funis e etapas, funil anterior e nome do autor no momento do evento. Trocas de funil com a mesma chave de etapa também geram evento. A linha do tempo do negócio mostra esse percurso e não usa etapas de outro funil para preencher a régua atual.

Uma transferência de ganho para etapa comum em outro funil preserva a venda. A reabertura deliberada dentro do mesmo funil continua funcionando. A RPC trava a entrada durante a transferência, valida o destino e torna a repetição idempotente.

## Validação

- Testes de transição do kanban, hook custom, helper e apresentação do histórico.
- `scripts/test-deal-transfer.ps1`: PostgreSQL 16 descartável, fixture mínima com as funções reais de movimento e captura de venda; prova a regressão antes da migration e o comportamento depois, incluindo isolamento por organização, rejeição de etapa inválida, nomes preservados após renomeação e negócio legado sem linha em deals. Não reproduz todos os gatilhos e integrações de produção.
- Nenhuma mensagem real disparada; nenhum dado de cliente alterado; nenhuma branch paga criada.

## Publicação

Aplicar `20271019000007_deal_transfer_history.sql` antes de disponibilizar o frontend: a proteção contra estorno durante a transferência depende da migration. O schema é aditivo e preserva os registros anteriores. Não há reconstrução retroativa de passagens que nunca foram registradas, nem exclusão automática de duplicatas antigas.
