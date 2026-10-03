# Chamados prontos — Health check Sentry (2026-10-03)

Texto escrito para qualquer pessoa entender, inclusive dev júnior.
Cada bloco abaixo vira um Chamado (Título + Descrição + Tipo + Impacto).
Organização Sentry: `torquecrm`.

## Resumo

| Prioridade | Serviço | Problema | Link |
|---|---|---|---|
| Média | `torque-edge` (função `summarize-conversations-batch`) | Resumos automáticos de conversa não são gerados | https://torquecrm.sentry.io/issues/TORQUE-EDGE-1 |
| Baixa | `torque-web` (tela `/chat-whatsapp`) | Mensagem de WhatsApp falhou ao enviar (poucos casos) | https://torquecrm.sentry.io/issues/TORQUE-WEB-Z |

- Incidentes ativos (queda geral): nenhum.
- Itens resolvidos nas últimas 24h: nenhum.
- Performance: o Sentry não tem transações de performance registradas nas últimas 24h, então não há como medir lentidão. Isso é uma lacuna de monitoramento, não um sinal de que está tudo bem.

---

## Chamado 1 — Resumos de conversa não estão sendo gerados

- **Tipo sugerido:** erro
- **Impacto sugerido:** médio (ninguém fica sem usar o sistema, mas uma função automática está parada)

**O que aconteceu, em palavras simples**
Existe uma rotina que roda sozinha e escreve um resumo curto das conversas de WhatsApp com cada lead. Para isso, ela primeiro pede ao banco de dados uma "lista de conversas para resumir". Desde 01/10 às 16h07 esse pedido falha toda vez. Como a lista nunca chega, nenhum resumo novo é criado. Já foram 331 falhas, a última há poucos minutos.

**Quem sente isso**
Nenhum usuário viu erro na tela (0 usuários afetados). O efeito é silencioso: os resumos de conversa ficam desatualizados ou não aparecem.

**Onde está**
- Função: `supabase/functions/summarize-conversations-batch/index.ts` (linhas 40-42)
- Função do banco chamada: `claim_conversation_summary_jobs`

**Causa provável**
O repositório já tem um arquivo de correção para exatamente essa função do banco: `docs/operations/proposals/summary-claim-fix.sql`. Ele corrige um nome de coluna ambíguo, que faz o banco recusar a consulta. Isso é uma hipótese: o Sentry só mostra a mensagem genérica, sem o erro real do banco.

**Por que ainda não foi aplicado**
O próprio arquivo avisa que consertar liga a geração de resumos de cerca de 25.900 conversas acumuladas (medido em 23/09). Isso gera custo de IA. Alguém precisa decidir o orçamento antes de aplicar.

**Próximos passos**
1. Decidir se há orçamento para gerar o backlog de resumos.
2. Se sim, aplicar `summary-claim-fix.sql` (o rollback está em `summary-claim-fix-rollback.sql`).
3. Se não, desligar o agendamento da função para parar o ruído no Sentry. Isso não conserta o problema, só silencia.
4. Registrar o erro real do banco (hoje a mensagem original é descartada em `index.ts:42`) para o próximo diagnóstico ser mais rápido.

---

## Chamado 2 — Falha ao enviar mensagem no chat de WhatsApp

- **Tipo sugerido:** erro
- **Impacto sugerido:** baixo (4 ocorrências, 3 usuários, em 2 dias)

**O que aconteceu, em palavras simples**
Um usuário tentou enviar uma mensagem na tela de Chat WhatsApp. O sistema tentou várias vezes, tentou confirmar se a mensagem tinha saído, não conseguiu confirmar e mostrou "Falha no envio". A última ocorrência foi em 03/10 às 13h46 (horário UTC).

**Quem sente isso**
3 usuários diferentes. A mensagem pode ou não ter chegado ao cliente final.

**Onde está**
- `src/modules/communication/hooks/chat/useWhatsAppSend.ts` (linha 257, chamada à função `whatsapp-api-proxy`)
- `src/modules/communication/hooks/chat/shared/send-recovery.ts` (linha 53, quando as tentativas se esgotam)

**Causa provável**
Ainda desconhecida. O envio passa pelo `whatsapp-api-proxy` e todas as tentativas falharam. O código de erro veio como `unknown`, o que não ajuda. Pode ser instabilidade do provedor de WhatsApp ou da instância do usuário.

**Próximos passos**
1. Ver as gravações de sessão no Sentry (4 replays):
   - https://torquecrm.sentry.io/explore/replays/7c6c77e8d2eb43d481535a55194566c4/
   - https://torquecrm.sentry.io/explore/replays/a202fb944b6b4cd8801c10622e852ae0/
   - https://torquecrm.sentry.io/explore/replays/5b34608d42d0465dbca8bd4ed9142c65/
   - https://torquecrm.sentry.io/explore/replays/0f8476f03d484021aee76feb6412063e/
2. Procurar nos logs do `whatsapp-api-proxy` o que aconteceu perto do horário das falhas. A referência do erro é `A9CB9138`.
3. Só agir se voltar a acontecer: com 4 casos, ainda pode ser instabilidade pontual.
