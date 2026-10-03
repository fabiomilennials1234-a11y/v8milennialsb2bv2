# Chamados — Verificação de saúde (Sentry) — 03/10/2026

Org Sentry: `torquecrm` · Janela: últimas 24h · Resolvidos no período: **nenhum**
Lacuna: não há transações/latência no Sentry (traces vazios), então "performance" só dá para ler pelos erros de timeout.

---

## CHAMADO 1 — ALTA — O resumo automático de conversas está falhando sem parar
- **Onde:** edge function `summarize-conversations-batch` · [TORQUE-EDGE-1](https://torquecrm.sentry.io/issues/TORQUE-EDGE-1)
- **Números:** 301 falhas desde 01/10 16:07 UTC, última às 18:17 UTC de hoje. Nenhum usuário reclamou (é tarefa de fundo).
- **Em linguagem simples:** de tempos em tempos o sistema roda um "robô" que pega conversas e gera um resumo. O primeiro passo do robô é "reservar" as conversas que vai resumir. Esse passo falha toda vez. Resultado: nenhum resumo novo é gerado e o robô tenta de novo, de novo, de novo.
- **Onde olhar no código:** `supabase/functions/summarize-conversations-batch/index.ts:45` chama a função de banco `claim_conversation_summary_jobs`. O código joga fora o erro real do banco e só mostra a frase genérica, por isso o Sentry não diz o motivo.
- **Hipótese (não confirmada):** a função do banco está com permissão negada, ou nem existe em produção (mesmo padrão dos Chamados 3 e 4).
- **Primeiro passo para o dev:** logar `error.message` e `error.code` antes do `throw`, e conferir no banco se `claim_conversation_summary_jobs` existe e se `service_role` tem EXECUTE.

## CHAMADO 2 — ALTA — Tabela `org_onboarding` não existe em produção (tela /tv)
- **Onde:** web, rota `/tv` · [TORQUE-WEB-Q](https://torquecrm.sentry.io/issues/TORQUE-WEB-Q)
- **Números:** 7 erros, 3 usuários, entre 02/10 12:33 e 20:40 UTC. Papel: admin. Org `36971ff5…`.
- **Em linguagem simples:** a tela pede ao banco os dados do "onboarding" da empresa, mas o banco responde "essa tabela não existe". É como pedir um arquivo numa pasta onde ele não foi guardado.
- **Pista:** `org_onboarding` aparece só na migration baseline e em migrations **arquivadas** (`supabase/migrations/archive/`). Provavelmente foi renomeada/removida e o código do front ainda usa o nome antigo (`src/modules/platform/hooks/useOnboarding.ts`).
- **Primeiro passo:** confirmar em produção se a tabela existe e qual é o nome atual; ajustar o front ou criar a migration que falta.

## CHAMADO 3 — MÉDIA — "Permissão negada" no banco, em vários pontos do login (/auth)
Quando o usuário entra, o app faz várias consultas ao banco e **12 delas foram recusadas** por falta de permissão (código 42501). Todas ocorreram em 23h atrás, em sequência, o que parece um único evento (por exemplo uma migration/deploy que tirou permissões), e não 12 problemas separados. Quase sem usuários afetados (0–1 por issue), então hoje o impacto é baixo, mas a lista de coisas afetadas é grande:

| Issue | O que foi negado |
|---|---|
| [TORQUE-WEB-G](https://torquecrm.sentry.io/issues/TORQUE-WEB-G) | função `get_my_member_organization_ids` (8 eventos, última 02/10 19:01 UTC) |
| [TORQUE-WEB-13](https://torquecrm.sentry.io/issues/TORQUE-WEB-13) | tabela `leads` |
| [TORQUE-WEB-1J](https://torquecrm.sentry.io/issues/TORQUE-WEB-1J) | tabela `conversations` |
| [TORQUE-WEB-1H](https://torquecrm.sentry.io/issues/TORQUE-WEB-1H) | função `org_get_features_and_limits` |
| [TORQUE-WEB-1G](https://torquecrm.sentry.io/issues/TORQUE-WEB-1G) | função `get_unread_total` |
| [TORQUE-WEB-1F](https://torquecrm.sentry.io/issues/TORQUE-WEB-1F) | tabela `messaging_channels` |
| [TORQUE-WEB-1E](https://torquecrm.sentry.io/issues/TORQUE-WEB-1E) | função `get_whatsapp_conversation_list_multi` |
| [TORQUE-WEB-1D](https://torquecrm.sentry.io/issues/TORQUE-WEB-1D) | tabela `subscription_plans` |
| [TORQUE-WEB-1C](https://torquecrm.sentry.io/issues/TORQUE-WEB-1C) | função `get_unread_counts` |
| [TORQUE-WEB-1B](https://torquecrm.sentry.io/issues/TORQUE-WEB-1B) | tabela `notification_preferences` |
| [TORQUE-WEB-D](https://torquecrm.sentry.io/issues/TORQUE-WEB-D) | view `org_visible_members` |
| [TORQUE-WEB-A](https://torquecrm.sentry.io/issues/TORQUE-WEB-A) | `preferred_whatsapp_instance` (PGRST116: esperava 1 linha, veio 0) |

- **Em linguagem simples:** o app tentou ler dados antes de o usuário estar totalmente logado (rota `/auth`) e o banco disse "você não pode". Se isso persistir depois do login, o usuário veria telas vazias ou contadores zerados.
- **Primeiro passo:** verificar se as consultas rodam como usuário *anônimo* (antes da sessão existir) — nesse caso é só ordem de carregamento no front; se rodam com sessão válida, é permissão (GRANT) faltando no banco.

## CHAMADO 4 — MÉDIA — Telas lentas ou fora do ar
- [TORQUE-WEB-3](https://torquecrm.sentry.io/issues/TORQUE-WEB-3): `/dashboard` (consulta `comando`) estourou o tempo limite do banco (57014). 2 usuários.
- [TORQUE-WEB-C](https://torquecrm.sentry.io/issues/TORQUE-WEB-C): `/leads` (`leads-stats`) recebeu erro 500 do servidor. 1 usuário.
- **Simples:** a consulta demorou demais e o banco desistiu; em outro caso o servidor devolveu "erro interno". Ambos ocorreram há ~21–23h e não se repetiram.
- **Primeiro passo:** olhar o plano da query `comando` e os logs do servidor no horário (02/10 ~19h–21h UTC).

## CHAMADO 5 — BAIXA — Casos isolados (1 ocorrência cada)
- [TORQUE-WEB-Z](https://torquecrm.sentry.io/issues/TORQUE-WEB-Z): WhatsApp "Falha no envio" — 2 usuários, última há 4h. **Este é o mais recente com cliente afetado, vale conferir primeiro.**
- [TORQUE-WEB-1K](https://torquecrm.sentry.io/issues/TORQUE-WEB-1K): Automações — a métrica "ganho/perda" não aceita o recorte "total". Erro de configuração da automação.
- [TORQUE-WEB-6](https://torquecrm.sentry.io/issues/TORQUE-WEB-6): Google Calendar — não conseguiu renovar o token (usuário precisa reconectar a conta Google).

---

## Resumo
| Gravidade | Qtd | Status |
|---|---|---|
| Alta | 2 chamados | abertos |
| Média | 2 chamados | abertos |
| Baixa | 3 issues | abertos |
| Resolvidos desde a última checagem | 0 | — |

Observação: não havia ferramenta para abrir os Chamados direto no sistema (o `torque-mcp` não está conectado nesta sessão). Este arquivo está pronto para ser copiado para os Chamados.
