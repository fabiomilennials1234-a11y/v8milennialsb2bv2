# Chamados — Verificação de saúde do Sentry (2026-10-03)

Fonte: Sentry, org `torquecrm` (projetos `torque-web`, `torque-edge`, `torque-qa`), janela de 24h.
Painel: https://torquecrm.sentry.io/issues/?query=is%3Aunresolved

> Escrito para qualquer pessoa do time entender, inclusive dev jr.
> Os Chamados abaixo ainda **não foram criados em `support_tickets`**: a rotina automática não tem acesso ao banco nem ao torque-mcp.
> Quem for operar: abra cada um no Master → Suporte, ou rode `/chamado-diagnosticar`.

## Resumo rápido

- 45 problemas abertos nas últimas 24h, 288 erros no total. Nenhum resolvido no período.
- Não há queda geral do sistema. Há **2 problemas ativos** e **1 problema que parece ter acabado** (veja o Chamado 2).
- Os erros de ontem se concentraram entre 11h e 13h UTC (pico de 62 erros às 12h UTC, 09h em Brasília).
- Desde as 21h UTC de ontem, o único erro que continua aparecendo é 1 a cada 10 minutos (Chamado 1).

---

## Chamado 1 — 🔴 ALTA — O resumo automático de conversas está falhando toda vez

- **Onde:** `torque-edge`, função `summarize-conversations-batch`
- **Link:** https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
- **Quantos:** 247 erros desde 01/10 16:07 UTC. Último erro: hoje 09:17 UTC. Ainda acontecendo.
- **O que aconteceu, em palavras simples:**
  De 10 em 10 minutos o sistema tenta "reservar" conversas para a IA resumir. Essa reserva é feita chamando uma função do banco chamada `claim_conversation_summary_jobs`. A chamada dá erro, então nenhuma conversa é resumida. Hoje nenhum usuário reclamou (0 usuários afetados), mas os resumos das conversas estão parados desde 01/10.
- **Por que parece acontecer:** o código joga fora a mensagem de erro real do banco (`index.ts:42`) e só escreve "Falha ao reservar". Por isso o Sentry não diz o motivo. A função do banco foi criada na migration `20271019150000_oraculo_conversas_legiveis.sql`. Suspeitas: função sem permissão para o `service_role` (mesmo tipo de problema do Chamado 2) ou função com erro interno.
- **O que fazer:**
  1. No código, incluir `error.message` no erro (sem dados de cliente), para o Sentry mostrar a causa.
  2. Conferir no banco se `claim_conversation_summary_jobs` existe e se o `service_role` tem `EXECUTE`.
- **Urgência:** não bloqueia ninguém, mas some uma funcionalidade e gera ruído no Sentry. Resolver hoje.

## Chamado 2 — 🟠 MÉDIA — Telas deram "permissão negada" para alguns usuários (parece resolvido)

- **Onde:** `torque-web` (muitas telas: `/auth`, `/funil/whatsapp`, `/leads`, `/funil/propostas`)
- **Links (exemplos):**
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-G (função `get_my_member_organization_ids`)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-13 (tabela `leads`)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-15 (função `get_pipeline_page`)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-K (nova linha em `leads` barrada)
  - Há mais ~20 do mesmo tipo: `TORQUE-WEB-D, E, F, H, J, 14, 16, 17, 1B a 1J`.
- **O que aconteceu, em palavras simples:**
  O banco de dados tem "porteiros" (permissões) que decidem quem pode ler cada tabela e usar cada função. Em algum momento de ontem (entre ~11h e 19h UTC), esses porteiros barraram usuários logados em tabelas e funções básicas do CRM (leads, negócios, conversas, planos). Para o usuário, é uma tela que não carrega ou carrega vazia.
- **Está acontecendo agora?** Não. O último erro é de 14h a 16h antes desta verificação, então as permissões provavelmente foram corrigidas. **Não está confirmado**: é preciso conferir.
- **O que fazer:**
  1. Confirmar com o time se houve migration ou mudança de permissão ontem (ex.: `REVOKE`/`GRANT`, RLS) e se alguém já corrigiu.
  2. Se foi corrigido, marcar os problemas como resolvidos no Sentry. Se não, é prioridade máxima, pois afeta o núcleo do CRM.
  3. Avisar os 1 a 2 usuários afetados que o problema passou.

## Chamado 3 — 🟠 MÉDIA — Banco lento e fora do ar por instantes ontem de manhã

- **Onde:** `torque-web` (`/dashboard`, `/leads`, `/funil/propostas`, `/funil/lista-fria-30d`, chat de WhatsApp)
- **Links:**
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-3 (consulta cancelada por demorar demais, 11 usuários, 20 vezes)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-W (banco indisponível por instantes, 12 usuários)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-C (erro 500 em `/leads`, 23 vezes)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-1A e https://torquecrm.sentry.io/issues/TORQUE-WEB-19 (lista fria: demora e trava)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-R (upload no chat: banco demorou)
- **O que aconteceu, em palavras simples:**
  Ontem por volta de 12h UTC o banco ficou sobrecarregado ou reiniciou o cache interno (`PGRST002`). Telas pesadas, como o painel e a lista de leads, não conseguiram carregar a tempo. Foi o pico do dia (62 erros em 1 hora) e afetou até 12 pessoas.
- **Está acontecendo agora?** Não. O último erro foi há 12 horas ou mais.
- **O que fazer:** olhar no painel do Supabase o uso de CPU e conexões por volta de 12h UTC de ontem. Se a consulta `comando` do dashboard continuar lenta, revisar índices. Ficar de olho se voltar.

## Chamado 4 — 🟡 BAIXA — Tela mestre com erro de configuração do banco

- **Onde:** `torque-web`, telas de Master
- **Links:**
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-Q (tabela `org_onboarding` não encontrada, 3 usuários, tela `/tv`)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-N (consulta ambígua entre `pipeline_stages` e `pipelines`)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-M (relação `whatsapp_health_checks` → `organization_id` não existe)
- **O que aconteceu, em palavras simples:**
  O código pede ao banco algo que o banco não sabe responder: uma tabela que não aparece para o sistema, e duas consultas que juntam tabelas do jeito errado. É erro de código ou de migration que não chegou à produção.
- **O que fazer:** conferir se a migration de `org_onboarding` foi aplicada em produção. Corrigir as duas consultas dos painéis master (`master-stage-role-suggestions` e `whatsapp-health-checks`), dizendo explicitamente qual relação usar.

## Chamado 5 — 🟡 BAIXA — WhatsApp e login com falhas pontuais

- **Onde:** `torque-web` e `torque-edge`
- **Links:**
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-18 (Uazapi, o serviço de WhatsApp, respondeu erro 503)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-T e https://torquecrm.sentry.io/issues/TORQUE-WEB-12 e https://torquecrm.sentry.io/issues/TORQUE-WEB-Z (token inválido e falha no envio)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-10, TORQUE-WEB-Y, TORQUE-WEB-11 (sessão de login expirada)
  - https://torquecrm.sentry.io/issues/TORQUE-WEB-6 (falha ao renovar o token do Google Calendar)
  - https://torquecrm.sentry.io/issues/TORQUE-EDGE-3 (plano da org não pôde ser lido: recebeu uma página HTML em vez de dados)
- **O que aconteceu, em palavras simples:**
  Foram poucas ocorrências (1 a 3 cada), todas ontem. A maioria vem de serviço de fora (Uazapi, Google) que falhou por um momento, ou de sessão de login que expirou. O mais estranho é o `TORQUE-EDGE-3`: a resposta veio como página HTML, o que costuma indicar erro de infraestrutura do Supabase naquele minuto.
- **O que fazer:** nada urgente. Se algum cliente reclamar de envio de WhatsApp de ontem, estas são as pistas.

## Chamado 6 — ⚪ INFO — Métrica de automação com combinação inválida

- **Onde:** `torque-web`, `/automacoes`
- **Link:** https://torquecrm.sentry.io/issues/TORQUE-WEB-1K
- **O que aconteceu, em palavras simples:** alguém montou uma métrica de automação com uma combinação que o sistema não aceita ("recorte total" com a medida "ganho_perda"). Foi 1 vez e 1 usuário. Provavelmente falta uma validação na tela que impeça essa escolha.

---

## Resumo por gravidade

| # | Gravidade | Situação agora | Serviço |
|---|---|---|---|
| 1 | 🔴 Alta | **Ativo** (a cada 10 min) | Resumo de conversas (`torque-edge`) |
| 2 | 🟠 Média | Parou há ~14h, não confirmado | Permissões do banco (`torque-web`) |
| 3 | 🟠 Média | Parou há ~12h | Lentidão do banco (`torque-web`) |
| 4 | 🟡 Baixa | Só aparece quando alguém abre a tela | Painéis Master |
| 5 | 🟡 Baixa | Pontual | WhatsApp, login, Google |
| 6 | ⚪ Info | 1 ocorrência | Automações |

## Itens resolvidos desde a última verificação

Nenhum. Nada foi marcado como resolvido no Sentry nas últimas 24h.
