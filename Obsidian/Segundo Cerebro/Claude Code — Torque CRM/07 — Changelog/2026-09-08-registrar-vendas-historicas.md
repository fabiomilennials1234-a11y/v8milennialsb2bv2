---
type: changelog
title: Registrar vendas históricas no lead
status: draft
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
Publicação pendente da validação final.
