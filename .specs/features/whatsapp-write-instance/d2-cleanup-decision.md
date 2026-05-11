# D2 — Cleanup Decision (`whatsapp_instance_allowed_members`)

**Data:** 2026-05-11
**Branch:** `chore/whatsapp-write-instance-d0-migrate-dev`
**Status:** **BLOQUEADO** — reescopo necessário.

---

## Contexto

Spec original ([spec.md §4](spec.md)) considerava 3 opções:

| Opção | Avaliação |
|-------|-----------|
| A. Drop tabela | **Inviável** hoje |
| B. Manter como ACL secundária | **Inviável** sem refactor |
| C. Rename + freeze (`_legacy_...`) | **Inviável** sem refactor |

Razão: tabela tem **uso ativo** no frontend.

---

## Grep evidencial

Callers ativos:

| Arquivo | Linhas | Uso |
|---------|--------|-----|
| [src/hooks/chat/useWhatsAppSend.ts:51-54](../../../src/hooks/chat/useWhatsAppSend.ts#L51-L54) | SELECT | Valida envio: confirma se `team_member_id` do user está na lista para a instância. |
| [src/hooks/chat/useWhatsAppInstances.ts:43-46, 53-56](../../../src/hooks/chat/useWhatsAppInstances.ts#L43-L56) | SELECT | Lista instâncias do user: filtra por allowed_members quando lista existe; org-wide quando vazia. |
| [src/hooks/useWhatsAppInstanceAllowedMembers.ts](../../../src/hooks/useWhatsAppInstanceAllowedMembers.ts) | SELECT/INSERT/DELETE | CRUD completo da tabela, usado por UI admin de instâncias. |
| [tests/unit/use-whatsapp-chat.test.ts](../../../tests/unit/use-whatsapp-chat.test.ts) | mocks | Testes do hook send. |

Migrations históricas (criação/alteração):
- `20260207000000_whatsapp_instance_allowed_members.sql` — criação
- `20260220000000_whatsapp_allowed_members_closer_permissions.sql` — RLS expansão
- `20260817000000_copilot_whatsapp_member_permissions.sql` — uso por copilot
- `20260901200000_ghost_master_rls_and_view.sql` — bypass master

---

## Por que cada opção falha

### Opção A — Drop

Quebra imediata:
- UI admin de instâncias para de funcionar (CRUD via `useWhatsAppInstanceAllowedMembers`).
- `useWhatsAppInstances` retorna lista vazia para users que dependiam de allowed_members.
- `useWhatsAppSend` rejeita envios.

### Opção B — Manter como ACL secundária

Conflito de modelo:
- Owner único (1:1) vs. ACL (1:N) cria semântica ambígua: "quem pode escrever?" tem 2 fontes de verdade.
- Em flag ON: backend usa owner. Frontend usa allowed_members. Divergência → bug latente.

### Opção C — Rename + freeze

- Os callers do frontend continuam consultando o nome antigo. Rename quebra mesmo o legacy.
- Renomear + atualizar callers = refactor disfarçado.

---

## Reescopo: D2 → "frontend strict alignment" (nova etapa)

D2 vira refactor frontend, não cleanup de schema. Trocar:

| Hook | Hoje | Após refactor (gated por flag) |
|------|------|-------------------------------|
| `useWhatsAppInstances` | filtra por `allowed_members` (legacy) | flag ON: filtra por `owner_team_member_id`. flag OFF: comportamento atual. |
| `useWhatsAppSend` | valida via `allowed_members` | flag ON: valida via `can_user_write_instance` RPC. flag OFF: comportamento atual. |
| `useWhatsAppInstanceAllowedMembers` (CRUD) | em uso | flag ON: deprecar UI ou redirecionar para `InstanceOwnerModal`. flag OFF: mantido. |

**Cleanup real (drop tabela)** só após:
1. Refactor frontend completo.
2. 100% orgs com flag ON 30 dias estáveis.
3. Migration de drop em janela ociosa, com backup.

---

## Decisão

🟥 **D2 NÃO executável nesta branch.** Schema cleanup adiado.

Próximos passos D2-bis (sessão futura):
1. Reescrever `useWhatsAppInstances` para bifurcar por flag.
2. Reescrever `useWhatsAppSend` legacy guard idem.
3. Decidir destino da UI `useWhatsAppInstanceAllowedMembers` quando flag ON.
4. Após estabilização total: migration drop + arquivar callers.

D2-bis bloqueia drop final da tabela e fecha a feature.

---

## O que esta branch faz com `allowed_members`

**Nada.** Tabela permanece intocada. Backfill da migration A já preencheu `owner_team_member_id` em instâncias com exatamente 1 allowed_member (em DEV: 0 instâncias atendiam a essa condição; em PROD: a verificar).
