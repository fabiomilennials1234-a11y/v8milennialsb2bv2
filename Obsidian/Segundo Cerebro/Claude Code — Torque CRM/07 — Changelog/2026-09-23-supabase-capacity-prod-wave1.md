---
type: changelog
title: Supabase Pro — primeira ativação econômica em produção
status: active
created: 2026-09-23
updated: 2026-09-23
tags: [supabase, capacity, cron, workflows, prod]
owner: gabriel
---

# Primeira ativação econômica em produção

> Correção em 2026-09-24: item 3 abaixo registrou conclusão incorreta sobre
> frontend. Existe webhook independente GitHub → EasyPanel, ativo e com resposta
> 200; imagem da VPS foi reconstruída em 2026-09-24T03:03:37Z. Falha do workflow
> GHCR não prova ausência de deploy. Ver `docs/operations/supabase-capacity-wave2-rollout.md`.

CTO pediu continuidade após entrega e merge dos PRs 2162/2163: “show, pode seguir então”, perguntando sobre ativação. Primeira leva aplicada em produção `jsjsmuncfkbsbzqzqhfq` em **2026-09-23 às 21h03 America/Sao_Paulo** (2026-09-24 00:03 UTC). Escopo: guardas de 12 cron invokers e admissão de workflow de etapa. Nenhuma troca de rota WhatsApp, flag de grupos ou serviço externo foi ativada.

## Migrations aplicadas

| Arquivo | Versão remota | SHA-256 do arquivo fonte |
| --- | --- | --- |
| `20271021000026_cron_skip_idle_dispatch.sql` | `20260924000328` | `744c3e265d8373eeb1957a827a50da996fc1bade08048ca071fee08ae14fe7a5` |
| `20271021000027_cron_skip_idle_campaigns.sql` | `20260924000331` | `7a4bd778f61633e16324b883b2becd17dabac528cbe17033055b30ba72523b9f` |
| `20271021000030_workflow_stage_http_admission.sql` | `20260924000334` | `1b893356b53d00a5a7bd9abeffb0fcde758a20ec16df1e480a1909618fd9fa5a` |

Versões remotas diferem dos prefixos locais fictícios 2027. Conferir **nome e conteúdo**, não reaplicar porque a versão local não aparece no ledger. A chamada incluiu timeout de bloqueio/statement e assertion de hash do corpo anterior antes do SQL original. Migration 30 define seu próprio timeout 5s/30s. Não executar db push indiscriminado da cadeia inteira.

## Verificação

- Pré-apply: 13 corpos de funções idênticos aos rollbacks usados nos testes; nenhum drift encontrado. Tabelas dos dois índices: scheduled_pipe_messages 376 kB (~506 linhas), oraculo_feedback_alerts 32 kB.
- Pós-apply: 13/13 hashes dos corpos correspondem ao código aprovado; 12 invokers negam EXECUTE a anon/authenticated e permitem service_role.
- Agendas dos 12 crons permaneceram ativas com cadência original. Primeira observação: 11 já executados com sucesso, zero falhas; replay DLQ de 5min ainda aguardava o próximo tick. Sucesso do cron não prova conclusão de cada tarefa nem redução de faturamento.
- Rollbacks pareados estão em `supabase/migrations/rollback/`; já validados em fixtures e preview. Nenhum invoker foi chamado manualmente para testar; somente ticks normais.

## Próximas etapas

1. Observar chamadas, idade de filas e erros nas próximas janelas; reconciliar Usage antes de declarar economia. Meta 1,4M ainda não alcançada/comprovada.
2. Edge ainda pendente: process-workflow-executions, attach-to-org-by-pending-invite, whatsapp-webhook; depois SQL 28 antes de whatsapp-api-proxy/rebind. Preservar verify_jwt live: attach=true; demais quatro=false com autenticação interna.
3. Frontend: merge **não publica automaticamente**. Workflow docker-image só gera imagem e exige redeploy manual no EasyPanel. Builds dos commits 2162/2163 falharam antes de iniciar por bloqueio de faturamento/limite do GitHub. Não redeployar latest assumindo conter estas mudanças.
4. Filtro de grupos OFF até writers coordenados, drenagem antiga, enrollment e confirmação por organização.
5. SQL 29/serviço de ingresso OFF até capacidade no VPS, contrato Uazapi (rotas/retry/202), crash recovery e latência comercial passarem. Falta definir instância/número de homologação controlados. Começar somente messages_update numa instância; expandir conforme evidência, sem data global prometida.

Não confundir esta ativação inicial com deslocamento completo do webhook para fora da Edge. Cálculos e limites permanecem em `.specs/supabase-capacity-phase2-plan.md`.
