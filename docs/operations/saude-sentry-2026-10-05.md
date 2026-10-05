# Saúde do sistema (Sentry) — 2026-10-05

Fonte: https://torquecrm.sentry.io (projetos torque-web, torque-edge, torque-qa). Janela: últimas 24h.
Resolvidos nas últimas 24h: nenhum. Todas as 25 issues abaixo seguem abertas e nasceram nas últimas 23h (primeira checagem, sem base anterior para comparar).

> Os Chamados abaixo estão prontos para colar no sistema. A ferramenta de criar Chamados (torque-mcp) não estava disponível nesta execução, então não foram abertos automaticamente.

## CHAMADO 1 — Banco de dados lento/indisponível (prioridade ALTA)
**O que aconteceu, em simples:** o banco de dados às vezes "engasga". Quando uma consulta demora demais, ele a cancela (erro `57014 statement timeout`). Em outros momentos ele fica sem conseguir ler o "mapa" das tabelas (`PGRST002 schema cache`) e responde que está indisponível. Para o usuário: telas que ficam em branco, carregando para sempre ou com erro.
**Quem foi afetado:** ~15 usuários só no erro principal.
**Onde aparece:** /metricas, /leads, /chat-whatsapp, /funil, /tv, /dashboard.
**Issues:** [WEB-W](https://torquecrm.sentry.io/issues/TORQUE-WEB-W) (27 eventos, 15 usuários) · [WEB-C](https://torquecrm.sentry.io/issues/TORQUE-WEB-C) · [WEB-3](https://torquecrm.sentry.io/issues/TORQUE-WEB-3) · [WEB-1A](https://torquecrm.sentry.io/issues/TORQUE-WEB-1A) · [WEB-1X](https://torquecrm.sentry.io/issues/TORQUE-WEB-1X) · [WEB-1W](https://torquecrm.sentry.io/issues/TORQUE-WEB-1W) · [WEB-20](https://torquecrm.sentry.io/issues/TORQUE-WEB-20) · [WEB-1T](https://torquecrm.sentry.io/issues/TORQUE-WEB-1T) · [EDGE-6](https://torquecrm.sentry.io/issues/TORQUE-EDGE-6)
**Por onde começar:** ver consultas lentas (`lead-history-compact`, `team-response-time`, `search-messages`, `leads-count`) e carga do banco (CPU/conexões) nas últimas horas.

## CHAMADO 2 — WhatsApp: mensagens não enviam / token inválido (prioridade ALTA)
**O que aconteceu, em simples:** o sistema usa um "intermediário" (`whatsapp-api-proxy`) para falar com o WhatsApp. Ele está respondendo "token inválido", "proibido", "erro 503" e "falha ao chamar a função". Resultado: usuário clica em enviar e aparece "Falha no envio".
**Quem foi afetado:** 7 usuários no envio, 6 no token inválido.
**Issues:** [WEB-Z](https://torquecrm.sentry.io/issues/TORQUE-WEB-Z) (17 eventos, ativo há 7 min) · [WEB-T](https://torquecrm.sentry.io/issues/TORQUE-WEB-T) · [WEB-1Q](https://torquecrm.sentry.io/issues/TORQUE-WEB-1Q) · [WEB-1P](https://torquecrm.sentry.io/issues/TORQUE-WEB-1P) · [WEB-18](https://torquecrm.sentry.io/issues/TORQUE-WEB-18) (Uazapi 503) · [WEB-1V](https://torquecrm.sentry.io/issues/TORQUE-WEB-1V) · [WEB-1Z](https://torquecrm.sentry.io/issues/TORQUE-WEB-1Z) (upload) · [WEB-1S](https://torquecrm.sentry.io/issues/TORQUE-WEB-1S)
**Por onde começar:** conferir se o token da Uazapi/instâncias expirou ou mudou e o status da Uazapi.

## CHAMADO 3 — Resumo automático de conversas falhando (prioridade MÉDIA)
**O que aconteceu, em simples:** um processo de fundo que resume conversas tenta "reservar" um lote de conversas e falha, de novo e de novo (141 vezes em 23h, a última há 6 min). Nenhum usuário viu erro na tela, mas o resumo não está sendo gerado.
**Issue:** [EDGE-1](https://torquecrm.sentry.io/issues/TORQUE-EDGE-1) · função `summarize-conversations-batch`.

## CHAMADO 4 — Sessão expirada / sem permissão (prioridade MÉDIA)
**O que aconteceu, em simples:** o "crachá" de login (JWT) venceu, e a tela pede permissões com ele vencido. O sistema responde "não autorizado". Um caso é de usuário que não pertence à organização. Em geral basta fazer login de novo, mas o app deveria renovar o crachá sozinho.
**Issues:** [WEB-Y](https://torquecrm.sentry.io/issues/TORQUE-WEB-Y) · [WEB-10](https://torquecrm.sentry.io/issues/TORQUE-WEB-10) · [WEB-1Y](https://torquecrm.sentry.io/issues/TORQUE-WEB-1Y) · [WEB-G](https://torquecrm.sentry.io/issues/TORQUE-WEB-G) (permissão negada na função `get_my_member_organization_ids`)

## CHAMADO 5 — Defeitos de código/banco pontuais (prioridade BAIXA)
**O que aconteceu, em simples:** pedidos que o código faz de forma errada, afetando 1 usuário cada:
- [WEB-Q](https://torquecrm.sentry.io/issues/TORQUE-WEB-Q): a tabela `org_onboarding` não existe no banco (migration não aplicada?) — tela /tv.
- [WEB-B](https://torquecrm.sentry.io/issues/TORQUE-WEB-B): `upsell_orders` e `team_members` têm mais de uma relação; é preciso dizer qual usar — tela /upsell.
- [WEB-A](https://torquecrm.sentry.io/issues/TORQUE-WEB-A): busca de tipo da organização espera 1 resultado e achou 0 — /dashboard.
