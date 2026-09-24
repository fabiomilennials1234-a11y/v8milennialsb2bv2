---
type: changelog
title: Supabase Pro — sondagem segura e redução de chamadas ociosas
status: active
created: 2026-09-24
updated: 2026-09-24
tags: [supabase, capacity, cron, analytics]
owner: gabriel
---

# Segunda etapa de otimização

Continuidade autorizada pelo CTO: implementar por etapas com testes, sem esperar
novo ciclo de medição. Meta 1,4M permanece projeção a confirmar.

## Produção

PR2165 mergeado. Migration31 aplicada como versão remota `20260924034604`;
seis hashes conferidos antes e depois, ACL service_role-only confirmada e seis
agendas ativas. Somadas às12guardas anteriores,18invokers evitam HTTP ocioso.

Publicados `process-workflow-executions` v169 (sondagem sem executar tarefas) e
`attach-to-org-by-pending-invite` v90 (envelope correto do usuário autenticado).
Dez testes direcionados passaram. Sondagem real autenticada 200/healthy;
chamadas sem autenticação 401. Dependências e verify_jwt publicados preservados.

## Código

Coach IA da TV passa a reutilizar análise por usuário/organização durante cinco
minutos, inclusive entre rotações. Dados atualizados entram na próxima consulta;
falhas respeitam intervalo, com nova tentativa manual disponível. Acesso requer
identidade e plano resolvidos. Sem mudança no contrato de análise.

Migration31 acrescenta guardas conservadoras a seis invokers: workflows por tempo,
outbound pendente vencido, automações de followup, Copilot followups, situações de
followup e Meta leadgen. Agendas e workers permanecem iguais; trabalho novo volta
a ser considerado no próximo tick. Não filtra o worker default de workflows,
que também executa recuperação. SQL e rollback têm testes PGlite.

## Correções de diagnóstico

Existe webhook automático GitHub → EasyPanel independente do workflow GHCR.
Erro de billing no GitHub não prova ausência de publicação frontend. Inspeção
read-only confirmou hook ativo/200 e imagem reconstruída em 2026-09-24T03:03:37Z.

Teste WhatsApp anterior foi self-chat, não valida entrada externa. Novo ingresso
e filtro de grupos continuam desligados. Otimizações atuais não dependem desse
teste nem alteram rota do provedor.

Evidência e estado de ativação: `docs/operations/supabase-capacity-wave2-rollout.md`.
