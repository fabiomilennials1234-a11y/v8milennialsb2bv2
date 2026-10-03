# Checagem de saúde — Sentry (2026-10-03, ~06:30 UTC)

Org `torquecrm` · projetos `torque-web`, `torque-edge`, `torque-qa`.
Escrito para qualquer pessoa do time (inclusive dev jr). Cada item = um possível **Chamado**.

## Resumo
- Incidentes ativos graves: **nenhum**. O sistema está de pé.
- 25 issues abertas nas últimas 24h, 288 erros no total. Pico às 12:00 UTC do dia 02 (62 erros), depois voltou ao normal.
- Resolvidas nas últimas 24h: **nenhuma**.
- Quase todos os erros pararam entre 9h e 17h antes desta checagem. **Exceção: TORQUE-EDGE-1, que continua acontecendo.**

## 1. Alta prioridade — ainda acontecendo
**Chamado A — TORQUE-EDGE-1: resumo de conversas não funciona** (229 eventos, última ocorrência 06:17 UTC)
- O que é: uma tarefa automática (`summarize-conversations-batch`) tenta "reservar" conversas para o Oráculo resumir. Ela falha ~6x por hora, toda hora, desde 01/10 16:07.
- Efeito: nenhum usuário reclamou (0 usuários), mas os resumos de conversa provavelmente não estão sendo gerados.
- Onde olhar: `supabase/functions/summarize-conversations-batch/index.ts:45` (função `claim`) e `_shared/oraculo/summary-batch.ts`.
- Link: https://torquecrm.sentry.io/issues/TORQUE-EDGE-1

## 2. Média prioridade — afetou usuários, já parou
**Chamado B — Banco lento / indisponível (pico das 12:00 UTC de 02/10)**
- TORQUE-WEB-W (12 usuários): banco respondeu "não consegui ler o schema, tentando de novo" (PGRST002) em /funil/propostas.
- TORQUE-WEB-3 (11 usuários, 20 eventos): consulta estourou o tempo limite em /dashboard.
- TORQUE-WEB-C (500 em /leads), TORQUE-WEB-1A e TORQUE-WEB-19 (tempo limite/lock em /funil/lista-fria-30d).
- Em palavras simples: por um período o banco ficou sobrecarregado ou reiniciando e as telas não carregaram. Hoje não repete. Vale checar o que rodou no banco nesse horário (migration? consulta pesada do dashboard?).
- Links: https://torquecrm.sentry.io/issues/TORQUE-WEB-W · /TORQUE-WEB-3 · /TORQUE-WEB-C

**Chamado C — "Permission denied" em várias tabelas** (poucos usuários, 1 cada)
- TORQUE-WEB-G, 15, 13, D, J, H, F, E: erro 42501 em `get_my_member_organization_ids`, `get_pipeline_page`, `leads`, `org_visible_members`, `lead_history`, `sale_events`, `deals`, `lead_custom_field_values`.
- Em palavras simples: o banco disse "você não tem permissão" para um usuário ao abrir /funil/whatsapp e /auth. Todos entre 16h–11h antes da checagem; parece uma única janela em que as permissões (GRANT/RLS) estavam incompletas, provavelmente por uma migration. Não repetiu.
- Links: https://torquecrm.sentry.io/issues/TORQUE-WEB-G (e demais IDs acima)

## 3. Baixa prioridade — bugs pontuais de código
**Chamado D — Tabela/relação não encontrada (Seer: "medium")**
- TORQUE-WEB-Q: tabela `org_onboarding` não existe no schema (/tv). Provável migration não aplicada.
- TORQUE-WEB-N: consulta ambígua entre `pipeline_stages` e `pipelines` (/master/stage-roles).
- TORQUE-WEB-M: relação inexistente em `whatsapp_health_checks` (/master/whatsapp-health).
- Links: https://torquecrm.sentry.io/issues/TORQUE-WEB-Q · /TORQUE-WEB-N · /TORQUE-WEB-M

**Chamado E — WhatsApp (Uazapi) e login**
- TORQUE-WEB-18: provedor Uazapi devolveu 503 (fora do ar, não é bug nosso). TORQUE-WEB-T: token inválido. TORQUE-WEB-Z / TORQUE-WEB-12: falha no envio de mensagem.
- TORQUE-WEB-10 / TORQUE-WEB-Y: sessão expirada (JWT) — normal quando o usuário fica muito tempo parado.
- TORQUE-EDGE-3: ao checar o plano da org, a resposta veio como página HTML (provável erro de infraestrutura no mesmo horário do Chamado B).
- TORQUE-WEB-6: falha ao renovar token do Google Calendar.

## Performance
Sem dados de latência fora dos timeouts acima. Único anômalo: pico de erros às 12:00 UTC (62 vs. média de ~6/h).

## Observação
O Chamado A tem erro constante de base (~6/h) — é o que mantém o Sentry "barulhento". Corrigir ele deixa o painel limpo.
