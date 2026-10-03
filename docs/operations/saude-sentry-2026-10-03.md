# Saúde do sistema (Sentry) — 2026-10-03

Projeto Sentry: `torquecrm` (torque-web, torque-edge, torque-qa). Janela: últimas 24h.
Resumo: **1 problema ativo agora, 1 incidente de banco que parece ter passado, 0 itens resolvidos.**
Observação: o Chamado não pôde ser aberto automaticamente (a tool `torque-mcp` não está disponível nesta sessão). O texto abaixo está pronto para colar em um Chamado.

## 1. Ativo agora (prioridade alta)

**Resumo de conversas está falhando** — [TORQUE-EDGE-1](https://torquecrm.sentry.io/issues/TORQUE-EDGE-1)
- O que aconteceu, em simples: todo dia o sistema resume conversas em lote. O primeiro passo é "reservar" as conversas que vai resumir. Esse passo falha toda hora (143 vezes em 23h, último erro há poucos minutos). Enquanto isso, os resumos não são gerados.
- Onde: edge function `summarize-conversations-batch`, função `claim`.
- Impacto: nenhum usuário reclamou (0 usuários), mas é um erro contínuo, não passageiro.
- Causa: **hipótese**, ainda não investigada. Comece olhando a função/RPC que reserva as conversas e se ela sofreu o mesmo problema de permissão do item 2.

## 2. Incidente de banco ~12–15h atrás (parece ter parado, causa a confirmar)

Vários erros diferentes apareceram na mesma janela e quase todos pararam de 5h a 13h atrás.
- **Banco indisponível por um momento** — [TORQUE-WEB-W](https://torquecrm.sentry.io/issues/TORQUE-WEB-W): 12 usuários, `PGRST002` (a API do banco não conseguiu carregar o "schema cache"). Em simples: a API do banco reiniciou/ficou fora do ar por pouco tempo.
- **"Permissão negada" em tabelas e funções** (código 42501): [WEB-G](https://torquecrm.sentry.io/issues/TORQUE-WEB-G), [WEB-15](https://torquecrm.sentry.io/issues/TORQUE-WEB-15), [WEB-13](https://torquecrm.sentry.io/issues/TORQUE-WEB-13), [WEB-D](https://torquecrm.sentry.io/issues/TORQUE-WEB-D), [WEB-J](https://torquecrm.sentry.io/issues/TORQUE-WEB-J), [WEB-H](https://torquecrm.sentry.io/issues/TORQUE-WEB-H), [WEB-F](https://torquecrm.sentry.io/issues/TORQUE-WEB-F), [WEB-E](https://torquecrm.sentry.io/issues/TORQUE-WEB-E). Em simples: o usuário logado perdeu o direito de ler tabelas como `leads`, `deals`, `lead_history`. Costuma acontecer quando uma migration recria uma tabela/função e esquece os `GRANT`.
- **Tabela/relacionamento não encontrado** (schema cache): [WEB-Q](https://torquecrm.sentry.io/issues/TORQUE-WEB-Q) (`org_onboarding`), [WEB-N](https://torquecrm.sentry.io/issues/TORQUE-WEB-N) (relação duplicada `pipeline_stages`/`pipelines`), [WEB-M](https://torquecrm.sentry.io/issues/TORQUE-WEB-M) (`whatsapp_health_checks`). Em simples: o código pede algo que o banco não conhece. Pode ser migration não aplicada ou cache desatualizado.
- **Sessão expirada (JWT)**: [WEB-10](https://torquecrm.sentry.io/issues/TORQUE-WEB-10), [WEB-Y](https://torquecrm.sentry.io/issues/TORQUE-WEB-Y), [EDGE-3](https://torquecrm.sentry.io/issues/TORQUE-EDGE-3). Provavelmente consequência do banco fora do ar.
- Hipótese: uma migration/deploy de banco ~12–15h atrás. Confirmar cruzando o horário com as migrations aplicadas. Se os erros 42501 voltarem, trate como prioridade alta.

## 3. Lentidão (performance)

- **Dashboard lento** — [TORQUE-WEB-3](https://torquecrm.sentry.io/issues/TORQUE-WEB-3): 11 usuários, 20 vezes, `statement timeout` na consulta `comando`. Em simples: a consulta demorou demais e o banco cancelou. Último há 5h.
- **Estatísticas de leads com erro 500** — [TORQUE-WEB-C](https://torquecrm.sentry.io/issues/TORQUE-WEB-C): 2 usuários, 23 vezes, consulta `leads-stats` em `/leads`.
- **Lista fria 30d** — [WEB-1A](https://torquecrm.sentry.io/issues/TORQUE-WEB-1A) (timeout) e [WEB-19](https://torquecrm.sentry.io/issues/TORQUE-WEB-19) (lock timeout): 2 usuários. Em simples: uma ação em massa travou esperando outra terminar.

## 4. Integrações externas (menor prioridade)

- WhatsApp (Uazapi) fora do ar/token inválido: [WEB-18](https://torquecrm.sentry.io/issues/TORQUE-WEB-18) (503), [WEB-T](https://torquecrm.sentry.io/issues/TORQUE-WEB-T) (token inválido), [WEB-Z](https://torquecrm.sentry.io/issues/TORQUE-WEB-Z) (falha no envio), [WEB-12](https://torquecrm.sentry.io/issues/TORQUE-WEB-12). 2 usuários afetados. Pode ser instabilidade do provedor.
- Google Calendar: [WEB-6](https://torquecrm.sentry.io/issues/TORQUE-WEB-6) — falha ao renovar o token (1 usuário; o cliente precisa reconectar a agenda).

## 5. Resolvidos desde a última checagem

Nenhum.

Lista completa: https://torquecrm.sentry.io/issues/?query=is%3Aunresolved
