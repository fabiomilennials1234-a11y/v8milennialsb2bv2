# Movimentação em lote e reparo Loofting — 2026-09-16

## Diagnóstico

O botão Mover do kanban enviava IDs de leads para `bulk_add_to_pipeline`.
Esse RPC procura negócios abertos somente no destino e insere quando não
encontra, mantendo a origem. Em 16:29:04 UTC, isso produziu nove cópias vazias
na Loofting: originais com `deal_id` em Oportunidades, cópias sem `deal_id` no
funil de slug `representantes`.

Foi encontrada também a constraint antiga `pipeline_stage_events_real_transition`,
que rejeitava uma transferência entre funis com a mesma chave de etapa (`novo`).
O trigger já registrava origem/destino, mas a constraint impedia a gravação.

## Correção

- Kanban envia os IDs das entradas selecionadas e o funil de origem.
- `bulk_move_pipeline_entries` chama `mover_negocio` em uma transação, conserva
  IDs/vínculos, bloqueia itens fora da origem esperada e aceita retry idempotente.
- RPC é invoker/RLS, com EXECUTE negado a anon. Acesso entre organizações testado.
- Constraint aceita mudança real de etapa **ou de funil**.
- Lista de leads mantém a adição explícita, agora rotulada “Adicionar ao funil”.

## Reparo autorizado e executado em produção

Autorização: pedido da sessão para corrigir a movimentação e limpar Oportunidades
da Loofting, deixando os negócios somente em Representantes.

O destino foi renomeado pelo usuário durante o trabalho para **Marcando Entrevista**;
o ID e o slug `representantes` permaneceram os mesmos. O reparo seguiu esse ID.

Script: `scripts/ops/repair-loofting-bulk-pipeline-move.sql`.
Executado em `jsjsmuncfkbsbzqzqhfq`, em 2026-09-16 às 16:46:01 UTC.

- Backup: `backup.pipeline_move_repair_snapshots`, chave `loofting-20260916-bulk-move`.
  Contém 18 entradas anteriores, nove negócios, leads e eventos de histórico.
  RLS ativa, sem políticas ou grants para clientes; leitura authenticated negada.
- Nove originais preservados; nove cópias vazias removidas.
- Todos os FKs para cópias inspecionados: nenhum item, comissão, tarefa, reunião,
  comentário, follow-up ou execução de workflow dependente.
- Histórico é append-only: **nenhum evento apagado**, inclusive os de criação das cópias.
- Nove eventos reais Oportunidades → Marcando Entrevista registrados nos originais.
- Verificação final: Oportunidades 0, Marcando Entrevista 9, Orçamentos 0.
- Sem disparo automático ou checklist configurado na etapa de destino.

## Validação e deploy

- Reprodução vermelha/verde do RPC incorreto no hook e da constraint no SQL.
- 13 testes Vitest: diálogo real, hook, seleção vazia e transferência por ganho.
- PGlite: identidade, histórico, outra venda do mesmo lead preservada, retry,
  rollback integral por item inválido, isolamento entre organizações e grants.
- Rollback de schema executado no teste, preservando eventos existentes.
- Build e ratchets de lint/tipos passaram sem erros novos.
- Não foi criada branch paga. Desvio de QA: PGlite local + ensaio transacional
  no banco real com ROLLBACK e confirmação de que o baseline continuava 9/9;
  somente depois foi executado COMMIT. O primeiro ensaio detectou a proteção
  append-only; o script foi ajustado para preservar esses eventos.
- Migrations `20260916163244` e `20260916164400` aplicadas, grants conferidos.
  Versões geradas pelo MCP (`20260916164455`/`20260916164505`) reconciliadas
  de forma condicionada com os nomes dos arquivos no ledger, sem reaplicar SQL.
- Frontend depende do merge/deploy da PR desta branch.

Rollback de schema: `scripts/ops/rollback-bulk-pipeline-move.sql`, após reverter
o frontend. O backup privado deve ser preservado. A recuperação de dados deve
usar esse snapshot e conferir edições posteriores; não repetir o reparo nem
restaurar cegamente sobre trabalho novo.

## Segurança

Revisão conforme `.claude/skills/security-rubric/SKILL.md`: sem bloqueios novos.
Não muda policies de leitura/escrita das entradas; usa RLS existente e validação
de organização de `mover_negocio`. Dados do reparo ficam fora da migration de
schema e o backup não é acessível pela API do cliente.
