---
type: changelog
title: Registrar vendas históricas no lead
status: active
created: 2026-09-08
tags: [leads, carteira, vendas]
owner: gabriel
---

# Registrar vendas históricas no lead

Nova ação Registrar Venda junto de Novo negócio, inclusive para leads sem funil.
Valor/data em lista, gravação atômica ao salvar e proteção contra envio repetido.
Vendas registradas aparecem como negócios ganhos e alimentam o ciclo de recompra.

Contrato, limites, segurança e testes em `docs/historical-sales.md`.
Migration nova `20271018000002_registrar_vendas_historicas.sql`, sem backfill.
Migration aplicada em produção nesta rodada autorizada pelo CTO. Ledger e SQL
conferidos; anon sem EXECUTE, authenticated sem INSERT direto e RLS habilitada.
Nenhum lote/venda inserido durante a verificação. SHA256 do arquivo:
`44aab5f20f9b7f722ecc8c092035b4540a519b711f126558a680bb9d5e1fc3cd`.
Frontend aguardando merge do PR #2049. Ensaio PostgreSQL independente no CI em
`historical-sales.yml`, além dos testes React e do rollback executado localmente.
