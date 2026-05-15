---
type: reference
title: Reference — Map of Content
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [reference, moc]
related: []
owner: gabriel
---

# Reference — Map of Content

> Diátaxis: **Reference**. Lookup tables, valores, comandos.
> Para entender o **porquê**, ver `02 — Arquitetura/`.
> Para **fazer** algo, ver `05 — How-to/`.

## Sumário

- [[Schema]] — tabelas principais e relações
- [[RLS Policies]] — policies por tabela
- [[Edge Functions]] — 78+ functions, padrão, categorias
- [[RPCs]] — funções SQL chamadas do frontend/edge fn
- [[Env Vars]] — variáveis de ambiente (prod + dev)
- [[Cron Jobs]] — pg_cron jobs ativos
- [[Webhooks Outbound]] — webhooks que o sistema chama

## Convenção

Reference docs são **lookups**. Não tutoriais, não explicações. Sintéticos.
Atualizar quando schema/policies/functions mudam — preferível automação
(`vault-regen` skill).
