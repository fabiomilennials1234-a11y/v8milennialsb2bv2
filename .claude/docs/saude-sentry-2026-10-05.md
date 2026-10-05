# Saúde do sistema (Sentry) — 2026-10-05

Org `torquecrm` · 24h: torque-web 167 erros, torque-edge 144 erros · 0 itens resolvidos · Sem dados de performance (traces vazios).
Obs.: o MCP do torque (`support_tickets`) não estava conectado, então **os Chamados não foram abertos no sistema**. Os textos abaixo estão prontos para colar.

## CHAMADO 1 — ALTA: telas do WhatsApp com "permissão negada" (TORQUE-WEB-G/J/H/F/E/D)
**O que aconteceu (simples):** há ~5h, quem abre `/funil/whatsapp` leva "permission denied" ao ler as tabelas `lead_history`, `sale_events`, `deals`, `lead_custom_field_values`, a view `org_visible_members` e a função `get_my_member_organization_ids`. Ainda ocorre (último: 14 min atrás). É como o banco "trancar a porta" para o usuário logado: o código está certo, falta liberar o acesso (GRANT/policy).
**Suspeita (hipótese):** migration recente tirou o GRANT de `authenticated`. Parecido com o TORQUE-WEB-1 já visto (função não executável de propósito).
**Ação:** conferir migrations das últimas 6h e GRANTs dessas tabelas. Links: https://torquecrm.sentry.io/issues/TORQUE-WEB-G · /J · /H · /F · /E · /D

## CHAMADO 2 — ALTA: resumo de conversas falhando sem parar (TORQUE-EDGE-1)
**O que aconteceu:** a função `summarize-conversations-batch` roda sozinha e falha em toda execução ("Falha ao reservar conversas para resumo", `index.ts:45`, passo `claim`). 580 falhas desde 01/10, a mais recente há minutos. Nenhum usuário reclamou (0 afetados), mas os resumos de conversa **não estão sendo gerados**.
**Ação:** ver a função/RPC chamada no `claim` (provável erro de banco ou permissão). https://torquecrm.sentry.io/issues/TORQUE-EDGE-1

## CHAMADO 3 — MÉDIA: banco lento / indisponível em momentos (TORQUE-WEB-C, W, 3, 1A, 1X, 20, 1S)
**O que aconteceu:** consultas estourando tempo (`57014 statement timeout`) em chat-whatsapp (`lead-history-compact`, 6 usuários), métricas (`team-response-time`) e funil; `/leads` com HTTP 500 (30 eventos); `/tv` com `PGRST002` (cache do schema indisponível, 15 usuários) há 3h; conexão resetada em `whatsapp_dead_sessions`. Sinal de banco sobrecarregado ou reiniciando.
**Ação:** checar CPU/conexões do Supabase e a query `lead-history-compact`. Links: TORQUE-WEB-C, -W, -3, -1A, -1X, -20, -1S em torquecrm.sentry.io/issues/

## CHAMADO 4 — MÉDIA: envio de WhatsApp falhando (TORQUE-WEB-Z, T, 1Q, 1P, 18, 1Z)
**O que aconteceu:** "Falha no envio" (8 usuários, 18 eventos), `whatsapp-api-proxy: Invalid token` (7 usuários), Uazapi 503 e erro no upload de mídia. Provável token de instância inválido/expirado ou o provedor instável.
**Ação:** conferir tokens das instâncias e status do Uazapi.

## CHAMADO 5 — BAIXA
- TORQUE-WEB-Y / -10: sessão (JWT) expirada em `/funil/whatsapp` — normalmente só pede novo login.
- TORQUE-WEB-Q: tabela `org_onboarding` não existe no banco (migration não aplicada?).
- TORQUE-WEB-B: consulta `upsell_orders`↔`team_members` ambígua (precisa indicar qual relação usar).
- TORQUE-WEB-A: `organization-type` retornou 0 linhas onde se esperava 1.

## Resolvidos desde a última checagem
Nenhum.
