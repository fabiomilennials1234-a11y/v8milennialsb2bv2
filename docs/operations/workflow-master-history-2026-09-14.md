# Histórico de workflows para master — 2026-09-14

O helper `can_read_guided_execution_data` recusava qualquer execução sem
`guided_version_id` antes de verificar master. Assim, workflows legados ficavam
com detalhes protegidos até para master completo.

A correção verifica sessão e organização, depois a autorização master existente,
e só então exige lead/versão para leitores comuns. Master restrito continua sujeito
a `can_administer_guided_workflow`. RPCs, projeção segura dos resultados e grants
existentes foram preservados.

## Validação e aplicação

- PostgreSQL local (PGlite): falha reproduzida com função original; correção passa.
- Negativos: master restrito, admin comum e anônimo não recebem a exceção.
- Helper continua privado; rollback executado e comportamento anterior confirmado.
- Baseline de produção: master=true, full_access=true, legacy_visible=false.
- Depois do apply: legacy_visible=true, history_visible=true, visible_steps=2;
  EXECUTE direto negado para anon e authenticated.
- Ledger de produção: `20260914182927_master_legacy_workflow_history` (versão
  atribuída pelo MCP). Arquivo ordenado após as dependências futuras do repo:
  `20271021000007_master_legacy_workflow_history.sql`. Não reaplicar pelo nome.
- Não foi criada preview adicional: a branch `condicional-guiado` pertence a outro
  trabalho. QA substituído por PGlite, baseline medido, rollback executado e
  verificação imediata de produção, conforme runbook de migration.

## Relato do nó de ganho — Milennials

Fluxo `Automação — Vendido ✓` (79dc7290-9a4b-480b-b8bf-85e33db8c95e).
Execução 9aec9678-4797-40b8-ba54-5fe02b8ac3b4: iniciou às 16:53 UTC e
gravou ganho às 16:54 UTC em 14/09. Negócio bcf122b9-9372-4406-8d31-3143e375f848
confirmado com outcome=won, won=true, outcome_source=workflow.
A execução de 11/09 também terminou com sucesso (negócio já ganho, idempotente).

Não foi reproduzida falha de ganho nessas execuções. Nenhuma venda foi reprocessada
ou modificada nesta investigação. Para outro caso, falta a identificação do negócio
ou execução relatados; não alterar o executor sem reproduzir o sintoma.
