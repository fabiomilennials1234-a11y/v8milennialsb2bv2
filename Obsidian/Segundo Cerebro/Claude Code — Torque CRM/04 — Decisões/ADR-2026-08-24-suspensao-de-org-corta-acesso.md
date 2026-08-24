---
type: adr
title: "Suspensão de org corta acesso no banco, não na tela"
status: accepted
created: 2026-08-24
updated: 2026-08-24
tags: [adr, billing, seguranca, multi-tenant]
related: []
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-08-24 — Suspensão de org corta acesso no banco, não na tela

**Data:** 2026-08-24
**Status:** accepted
**Escopo:** `organizations.subscription_status`, helpers de RLS, `_shared/auth.ts`, choke de envio (`governSend`), `agent-message`, `whatsapp-api-proxy`, `team_members.is_active`

## Contexto

Levantamento pedido pelo CTO: *o que acontece hoje se desativarmos uma org ou um usuário?*
A resposta medida em prod (2026-08-24):

**Usuário desativado (`team_members.is_active = false`)** — funcionava no essencial. A RLS
fecha de verdade: `get_my_organization_ids()`, `get_my_admin_organization_ids()`,
`get_my_team_member_ids()` e `assert_org_access()` já filtravam `is_active = true`. Dois
defeitos: a sessão **não** era revogada (refresh token vivo, renovando indefinidamente), e
a tela mostrava a mensagem errada — "Aguardando Ativação / sua conta está sendo
configurada" para quem tinha acabado de ser desligado, porque `useCurrentTeamMember`
filtra `is_active = true` e devolve `null`, indistinguível de quem nunca teve vínculo.
O ramo "Conta Desativada" do `ProtectedRoute` era código morto.

**Org suspensa** — não funcionava. Não existe `organizations.is_active`; o que existe é
`subscription_status`, e ele era conhecido **apenas pelo front**
(`SubscriptionProtectedRoute`). Nenhuma policy o consultava. Com token válido, PostgREST
continuava lendo e escrevendo tudo. Chave de API continuava respondendo. Cron, workflows,
Copilot e disparo de WhatsApp continuavam rodando — custo correndo numa conta suspensa.

E, na prática, a suspensão nem chegava a mudar a tela: `is_blocked` é
`status bloqueado AND NOT billing_override`, o botão "Suspender" escrevia só o status, e a
distribuição em prod era:

| status | billing_override | orgs |
|---|---|---|
| active | true | 90 |
| trial | false | 9 |
| suspended | **true** | **5** |
| active | false | 3 |

As 5 suspensas tinham override ligado — ou seja, **suspensão era no-op em 95 das 107 orgs**.

## Forças em jogo

**Restrições do CTO:**
- Padrão world-class: nada de meia-medida do tipo "não vê nada mas continua logado".
- Segurança não é fase posterior.

**Restrições técnicas:**
- 239 policies consultam `get_my_organization_ids()`. Editar policy a policy é inviável e
  garante esquecimento.
- Backend roda como `service_role` e **bypassa RLS** — o gate de banco não alcança edge function.
- O access token JWT é sem estado: não há como revogá-lo antes de expirar.

**Restrições de segurança/multi-tenant:**
- A tela de bloqueio e o fluxo de regularização precisam continuar funcionando **enquanto**
  a org está bloqueada. Cortar identidade junto com dados quebraria a própria saída.
- Master e `service_role` não podem ser afetados.

## Opções consideradas

### Opção (a) — Gate por policy, tabela a tabela
Vantagem: controle fino por tabela.
Desvantagem: 239 policies; a próxima tabela nasce sem o gate. Vetada.

### Opção (b) — Gate no choke `get_my_organization_ids()` ⭐ ESCOLHIDA
Vantagem: um ponto cobre as 239 policies e toda tabela futura, sem tocar em policy nenhuma.
Desvantagem: exige separar "vínculo" de "acesso" para as superfícies que precisam
sobreviver ao bloqueio.

### Opção (c) — Só front, como era
Vantagem: zero risco.
Desvantagem (vetada pelo CTO): bloqueio cosmético; API e motor de IA seguem servindo.

## Decisão

**Adotada opção (b)**, em quatro camadas.

### D1 — Predicado único: `org_access_blocked(uuid)`
`status IN ('suspended','cancelled','expired') AND NOT billing_override`. Passa a ser a
fonte tanto das policies (via helper) quanto do `is_blocked` de
`org_get_subscription_status()` — antes a regra existia duplicada. TS **não** reimplementa:
`_shared/org-status.ts` chama a RPC (há teste de guarda de fonte para isso).

### D2 — Vínculo ≠ acesso
`get_my_member_organization_ids()` guarda o vínculo CRU (o corpo antigo).
`get_my_organization_ids()` (e os helpers de admin/team) passam a excluir org bloqueada.
Sobrevivem ao bloqueio, de propósito: a policy `Users can see their organization`
(repontada para o helper CRU), a policy `team_members_select_own` (já era por
`user_id = auth.uid()`) e `org_get_subscription_status()`. Sem essas três, a tela de
bloqueio não teria nem o nome da org e o `ProtectedRoute` quebraria antes dela.

### D3 — O backend precisa do próprio gate
`service_role` bypassa RLS, então o gate de banco não vale para edge function. Foram
fechados: `validateApiKey` (`_shared/auth.ts`, cobre os 5 callers → **402**, não 401 — a
chave é válida, quem está suspensa é a conta), o choke de envio `governSend`
(cobre os ~23 caminhos de disparo, inclusive `manual`), o turno do Copilot
(`agent-message`, antes de qualquer side-effect) e o `whatsapp-api-proxy` (envio manual,
único caminho que não passa por `governSend`).
**Fail-open deliberado:** erro ao consultar o status libera e loga. Isto é gate de
cobrança, não fronteira de segurança — um blip de banco não pode calar a base pagante.

### D4 — Suspender limpa o `billing_override`
Via RPC `master_set_org_suspension(org, suspend, motivo)`: atômica, auditada em
`master_audit_logs`, motivo obrigatório. Reativar **não** devolve o override. O badge do
Master passa a mostrar status e override como dois fatos separados.

### D5 — Desativar pessoa derruba a sessão
Trigger `AFTER UPDATE OF is_active` em `team_members` apaga `auth.sessions` e
`auth.refresh_tokens`. Guarda na coluna e não na tela porque há dois caminhos de
desativação (Master → Usuários e Equipe → membro). Não derruba quem tem outro vínculo
ativo, nem master, nem gestor. Fail-soft.

## Consequências

### Positivas
- Suspender uma org passa a significar alguma coisa: dados, API e motor param juntos.
- Toda tabela nova herda o gate de graça, pelo choke.
- Desligar alguém encerra a sessão.

### Negativas
- `get_my_organization_ids()` ganhou um predicado por org do usuário (1–3 linhas, função
  `STABLE`, avaliada uma vez por query).
- Órfãs no rollback: `org_access_blocked` e `get_my_member_organization_ids` ficam de pé
  (dropar exigiria recriar grants).

### Pendências geradas
- MEDIUM: as 5 orgs hoje `suspended` seguem com `billing_override = true`. O apply é no-op
  para elas até o master suspender de novo pelo fluxo novo — **decisão comercial do CTO**,
  não da migration.
- MEDIUM: janela residual de até 1h entre revogar a sessão e o JWT expirar. Na janela a RLS
  já não entrega dado; o que demora é o logout.
- LOW: utilitários de IA avulsos (`generate-faqs`, `generate-business-context`, …) não têm
  gate próprio — são disparados pela UI, que já está bloqueada.

## Alternativas rejeitadas

- **Gate por policy** — 239 pontos, esquecimento garantido.
- **Fail-closed no backend** — um erro de banco calaria o WhatsApp de toda a base.
- **Revogar o access token** — impossível: JWT é sem estado.
