# Chamados do Sentry — verificação de saúde de 2026-10-04

Gerado pela rotina automática de saúde (Sentry, org `torquecrm`). Linguagem
simples de propósito: qualquer pessoa do time, inclusive dev júnior, deve
entender o que houve e o que fazer.

**Resumo:** nenhuma queda (outage). 2 erros abertos. Um deles (Chamado 1) se
repete a cada ~10 minutos desde 01/10 e merece ação. O outro (Chamado 2) é
pequeno. Nenhum item foi resolvido nas últimas 24h. Sem dados de performance
(o Sentry não recebeu transações nas últimas 24h).

> Nota: o `torque-mcp` não estava conectado nesta execução, então estes
> Chamados **não** foram gravados em `support_tickets`. Abra-os no painel do
> master copiando daqui, ou rode `/chamado-diagnosticar` depois de abri-los.

---

## Chamado 1 — Resumos de conversa do Oráculo não estão sendo gerados

- **Severidade:** média-alta (o cliente não vê erro na tela, mas um recurso de
  fundo está parado)
- **Status:** ativo, não resolvido
- **Serviço:** `torque-edge` → função `summarize-conversations-batch`
- **Link:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- **Quando:** primeira vez em 01/10 16:07 UTC; última em 04/10 16:17 UTC;
  433 ocorrências (~6 por hora, ou seja, toda vez que o agendador roda)
- **Usuários afetados:** 0 (é tarefa automática, ninguém clica nela)

### O que aconteceu, em simples

O sistema tem uma tarefa que roda sozinha de tempos em tempos. Ela pega
conversas de WhatsApp paradas há mais de 1 hora e pede para a IA escrever um
resumo. O primeiro passo da tarefa é "reservar" quais conversas resumir,
chamando uma função do banco (`claim_conversation_summary_jobs`). **Essa
reserva está dando erro toda vez**, então nenhuma conversa é reservada e
nenhum resumo novo é criado. Nada quebra para o usuário; os resumos
simplesmente ficam velhos.

### Por que acontece (hipótese, não confirmada)

O texto do erro real do banco **não aparece** no Sentry: o código joga fora a
mensagem original e mostra só "Falha ao reservar conversas para resumo"
(`supabase/functions/summarize-conversations-batch/index.ts:42`).

A pista mais forte está na função do banco
(`supabase/migrations/20271019150000_oraculo_conversas_legiveis.sql:225-258`).
Ela declara que devolve colunas chamadas `id`, `organization_id`, `lead_id` e
`instance_id`, e dentro dela usa
`ON CONFLICT (organization_id, lead_id, instance_id)` **sem prefixo**. No
PL/pgSQL, os nomes da lista de retorno viram variáveis, e o banco pode
reclamar `column reference "organization_id" is ambiguous` (nome ambíguo).
Isso é um erro conhecido e acontece sempre que a função roda, o que bate com
o padrão de ~6 erros por hora.

Para descartar a hipótese: rode a função uma vez no banco
(`select * from claim_conversation_summary_jobs(1);` como `service_role`) e
leia a mensagem. Se for outra (permissão, tabela ausente, migration não
aplicada em produção), a causa é outra.

### O que fazer

1. **Ver a mensagem real** (passo acima). 2 minutos.
2. Se for ambiguidade: nova migration com `CREATE OR REPLACE FUNCTION` que
   coloca `#variable_conflict use_column` logo após o `AS $$`, ou renomeia as
   colunas de retorno (ex.: `job_id`, `org_id`...). Não edite a migration
   antiga.
3. **Melhorar o log:** no `index.ts:42`, incluir `error.message` no erro, para
   o Sentry mostrar a causa da próxima vez.
4. Depois de corrigir, confirmar que o Sentry para de receber o
   `TORQUE-EDGE-1` e que a tabela `conversation_summary_jobs` passa a ter
   linhas `completed`.

**Resposta sugerida ao cliente:** não há cliente afetado. Se alguém perguntar
sobre resumos de conversa desatualizados: "Identificamos uma falha na rotina
automática que gera os resumos e estamos corrigindo. As conversas continuam
funcionando normalmente."

---

## Chamado 2 — Tela de Métricas: combinação inválida de medida e recorte

- **Severidade:** baixa
- **Status:** ativo, sem recorrência desde 03/10 23:39 UTC
- **Serviço:** `torque-web`, rota `/metricas`
- **Link:** https://torquecrm.sentry.io/issues/TORQUE-WEB-1K
- **Replays:** https://torquecrm.sentry.io/explore/replays/70d050212f4a41db82fc6042a15bb57e/
  e https://torquecrm.sentry.io/explore/replays/99c694f066f54df2964e79003ba30ad5/
- **Quando:** 02/10 20:39 UTC e 03/10 23:39 UTC; 2 ocorrências, 1 usuário
  (papel `master`, Florianópolis)

### O que aconteceu, em simples

Na tela de Métricas, o usuário escolheu a medida **ganho_perda** com o
recorte **total**. O banco só aceita **ganho_perda** com o recorte
**desfecho** (`supabase/migrations/20270821170000_metric_ganho_perda.sql:80-81`)
e, de propósito, recusa o resto em vez de mostrar um número que responde
outra pergunta. A tela chamou o banco com a combinação errada e mostrou erro
(referência de suporte `C5E6DFE8`).

### Por que acontece (hipótese)

A tela deixa (ou deixou) o usuário chegar nessa combinação, ou mantém o
recorte antigo ao trocar de medida. Veja os dois replays para confirmar o
passo a passo do clique.

### O que fazer

1. Assistir os replays e achar o clique que gera a combinação.
2. No front (`src/modules/analytics/hooks/useMetricMeasure.ts`), ao trocar de
   medida, resetar o recorte para um válido para aquela medida (ou esconder os
   recortes incompatíveis).
3. Baixa prioridade: o banco está certo em recusar; o defeito é a tela.

---

## Itens sem problema

- **Incidentes/queda:** nenhum.
- **Resolvidos desde a última checagem:** nenhum.
- **Performance:** sem dados. O Sentry não devolveu nenhuma transação nas
  últimas 24h (tracing parece desligado ou sem amostra). Não dá para afirmar
  que latência está normal; vale ligar `tracesSampleRate` se quiserem esse
  monitoramento.
- **Volume geral de erros (24h):** 145, estável (~6/h), quase tudo do
  Chamado 1.
