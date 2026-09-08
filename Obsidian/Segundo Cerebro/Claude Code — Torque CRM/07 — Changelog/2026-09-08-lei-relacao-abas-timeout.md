---
type: changelog
title: Corrigir timeout nas abas da Lei da Relação
status: active
created: 2026-09-08
tags: [leads, migration, performance]
owner: gabriel
---

# Corrigir timeout nas abas da Lei da Relação

A consulta anterior passava no smoke de serviço, mas estourava 8 segundos com
permissões reais. O campo relacao_negocios agora é uma coluna indexada, mantida
por triggers; mantém a RLS de leads e rejeita classificação forjada pelo cliente.

Migration 20271018000001 aplicada às 17:59:10 UTC em 2026-09-08, na autorização
de produção/merge desta sessão. Hash e evidências em
`.specs/fixes/lei-relacao-abas-timeout.md`. A contagem autenticada no ensaio com
dados reais caiu para 4,678ms. Testes de transições e isolamento passaram no preview.
