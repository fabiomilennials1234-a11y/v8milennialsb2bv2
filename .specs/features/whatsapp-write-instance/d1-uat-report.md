# D1 — UAT Report (flag OFF)

**Data:** 2026-05-11
**Branch:** `chore/whatsapp-write-instance-d0-migrate-dev`
**Ambiente:** DEV (`bcfadphgsibjzivtbjvc`)
**Flag `user_write_instance_strict`:** default OFF, sem override em `organization_features` para nenhuma org.

---

## Escopo

Validar que com flag OFF + migration A aplicada, comportamento do sistema é byte-a-byte legacy. Testes funcionais reais (envio WhatsApp humano em UI) ficam para sessão manual posterior. UAT aqui = validação automatizada via:

1. Inspeção de código (curto-circuito).
2. Suite de integration tests do guard.
3. Smoke direto das RPCs via Management API.

---

## 1. Curto-circuito flag OFF (inspeção de código)

[supabase/functions/_shared/instance-write-guard.ts:91-119](../../../supabase/functions/_shared/instance-write-guard.ts#L91-L119) — `resolveStrictInstanceForCaller`:

```typescript
if (!leadId) return null;            // sem leadId → null → caller usa legado
const strict = await isStrictWriteEnabled(client, organizationId);
if (!strict) return null;            // flag OFF → null → caller usa legado
```

[supabase/functions/_shared/instance-write-guard.ts:241-284](../../../supabase/functions/_shared/instance-write-guard.ts#L241-L284) — `isStrictWriteEnabled`:

```typescript
} catch (err) {
  // ...degrade safe
  enabled = false;
}
```

Erro de RPC ou tabela ausente → `enabled = false` → null. Verificado também em [src/hooks/useLeadWriteInstance.ts](../../../src/hooks/useLeadWriteInstance.ts) — frontend tem mesma defesa: erro/loading/flag OFF → `canWrite = true` (Estado 1 HABILITADO).

**Veredicto:** zero risco de bloqueio espúrio.

---

## 2. Suite integration `instance-write-guard`

```
$ npx vitest run tests/integration/instance-write-guard.test.ts

Test Files  1 passed (1)
     Tests  13 passed (13)
  Duration  2.09s
```

Todos cenários green, incluindo o crítico:

> `resolveDispatchContext (flag OFF) > flag OFF + leadId presente NÃO chama get_lead_write_instance` ✓

---

## 3. Smoke RPCs em DEV (via Management API)

| # | Cenário | Resultado | OK |
|---|---------|-----------|-----|
| 1 | `get_lead_write_instance('00000000-...')` | `error_code = LEAD_NOT_FOUND` | ✓ |
| 2 | `get_lead_write_instance(<lead sem responsible>)` | `error_code = NO_RESPONSIBLE` | ✓ |
| 3 | `get_lead_write_instance(<lead com responsible, sem instância vinc>)` | `error_code = NO_INSTANCE`, `responsible_user_id = <tm_id>` | ✓ |
| 4 | `get_user_write_instance(<user sem owner>, <org>)` | empty rowset | ✓ |
| 5a | `can_user_write_instance(<user admin org da instância>, <instance>)` | `true` (admin bypass) | ✓ |
| 5b | `can_user_write_instance('00000000-...', <instance>)` | `false` | ✓ |
| 5c | `can_user_write_instance(<user>, '00000000-...')` | `false` | ✓ |
| 6 | `set_instance_owner(...)` via REST | **não testado** — RPC exige `auth.uid()` (Management API não autentica como user). Coberto por tests + UI manual. | n/a |

---

## 4. Suite frontend

```
$ npx vitest run tests/unit/useLeadWriteInstance.test.tsx tests/unit/ChatComposerShell.test.tsx

Test Files  2 passed (2)
     Tests  18 passed (18)
```

Inclui cenários:
- `useLeadWriteInstance` flag OFF → `canWrite=true`, `state='HABILITADO'`, sem chamada RPC.
- `useLeadWriteInstance` RPC error → degrade safe, `canWrite=true`.
- `ChatComposerShell` 3 estados (HABILITADO/BLOQUEADO/ERRO) + variantes `full`/`compact` + admin/membro.

---

## 5. Inventário DEV (relevante para Etapa E)

| Item | Quantidade |
|------|-----------|
| Orgs | 24 (espelho de PROD) |
| Instâncias whatsapp | 1 (`qa-e2e-test-2`, status `connecting`, sem owner) |
| Instâncias com owner vinculado | 0/1 |
| Leads com `responsible_user_id` populado | 2/28 |
| Linhas em `whatsapp_instance_allowed_members` | 0 |
| `feature_flags.user_write_instance_strict.default_enabled` | `false` |
| Override em `organization_features` | nenhum |

---

## 6. Cenários funcionais NÃO cobertos automaticamente (sessão manual)

Testes que exigem envio real de WhatsApp + interação humana — pendente sessão UAT presencial:

| # | Caller | Setup mínimo | Esperado (flag OFF) |
|---|--------|--------------|---------------------|
| F1 | Composer humano (UI `/chat`) | login user comum, abrir lead com responsável diferente | envia OK, sem 409/403 |
| F2 | Outbound copilot imediato | agente ativo, lead novo c/ telefone | envia via `preferred_instance_id` legado |
| F3 | Followup cron | followup agendado | envia via instância default |
| F4 | Workflow node `send_message` | workflow ativo disparado | envia conforme legado |
| F5 | `pipe-rule-dispatch` (template + timeout) | regra disparando | envia OK |
| F6 | `campaign-rule-dispatch` | campanha ativa | envia OK |
| F7 | `mass-send-create` | broadcast Uazapi | envia OK (exceção arquitetural) |
| F8 | UI lead drawer composer | abrir lead drawer qualquer | Estado 1 HABILITADO, zero shell shift |

**Recomendação:** rodar F1-F8 antes de qualquer cutover de Etapa E.

---

## 7. Veredicto D1

✅ **Aprovado para automação.**
🟡 **Pendente para presencial.** Sessão manual F1-F8 antes de Etapa E.

Migration A aplicada DEV está estável. Comportamento legacy preservado. Risco zero de regressão acidental até cutover por org.
