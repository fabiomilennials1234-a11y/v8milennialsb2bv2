# CHAMADO — Verificação de saúde (Sentry) — 2026-10-05

Org Sentry: `torquecrm` · Janela: últimas 24h · Origem: rotina automática

## Resumo em uma frase
O sistema está no ar e sem lentidão. Existe **1 erro que se repete** (resumo automático de conversas do Oráculo não está rodando) e 2 erros pontuais.

## 1. Incidentes ativos
Nenhuma queda ou incidente de disponibilidade. Nenhum alerta de performance.

## 2. Erros e avisos (por prioridade)

### 🟠 TORQUE-EDGE-1 — Resumo automático de conversas falhando (PRIORIDADE)
- Link: https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- Serviço: edge function `summarize-conversations-batch` (produção)
- Frequência: 511 vezes desde 2026-10-01; 144 só nas últimas 24h; última há poucos minutos (continua acontecendo, ~a cada 10 min).
- Usuários afetados: 0 (é um processo de fundo, ninguém vê erro na tela).
- **Em linguagem simples:** de tempos em tempos o sistema acorda um "robô" que escolhe conversas de WhatsApp paradas há mais de 1 hora para gerar um resumo. O robô tenta pegar a lista de conversas no banco de dados e o banco responde com erro. Como não consegue pegar a lista, **nenhum resumo novo é gerado**. O cliente não vê erro, mas os resumos do Oráculo ficam desatualizados.
- Onde olhar: `supabase/functions/summarize-conversations-batch/index.ts:41-42` chama a função de banco `claim_conversation_summary_jobs`, definida em `supabase/migrations/20271019150000_oraculo_conversas_legiveis.sql:225`. O código joga um erro genérico e **descarta a mensagem real do banco** (`error` é ignorado), por isso o Sentry não mostra o motivo.
- **Hipóteses (não confirmadas):** (a) a migration não foi aplicada em produção, ou (b) a função falha ao rodar (ex.: nome de coluna ambíguo entre as colunas de retorno `id/lead_id/instance_id` e as tabelas usadas dentro dela), ou (c) falta permissão para `service_role`.
- Próximo passo sugerido: incluir `error.message` no erro lançado (1 linha), fazer deploy, e ver a mensagem real no próximo evento; em paralelo, conferir no banco se a função existe e rodá-la manualmente com `select * from claim_conversation_summary_jobs(1)`.

### 🟡 TORQUE-EDGE-4 — Falha ao propagar responsáveis (1 ocorrência)
- Link: https://torquecrm.sentry.io/issues/TORQUE-EDGE-4
- Serviço: edge function `toth-sync-clientes`
- **Simples:** durante a sincronização de clientes, ao copiar o "responsável" para os itens do recorte, o servidor devolveu "Internal server error". Ocorreu 1 vez, há ~9h, não repetiu. Observar; se repetir, abrir chamado próprio.

### ⚪ TORQUE-WEB-10 — "JWT inválido ou expirado" (1 ocorrência)
- Link: https://torquecrm.sentry.io/issues/TORQUE-WEB-10
- Serviço: frontend, rota `/funil/whatsapp`, consulta `calendar-sharing`
- **Simples:** 1 usuário ficou com a sessão (login) vencida e a tela tentou carregar o calendário. Normal; basta entrar de novo. Sem ação, a menos que apareça em vários usuários.

## 3. Anomalias de performance
Nenhuma. Sem transações lentas registradas na janela.

## 4. Itens resolvidos desde a última checagem
Nenhum.
