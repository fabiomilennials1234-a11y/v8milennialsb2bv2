---
type: architecture
title: Funcionalidades — Mapa To-Be (norte)
status: active
created: 2026-05-26
updated: 2026-05-26
tags: [arquitetura, funcionalidades, capabilities, to-be, norte, modularizacao]
related: ["[[Funcionalidades — Mapa Atual]]", "[[Arquitetura Atual — As-Is]]", "[[Roadmap]]", "[[ADR-2026-05-26-modularizacao-monolito-modular]]"]
owner: claude-agent
---

# Funcionalidades — Mapa To-Be (norte)

> **Visão alvo** pós-Modularização (Phase 1) + Hardening (Phase 2). Atua como **goal** do roadmap.
> Espelha [[Funcionalidades — Mapa Atual]] (As-Is) mas projeta o estado final.
> Diferenças destacadas em ⚡ por seção.
> Reversibilidade: ver [[ADR-2026-05-26-modularizacao-monolito-modular#Reversibilidade]].

---

## ⚡ TL;DR — o que muda

| Dimensão | As-Is | To-Be |
|---|---|---|
| **Organização física** | Por camada técnica (`components/`, `hooks/`, `pages/`, `functions/`) | Por bounded context (`src/modules/<bc>/`, `supabase/functions/<bc>/<fn>/`) |
| **API entre módulos** | Import direto de path interno | Apenas via `index.ts` público; cross-import enforced |
| **Pastas duplicadas** | `lead/`+`leads/`+`lead-detail/`, `chat/`+`chat-meta/`, `pipelines/`+`pipe-propostas/`+`kanban/`+`confirmacao/` | 1 pasta por BC |
| **Hooks soltos** | 250+ no root de `src/hooks/` | 0 no root; todos sob `src/modules/<bc>/hooks/` |
| **Edge functions soltas** | 97 no root de `supabase/functions/` | 0 no root; todas sob `supabase/functions/<bc>/<fn>/` |
| **_shared inflado** | 35+ módulos misturando core + domínio | `_shared/core/` (10 cross-cutting) + `_shared/<bc>/` quando necessário |
| **Naming** | pt/en mix (`campanhas`+`campaigns`, `pipeline`+`pipe-`) | 1 idioma por conceito (escolha: pt no UI, en no domínio técnico) |
| **Páginas órfãs** | `MockupChat`, `MockupChatV2`, `MockupChatV3`, `MockupChatV3 2`, `Negocios.tsx` paralelo a `PipePropostas.tsx` | Removidas ou consolidadas |
| **Telemetria** | Erros sem dimensão de domínio | Sentry tag `module:<bc>`, structured logs com `module` field |
| **Testes** | 41 testes stale em 25 files | 0 failures; 70% coverage nos top-3 módulos |
| **Boundary** | Convenção verbal | ESLint `boundaries` em error mode + CI gate |

---

## 1. Mapa de capabilities (To-Be)

```mermaid
mindmap
  root((Torque CRM<br/>14 módulos))
    identity
      Org multi-tenant
      Team Members (admin/master/membro)
      Permissions 3 camadas
      Onboarding flow
    leads
      Captura via webhook + import + duplicates
      Qualification score IA
      Rating/tags/lifecycle
      Trash + recovery
      Shadow leads (gerenciado pelo copilot)
    pipelines
      whatsapp / confirmacao / propostas / custom
      Kanban DnD universal
      Stage rules dinâmicas
      Funis hub
      (Negocios.tsx mergeado em PipePropostas)
    communication
      ⚡ Omnichannel chat (chat + chat-meta consolidado<br/>provider abstraction)
      WhatsApp via Uazapi (Evolution removido)
      Meta FB + IG
      SZ.Chat
      Mass send unificado (3 funcoes → 1)
      History sync
      Media (audio/img/doc/menu/pix)
      Templates
    copilot
      6 agent types + custom
      RAG (docs + FAQs)
      Human pause
      Oraculo Comercial
      Followup cadence
      Business context
      Tool registry
      Sanitizer + classifier
    workflows
      DAG editor visual
      Triggers / actions / conditions / branching
      Wait response / business window / delay / split AB
      Dead-letter retry universal
      ⚡ webhook-orchestrator absorve fragmentos
    campaigns
      Campanha + agente IA
      Round robin
      Mass send sequence
      Templates compartilhados com communication
      Metas + deadline
    carteira
      ⚡ Upsell absorvido (legacy folder removida)
      Customer portfolio
      Segmentação ouro/prata/novo/dormindo/resgate
      Health scoring + churn prediction + reorder cycle
      Retention actions
      Bulk message
      Orders + ERP sync (TinyERP)
    engagement
      Checklists template-driven
      Activities log unificado
      Follow-ups
      Agenda
      Gamification (badges/awards/competitions/ranking)
      Comissões
    analytics
      ⚡ Dashboard único com toggles (Outbound/Standard/TV)
      Performance individual
      Cohort analysis
      Metas + Gestão metas
      Revisão diária
      UTM tracking
    billing
      Subscription plans
      Asaas integration
      Plan quotas
      Feature flags por plano
    marketing
      Landing page premium
      Lead forms (Meta)
      UTM tracking
      Signup + auth
    integrations
      Provider facades isoladas
      Meta / Google Calendar / TinyERP / Asaas / SZ.Chat / Cal.com / ElevenLabs / Uazapi
      ⚡ Webhook orchestrator único como entrada
    platform
      Onboarding wizard
      Settings unificado
      Privacidade
      Observability (Sentry tag + structured logs)
      Cron health monitor
      Dead-letter UI
      System alerts
      Master area
```

**⚡ Mudanças**:
- **`communication`**: omnichannel (chat + chat-meta = 1 módulo, provider abstraction). Mass-send unificado (3 funções → 1 com modos).
- **`carteira`**: absorbiu `upsell/` (legacy folder removida; conceito já fundido em CONTEXT.md).
- **`workflows`**: `webhook-orchestrator` absorbe fragmentos de roteamento (`webhook-new-lead`, `webhook-confirmacao`, etc viram handlers internos).
- **`analytics`**: 3 dashboards consolidados em 1 com toggles (Standard / Outbound / TV).
- **`pipelines`**: `Negocios.tsx` mergeado em `PipePropostas.tsx` (mesma capability, nomes diferentes).

---

## 2. Lead lifecycle (To-Be — sem mudança funcional)

```mermaid
flowchart LR
    subgraph entry["Entrada — modulo marketing + leads"]
        META[Meta Ads Form]
        WHATSAPP_IN[WhatsApp inbound]
        FORM[Form externo]
        CSV[CSV import]
        CAL[Cal.com]
    end

    subgraph pipelines_mod["modulo pipelines"]
        subgraph qf["pipe_whatsapp"]
            NL[novo_lead]
            AB[abordado]
            RE[respondeu]
            AG[agendado]
        end
        subgraph cf["pipe_confirmacao"]
            RM[reuniao_marcada]
            D1[D1]
            CP[compareceu]
        end
        subgraph pp["pipe_propostas"]
            PE[proposta_enviada]
            VD[vendido]
        end
    end

    subgraph carteira_mod["modulo carteira (upsell absorvido)"]
        ON[novo cliente]
        OU[ouro]
        RG[resgate]
        UP[upsell]
    end

    META --> NL
    WHATSAPP_IN --> NL
    FORM --> NL
    CSV --> NL
    CAL -.bypass.-> RM

    NL --> AB --> RE --> AG --> RM
    RM --> D1 --> CP --> PE --> VD --> ON
    ON --> OU --> UP

    classDef mod fill:#1f4d2e,color:#fff,stroke:#2e8855,stroke-width:2px
    classDef stage fill:#664400,color:#fff

    class qf,cf,pp,pipelines_mod,carteira_mod mod
    class NL,AB,RE,AG,RM,D1,CP,PE,VD,ON,OU,UP,RG stage
```

**⚡ Mudanças**:
- Mesmo lifecycle, mas **stages e regras de transição vivem dentro do módulo** `pipelines/`
- `entry` é responsabilidade de `marketing/` (lead forms) + `leads/` (entrada genérica)
- `carteira/` é módulo único — `upsell/` legacy removida

---

## 3. Event flow (To-Be — engines com ownership claro)

```mermaid
flowchart TB
    subgraph triggers["Triggers"]
        T1[lead_created]
        T2[stage_changed]
        T3[tag_added]
        T4[message_received]
        T5[meeting_scheduled]
        T6[cron tick]
        T7[webhook external]
    end

    subgraph engines["Engines — ownership claro"]
        WF["workflows.executor<br/>(módulo workflows)"]
        COP["copilot.dispatcher<br/>(módulo copilot)"]
        CAMP["campaigns.dispatcher<br/>(módulo campaigns)"]
        FUP["copilot.followupCadence<br/>(módulo copilot)"]
        AI["copilot.aiActionExecutor<br/>(módulo copilot)"]
        WHO["workflows.webhookOrchestrator<br/>⚡ absorve fragmentos"]
    end

    subgraph apis["APIs públicas dos módulos"]
        COMM_API["communication.sendMessage()<br/>communication.massSend()"]
        PIPE_API["pipelines.moveStage()<br/>pipelines.upsertEntry()"]
        LEAD_API["leads.update()<br/>leads.addTag()"]
        ENG_API["engagement.scheduleFollowUp()<br/>engagement.applyChecklist()"]
        INT_API["integrations.tinyerp.pushOrder()"]
    end

    subgraph side["Side effects (universais via platform/observability)"]
        S1[(audit log)]
        S2[(activity feed)]
        S3[(Sentry tag:module)]
        S4[(structured logs)]
        S5[(realtime push)]
        S6[(dead_letter)]
    end

    T1 & T2 & T3 --> WF
    T7 --> WHO --> WF
    T4 --> COP
    T2 & T6 --> CAMP
    T6 --> FUP
    COP --> AI

    WF & COP & CAMP & FUP & AI --> COMM_API
    WF & AI --> PIPE_API
    WF & COP & AI --> LEAD_API
    WF & AI --> ENG_API
    WF --> INT_API

    COMM_API & PIPE_API & LEAD_API & ENG_API & INT_API --> S1 & S2 & S4 & S5
    COMM_API & PIPE_API & LEAD_API & ENG_API & INT_API -. erro .-> S3 & S6

    classDef trig fill:#1f3a5f,color:#fff
    classDef eng fill:#7a1f1f,color:#fff
    classDef api fill:#1f4d2e,color:#fff,stroke:#2e8855,stroke-width:2px
    classDef sid fill:#4a3c00,color:#fff

    class T1,T2,T3,T4,T5,T6,T7 trig
    class WF,COP,CAMP,FUP,AI,WHO eng
    class COMM_API,PIPE_API,LEAD_API,ENG_API,INT_API api
    class S1,S2,S3,S4,S5,S6 sid
```

**⚡ Mudanças**:
- Engines têm **ownership documentado** (cada um pertence a 1 módulo)
- Actions passam por **API pública do módulo dono** (não por path interno)
- **Webhook Orchestrator** absorve `webhook-new-lead`, `webhook-confirmacao`, etc — entrada única roteada para o workflow correto
- Side effects ganham `module:<bc>` tag (Pillar 5 do Hardening)

---

## 4. Matriz de interações (To-Be — enforced)

```
✅ permitido sempre  •  🔁 só via API pública  •  ❌ proibido (CI bloqueia)
```

| De ↓ / Para → | identity | leads | pipelines | communic | copilot | workflows | campaigns | carteira | engage | analytics | billing | market | integ | platform |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **identity** | — | 🔁 | 🔁 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔁 |
| **leads** | 🔁 | — | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | ❌ | ❌ | 🔁 | ❌ |
| **pipelines** | 🔁 | 🔁 | — | ❌ | ❌ | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | ❌ | ❌ | ❌ | ❌ |
| **communic** | 🔁 | 🔁 | ❌ | — | 🔁 | 🔁 | 🔁 | ❌ | ❌ | ❌ | ❌ | ❌ | 🔁 | ❌ |
| **copilot** | 🔁 | 🔁 | 🔁 | 🔁 | — | 🔁 | ❌ | 🔁 | ❌ | ❌ | ❌ | ❌ | 🔁 | ❌ |
| **workflows** | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | — | 🔁 | 🔁 | 🔁 | ❌ | ❌ | ❌ | 🔁 | ❌ |
| **campaigns** | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **carteira** | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | ❌ | — | 🔁 | ❌ | ❌ | ❌ | 🔁 | ❌ |
| **engage** | 🔁 | 🔁 | 🔁 | ❌ | ❌ | 🔁 | ❌ | ❌ | — | 🔁 | ❌ | ❌ | 🔁 | ❌ |
| **analytics** | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | — | 🔁 | 🔁 | ❌ | ❌ |
| **billing** | 🔁 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ | 🔁 | ❌ |
| **market** | 🔁 | 🔁 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔁 | ❌ | — | 🔁 | ❌ |
| **integ** | ❌ | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | 🔁 | ❌ | 🔁 | 🔁 | — | ❌ |
| **platform** | 🔁 | ❌ | ❌ | ❌ | 🔁 | 🔁 | ❌ | ❌ | ❌ | 🔁 | ❌ | ❌ | ❌ | — |

**⚡ Mudanças vs As-Is**:
- Cada `✓`/`⚙` virou `🔁` (only via public API) ou `❌` (explicitly forbidden, CI fails)
- **`analytics` é leitor-only** — escreve só em platform (telemetria)
- **`billing` é mais isolado** — só conversa com `identity` e `integ` (Asaas)
- **`platform` é base** — recebe muito mas chama pouco (não cria features de domínio)

ESLint `boundaries` config (slice 1 do Modularização) declara cada `❌` como erro. PR que viola = CI vermelho.

---

## 5. Sequence diagram (To-Be — mesmo fluxo, módulos explícitos)

Cenário idêntico: lead inbound WhatsApp + Copilot tool_call. Mudança: cada chamada **explicita o módulo dono**.

```mermaid
sequenceDiagram
    autonumber
    actor LEAD as Lead (WhatsApp)
    participant UAZ as Uazapi
    participant COMM as communication<br/>whatsapp-webhook
    participant LEADS as leads<br/>getOrCreate + history
    participant COP as copilot<br/>dispatcher
    participant RAG as copilot<br/>RAG retriever
    participant LLM as integrations<br/>llm-proxy
    participant TOOLS as copilot<br/>tool registry
    participant PIPE as pipelines<br/>upsertEntry()
    participant SEND as communication<br/>sendMessage()
    participant OBS as platform<br/>observability
    participant FE as Frontend (realtime)

    LEAD->>UAZ: msg
    UAZ->>COMM: webhook
    COMM->>LEADS: getOrCreate (shadow if new)
    COMM->>COMM: upsert conversation + msg
    COMM-->>FE: realtime push
    COMM->>COP: dispatch (lead_id, conv_id)

    COP->>COP: load agent + context
    COP->>RAG: search_knowledge
    RAG->>LLM: embed query
    LLM-->>RAG: vector
    RAG-->>COP: top-k contexts
    COP->>LLM: completion
    LLM-->>COP: response + tool_call

    alt response only
        COP->>SEND: sendMessage()
        SEND->>UAZ: POST
        SEND-->>FE: realtime push
        UAZ-->>LEAD: msg
    else response + tool_call
        COP->>TOOLS: execute (e.g. promove)
        TOOLS->>PIPE: upsertEntry()
        TOOLS->>LEADS: update()
        PIPE-->>FE: realtime push
        TOOLS-->>COP: result
        COP->>SEND: sendMessage()
        SEND->>UAZ: POST
        UAZ-->>LEAD: msg
    end

    par observability (todo passo)
        COP-->>OBS: trace + tag module:copilot
        COMM-->>OBS: trace + tag module:communication
        PIPE-->>OBS: trace + tag module:pipelines
    end

    note over COMM,SEND: Human Pause check em SEND<br/>(comm.humanPauseGuard())
```

**⚡ Mudanças**:
- Cada participant agora tem `<modulo>` prefixado — fica óbvio quem é dono
- **Observability paralela** — cada módulo emite trace+tag pra `platform`
- `humanPauseGuard()` é função pública de `communication/`, não polui copilot

---

## 6. Engines compartilhados (To-Be — cada um em 1 módulo)

| Engine | Onde mora (To-Be) | Como é consumido |
|---|---|---|
| `message-gateway` (renamed: `sendMessage`) | `modules/communication/api/sendMessage.ts` | `import { sendMessage } from "@/modules/communication"` |
| `mass-send` (3 funcs → 1) | `modules/communication/api/massSend.ts` | `import { massSend } from "@/modules/communication"` |
| `workflow-executor` | `modules/workflows/api/executor.ts` | `import { executeWorkflow } from "@/modules/workflows"` |
| `webhook-orchestrator` (⚡ expandido) | `modules/workflows/api/webhookOrchestrator.ts` | `import { handleWebhook } from "@/modules/workflows"` (substitui webhook-new-lead, etc) |
| `ai-action-executor` | `modules/copilot/api/executeAction.ts` | `import { executeAiAction } from "@/modules/copilot"` |
| `permission-engine` | `modules/identity/api/permissions.ts` | `import { canDo, assertPermission } from "@/modules/identity"` |
| `outbound-sender` | absorbido por `communication.sendMessage` + `campaigns.dispatch` | (consolidado, deixa de existir como engine separado) |
| `dispatch-router` | absorbido por `workflows.webhookOrchestrator` | (consolidado) |
| `followup-cadence` | `modules/copilot/api/followupCadence.ts` | `import { scheduleFollowup } from "@/modules/copilot"` |
| `lead-service` | `modules/leads/api/leadService.ts` | `import { getOrCreateLead, promote } from "@/modules/leads"` |
| `pipeline-adapter` (renamed: `pipelines.entries`) | `modules/pipelines/api/entries.ts` | `import { upsertEntry } from "@/modules/pipelines"` |
| `retention-gate` | `modules/carteira/api/retention.ts` | `import { shouldOfferRetention } from "@/modules/carteira"` |

**⚡ Mudanças**:
- **2 engines consolidados**: `outbound-sender` e `dispatch-router` desaparecem (suas responsabilidades viraram parte de outras APIs)
- Cada engine tem **nome de função imperativo** (não "engine"/"executor"/"adapter") — caller chama `sendMessage()`, não `MessageGateway.dispatch()`
- 10 engines → **8 funções públicas distribuídas em 6 módulos**

---

## 7. Cron jobs (To-Be — organizados por módulo)

```mermaid
flowchart LR
    CRON[pg_cron + pg_net]

    CRON -->|1min| W1["workflows/<br/>process-executions"]
    CRON -->|1min| W2["workflows/<br/>process-outbound"]
    CRON -->|1min| W3["workflows/<br/>process-webhooks"]
    CRON -->|5min| W4["workflows/<br/>retry-dlq"]

    CRON -->|1min| C1["copilot/<br/>process-ai-actions"]
    CRON -->|1min| C2["copilot/<br/>process-followups"]
    CRON -->|1min| C3["copilot/<br/>process-scheduled-user-msgs"]
    CRON -->|daily| C4["copilot/<br/>reembed-all"]

    CRON -->|1min| P1["pipelines/<br/>process-distribution"]
    CRON -->|15min| CAMP1["campaigns/<br/>rule-dispatch"]
    CRON -->|10min| COMM1["communication/<br/>session-watchdog"]
    CRON -->|daily| INT1["integrations/<br/>refresh-meta-tokens"]
    CRON -->|hourly| PL1["platform/<br/>health-check"]
    CRON -->|1min| ENG1["engagement/<br/>followup-automations"]

    classDef cron fill:#4a3c00,color:#fff
    classDef mod fill:#1f4d2e,color:#fff

    class CRON cron
    class W1,W2,W3,W4,C1,C2,C3,C4,P1,CAMP1,COMM1,INT1,PL1,ENG1 mod
```

**⚡ Mudanças**:
- **Path muda** mas comportamento + cadence iguais
- `supabase/config.toml` ajustado em slice 14 do Modularização
- Edge fn naming consistente: `<module>/<verb>-<noun>` (não `verb-noun-thing`)

---

## 8. Integrações externas (To-Be — facade isolada)

```mermaid
flowchart LR
    subgraph torque["Torque CRM (monolito modular)"]
        subgraph mods["src/modules/"]
            COMM2[communication]
            LEAD2[leads]
            CART[carteira]
            COP2[copilot]
            BILL[billing]
            ANALY[analytics]
        end

        subgraph integ_mod["modules/integrations (facades)"]
            UAZ_F[uazapi/]
            META_F[meta/]
            GCAL_F[google-calendar/]
            TINY_F[tinyerp/]
            ASA_F[asaas/]
            SZ_F[sz-chat/]
            CAL_F[cal-com/]
            ELV_F[elevenlabs/]
            LLM_F[llm-proxy/<br/>gemini+openrouter]
        end
    end

    subgraph external["Serviços externos"]
        UAZ[Uazapi]
        META[Meta API]
        GCAL[Google Calendar]
        TINY[TinyERP]
        ASA[Asaas]
        SZ[SZ.Chat]
        CAL[Cal.com]
        ELV[ElevenLabs]
        GEM[Gemini + OpenRouter]
    end

    COMM2 --> UAZ_F --> UAZ
    COMM2 --> META_F --> META
    COMM2 --> SZ_F --> SZ
    LEAD2 --> META_F
    LEAD2 --> CAL_F --> CAL
    CART --> TINY_F --> TINY
    BILL --> ASA_F --> ASA
    COP2 --> ELV_F --> ELV
    COP2 --> LLM_F --> GEM
    ANALY --> META_F

    classDef mod fill:#1f4d2e,color:#fff
    classDef facade fill:#664400,color:#fff
    classDef ext fill:#1f3a5f,color:#fff

    class COMM2,LEAD2,CART,COP2,BILL,ANALY mod
    class UAZ_F,META_F,GCAL_F,TINY_F,ASA_F,SZ_F,CAL_F,ELV_F,LLM_F facade
    class UAZ,META,GCAL,TINY,ASA,SZ,CAL,ELV,GEM ext
```

**⚡ Mudanças**:
- Cada provider é **facade isolada** em `modules/integrations/<provider>/` com:
  - Public API tipada
  - Retry + circuit breaker
  - Sentry tag `module:integrations.<provider>`
  - Zod schema dos payloads (Pillar 3)
- Módulo consumidor **nunca chama API externa direto** — sempre via facade
- Trocar provider (ex: Uazapi → Cloud API) muda só facade

---

## 9. Consolidações e remoções

Lista do que **muda funcionalmente** (não só de pasta):

### Consolidações

| O que | De | Para | Justificativa |
|---|---|---|---|
| Chat omnichannel | `chat/` + `chat-meta/` separados | `communication/` único com provider abstraction | Backend Meta já entrega em `channel_messages`. Apenas UI estava separada. ADR-2026-05-25 já antecipou. |
| Mass send | `mass-send-create` + `mass-send-control` + `mass-send-status` | `communication.massSend(action)` com `action: 'create' \| 'control' \| 'status'` | 3 endpoints com mesma surface de auth/log. |
| Webhook entry | `webhook-new-lead` + `webhook-confirmacao` + `webhook-orchestrator` + `webhook-validate-url` + `webhook-send-test` | `workflows.webhookOrchestrator(payload)` único + handlers internos | Roteamento já existe parcialmente; consolidar evita 5 patterns de auth/dedup. |
| Dashboard | `Dashboard.tsx` + `DashboardOutbound.tsx` + `TVDashboard.tsx` | `analytics.DashboardPage` único com `<DashboardModeToggle />` | 3 layouts, mesmo data source. Toggle preserva UX de cada modo. |
| Pipe propostas | `Negocios.tsx` + `PipePropostas.tsx` | `pipelines.PipePropostas` único | Mesma capability, naming legacy. |
| TinyERP push order | `tinyerp-push-order` + `tinyerp-push-upsell-order` | `integrations.tinyerp.pushOrder({ isUpsell: bool })` | Mesma rota TinyERP, só payload muda. |
| Process cron series | 9 `process-*` no root | 9 funções dentro dos módulos donos | Mesma cadence, só path muda. |

### Remoções

| O que | Por quê |
|---|---|
| Pasta `src/components/upsell/` | Conceito absorvido por `carteira/` (CONTEXT.md já diz "Carteira subsumes the legacy Upsell concept") |
| `evolution-provider.ts` + `evolution-api.test.ts` | Migração Evolution → Uazapi concluída há meses |
| `MockupChat.tsx`, `MockupChatV2.tsx`, `MockupChatV3.tsx`, `MockupChatV3 2.tsx` | Mockups órfãos; nenhum em rota ativa |
| `pages/master/` se contiver pages que duplicam settings | Caso a caso na slice 13 (platform) |
| 11 wrappers `pipe_*` views (se realtime já só ouvir `pipeline_entries`) | Caso a caso; remover só após confirmar zero consumer |

### Renomeações

| De | Para | Por quê |
|---|---|---|
| `components/campanhas/` + `pages/campaigns/` | `modules/campaigns/` (en) | Domínio técnico em inglês; UI labels continuam em pt |
| `pipe-propostas/`, `confirmacao/`, `kanban/` (espalhados) | `modules/pipelines/<sub-feature>/` | Agrupamento por BC |
| `_shared/lead-service.ts` | `modules/leads/api/leadService.ts` | Module ownership |
| Hooks `useAgent*` | `modules/copilot/hooks/use*` | Module ownership |

---

## 10. Critérios de "estamos no To-Be" (exit do projeto)

Checklist de conformidade total:

- [ ] `ls src/components/` retorna **vazio** (ou só `ui/` + `shared/`)
- [ ] `ls src/hooks/*.ts` retorna **vazio** (todos em `modules/<bc>/hooks/`)
- [ ] `ls src/pages/*.tsx` retorna **vazio** (todos em `modules/<bc>/pages/`)
- [ ] `ls supabase/functions/` retorna **só** `_shared/` + subpastas de módulo (nenhuma function solta)
- [ ] `ls supabase/functions/_shared/` retorna **só** `core/` + `<bc>/`
- [ ] Cada `modules/<bc>/` tem `index.ts` exportando API pública
- [ ] Cada `modules/<bc>/` tem `CLAUDE.md` com escopo + áreas frágeis + owner
- [ ] `eslint --max-warnings=0` passa com `boundaries` em error mode
- [ ] `npm run test:unit` retorna **0 failures**
- [ ] Top-3 módulos com 70% coverage (Pillar 1 do Hardening)
- [ ] Sentry dashboard mostra erros por `module:` tag
- [ ] Bundle delta vs As-Is: ±5%
- [ ] `MockupChat*`, `evolution-*`, `upsell/` removidos
- [ ] Mass-send consolidado em 1 função
- [ ] Webhook orchestrator único
- [ ] Dashboard único com toggle
- [ ] `Negocios.tsx` removido
- [ ] Vault Obsidian atualizado (este doc fica como referência)
- [ ] PR final `develop → main` mergeado

---

## 11. O que NÃO muda

- Stack (React 18 + TS 5.8 + Vite 5, Supabase, Tailwind, shadcn/ui, TanStack Query, etc)
- Modelo de dados (zero schema migration neste projeto, exceto se derivar de bug Pillar 2)
- Comportamento de domínio (mesmas regras, mesmas transições, mesmos triggers)
- Cron cadences
- Integrações (mesmas APIs externas)
- Permissões (mesma cascade master → admin → feature → matrix)
- Multi-tenancy (mesmo isolation via RLS + org_id)
- Stack de IA (Gemini embeddings + LLM via proxy)

---

## 12. Relação com As-Is e roadmap

```mermaid
flowchart LR
    AS[["Funcionalidades — Mapa Atual<br/>(As-Is)<br/>2026-05-26"]]
    PHASE1[Phase 1: Modularização<br/>~80h / 18 slices]
    PHASE2[Phase 2: Hardening<br/>~120h / 10 slices]
    TB[["Funcionalidades — Mapa To-Be<br/>(norte)<br/>este doc"]]

    AS -->|onde estamos| PHASE1
    PHASE1 -->|onde queremos estar| PHASE2
    PHASE2 --> TB

    classDef snap fill:#1f3a5f,color:#fff,stroke:#3070b0,stroke-width:2px
    classDef phase fill:#664400,color:#fff
    classDef goal fill:#1f4d2e,color:#fff,stroke:#2e8855,stroke-width:3px

    class AS snap
    class PHASE1,PHASE2 phase
    class TB goal
```

- **As-Is** ([[Funcionalidades — Mapa Atual]]): fotografia. Mostra dor.
- **Phase 1** ([[ADR-2026-05-26-modularizacao-monolito-modular|Modularização]]): estrutura física + boundary enforcement.
- **Phase 2** ([Hardening](../../../../.specs/features/hardening/SPEC.md)): stop-bleeding + harden top-3 + patterns reutilizáveis.
- **To-Be** (este doc): norte. Critério de aceite final do projeto inteiro.
