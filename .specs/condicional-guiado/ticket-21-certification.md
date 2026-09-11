# Ticket 21 — certificação da primeira entrega

**Status:** certificado em ambiente dev/preview em 2026-09-10.

**Preview:** `saonafmpiaupgnosqvax`.

Produção não foi alterada. Migrações, Edge Functions e worker de produção só
podem ser liberados após autorização específica do CTO na sessão.

## Escopo certificado

A primeira entrega inclui editor guiado, E/OU em até três níveis, rascunho,
autorização organizacional, teste pessoal, publicação imutável, pin da versão na
execução, retry limitado, histórico protegido, portabilidade e revisão explícita
do legado. Os critérios expostos de atividade e produto possuem fontes fechadas:

- atividade: follow-up vinculado ao lead ou ao negócio exato, com estado e data
  operacionais explícitos;
- produto: item do negócio exato, associação manual ativa ou registro de negócio
  ganho.

“Último contato” não integra o catálogo certificado. O modelo atual não possui
fonte canônica suficiente e a decisão pendente está registrada em
`ticket-17-ultimo-contato-decisao.md`. Produto pago, pedido/nota externa,
variante/SKU e reconstrução histórica além do agregado atual também não são
declarados entregues. Negócio ganho não prova pagamento.

Tempo comercial e calendários compartilhados permanecem na segunda entrega.
Esta entrega usa tempo corrido.

## Limites fechados

| Recurso | Limite | Aplicação |
| --- | ---: | --- |
| Complexidade da árvore | 100 itens | editor, avaliador, publicação e trigger PostgreSQL |
| Profundidade de grupos | 3 níveis | editor, avaliador e publicação |
| Leitores sequenciais | 20 por árvore | avaliador e trigger PostgreSQL |
| Período de mensagem | 366 dias | avaliador e publicação |
| Expressões por busca | 20 | avaliador e publicação |
| Tamanho por expressão | 120 caracteres | avaliador e publicação |
| Soma normalizada das expressões | 1.000 caracteres | avaliador e publicação |
| Candidatos no teste pessoal | 50 | RPC PostgreSQL |
| Deadline do servidor | 10 segundos | avaliação e publicação |
| Deadline da UI | 12 segundos | teste pessoal e publicação |

O orçamento de leitores soma buscas de período, busca textual fora do gatilho,
espera por resposta, follow-ups e relações de produto em toda a árvore. O editor
impede crescimento acima de 100 itens. O avaliador rejeita o payload antes de
consultar dados. O trigger em `workflow_guided_versions` impede que outro caminho
de publicação grave versões acima de 100 itens ou 20 leitores.

## Evidência integrada

| Camada | Evidência | Resultado |
| --- | --- | --- |
| Navegador real | sessão real, organização, lead, edição, teclado, erro inline, grupo recolhido, resumo, teste pessoal e duas versões consultadas no banco | 1/1, 12,6 s |
| Integração real | Auth, RLS, outra organização, revogação, publicação, execução, falha, diagnóstico, limites e volume | 87/87, 162,31 s |
| Navegador isolado | regressão de interações e estados de UI, mais deadlines de teste/publicação | 125/125 + 2/2 focados |
| Unidades focadas | avaliador, API de teste, publicação, executor, worker e migração legada | 163/163 |
| Carga real | 1.000 mensagens; correspondência no último registro | 355,6 ms; resposta de 363 bytes |
| Ausência sem cobertura | 1.000 mensagens sem correspondência e sem cobertura completa | `history_insufficient` em 331,1 ms |
| Rollback | rollback e reapply de 56 migrations em uma transação no preview | passou; aprovação sintética e ACLs preservadas |
| Estática | Deno shared, TypeScript ratchet, ESLint focado e `git diff --check` | sem erro novo |

Os 127 casos de navegador isolado provam interação da UI. Não são usados como
prova de RLS. A prova de isolamento e revogação vem dos 87 testes contra Auth,
PostgREST, RPCs e Edge Functions reais do preview.

## Histórico grande e ausência

As consultas de mensagens retornam no máximo o registro decisivo com `LIMIT 1`.
A lista de candidatos do teste pessoal retorna no máximo 50 itens. A resposta da
avaliação contém somente resultado, referência e metadados permitidos; as 1.000
mensagens do ensaio não atravessaram a API.

Correspondência positiva pode ser decidida pelo registro encontrado. Falta de
correspondência só vira ausência quando `conversation_history_coverage` cobre
integralmente `[from,to)`. Cobertura inexistente, em andamento ou com lacuna vira
`history_insufficient` ou `history_sync_in_progress`.

## Rollback e liberação

Migration aditiva:
`supabase/migrations/20271020000055_guided_workload_limits.sql`.

Rollback:
`supabase/migrations/rollback/20271020000055_guided_workload_limits.sql`.

Ensaio reproduzível:

```bash
node scripts/check-guided-grant-rollback.mjs saonafmpiaupgnosqvax
```

Critério para produção: autorização explícita do CTO, aplicação ordenada das
migrations, deploy das Edge Functions e worker compatíveis, smoke test real e
monitoramento de erros/latência. Sem essa autorização, certificação termina no
preview.
