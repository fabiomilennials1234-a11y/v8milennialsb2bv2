# 2026-07-13 — Toggle por org: criar lead automaticamente no inbound do WhatsApp

## Mudanças
- **copilot / agent-message (área frágil 🔴)**: nova flag por organização `auto_create_lead_on_inbound` (default `false`). Quando **ON**, uma mensagem inbound de WhatsApp de telefone **desconhecido** cria o lead sozinho (funil WhatsApp, etapa Novo, sem dono) **mesmo sem IA ativa** ou quando o `attend_unknown_contacts=false` barraria a resposta. Quando **OFF** (default de TODAS as orgs), o comportamento é byte-a-byte o de hoje (os dois gates retornam `skipped` sem criar lead).
- **pipelines (UI)**: `Switch` "Criar lead automático (WhatsApp)" na barra do funil (kanban), visível nas 3 abas de pipe (whatsapp/confirmacao/propostas). Só admin/owner + master. Vale pra conta inteira (tooltip deixa claro que não é por-aba/funil).

## Semântica ON/OFF
- **OFF** (legado): sem agente ativo → `{skipped, reason:"no_active_agents"}`; audience blocked → `{skipped, reason:"unknown_phone_blocked"}`. **Nenhum lead criado.**
- **ON**: sem agente ativo → cria lead + `{skipped, reason:"lead_created_no_ai"}`; audience blocked → cria lead + `{skipped, reason:"lead_created_ai_blocked"}`. **Early-return mantido** — a IA nunca responde num contexto onde hoje não responderia; só o lead é materializado.
- Telefone **conhecido** OU (`attend_unknown_contacts=true` + agente ativo): fluxo **inalterado** — cria lead + IA responde. A flag não regride esse caminho.

## Interação com `attend_unknown_contacts`
- Flag **aditiva e ortogonal**. `attend_unknown_contacts` governa **SE a IA responde** a desconhecidos; `auto_create_lead_on_inbound` governa **SE o lead é materializado** quando a IA não vai responder. Nenhuma substitui a outra.

## Arquivos tocados
- `supabase/migrations/20270211000000_org_auto_create_lead_on_inbound.sql` — `ADD COLUMN IF NOT EXISTS ... boolean NOT NULL DEFAULT false` + COMMENT.
- `supabase/functions/agent-message/gate-decision.ts` — **novo** helper puro `decideBlockedInboundAction(gate, autoCreateLead)` (mapeia gate+flag → `{createLead, reason}`; testável isolado).
- `supabase/functions/agent-message/index.ts` — lê a flag 1x após o lock; nos 2 gates (sem agente / audience) cria o lead quando flag ON antes do early-return.
- `src/integrations/supabase/types.ts` — patch manual: `auto_create_lead_on_inbound` no Row (`boolean`) e Insert/Update (`boolean?`) de `organizations`.
- `src/modules/identity/org-team/hooks/useAutoCreateLeadSetting.ts` — **novo** hook (read/write org-scoped, resiliente a coluna ausente, invalida no onSuccess).
- `src/modules/identity/org-team/index.ts` + `src/modules/identity/index.ts` — export do hook + tipo.
- `src/modules/pipelines/components/shared/AutoCreateLeadToggle.tsx` — **novo** componente do toggle (gate admin/master, tooltip).
- `src/modules/pipelines/components/shared/index.ts` — export do componente.
- `src/modules/pipelines/pages/{PipeWhatsapp,PipeConfirmacao,PipePropostas}.tsx` — `<AutoCreateLeadToggle />` no header, após o `PipeViewToggle`.
- `tests/unit/gate-decision.test.ts` — **novo**: cobre OFF (reasons legados, não cria) e ON (cria + reasons novos).

## Decisões
- **Coluna tipada** (não feature_flags jsonb) — semântica de gate hot-path, `DEFAULT false` garante todas as orgs OFF sem trigger de init.
- **Helper puro extraído** — a lógica de decisão dos gates estava inline no `index.ts` (difícil de testar); `gate-decision.ts` isola o mapeamento gate+flag→ação e documenta os critérios de aceite via teste.
- **Toggle na barra do funil** (não em Configurações) — pedido do CTO; `Configuracoes.tsx` está no WIP do usuário (fora de escopo).
- Log runtime da flag ON usa `action:"auto_create_lead_on_inbound"`; o caminho OFF do audience gate migrou de `status:"ok"` (off-spec) pra `status:"success"` + campos corretos de `LogRuntimeParams` — melhoria de telemetria, sem mudar o contrato HTTP.

## Follow-ups / pendências
- **Aplicar a migration no DEV** (`supabase db push --linked --project-ref bcfadphgsibjzivtbjvc`) pra persistência funcionar no localhost. NÃO aplicada nesta sessão.
- **Deploy da edge `agent-message`** (DEV/PROD) pra flag agir no runtime. NÃO deployado.
- **Limitação conhecida**: inbound **sem texto/mídia** não passa por `agent-message` (v1 não toca `whatsapp-webhook`). Esse edge case não cria lead automático — documentado como limitação de v1.
- Regenerar `types.ts` via `supabase gen types` na próxima regen consolidada (patch manual pontual por ora).
