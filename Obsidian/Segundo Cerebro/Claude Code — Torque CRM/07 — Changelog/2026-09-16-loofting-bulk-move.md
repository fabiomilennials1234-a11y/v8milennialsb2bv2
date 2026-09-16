# Movimentação em lote — Loofting

- Corrigido o caminho do kanban: mover entradas existentes com `mover_negocio`,
  conservando identidade e histórico, em vez de adicionar por lead no destino.
- Corrigida a validação de histórico para etapas de mesma chave em funis diferentes.
- Produção: migrations 20260916163244 e 20260916164400 aplicadas em 2026-09-16,
  autorizadas pelo pedido da sessão de correção e limpeza da Loofting.
- Reparo confirmado às 16:46 UTC: Oportunidades 0; antigo Representantes,
  renomeado Marcando Entrevista pelo usuário, 9 originais. Nove cópias vazias
  removidas com backup privado, preservando todos os eventos de histórico.
- Frontend preparado para revisão/merge nesta branch.
- Evidências, testes e rollback: `docs/operations/loofting-bulk-move-2026-09-16.md`.
