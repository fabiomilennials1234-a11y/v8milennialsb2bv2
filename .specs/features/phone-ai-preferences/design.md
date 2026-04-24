# phone_ai_preferences — Design

## Architectural decision

**A fonte de verdade do estado "IA ligada/desligada" deixa de ser `leads.ai_disabled` e passa a ser `phone_ai_preferences(organization_id, normalized_phone, ai_disabled)`.** `leads.ai_disabled` vira uma **denormalização** mantida em sincronia por RPC, para não quebrar consumidores existentes (ex: `agent-message`, `evolution-webhook`, `get_lead_ai_status`).

### Why this beats alternatives

| Alternativa | Por que não |
|---|---|
| Consertar apenas o enum (`shadow_ai_toggle`) | Remendo: mantém shadow leads criados por toggle, continua disparando triggers de leads, não resolve duplicação, não resolve divergência front/back estruturalmente. |
| Mover `ai_disabled` pra `conversations` | `conversations` é Copilot-específica. Não existe antes da primeira msg do agente. Mesmo problema do leads. |
| Usar `localStorage` / cliente | Não persistente cross-device, não existe pra webhook. Viola multi-device. |
| Tabela `contact_preferences` genérica | Over-engineering pra uma única preferência. Pode vir depois se houver 2+ prefs por contato. |

A tabela dedicada **`phone_ai_preferences`**:
- É o único lugar que existe **antes** de qualquer lead.
- Escalável: próximas preferências por-contato entram como colunas aqui.
- Não dispara triggers de `leads`.
- Chave natural `(organization_id, normalized_phone)` — multi-tenant direto.
- Unifica duplicatas: qualquer lead com mesmo phone normalizado herda a mesma preferência.

## Data model

```sql
CREATE TABLE public.phone_ai_preferences (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  normalized_phone TEXT NOT NULL,
  ai_disabled BOOLEAN NOT NULL DEFAULT false,
  set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, normalized_phone)
);

CREATE INDEX idx_phone_ai_preferences_phone ON public.phone_ai_preferences (normalized_phone);

-- Trigger existente `update_updated_at()` reaproveitado.
CREATE TRIGGER update_phone_ai_preferences_updated_at
  BEFORE UPDATE ON public.phone_ai_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### RLS

```sql
ALTER TABLE public.phone_ai_preferences ENABLE ROW LEVEL SECURITY;

-- Select: qualquer team_member ativo da mesma org
CREATE POLICY "phone_ai_prefs_select_same_org"
  ON public.phone_ai_preferences FOR SELECT
  USING (organization_id IN (
    SELECT team_members.organization_id FROM public.team_members
    WHERE team_members.user_id = auth.uid() AND team_members.is_active = true
  ));

-- Insert/Update/Delete: apenas via RPC SECURITY DEFINER (frontend não toca direto)
-- Sem policy → acesso negado. Força o uso de toggle_phone_ai().
```

## RPC surface

### New: `toggle_phone_ai(p_phone TEXT, p_disabled BOOLEAN) RETURNS JSONB`

Substitui a atual `toggle_conversation_ai`. Comportamento:

1. Resolve `auth.uid()` → `v_user_id`. Falha se anônimo.
2. Resolve `team_members.organization_id` ativo do usuário → `v_org_id`. Falha se sem membership.
3. Normaliza o telefone via `normalize_brazilian_phone(p_phone)` → `v_normalized`. Falha se inválido.
4. UPSERT em `phone_ai_preferences (organization_id, normalized_phone, ai_disabled, set_by)` com `ON CONFLICT (organization_id, normalized_phone) DO UPDATE`.
5. **Sincroniza todos os leads** da org com mesmo `normalized_phone`:
   ```sql
   UPDATE leads
   SET ai_disabled = p_disabled,
       ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
       ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
   WHERE organization_id = v_org_id AND normalized_phone = v_normalized;
   ```
6. Quando reativando (`p_disabled=false`): reseta `conversations.state` de `WAITING_HUMAN` → `QUALIFYING` para todos os leads atingidos. Insere `lead_history` `ai_reactivated` em cada lead.
7. Quando desativando: insere `lead_history` `ai_disabled` em cada lead.
8. **NÃO cria shadow lead.** Se `v_affected_count=0`, registra apenas a preferência e retorna `{lead_id: null, ...}`.
9. Retorna `{lead_id, ai_disabled, normalized_phone, affected_leads: int}`.

### Modified: `toggle_lead_ai(p_lead_id UUID, p_disabled BOOLEAN) RETURNS JSONB`

Continua existindo. Adiciona passo extra: UPSERT em `phone_ai_preferences` com o `normalized_phone` do lead alvo. Garante que a fonte única fica coerente quando o usuário toggle no detalhe do lead.

### Modified: `get_lead_ai_status(p_lead_id UUID) RETURNS JSONB`

Continua lendo de `leads.ai_disabled`. Nada muda — a sincronização mantém `leads.ai_disabled` fiel.

### New: `get_phone_ai_status(p_phone TEXT) RETURNS JSONB`

Para uso no chat sem lead:
1. Resolve org. Normaliza phone.
2. `SELECT ai_disabled FROM phone_ai_preferences WHERE (org, normalized_phone) = (...)`. 
3. Se não existir, retorna `false` (default ligado) + flag `source: "default"` vs `source: "preference"` vs `source: "lead"`.
4. Fallback: se existir lead pra esse phone, lê do lead (útil quando preferência nunca foi salva mas lead já tem estado).

### Dropped: `toggle_conversation_ai`

Migration `DROP FUNCTION IF EXISTS public.toggle_conversation_ai(text, boolean) CASCADE`. Não ressuscitar.

## Ingestion integration

`supabase/functions/_shared/lead-service.ts::getOrCreateLead`:

- Quando cria novo lead (branch linha ~198), **antes** de fazer o INSERT, consulta `phone_ai_preferences` por `(organization_id, normalized_phone)`.
- Se preferência existir com `ai_disabled=true`, o INSERT inclui `ai_disabled: true, ai_disabled_at: now(), ai_disabled_by: <preference.set_by>`.
- Se não existir, comportamento atual (default false). Nenhum custo em leads que nunca foram toggled.

Isso fecha AC-02 (herança na 1ª mensagem).

## Frontend integration

### Query keys

| Key atual | Fonte | Permanece |
|---|---|---|
| `["lead_ai_status", leadId]` | `get_lead_ai_status` RPC | Sim, só quando `leadId` está definido |
| `["phone_ai_status", orgId, normalizedPhone]` | **NOVO** `get_phone_ai_status` RPC | Sim, usado quando `leadId` é undefined |

### Hook surface

- `useLeadAiStatus(leadId)` — permanece. `staleTime: 30_000`.
- `usePhoneAiStatus(phone)` — novo. Lê preferência por telefone. Normaliza no cliente via `src/lib/normalizePhone`. `staleTime: 30_000`.
- `useToggleLeadAI()` — ajustes:
  - `onMutate` passa a atualizar também `["lead_ai_status", leadId]` optimisticamente (fecha caminho B do diagnóstico).
  - `onError` adicionado rollback dessa chave.
  - `onSuccess` já escreve. Mantido.
- `useToggleConversationAI()` — **reescrito**:
  - Renomeado (internamente) para `useTogglePhoneAI`. Export antigo mantido como alias por compat — mas chama a nova RPC `toggle_phone_ai`.
  - Adiciona `onMutate` optimistic em `["phone_ai_status", orgId, normalized]`.
  - Adiciona `onError` com rollback do cache.
  - Recebe `{ phone, disabled, organizationId }`. Normaliza no cliente.

### Component wiring

`src/components/chat/WhatsAppChat.tsx` — a Switch vira controlada por:
```ts
const phoneAi = usePhoneAiStatus(phoneNumber);
const leadAi = useLeadAiStatus(leadId);
// Quando há lead: leadAi é a verdade. Senão: phoneAi.
const currentAiDisabled = leadId ? (leadAi?.ai_disabled ?? false) : (phoneAi?.ai_disabled ?? false);
```

O branching no `onCheckedChange` continua escolhendo `toggleAI` (leadId) vs `togglePhoneAI` (no lead).

## Normalization alignment

Três implementações coexistentes, todas alinhadas no algoritmo canônico:
- SQL `normalize_brazilian_phone(text)` (já existe)
- TS edge `normalizePhoneForSearch` em `supabase/functions/_shared/lead-service.ts` (já existe)
- TS frontend `normalizePhone` em `src/lib/normalizePhone.ts` (já existe)

Teste de equivalência: tabela de casos em `tests/unit/normalize-phone-equivalence.test.ts` que roda os 3 (SQL via mock/fixture, dois TS direto) e assegura mesmo output. Previne drift futuro.

## Trade-offs

- **Denormalização intencional** em `leads.ai_disabled` mantida: consumidores (agent-message, webhook) não precisam mudar. Custo: toda RPC de toggle faz 2 writes. Benefício: não-quebrável.
- **Sem cascade automático via trigger**: o sync é feito no corpo das RPCs, não via trigger em `phone_ai_preferences → leads`. Rationale: trigger dispararia triggers em `leads` também, causando efeitos colaterais (workflow_field_changed etc.) sempre que a preferência muda. Manter dentro da RPC dá controle.
- **`set_by` como `auth.users.id` (ON DELETE SET NULL)**: permite auditoria sem criar dependência dura.
- **Sem `unique` em `normalized_phone` isolado**: a chave é composta com `organization_id` — multi-tenancy.

## Residual risks

- **R1**: Ordem de operações entre RPC e webhook concorrente. Se um webhook chega exatamente entre o UPSERT em `phone_ai_preferences` e o UPDATE em `leads`, o webhook cria lead com default `false`. Mitigação: `getOrCreateLead` consulta `phone_ai_preferences` ao criar; mesmo que racing, ainda herda. **Sem mitigação extra necessária**.
- **R2**: A RPC `toggle_lead_ai` existente faz sync de duplicatas. Se adicionarmos o UPSERT de preferência, **precisamos** garantir que o telefone do lead está realmente normalizado (pode estar `NULL` se migração do normalized_phone não rodou). Mitigação: se `normalized_phone IS NULL`, não faz UPSERT em preferências (ajuste só em `leads`) — é o comportamento de fallback já existente.
- **R3**: Lag entre update em `leads.ai_disabled` (via RPC) e cache do front. Mitigação: optimistic update em ambas as query keys + `onSuccess` explicit setQueryData.

## Test strategy

Ver `tasks.md`.
