---
type: changelog
title: "SCRUM-673 — frontend deixa os espelhos"
status: shipped
created: 2026-09-04
updated: 2026-09-04
tags: [changelog, migration, funis, frontend, postgres]
related: []
owner: gabriel
branch: refactor/673-escrita-do-front-sai-dos-espelhos
pr: 2008
---

# 2026-09-04 — Frontend deixa os espelhos

## Mudança

As 42 mutações encontradas no frontend deixaram as seis views de
compatibilidade:

- `pipe_whatsapp`
- `pipe_confirmacao`
- `pipe_propostas`
- `custom_pipe_entries`
- `custom_pipeline_stages`
- `custom_pipelines`

Entradas passam pelas RPCs compartilhadas sobre `pipeline_entries`. Funis e
etapas custom passam pelas novas RPCs sobre `pipelines` e `pipeline_stages`.
Criação de funil com etapas virou uma transação única. Alterações de responsável
e compromisso na ficha do lead são projetadas pelo banco na mesma transação.

Os adaptadores `INSTEAD OF` permanecem ativos durante a compatibilidade e agora
delegam às mesmas RPCs. Guardas de família impedem uma RPC de sistema de alterar
entrada custom, uma RPC custom de alterar entrada de sistema e uma RPC de etapa
custom de alterar etapa de sistema. A guarda de `lifecycle_type` mantém os hooks
temporários separados dos funis permanentes.

## Apply em PROD

- Migration: `20271006000000_front_escreve_sem_espelhos.sql`
- PROD apply: `2026-09-05T01:11:13Z`
- Autorizador: Gabriel, pela autorização da sequência nesta sessão
- Commit do apply: `193fdf9b`
- SHA-256: `8a148b28dd3ef38044febf0c96c0d58962085de272acb6f856226c08ae245b11`
- Ledger: versão `20271006000000` gravada uma vez e confirmada no topo

## Provas

- Pacote final ensaiado em PROD com `ROLLBACK` antes do apply real.
- Preflight confirmou migration anterior, ausência da nova versão e hashes das
  seis funções substituídas.
- A/B transacional cobriu defaults, JSON, triggers, ACL, tenancy, atomicidade,
  nulos, guardas de família e compatibilidade de `RETURNING`.
- Controle positivo envenenado reprovou como esperado.
- Rollback transacional restaurou funções e adaptadores anteriores.
- Pós-commit em conexão nova: cinco RPCs presentes; `anon` sem `EXECUTE`;
  `authenticated` com `EXECUTE`; trigger de lead único e habilitado; quatro
  adaptadores delegando; três guardas presentes.
- Varredura do frontend: zero mutações nos seis espelhos.
- TypeScript: zero erros e teto herdado reduzido de 20 para 13.
- Ratchet unitário: zero testes quebrados pela branch em 12.277 testes.
- 107 testes focados passaram; build de produção passou.

## Estado restante

Três funções de manutenção ainda geram nove correspondências de escrita nos
espelhos: `bulk_delete_leads`, `purge_lead` e `remove_demo_data`. Elas também
estão no inventário de leitores da SCRUM-639 e serão migradas naquela janela.

A migration futura `20270920000000_demolicao_dos_espelhos.sql`, já presente na
`main`, bloqueia o `supabase start` enquanto os 19 leitores SQL da SCRUM-639
existirem. Por isso integração, pgTAP e E2E não iniciam nesta janela. Os quatro
testes Edge falhos pertencem ao baseline fora deste diff.

## Desvio de estimativa

O Jira estimava 23 chamadas em cinco arquivos. A varredura completa encontrou
42 mutações. O título da SCRUM-673 foi corrigido para refletir o escopo entregue.
