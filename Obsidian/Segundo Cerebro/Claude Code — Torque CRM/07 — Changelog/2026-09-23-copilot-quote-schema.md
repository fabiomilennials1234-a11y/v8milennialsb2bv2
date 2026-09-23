---
type: changelog
title: Schema de orçamentos Copilot — release desabilitada
status: active
created: 2026-09-23
tags: [copilot, migration, prod]
---

# Schema de orçamentos Copilot

Autorizado pelo CTO nesta sessão: merge na main e publicação no DB de produção.

- Apply em `jsjsmuncfkbsbzqzqhfq`: 2026-09-23 15:44:40 UTC.
- Migration local: `20260923140413_copilot_quote_documents.sql`.
- Ledger: `20260923154440_copilot_quote_documents`. Não reaplicar por diferença de timestamp.
- SHA-256: `B50424353DCEFA5A9755F78EDAFD6E64E1354B697F1A717BB392F75BA9FFF151`.
- Verificação: 53 agentes desligados para a ferramenta; RLS nas três tabelas; Storage privado; anon/authenticated sem EXECUTE nas funções novas; service_role autorizado; zero orçamentos.
- Preview de ensaio excluída, cleanup confirmado. Sem envios ou ativação de atendimento real.
- PR: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2159.

Edge Functions, renderer e homologação completa pendentes. Estado detalhado e rollback operacional em `docs/operations/copilot-quote-release-2026-09-23.md`.
