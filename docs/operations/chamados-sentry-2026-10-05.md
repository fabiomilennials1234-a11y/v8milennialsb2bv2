# Chamados de saúde — Sentry, 2026-10-05

Verificação automática (org `torquecrm`, projetos `torque-edge`, `torque-web`, `torque-qa`).
Nada resolvido nas últimas 24 h. Três issues abertas. Cada bloco abaixo é um Chamado
pronto para colar em Master → Suporte (o torque-mcp não estava acessível nesta rotina,
então não foi gravado direto em `support_tickets`).

---

## Chamado 1 — Resumos de conversa do Oráculo não estão sendo gerados  · Severidade: ALTA

**Link:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
**Serviço:** edge function `summarize-conversations-batch` (produção, sa-east-1)
**Números:** 517 ocorrências desde 2026-10-01 16:07 UTC; última 2026-10-05 06:17 UTC. 0 usuários afetados (é tarefa de fundo).

**O que aconteceu, em palavras simples**
A cada 10 minutos o sistema acorda um "robô" que resume as conversas de WhatsApp para o Oráculo.
Primeiro o robô precisa "pegar uma fila de conversas para resumir". Esse primeiro passo falha
(`Falha ao reservar conversas para resumo`). Como falha quase toda vez (517 de ~576 execuções em
4 dias), na prática **nenhuma conversa nova está sendo resumida**. Ninguém vê erro na tela — os
resumos só ficam velhos.

**Causa provável (hipótese, não confirmada)**
Em `supabase/migrations/20271019150000_oraculo_conversas_legiveis.sql:225`, a função SQL
`claim_conversation_summary_jobs` devolve colunas chamadas `id`, `organization_id`, `lead_id`,
`instance_id`, e dentro dela o `ON CONFLICT (organization_id, lead_id, instance_id)` usa esses
mesmos nomes. No Postgres isso costuma dar o erro "column reference is ambiguous" (42702).
O código (`supabase/functions/summarize-conversations-batch/index.ts:42`) esconde a mensagem real
do banco, por isso o Sentry só mostra o texto genérico.

**Como confirmar (1 minuto):** no SQL editor de produção, rode
`select * from public.claim_conversation_summary_jobs(1);` — a mensagem de erro real aparece.

**Sugestão de correção:** nova migration que renomeia as colunas de retorno/usa
`ON CONFLICT ON CONSTRAINT <nome>` (ou qualifica com alias), e trocar o `throw` do
`index.ts` para incluir `error.message` no log. Complexidade: **alta** (migration + edge function).

---

## Chamado 2 — Sincronização de clientes (Toth) falhou ao atribuir responsáveis  · Severidade: MÉDIA

**Link:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-4
**Serviço:** edge function `toth-sync-clientes` (`index.ts:704`)
**Números:** 1 ocorrência, 2026-10-04 19:31 UTC. Não repetiu.

**O que aconteceu, em palavras simples**
Ao sincronizar clientes, o sistema tenta dizer "quem é o responsável por cada cliente". Nessa
tentativa o serviço devolveu "Internal server error" (erro do lado de lá, sem detalhe). Aconteceu
uma vez só. Pode ter sido instabilidade passageira, mas os responsáveis daquele lote podem ter
ficado sem atualizar.

**Ação:** observar. Se repetir, abrir investigação em `toth-sync-clientes/index.ts:704` e checar
se o lote do dia 04/10 19:31 ficou sem responsável.

---

## Chamado 3 — "JWT inválido ou expirado" em /funil/whatsapp  · Severidade: BAIXA

**Link:** https://torquecrm.sentry.io/issues/TORQUE-WEB-10
**Serviço:** frontend (`torque-web`), consulta `calendar-sharing`
**Números:** 1 ocorrência, 1 usuário, 2026-10-05 ~06:00 UTC (12 h antes da verificação).

**O que aconteceu, em palavras simples**
A sessão de login de uma pessoa venceu enquanto a tela estava aberta, e a consulta do calendário
foi recusada. É comportamento esperado; a pessoa só precisa entrar de novo. Só vira problema se a
tela não redirecionar para o login sozinha.

**Ação:** nenhuma por enquanto.

---

## Resumo

| # | Serviço | Severidade | Status |
|---|---------|-----------|--------|
| 1 | summarize-conversations-batch | Alta | Ativo, repetindo a cada 10 min |
| 2 | toth-sync-clientes | Média | Ocorrência única |
| 3 | web /funil/whatsapp | Baixa | Ocorrência única |

Anomalias de performance: não analisadas a fundo nesta rodada além das issues acima.
Resolvidos nas últimas 24 h: nenhum.
