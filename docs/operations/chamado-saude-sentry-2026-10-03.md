# Chamado — Saúde do sistema (Sentry) — 2026-10-03

Checagem automática do Sentry (org `torquecrm`, projetos torque-edge / torque-web / torque-qa), últimas 24h.
Resolvidos nas últimas 24h: **nenhum**. Sem dados de performance (traces) no período.

## O que aconteceu, em linguagem simples

### 1. ALTA — O robô que resume conversas falha o tempo todo
- Onde: edge function `summarize-conversations-batch` · https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- 283 erros desde 2026-10-01 16:07 UTC, ainda ocorrendo (último às 15:17 UTC de hoje). Nenhum usuário reclamou (roda em segundo plano).
- Em simples: a cada rodada, o robô pede ao banco "me dê as próximas conversas para resumir" (função `claim_conversation_summary_jobs`) e o banco responde com erro. Nenhum resumo novo é gerado.
- Hipótese (não confirmada): essa função só é criada pela migration `20271019150000_oraculo_conversas_legiveis.sql`, que talvez não esteja aplicada em produção. Confirmar: a função existe no banco de produção?

### 2. ALTA — "Permissão negada" no banco, uma rajada de ~20 erros entre 20h e 22h atrás
- Issues: TORQUE-WEB-G, -D, -13, -J, -H, -F, -E, -1B a -1J (tabelas leads, deals, conversations, messaging_channels, lead_history, sale_events etc.; funções get_unread_total, org_get_features_and_limits...). Exemplo: https://torquecrm.sentry.io/issues/TORQUE-WEB-G
- Em simples: a tela tentou ler dados e o banco disse "você não tem permissão". Todos os erros caem na mesma janela (~2h) e pararam; padrão típico de permissão removida por engano e depois devolvida. Pelo Sentry, parou, mas vale confirmar com a equipe que foi correção e não coincidência.
- Impacto: ~1–2 usuários nas telas /auth e /funil/whatsapp.

### 3. MÉDIA — Tabela inexistente: `org_onboarding`
- https://torquecrm.sentry.io/issues/TORQUE-WEB-Q · 6 erros, 2 usuários, na tela /tv. Última ocorrência 18h atrás.
- Em simples: o código procura uma tabela que o banco não conhece (migration não aplicada ou cache do banco desatualizado).

### 4. MÉDIA — Consultas que demoram demais (timeout)
- https://torquecrm.sentry.io/issues/TORQUE-WEB-3 (dashboard, 5 usuários, 6 erros)
- https://torquecrm.sentry.io/issues/TORQUE-WEB-1A e TORQUE-WEB-19 (lista fria 30d: timeout e trava de bloqueio)
- Em simples: o banco cancelou a consulta por levar tempo demais. O dashboard foi o mais sentido (5 pessoas).

### 5. MÉDIA — WhatsApp
- TORQUE-WEB-18: provedor Uazapi respondeu 503 (fora do ar) — https://torquecrm.sentry.io/issues/TORQUE-WEB-18
- TORQUE-WEB-Z: "Falha no envio" no chat, 3 erros, último há 1h (ainda ativo) — https://torquecrm.sentry.io/issues/TORQUE-WEB-Z
- TORQUE-WEB-12: edge function retornou erro em /funil/whatsapp — https://torquecrm.sentry.io/issues/TORQUE-WEB-12

### 6. BAIXA
- TORQUE-WEB-C: erro 500 em estatísticas de leads (1 usuário) — https://torquecrm.sentry.io/issues/TORQUE-WEB-C
- TORQUE-WEB-6: falha ao renovar token do Google Calendar (1 usuário; ele precisa reconectar a conta) — https://torquecrm.sentry.io/issues/TORQUE-WEB-6
- TORQUE-WEB-1K: métrica "ganho_perda" não aceita o recorte "total" (automações) — https://torquecrm.sentry.io/issues/TORQUE-WEB-1K
- TORQUE-WEB-A: registro não encontrado em preferred_whatsapp_instance — https://torquecrm.sentry.io/issues/TORQUE-WEB-A

## Próximos passos sugeridos
1. Confirmar no banco de produção se `claim_conversation_summary_jobs` existe (item 1).
2. Perguntar quem mexeu em permissões (GRANT/REVOKE) há ~20–22h (item 2).
3. Rodar `/chamado-diagnosticar` nos itens 1–4 depois de abertos como Chamado.
