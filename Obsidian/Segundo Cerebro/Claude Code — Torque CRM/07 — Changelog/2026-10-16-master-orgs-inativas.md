---
type: changelog
title: Organizações inativas na Área Master
status: active
created: 2026-10-16
updated: 2026-10-16
tags: [changelog, master, organizacoes]
related: []
owner: codex
---

# 2026-10-16 — Organizações inativas na Área Master

A página de organizações da V5 separa **Orgs ativas** e **Orgs inativas** pelo status administrativo. Suspensas, canceladas e expiradas ficam na segunda aba. O filtro de login dos últimos 30 dias passa a se chamar **Com uso recente / Sem uso recente**, independente do status.

Inativas saem do seletor dos masters, inclusive se tiverem liberação de plano. A seleção salva no navegador é validada antes de restaurar o contexto, também para masters com vínculo real. Usuários comuns e gestores mantêm seus fluxos de vínculo.

As ações **Inativar / Reativar** usam a RPC existente `master_set_org_suspension`: inativar revoga o billing override e exige motivo; reativar não restaura a cortesia. As mutações invalidam os caches da lista, do seletor e do contexto. Não há alteração de schema, RLS ou Edge Functions.

Validação: testes da página (status, busca, URL, trial e escopo outbound) e dos hooks (filtro PostgREST, seleção persistida, vínculo real, lista vazia e atualização dos caches após inativação/reativação).
