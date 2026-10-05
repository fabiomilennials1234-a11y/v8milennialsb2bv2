# Chamado (rascunho) — Instabilidade no banco de dados (Sentry, 2026-10-05)

## O que aconteceu, em palavras simples
O banco de dados (Supabase) ficou lento/indisponível por alguns minutos. Quando isso acontece, telas que dependem dele (WhatsApp, Leads, Funil) falham ao carregar ou ao enviar mensagem. Não é um bug de uma tela só: é o "motor" por trás de várias telas engasgando.

## Gravidade: ALTA (ativo agora)
- **TORQUE-WEB-W** — "Could not query the database for the schema cache" (PGRST002): banco indisponível. 14 usuários, 24 eventos, em /chat-whatsapp. https://torquecrm.sentry.io/issues/TORQUE-WEB-W
- **TORQUE-WEB-C** — HTTP 500 em /leads (leads-stats). 2 usuários, 21 eventos. https://torquecrm.sentry.io/issues/TORQUE-WEB-C
- **TORQUE-WEB-3 / 1A / 1W** — "statement timeout": consultas demoraram demais e foram canceladas (lead-history-compact, mutation no funil, search-messages). https://torquecrm.sentry.io/issues/TORQUE-WEB-3
- **TORQUE-WEB-1S / 1R / WEB-R** — conexão com o banco expirou (timeout).

## Gravidade: MÉDIA
- **WhatsApp**: TORQUE-WEB-Z "Falha no envio" (5 usuários), TORQUE-WEB-1P "Failed to send a request to the Edge Function", TORQUE-WEB-T / 1Q "Invalid token", TORQUE-WEB-1V "Forbidden". Provável efeito do banco instável, mas "Invalid token" pode ser credencial expirada: conferir.
- **TORQUE-EDGE-1** — "Falha ao reservar conversas para resumo" (função summarize-conversations-batch): 142 eventos em 23h, ainda ocorrendo. Nenhum usuário afetado; é rotina em segundo plano. https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- **TORQUE-WEB-10 / WEB-Y** — "JWT inválido ou expirado": sessão expirada; usuário precisa relogar.

## Gravidade: BAIXA (possíveis bugs de código/permissão — 1 usuário cada)
- TORQUE-WEB-Q: tabela `org_onboarding` não encontrada (pode faltar migration).
- TORQUE-WEB-B: relação ambígua upsell_orders ↔ team_members.
- TORQUE-WEB-M1 → TORQUE-WEB-1M: `leads.name` nulo ao criar lead.
- TORQUE-WEB-G / J: permissão negada (get_my_member_organization_ids, lead_history).
- TORQUE-WEB-1N: sem permissão workflows.edit.
- TORQUE-EDGE-4, TORQUE-EDGE-5: erros pontuais em edge functions.

## Performance
Sentry não retornou dados de tracing (sem transações em 24h). Nada de latência medida além dos timeouts acima.

## Resolvidos desde a última checagem
Nenhum.

## Próximo passo sugerido (dev jr)
1. Abrir o painel do Supabase e ver CPU/conexões/queries lentas no horário dos erros.
2. Se já normalizou, acompanhar o TORQUE-WEB-W: se não repetir, marcar como resolvido.
3. Investigar as queries com timeout (lead-history-compact, search-messages) — provável falta de índice.
4. Conferir token do WhatsApp (whatsapp-api-proxy "Invalid token").
