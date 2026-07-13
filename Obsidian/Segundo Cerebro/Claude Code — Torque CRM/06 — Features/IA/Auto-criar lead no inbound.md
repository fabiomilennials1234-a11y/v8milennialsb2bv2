# Auto-criar lead no inbound (WhatsApp)

## O que é
Toggle **por organização** que, quando ligado, faz o sistema criar o lead automaticamente ao receber uma mensagem de WhatsApp de um telefone **desconhecido** — mesmo que não haja IA ativa na org e mesmo que o filtro de audiência (`attend_unknown_contacts=false`) barre a resposta da IA.

Coluna: `organizations.auto_create_lead_on_inbound` (`boolean NOT NULL DEFAULT false`). Default `false` = **todas as orgs desligadas** = comportamento legado.

## Como funciona
Age no turno principal do Copilot: `supabase/functions/agent-message/index.ts`, logo após o lock (`acquire_copilot_lock`), lê a flag 1x. Depois, nos **dois gates de entrada** que hoje barram a criação de lead:

1. **ACTIVE-AGENT gate** (`~/index.ts` 0.95) — org sem nenhum `copilot_agents.is_active=true`.
2. **AUDIENCE gate** (`~/index.ts` 1.0, `audience-gate.ts`) — telefone desconhecido + algum agente ativo com `attend_unknown_contacts=false` (veto org-wide, fail-closed).

A decisão é isolada no helper puro `agent-message/gate-decision.ts::decideBlockedInboundAction(gate, autoCreateLead)`:

| gate | flag OFF | flag ON |
|------|----------|---------|
| `no_active_agents` | `{skipped, reason:"no_active_agents"}` (sem lead) | cria lead + `{skipped, reason:"lead_created_no_ai"}` |
| `audience_blocked` | `{skipped, reason:"unknown_phone_blocked"}` (sem lead) | cria lead + `{skipped, reason:"lead_created_ai_blocked"}` |

Criação via `_shared/lead-service.ts::getOrCreateLead({ organizationId, phone, pushName, origin:"whatsapp" })` — idempotente (índice único `normalized_phone` + retry em `23505`), seguro dentro da região travada pelo lock. Destino: funil WhatsApp, etapa `novo`, **sem atribuição** (sem dono).

Em ambos os casos com a flag ON o turno **ainda termina em early-return 200** — a IA não responde **no turno que cria o lead**. Mas, como o lead passa a existir, a partir do **próximo inbound** o número deixa de ser "desconhecido" e o atendimento segue o fluxo normal (ver **Handoff** abaixo).

## Regras de negócio
- Vale pra **conta inteira** (não por-aba, não por-funil).
- Flag **aditiva e ortogonal** a `attend_unknown_contacts`:
  - `attend_unknown_contacts` → **SE a IA responde** a desconhecidos.
  - `auto_create_lead_on_inbound` → **SE o lead é materializado** quando a IA não vai responder.
- Telefone **conhecido** OU (`attend_unknown_contacts=true` + agente ativo) → fluxo **inalterado**: cria lead + IA responde. A flag não toca esse caminho.
- Retrocompat: com a flag OFF, os dois gates respondem byte-a-byte como antes.

### Handoff da IA (importante)
O lead auto-criado **passa a existir**, então a partir do **2º inbound** o `audience-gate` não barra mais aquele número (short-circuit `existingLead`) e a IA responde normalmente. Ou seja, ligar o toggle habilita o fluxo desenhado: automação `lead_created` **inicia o atendimento** → IA **dá seguimento** quando o lead responde. Isso é o comportamento desejado (não é bug). ⚠️ Em org que use `attend_unknown_contacts=false` como controle rígido de custo/privacidade, ligar este toggle passa a permitir a IA a partir da 2ª msg — decisão consciente **na ativação** (por isso o default é OFF e a ativação é manual). Além disso, a criação do lead dispara os triggers `lead_created`/`lead_added`: antes de ligar numa org, conferir se há automação/dispatch que possa mandar mensagem indesejada.

## UI
Toggle `Switch` "Criar lead automático (WhatsApp)" na barra do funil (header do kanban), nas 3 abas de pipe (whatsapp/confirmacao/propostas).
- Componente: `src/modules/pipelines/components/shared/AutoCreateLeadToggle.tsx` (dropado no header de cada page, após o `PipeViewToggle`).
- Hook: `src/modules/identity/org-team/hooks/useAutoCreateLeadSetting.ts` (read/write org-scoped, invalida a query no onSuccess).
- Visibilidade: só **admin/owner + master** (`useUserRole().role==='admin' || useMasterAuth().isMaster`). Membro (vendedor) não vê.
- Resiliência: se a coluna ainda não foi aplicada no DB, o toggle renderiza como OFF e não quebra a página (permite verificação visual no localhost antes da migration).

## Edge cases / limitações
- **Inbound sem texto/mídia** não passa por `agent-message` (v1 não altera `whatsapp-webhook`). Esse caso **não** cria lead automático — limitação conhecida de v1. A cobertura via `agent-message` pega inbound com texto/mídia (a maioria).
- Criação é idempotente: reentrância pelo mesmo telefone não duplica lead (dedup por `normalized_phone`).
- A flag herda `ai_disabled` de `phone_ai_preferences` na criação (comportamento padrão do `getOrCreateLead`).

## Áreas frágeis
🔴 `agent-message` (turn principal do Copilot). Mudança **aditiva**: não remove `attend_unknown_contacts`, não altera contrato de idempotência/DLQ, não faz throw em path normal (early-return 200 como os gates atuais). Testes obrigatórios do módulo re-rodados.

## Refs
- Migration: `supabase/migrations/20270211000000_org_auto_create_lead_on_inbound.sql`
- Helper: `supabase/functions/agent-message/gate-decision.ts` + teste `tests/unit/gate-decision.test.ts`
- Sub-CLAUDE: `supabase/functions/agent-message/CLAUDE.md` (edge case documentado)

## Histórico
- 2026-07-13 — Feature criada (migration + gate wiring + toggle UI + testes + docs). Migration NÃO aplicada, edge NÃO deployada (pendências).
