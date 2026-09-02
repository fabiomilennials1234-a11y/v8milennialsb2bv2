---
type: changelog
title: "Agenda passa a ser da operação; ver só as suas vira permissão"
status: shipped
created: 2026-09-02
updated: 2026-09-02
tags: [changelog, agenda, permissoes, seguranca]
related: []
owner: gabriel
branch: feat/agenda-ver-de-todos
pr: pendente
---

# 2026-09-02 — Agenda de todos por permissão

## TL;DR

A tela Atividades mostrava a agenda da operação inteira só para admin; todo o resto via
apenas os próprios compromissos. Isso não era política de ninguém — era o cargo. Agora o
padrão é ver tudo, e o recorte "só os meus" é a permissão `agenda.view_all`, que nasce
LIGADA e um admin desliga por membro ou por org. De quebra, o recorte deixou de ser
filtro de tela e virou fronteira no banco.

## Tipo

`feature` + `security`

## Contexto

Pedido do CTO: "a agenda tem que mostrar todas as reuniões marcadas, para todos os
usuários; caso algum usuário não possa ver as reuniões dos outros, tem que ter uma
permissão de somente ver as marcadas por ele".

O levantamento mostrou duas coisas:

1. `get_agenda_events` sempre foi org-wide (o COMMENT dela diz isso desde a
   `20270907000020`). Quem recortava era `AgendaAtividades.tsx`, com
   `seesEveryone = identityReady && isAdmin`.
2. Como o recorte era só de tela, o compromisso do colega **atravessava a rede** e era
   descartado no navegador. Filtro de tela não é fronteira.

## O que mudou

- `feature_permissions` ganha `agenda.view_all` — módulo Agenda, `default_value = true`,
  `is_admin_only = false`, `sort_order = 15`. A tela de permissões por membro é
  dirigida pelo catálogo, então o toggle aparece sozinho.
- `get_agenda_events_scoped(uuid, timestamptz, timestamptz)` — compõe sobre
  `get_agenda_events` (não a substitui) e decide o escopo DENTRO do banco. Nenhum
  parâmetro de escopo viaja na requisição.
- `useAgendaEvents` passa a chamar a RPC com recorte, com queda para a base em `PGRST202`
  (janela entre deploy do front e apply da migration).
- `AgendaAtividades` troca `isAdmin` por `useCanDo("agenda.view_all")`, mantendo `isAdmin`
  como OR — ver a ressalva abaixo.

## As três portas do recorte

Quem está com a permissão desligada vê:

1. **o que é meu** — dono normalizado para `team_members.id`;
2. **o que não é de ninguém** — `owner_tm IS NULL`;
3. **o que me convidou** — `meeting_participants`, e `pipe_confirmacao.sdr_id` (quando
   closer e SDR estão preenchidos, o `COALESCE` dá o crédito ao closer e a SDR perderia a
   reunião que ela marcou).

A porta 2 era load-bearing em agosto (61% das confirmações sem responsável). Depois do
backfill da `20270907000020` ela ficou barata: medido em 02/09 na Milennials, janela de
±60 dias, 3 órfãos em 169 linhas (~2%).

## 🔴 A armadilha que a migration desarma

`created_by` carrega DOIS espaços de id na mesma coluna: `auth.users.id` para
`source = 'meeting'`, `team_members.id` para as outras quatro. Comparar a coluna crua
contra um id só some com metade da agenda **sem erro nenhum**. O `CASE` normaliza pelo
`source` antes de comparar, e a ponte `user_id → team_members` é escopada por org (sem
isso o JOIN dá fanout: `team_members.user_id` não é único — um master tem uma linha por
org).

## Ressalva conhecida

A edge function `get-member-permissions` monta o mapa do front lendo **catálogo +
override do membro**, sem passar por `organization_feature_defaults`. Ou seja: se um admin
desligar `agenda.view_all` como default DA ORG, o banco recorta (correto) e o front acha
que pode ver tudo — a tela mostraria menos do que promete, nunca mais. Por isso o front
mantém `isAdmin ||` na frente da permissão, e por isso quem manda é a RPC. O conserto do
mapa é maior que esta fatia.

## Provas

- `tests/unit/agenda-page-escopo.test.tsx` — 20 casos, incluindo "padrão vê o do colega",
  "sem permissão não vê", "admin atravessa com a permissão desligada" e falha-fechado
  enquanto identidade/permissão carregam.
- `tests/unit/agenda-permissao-ver-todos-contract.test.ts` — 16 casos travando as
  propriedades da migration (default ligado, sem parâmetro de escopo, admin antes da
  permissão, normalização do dono, grants).
- Ensaio transacional contra PROD (BEGIN → migration → asserções → ROLLBACK, 02/09): a
  migration aplica, o gate de tenancy dispara para sessão sem org, a ponte resolve dono em
  linha real e o catálogo grava com `default_value = true`. Confirmado depois que a chave
  e a função NÃO ficaram em prod.

## Aplicado em PROD — 2026-09-02

`20270914000000_agenda_de_todos_por_permissao`, ledger escrito na mesma transação (topo do
ledger; o anterior era `20270909001000`). Asserções pós-apply na própria transação:
função existe, `anon` sem EXECUTE, `authenticated` com, chave ligada e não-admin-only.

Medido impersonando um membro real (não-admin, org Milennials, janela de ±60 dias):

| medida | linhas |
|---|---|
| base org-wide sob RLS | 169 |
| com recorte, permissão LIGADA | 169 — md5 idêntico ao da base |
| com recorte, permissão desligada só para ele | 71 (as dele + as órfãs) |
| linhas de terceiro sobreviventes ao recorte | **0** |

Ao vivo depois do COMMIT: o mesmo membro vê 169 linhas, 165 com dono resolvido.

## Pendências

- **A tela ainda não mudou.** O banco está liberado, mas quem troca `isAdmin` por
  `useCanDo("agenda.view_all")` é o front desta branch — sem o merge/deploy, a Agenda em
  prod continua recortando por cargo.
- Regerar `types.ts`: a RPC nova não está lá (mesma situação da `get_comando_agenda_events`).
