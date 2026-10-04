# Chamado — Saúde do Sentry (2026-10-04)

Texto pronto para abrir como Chamado no CRM (Suporte → novo Chamado).
Escrito para qualquer pessoa do time entender, inclusive dev júnior.

**Título:** Resumo automático de conversas está parado há 3 dias (erro repetido todo dia)

**Gravidade:** média — ninguém está bloqueado, mas um recurso não funciona.

## O que aconteceu (em palavras simples)

O CRM tem um "robô" que, a cada 10 minutos, escolhe conversas de WhatsApp
antigas e pede para a IA escrever um resumo delas. Esse robô é a função
`summarize-conversations-batch`.

Desde **01/10 às 16h07**, toda vez que ele acorda, tenta pegar a lista de
conversas para resumir e **dá erro logo no primeiro passo**. Resultado: nenhum
resumo novo é gerado. O Sentry já registrou **373 erros** (issue
[TORQUE-EDGE-1](https://torquecrm.sentry.io/issues/TORQUE-EDGE-1)); o último foi
hoje às 06h17 UTC.

## Por que acontece

A busca da lista é feita por uma função do banco (`claim_conversation_summary_jobs`).
Dentro dela, o nome `organization_id` existe em dois lugares ao mesmo tempo
(como coluna da tabela e como valor de retorno) e o banco não sabe qual dos dois
usar. Ele se recusa a rodar ("coluna ambígua"). É um erro de escrita no SQL, não
de infraestrutura.

## Quem é afetado

- Usuários: **0** (ninguém vê erro na tela).
- Efeito real: conversas **sem resumo novo** (~25.900 elegíveis).
- Custo: nenhum extra; o robô falha antes de chamar a IA.

## Por que ainda não foi corrigido

A correção já existe pronta: `docs/operations/proposals/summary-claim-fix.sql`
(com volta atrás em `summary-claim-fix-rollback.sql`). Ela foi **segurada de
propósito**: ao consertar, o robô passa a gerar resumos das ~25.900 conversas,
o que pode chamar a IA até 1.440 vezes por dia (~43.200 em 30 dias) e **gasta
dinheiro**. Por isso precisa de decisão de orçamento antes.

## O que decidir / fazer

1. Responsável pelo orçamento de IA decide: **consertar agora** ou **manter
   pausado**.
2. Se consertar: aplicar `summary-claim-fix.sql` no Supabase, acompanhar o
   Sentry por 1 hora e fechar TORQUE-EDGE-1.
3. Se manter pausado: pausar o agendamento (`7-59/10 * * * *`) para parar de
   gerar um erro novo a cada 10 min e silenciar a issue no Sentry.

## Outros avisos (baixa prioridade, 1 ocorrência cada)

| Issue | Onde | Em simples |
|---|---|---|
| [TORQUE-WEB-1K](https://torquecrm.sentry.io/issues/TORQUE-WEB-1K) | `/metricas` | Uma tela de métricas combinou "recorte total" com "ganho/perda", que não podem ser usados juntos. 1 usuário, 1 vez. Provável filtro sem validação. |
| [TORQUE-WEB-Z](https://torquecrm.sentry.io/issues/TORQUE-WEB-Z) | `/chat-whatsapp` | Um envio de mensagem falhou ("Falha no envio"). 1 usuário, 1 vez, 16h atrás. Vale só observar se repetir. |

## Desempenho e resolvidos

- Lentidão: nenhum dado de performance retornado nas últimas 24h (sem anomalia
  detectável).
- Resolvidos nas últimas 24h: nenhum.
