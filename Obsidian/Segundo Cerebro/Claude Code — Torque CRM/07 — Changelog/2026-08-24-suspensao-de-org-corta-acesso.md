---
type: changelog
title: "Suspender org passa a cortar acesso, API e motor"
status: shipped
created: 2026-08-24
updated: 2026-08-24
tags: [changelog, billing, seguranca]
related: []
owner: gabriel
branch: feat/org-suspensa-corta-acesso
pr: pendente
---

# 2026-08-24 — Suspender org passa a cortar acesso, API e motor

## TL;DR

Suspender uma organização era cosmético: bloqueava a tela e nada mais — e nem a tela, na
prática, porque o botão não limpava o `billing_override` (95 das 107 orgs de prod tinham
override ligado). Agora a suspensão corta dados (RLS), chave de API e motor de
automação/IA/WhatsApp. E desativar uma pessoa passa a derrubar a sessão dela.

## Tipo

`security`

## Contexto

Levantamento pedido pelo CTO sobre o efeito real de desativar org/usuário. Diagnóstico e
decisão em [[ADR-2026-08-24-suspensao-de-org-corta-acesso]].

## O que mudou

- `org_access_blocked(uuid)` — predicado único do bloqueio; `is_blocked` da RPC de status
  passa a chamá-lo em vez de repetir a regra.
- `get_my_member_organization_ids()` — vínculo CRU (corpo antigo do helper de acesso).
- `get_my_organization_ids()` e os helpers de admin/team passam a excluir org bloqueada →
  as 239 policies que os consultam herdam o gate.
- Sobrevivem ao bloqueio (senão a tela de bloqueio quebra): policy de `organizations`
  repontada para o helper CRU, `team_members_select_own` e `org_get_subscription_status`.
- `master_set_org_suspension(org, suspend, motivo)` — suspender limpa o `billing_override`,
  exige motivo e audita em `master_audit_logs`. Reativar não devolve o override.
- Trigger em `team_members`: desativar sem outro vínculo ativo apaga `auth.sessions` e
  `auth.refresh_tokens` (não afeta master/gestor). Fail-soft.
- Backend: gate próprio em `validateApiKey` (→ **402**), no choke `governSend`, no turno do
  Copilot e no `whatsapp-api-proxy`. Fail-open com log em `runtime_logs`.
- Master: badge mostra status e override separados, com marca "sem acesso"; diálogo de
  confirmação lista o que a suspensão desliga.
- `ProtectedRoute`: membro desativado passa a ver "Conta Desativada" em vez de
  "Aguardando Ativação" (o ramo antigo era código morto).

## Arquivos tocados

- `supabase/migrations/20270826000000_org_suspensa_corta_acesso.sql`
- `supabase/migrations/20270826000010_master_set_org_suspension.sql`
- `supabase/migrations/20270826000020_revogar_sessao_ao_desativar_membro.sql`
- `supabase/functions/_shared/org-status.ts` — novo; consulta a RPC, cache 60s, fail-open
- `supabase/functions/_shared/send-governor/{gate,types}.ts` — motivo `subscription_blocked`
- `supabase/functions/_shared/auth.ts` + `_shared/api/router.ts` + 3 webhooks — 402
- `supabase/functions/agent-message/index.ts`, `whatsapp-api-proxy/index.ts`
- `src/modules/identity/master/{hooks/useMasterOrganizations.ts,pages/MasterOrganizations.tsx,components/OrgSuspensionDialog.tsx}`
- `src/modules/identity/org-team/hooks/useMembershipStatus.ts` — novo
- `src/modules/identity/auth/components/ProtectedRoute.tsx`

## Verificação

```bash
# unit (Deno) — 11 testes novos, incluindo controle positivo
cd supabase/functions && deno test --allow-read --allow-net --allow-env _shared/

# ensaio transacional contra prod (BEGIN → migration → asserções → ROLLBACK)
node scripts/prod-sql.mjs --file <scratchpad>/ensaio-org-suspensa.sql
node scripts/prod-sql.mjs --file <scratchpad>/ensaio-suspension-rpc.sql
node scripts/prod-sql.mjs --file <scratchpad>/ensaio-revoga-sessao.sql
```

Cada ensaio foi rodado também **sabotado**, para provar que as asserções pegam
(B2 "org bloqueada ainda aparece no helper", D2 "override sobreviveu à suspensão",
E1 "20 sessões sobreviveram à desativação").

## Deploy

- DEV: pendente
- PROD: pendente — migrations **não** aplicadas; edge functions **não** deployadas.

## Riscos / observações

- **O apply é no-op em prod hoje.** As 5 orgs `suspended` têm `billing_override = true`, e
  override vence o bloqueio. O gate só morde quando o master suspender pelo fluxo novo.
- Fail-open no backend: erro ao consultar o status **libera** e loga. Proposital.
- Janela de até 1h entre revogar a sessão e o JWT expirar. Na janela a RLS já não entrega
  dado nenhum.
- Ordem de deploy importa: migrations primeiro (a edge function chama
  `org_access_blocked`; sem a migration, `isOrgBlocked` cai no fail-open e libera).

## Referências

- ADR: [[ADR-2026-08-24-suspensao-de-org-corta-acesso]]
