# Chamados sugeridos — Sentry (torquecrm) — 2026-10-05

Rascunhos para abrir no painel Master → Suporte (a tool torque-mcp não estava disponível na rotina, então não foram criados automaticamente).

## 1. [ALTA] Resumos de conversa não estão sendo gerados (TORQUE-EDGE-1)
- Link: https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- Serviço: edge function `summarize-conversations-batch` (torque-edge, produção)
- Volume: 541 erros desde 01/10 16:07 UTC; 144 nas últimas 24h; último às 10:17 UTC de hoje. Nenhum usuário reportou (0 afetados), pois é job de fundo.
- Em linguagem simples: todo dia, de tempos em tempos, o sistema tenta "pegar a fila" de conversas do WhatsApp para resumir. Essa etapa falha sempre, então nenhum resumo novo é gerado. Ninguém vê tela quebrada, mas a funcionalidade de resumo (Oráculo) fica parada.
- Causa (confirmada no código): a função de banco `claim_conversation_summary_jobs` (migration `20271019150000_oraculo_conversas_legiveis.sql:243`) usa `ON CONFLICT (organization_id, lead_id, instance_id)`. Esses nomes também são colunas de saída da função, e o Postgres acha o nome ambíguo e rejeita a consulta. O código da edge function (`index.ts:42`) esconde o erro real e só mostra a mensagem genérica.
- Correção pronta, mas NÃO aplicada de propósito: `docs/operations/proposals/summary-claim-fix.sql` (troca por `ON CONFLICT ON CONSTRAINT ...`). Atenção: ao consertar, ~25.900 conversas pendentes (medido em 23/09) serão resumidas de uma vez, com custo de LLM. Decidir orçamento/limite antes de aplicar.
- Decisão necessária: aprovar o custo e aplicar a correção; ou desligar o cron para parar o ruído.

## 2. [BAIXA] Erro ao propagar responsáveis no sync de clientes (TORQUE-EDGE-4)
- Link: https://torquecrm.sentry.io/issues/TORQUE-EDGE-4
- Serviço: edge function `toth-sync-clientes` (`index.ts:763`)
- Ocorrência única, 04/10 19:31 UTC. Não repetiu.
- Em linguagem simples: durante a sincronização com o ERP, a etapa que atualiza "quem é o responsável" de alguns leads recebeu um "Internal server error" do banco. Foi uma vez só; provavelmente instabilidade momentânea. Se repetir, abrir investigação.
- Ação: monitorar.

## 3. [BAIXA] Sessão expirada em /funil/whatsapp (TORQUE-WEB-10)
- Link: https://torquecrm.sentry.io/issues/TORQUE-WEB-10
- Serviço: frontend, consulta `calendar-sharing`
- 1 usuário, 1 evento, 04/10 ~18:00 UTC.
- Em linguagem simples: o login de um usuário venceu enquanto a tela estava aberta e uma consulta falhou com "JWT inválido ou expirado". Comportamento normal; basta entrar de novo.
- Ação: nenhuma, só acompanhar se aumentar.

## Resolvidos
Nenhum item resolvido nas últimas 24h.
## Performance
Não analisada em profundidade nesta rodada (apenas erros/issues).
