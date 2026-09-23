---
type: changelog
title: Supabase Pro — redução de admissões e ingresso durável de atualizações
status: active
created: 2026-09-23
updated: 2026-09-23
tags: [supabase, capacity, whatsapp, workflows]
owner: gabriel
---

# Supabase Pro — fase 2

## Objetivo e orçamento

CTO autorizou execução em paralelo e merge via PR. Meta operacional: 1,4 milhão
de invocações por ciclo, 70% da franquia de 2 milhões. Não representa limite de
linhas do banco. Histórico CRM: 584.535 chamadas em sete dias, projeção 2.588.655
em 31 dias. Webhook representa 1.399.672 dessa projeção. Zero entradas Edge foram
contadas no wallet nas mesmas janelas; reconciliar com Usage da organização.

Plano e dados: `.specs/supabase-capacity-phase2-plan.md`,
`docs/operations/supabase-capacity-*-2026-09-23.json`.

## Implementação

- Frontend compartilha leituras simultâneas de status/limites por sessão,
  organização e instância. Sem mudar polling ou cache de resultado concluído.
- Migration 28: política remota de grupos, enrollment por organização, lease
  sem retomada automática, confirmação exata do fornecedor e provisionamento
  incerto preservado. Padrão OFF; publicar SQL antes de proxy/rebind.
- Núcleo webhook compartilhado; recibos não regridem leitura/entrega, reação
  legada usa CAS e duplicatas podem recuperar efeito comercial interrompido.
- Migration 29: inbox privado de atualizações, processamento local, FIFO por
  instância, retries, leases, limite de armazenamento e retenção delimitada.
  Serviço OFF, allowlist explícita, primeira rota apenas `messages_update`.
- Migration 30: guarda anterior ao HTTP de mudança de etapa. Preserva candidatos
  ativos `stage_changed`, `deal_won` e `deal_lost` da organização.
- Copilot não teve debounce alterado: eliminar despertares isoladamente perde
  o processamento da última mensagem da janela. Investigação documentada em
  `docs/operations/supabase-capacity-copilot-admission.md`.

## Limites e operação

Nenhum deploy Edge/SQL, roteamento Uazapi ou ativação de filtro foi realizado
nesta fase. Merge de código não prova publicação do backend. Também não prova
que a projeção caiu: medir após ativação e reconciliar franquias separadas.

Somente atualizações fora da Edge + hipótese de 80% dos crons evitados ainda
projeta 1.585.943/ciclo. Ingresso completo seria 824.721 nessa hipótese, porém
não está habilitado pelo serviço inicial. Não contabilizar filtro e migração
duas vezes. Não atribuir economia numérica ao frontend/workflow sem medição.

Antes de canary: contrato de múltiplos webhooks e retry/202 do fornecedor,
capacidade e latência no VPS, reinício/falhas, rollback de rota e ausência de
dois donos dos efeitos. Picos observados: 45/s e 317/min; testar no mínimo dobro.
Fila preserva `accepted_at` conservador de verificação de todos os chunks da
proposta; não retrodatar a partir de callback antigo. Latência comercial pode
exigir reconfirmação: validar ou excluir organizações com envio de orçamento
ativo antes da primeira ativação.

Runbooks: `docs/operations/uazapi-group-source-filter.md`,
`services/whatsapp-ingress/README.md`. Rollbacks preservam estado incerto e
trabalho pendente. Preview temporária deve ser excluída e ausência confirmada.

## Evidência de validação

246 testes direcionados passaram. Três harnesses SQL passaram em preview
Supabase isolada; schemas revertidos e preview excluída, ausência confirmada.
Detalhes e limitações: `docs/operations/supabase-capacity-phase2-validation.md`.
Suite global mantém dívida anterior reproduzida na base; não foi declarada verde.
