# Health check Sentry — 2026-10-04 (org `torquecrm`)

Resumo: **sem incidente de indisponibilidade**. 3 problemas abertos (1 recorrente, 2 pontuais).
Nenhum dado de latência (nenhuma transação com tracing nas últimas 24h). Resolvidos nos últimos 7 dias: 8 itens (todos de 01–02/10, fora os de teste/QA).

> Os Chamados abaixo estão escritos para qualquer pessoa da equipe entender, inclusive dev júnior.
> A tool `torque-mcp` não estava disponível nesta execução, então o registro no painel
> (Master → Suporte → Chamado → Diagnóstico) precisa ser feito à mão com este texto.

---

## CHAMADO 1 — Resumos de conversa do Oráculo não estão sendo gerados  (prioridade: MÉDIA)

- **Sentry:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-1 (projeto `torque-edge`)
- **Quantas vezes:** 451 ocorrências desde 01/10 16:07 UTC, última às 19:17 UTC de hoje. Acontece a cada execução do job. Clientes afetados: 0 (é um processo de fundo, ninguém vê erro na tela).
- **O que aconteceu, em português simples:** todo dia o sistema tenta "reservar" conversas de WhatsApp para um robô resumir. Essa reserva é feita por uma função do banco chamada `claim_conversation_summary_jobs`. Essa função está falhando **toda vez**, então nenhum resumo novo é gerado. Para o cliente, o efeito é indireto: o Oráculo fica sem resumos atualizados.
- **Por que (causa provável, confiança: alta mas não reproduzida em produção):** a função devolve colunas chamadas `organization_id`, `lead_id` e `instance_id`, e dentro dela existe um comando `ON CONFLICT (organization_id, lead_id, instance_id)`. O banco fica na dúvida se esses nomes são as colunas da tabela ou as colunas de saída da função e dá erro de "nome ambíguo". Código: `supabase/migrations/20271019150000_oraculo_conversas_legiveis.sql:225-255` (a linha do `ON CONFLICT`). O erro real do banco não aparece no Sentry (o código só registra a frase genérica em `supabase/functions/summarize-conversations-batch/index.ts:42`).
- **Já existe correção pronta?** Sim: `docs/operations/proposals/summary-claim-fix.sql` troca o `ON CONFLICT (colunas)` por `ON CONFLICT ON CONSTRAINT <nome da constraint>`. Está fora de `migrations/` de propósito.
- **ATENÇÃO antes de aplicar:** esse arquivo avisa que ao consertar, o sistema vai começar a resumir um backlog de ~25.900 conversas (medido em 23/09), o que **gera custo de LLM**. Quem decide é o responsável por orçamento: aplicar de uma vez, ou limitar antes.
- **Como saber que ficou bom:** `TORQUE-EDGE-1` para de receber eventos e `conversation_summary_jobs` passa a ter linhas `completed`. Teste existente: `tests/integration/summary-claim.test.mjs`.
- **Alternativa se não quiser gastar agora:** desligar o agendamento que chama `invoke_summarize_conversations_batch()` para parar o ruído no Sentry.

## CHAMADO 2 — Erro em /metricas: "recorte total incompatível com ganho_perda"  (prioridade: BAIXA)

- **Sentry:** https://torquecrm.sentry.io/issues/TORQUE-WEB-1K (projeto `torque-web`)
- **Quantas vezes:** 2 ocorrências, 1 usuário (perfil master), 02/10 e 03/10. Replay: https://torquecrm.sentry.io/explore/replays/70d050212f4a41db82fc6042a15bb57e/
- **O que aconteceu:** na tela de Métricas, um widget pediu o número "Ganhos vs. Perdas" usando um tipo de recorte (`total`) que essa métrica não aceita. A métrica só aceita `desfecho`. O banco recusa de propósito (para não responder uma pergunta diferente), e o card ficou com erro.
- **Onde:** regra no banco em `supabase/migrations/20270821170000_metric_ganho_perda.sql:80-82`; chamada em `src/modules/analytics/hooks/useMetricMeasure.ts:129`.
- **Causa provável (hipótese):** um widget salvo no dashboard dessa organização (`b2ad1ffb-…`) ficou configurado com recorte `total` para `ganho_perda`. Verificar a config do widget e corrigir para `desfecho`; opcionalmente o seletor de recorte do editor deveria impedir essa combinação.
- **Não é urgente:** 1 usuário, não repetiu hoje.

## CHAMADO 3 — "JWT inválido ou expirado" ao abrir o compartilhamento de agenda no Funil WhatsApp  (prioridade: BAIXA)

- **Sentry:** https://torquecrm.sentry.io/issues/TORQUE-WEB-10 (projeto `torque-web`)
- **Quantas vezes:** 3 ocorrências, 3 usuários diferentes (02/10 → hoje 18:15 UTC). Replays: https://torquecrm.sentry.io/explore/replays/521e3d6e88834d48a9c6717847c2d7e4/
- **O que aconteceu:** o login do usuário (o "crachá" digital, chamado JWT) venceu com a aba aberta, e a tela de agenda tentou carregar o compartilhamento com o crachá velho. O servidor respondeu 401 e a tela mostrou erro. Recarregar a página resolve.
- **Onde:** `src/modules/integrations/hooks/useGoogleCalendarSharing.ts:57` (lê a resposta) e `supabase/functions/google-calendar-sharing/index.ts:57` (devolve o 401).
- **Causa provável (hipótese):** o hook usa `session.access_token` guardado no momento do render e não renova antes de chamar. Correção sugerida: pegar o token atual com `supabase.auth.getSession()` dentro do `queryFn`, ou tratar 401 como "sessão expirada" sem reportar ao Sentry como erro.
- **Pista a confirmar:** pelo número de usuários, pode ser deploy/renovação de token coincidindo com o horário; olhar os 3 replays.

---

## Resolvidos nos últimos 7 dias (sem ação)

| Item | Resumo |
|---|---|
| TORQUE-WEB-1 | `permission denied for function can_link_or_read_lead` (6 usuários) |
| TORQUE-EDGE-2 | OpenRouter 404 para o modelo `claude-3.5-haiku` |
| TORQUE-WEB-7 / WEB-8 | timeouts de requisição (upstream) |
| TORQUE-WEB-2, QA-1, QA-2, QA-3 | testes de go-live / QA, ignorar |

## Performance

Sem transações com tracing nas últimas 24h: **não foi possível avaliar latência**. Vale conferir se o `tracesSampleRate` do front/edge está ligado.
