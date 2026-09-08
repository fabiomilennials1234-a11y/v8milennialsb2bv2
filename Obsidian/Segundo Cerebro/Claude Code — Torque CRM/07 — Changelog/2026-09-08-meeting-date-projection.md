---
type: changelog
title: Data da reunião no negócio sem deal_id
status: active
created: 2026-09-08
tags: [agenda, pipelines, migration]
owner: gabriel
---

# Data da reunião no negócio

Aplicado em produção `jsjsmuncfkbsbzqzqhfq`, autorizado por Gabriel nesta sessão
("pode. e já da merge"). Verificação concluída em 2026-09-08 14:23:37 UTC.

- PR #2039; migration `20271017000000_meeting_date_unique_pipeline_entry.sql`.
- SHA-256: `b4619dc0255a62863ec01b07bbc75c1cb2aa116b1a49d1452ef612eff38bc7fa`.
- Ledger: `20271017000000`, mesmo prefixo do arquivo, sem drift nesta aplicação.
- Projeção resolve entrada aberta única por organização, funil e lead quando a reunião não tem negócio explícito. Ambiguidade não escolhe entrada.
- Recuperação separada restaurou 7 datas em 3 organizações. Backup em `backup.meeting_date_recovery_20271017`; 7 projeções conferidas após apply.
- Três cards TorqueCRM reportados agora possuem a data agendada.
- Grants internos verificados: anon e authenticated sem EXECUTE nas três funções.
- Validação PostgreSQL e rollback passaram na preview, em transações revertidas.
- CI: lint/build, unit, edge, workflow e CodeQL passaram. Integração/RLS/E2E falham no setup legado `BACKUP rating incompleto`, anterior à migration.
- Smoke visual em produção não executado; verificação feita no banco consumido pelos cards.
