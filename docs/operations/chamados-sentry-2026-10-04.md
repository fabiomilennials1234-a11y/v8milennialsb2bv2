# Chamados sugeridos – Health check Sentry (2026-10-04)

Organização Sentry: torquecrm (projetos: torque-edge, torque-web, torque-qa).
Nenhuma ferramenta de escrita de Chamados (torque-mcp) estava disponível nesta execução,
então os textos abaixo estão prontos para serem abertos como Chamados.

## Resumo
- Incidente ativo: 1 (recorrente, baixo impacto direto no usuário)
- Issues novas nas últimas 24h: 0
- Resolvidas nas últimas 24h: 0
- Volume de erros: estável, ~6 por hora nas últimas 24h (sem pico)

---

## CHAMADO 1 — [Média] Resumo automático de conversas falha toda vez
Link: https://torquecrm.sentry.io/issues/TORQUE-EDGE-1
Serviço: edge function `summarize-conversations-batch` (torque-edge, produção)

**O que aconteceu (em palavras simples)**
Existe uma rotina que roda sozinha a cada ~10 minutos para gerar resumos das conversas de WhatsApp.
O primeiro passo dela é "reservar" as conversas que precisam de resumo, chamando uma função do banco
(`claim_conversation_summary_jobs`). Essa reserva está dando erro desde 01/10 (385 vezes, a última às 08:17 UTC de hoje).
Como o erro acontece logo no começo, **nenhum resumo está sendo gerado**. Nenhum usuário viu tela de erro (0 usuários afetados),
mas funcionalidades que dependem do resumo (Oráculo) podem estar desatualizadas.

**O que ainda não sabemos**
O código esconde a causa real: `supabase/functions/summarize-conversations-batch/index.ts:42` joga uma mensagem genérica
e descarta o erro devolvido pelo banco. Hipóteses (não confirmadas): a função do banco não existe/mudou
na migration `20271019150000_oraculo_conversas_legiveis.sql`, falta permissão (GRANT) para a service role, ou ela está demorando demais.

**Próximos passos sugeridos**
1. Incluir `error.message` e `error.code` no erro (ou no log) em `index.ts:42` e fazer deploy.
2. Rodar `select * from claim_conversation_summary_jobs(1)` no banco para ver o erro real.
3. Confirmar que a migration acima foi aplicada em produção e que os GRANTs existem.

---

## CHAMADO 2 — [Baixa] Instabilidade do banco/API em 02–03/10 (sem repetição hoje)
Links: TORQUE-WEB-3, TORQUE-WEB-C, TORQUE-WEB-W, TORQUE-WEB-1A, TORQUE-WEB-19, TORQUE-EDGE-3
(https://torquecrm.sentry.io/issues/TORQUE-WEB-W)

**O que aconteceu (em palavras simples)**
Em alguns momentos o banco ficou lento ou indisponível: consultas canceladas por demorar demais (timeout),
"PGRST002" (a API do banco não conseguiu recarregar o esquema) e erros 500. Afetou Dashboard, Leads e Funil
(até 13 usuários). Última ocorrência há ~1 dia; não voltou a acontecer. Ficar de olho; se repetir, investigar a query
`comando` do /dashboard (mais lenta) e as mutações de `lista-fria-30d` (lock timeout).

---

## CHAMADO 3 — [Baixa] Erros de permissão no banco (42501) após ajuste de acessos
Links: TORQUE-WEB-G, TORQUE-WEB-15, TORQUE-WEB-13, TORQUE-WEB-D; tabela ausente: TORQUE-WEB-Q (`public.org_onboarding`)

**O que aconteceu (em palavras simples)**
Alguns usuários receberam "permission denied" (o banco negou acesso) em funções/tabelas como `get_pipeline_page`,
`leads`, `org_visible_members`, e uma tela (/tv) pediu uma tabela que o banco não encontrou (`org_onboarding`).
Parece ligado a migrations/GRANTs aplicados em momentos diferentes. Cada caso afetou 1–3 usuários e não repetiu há ~1 dia.
Verificar se todas as migrations estão aplicadas e se os GRANTs estão corretos.

---

## CHAMADO 4 — [Baixa] Integrações externas com falha pontual
- TORQUE-WEB-18 / TORQUE-WEB-Z / TORQUE-WEB-12: envio WhatsApp (Uazapi respondeu 503).
- TORQUE-WEB-6: renovação do token do Google Calendar falhou (a conexão do cliente precisa ser refeita).
- TORQUE-WEB-1K, TORQUE-WEB-9, TORQUE-WEB-4: erros de validação no front (métrica "ganho_perda" com recorte incompatível; id `"undefined"` enviado como uuid).
Impacto pequeno (1–3 usuários); tratar como melhorias de tratamento de erro.
