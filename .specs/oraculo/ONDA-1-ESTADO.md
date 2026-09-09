# Oráculo · Onda 1 — estado da execução

Branch: `feat/oraculo-onda-1` (worktree `~/Dev/wt-oraculo-o1`, base `origin/main` @ 9d06b8a3).
Jira: SCRUM-588 (SCRUM-593 autoria, SCRUM-594 espinha). ADR-0032, ADR-0033.

## Achado que muda o alcance do SCRUM-593 — decisão do CTO pendente

O ticket assume que gravar o autor no caminho de envio dá dono à atividade do
vendedor. Medido em produção (30 dias, `whatsapp_messages`):

| Medição | Valor |
|---|---|
| Mensagens humanas `outgoing` | 268.735 |
| Saíram pela caixa de entrada do CRM (`wasSentByApi=true`) | **53 — 0,020%** |
| Orgs que enviam | 31 |
| Orgs que usam a caixa do CRM | **2** |
| Instâncias que enviam | 101 |
| Instâncias com dono único declarado | **5 → 1,5% das mensagens** |

Quebra por origem real (7 dias): `source=unknown` 27.526 · `web` 24.642 ·
`android` 9.293 · `ios` 200. O vendedor conversa pelo WhatsApp dele; o Uazapi
espelha para dentro. O CRM não é o remetente.

Consequência: a autoria no envio cobre ~0,02% da atividade. A dimensão `pessoa`
do Gargalo (SCRUM-604) **não** fica desbloqueada por esta fatia. Também não fica
pelo vínculo pessoa↔instância — a maioria das orgs tem 1–2 instâncias para 4–6
pessoas, ou seja o número é da empresa, não da pessoa.

Implementado assim mesmo (é barato, correto e pré-requisito de qualquer caminho
futuro — ADR-0033 §4), com o alcance declarado. O que fazer com a lacuna dos
99,98% é decisão de produto, não de engenharia.

## Verde (TDD, red→green, rodando)

`deno test` em `supabase/functions/_shared/` — 18 casos:

| Seam | Arquivo | Casos |
|---|---|---|
| S1 autoria | `message-authorship.ts` | 3 |
| S4 Escopo | `oraculo/scope.ts` | 4 |
| S5 memória | `oraculo/memory.ts` | 2 |
| S6 ferramenta `metricas` | `oraculo/tools/metricas.ts` | 4 |
| S7 laço | `oraculo/loop.ts` | 4 |
| S8 quota | `oraculo/quota.ts` | 3 |

`npx vitest run tests/unit/permission-actions.test.ts` — 11 casos (S9:
`view_org_metrics` → `metrics.view_org`, nas duas cópias, hash bate).

Controle positivo executado em S7 (teto) e S6 (3 guardas) — sabotagem deixa
vermelho, restauração deixa verde. As guardas não são verde por ausência.

## Entregue

**SCRUM-593 — autoria**
- `_shared/message-authorship.ts` — `resolveAuthor`, `readAuthorFromPayload`, `authorFromWebhookEcho` (7 casos).
- `whatsapp-api-proxy` manda o `team_members.id` em `track_id` nas três ações de envio.
- `whatsapp-webhook` lê o eco de volta e grava `sent_by_team_member_id`.
- `send-meta-message` grava direto — ali a linha nasce no próprio envio.
- Migration `20270905000000` — coluna nas duas tabelas + índices parciais.

**SCRUM-594 — espinha**
- `_shared/oraculo/`: `scope.ts` (4), `memory.ts` (2), `quota.ts` (3), `loop.ts` (4),
  `tools/metricas.ts` (4), `turn-handler.ts` (3), mais `openrouter.ts` e `store.ts`.
- Edge function `oraculo-turno` + `config.toml`.
- Migrations `20270905000010` (conversa, quota, RLS, REVOKE) e `20270905000020`
  (`metrics.view_org` + RPC `oraculo_metricas`).
- Front: `useOraculoTurno` (2 casos), `useOraculoConversas`, página `/oraculo`.
- 18ª ação de permissão `view_org_metrics` → `metrics.view_org`, nas duas cópias.

## Verificação executada

| Camada | Resultado |
|---|---|
| `npm run test:edge` | 795 passed / 0 failed |
| pgTAP na branch `oraculo-onda1` | 29 asserções, 0 falhas |
| `npm run typecheck:ratchet` | delta 0 (14 erros herdados de `origin/main`) |
| `npm run lint` | 0 erros |
| Controle positivo | executado em S6, S7 e na autoria — sabotagem vira vermelho |

A branch do Supabase (`ocorpojlbezalxdrcndl`) foi criada, recebeu as migrations e
**deve ser derrubada** — custa por hora.

## Ainda em aberto

- Deploy de `oraculo-turno` e apply das 3 migrations em prod: exige autorização do CTO.
- Onda 5 (SCRUM-606) remove o Oráculo antigo. Até lá as duas superfícies convivem.
- A lacuna dos 99,98% da atividade humana sem autor é decisão de produto (ver acima).
