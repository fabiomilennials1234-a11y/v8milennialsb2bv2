---
type: changelog
title: Chiquê Distribuidora — correção delimitada de reinscrição
status: active
created: 2026-09-23
updated: 2026-09-23
tags: [workflows, supabase, prod, incident]
owner: gabriel
---

# Chiquê Distribuidora — reinscrição em workflows

## Causa e escopo

`guard_workflow_reenrollment` retornava `NULL` no `BEFORE INSERT` de
`workflow_executions` quando o contato já tinha participado, mesmo com a
reinscrição habilitada: `re_enrollment_max_times = 1` e cooldown de 30 dias
continuavam vigentes. Em Agafarma, 55 participantes históricos estavam nessa
situação; cinco cartões passaram à etapa de automação em 2026-09-23 sem criar
nova execução. A migration geral `20271021000022_unlimited_workflow_reenrollment.sql`
estava no repositório, mas não no ledger de produção. O apply geral foi
bloqueado por impacto em todas as organizações e **não foi executado**.

Foram aplicadas duas migrations com exceção apenas para os IDs dos workflows
Agafarma e R. mercos da Chiquê. A guarda de execução ainda ativa e a opção
`re_enrollment_enabled` continuam obrigatórias. Nenhuma outra organização ou
workflow mudou de comportamento. Não houve backfill automático.

## Deploy de produção

Autorização: solicitação explícita do usuário na sessão para testar e implantar
em produção; ativação de R. mercos autorizada separadamente após revisão da
mídia. Supabase CLI instalado como devDependency, versão 2.117.0. O Docker
local não iniciou; testes transacionais com rollback foram executados no banco
de produção sem envio de mensagens.

| Arquivo local | Versão no ledger remoto | SHA-256 |
| --- | --- | --- |
| `20271021000024_chique_agafarma_reenrollment_guard.sql` | `20260923141736` | `7FEE63A39138AE7EDF1BECD300FAE3D5CF67298EB17D5E4660372EDC370330C9` |
| `20271021000025_chique_r_mercos_reenrollment_guard.sql` | `20260923142534` | `938DA24CEC788CA4BD1B6E41070AE74D982440FA760146BA05881343823C5105` |

O descompasso entre prefixo local (`2027`) e versão gravada pelo conector
(`2026`) é drift de ledger conhecido; comparar pelo **nome**, não reaplicar.

## Validação e rollback

- Baseline da função antes do primeiro apply: MD5 `a2b82cd66d895739c1b09fb77b21c79a`.
- Rollback da primeira alteração executado e desfeito antes do apply; hash
  original confirmado. Arquivo: `supabase/migrations/rollback/20271021000024_chique_agafarma_reenrollment_guard.sql`.
- Após o primeiro apply, hash `1d75bd3b66ae46e4664477f8c8123259`;
  rollback da segunda alteração também executado e desfeito antes do apply.
  Arquivo: `supabase/migrations/rollback/20271021000025_chique_r_mercos_reenrollment_guard.sql`.
- Antes e depois de cada apply, inserts de teste com status `cancelled` em
  transação validaram aceitação dos workflows autorizados e rejeição de
  duplicatas em execução. Cada transação foi revertida; contagens finais
  permaneceram 55 (Agafarma) e 249 (R. mercos).
- Hash da função após ambos os applies: `c26a84ec713f4e5631c8ab941005ec14`.
- O objeto de imagem atual de R. mercos existe em bucket público, responde
  HTTP 200 como JPEG (368.430 bytes). Os 35 erros históricos HTTP 400 ocorreram
  antes de sua publicação em 2026-09-02 16:56 UTC. Depois dela, o nó teve 31
  execuções bem-sucedidas e duas falhas não relacionadas ao HTTP 400.
- `re_enrollment_enabled` de R. mercos confirmado `true` após o deploy.

## Limites e acompanhamento

Ainda não ocorreu novo movimento real de etapa em Agafarma ou R. mercos após
os applies; o teste do caminho completo até o provedor depende desse evento
ou de replay explicitamente autorizado. Não retentar em massa as 43 falhas
históricas de Agafarma ou as 132 de R. mercos: há casos sem telefone, sem
valor de venda, limite de envio, destinatário inválido e falhas do provedor.
Os demais workflows ativos têm causas próprias (janela de 24h da Meta sem
template de escape, número fixo removido, funil alvo ausente). Tratar
separadamente; a correção da guarda não resolve essas falhas.
