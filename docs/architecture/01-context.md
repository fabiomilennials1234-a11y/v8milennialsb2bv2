# Architecture — Level 1: System Context

C4 model nível 1. Torque CRM no mundo. Atores externos + sistemas adjacentes.

## Diagram

```mermaid
graph TB
    classDef person fill:#08427b,stroke:#052e56,color:#fff,stroke-width:2px
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff,stroke-width:2px
    classDef external fill:#666,stroke:#444,color:#fff,stroke-width:1px

    %% Pessoas
    AdminOrg["👤 Admin Org<br/><br/>Configura org,<br/>users, integrações"]
    Membro["👤 Vendedor<br/><br/>SDR/Closer<br/>opera pipelines"]
    Master["👤 Master<br/><br/>Super-admin<br/>cross-org"]
    Lead["👤 Lead<br/><br/>Cliente final do cliente<br/>(B2B)"]

    %% Sistema central
    Torque["⭐ Torque CRM<br/><br/>SaaS B2B multi-tenant<br/>~30 orgs ativas"]

    %% Sistemas externos
    Uazapi["WhatsApp via Uazapi<br/>(provider)"]
    Meta["Meta Ads + Messenger + IG"]
    n8n["n8n<br/>(orquestração 20+ workflows)"]
    Google["Google Calendar"]
    Gemini["Google Gemini<br/>(LLM + embeddings)"]
    Asaas["Asaas<br/>(pagamentos PIX/card)"]
    Tiny["TinyERP<br/>(produtos/pedidos/NFe)"]
    SZChat["SZ.Chat Alamaster<br/>(multi-canal)"]
    ElevenLabs["ElevenLabs<br/>(TTS)"]
    Sentry["Sentry<br/>(monitoring)"]

    %% Relações pessoa → sistema
    AdminOrg -->|configura| Torque
    Membro -->|opera kanban,<br/>chat, agenda| Torque
    Master -->|admin cross-org| Torque
    Lead -.->|conversa via WhatsApp| Uazapi

    %% Sistema → externos
    Torque <-->|webhook + send msgs| Uazapi
    Torque <-->|webhook leads + msgs| Meta
    Torque <-->|webhook trigger| n8n
    Torque <-->|sync meetings| Google
    Torque -->|LLM calls<br/>+ embeddings 1536d| Gemini
    Torque <-->|cobranças + webhook| Asaas
    Torque <-->|produtos/pedidos/NFe| Tiny
    Torque <-->|multi-canal| SZChat
    Torque -->|TTS audio msgs| ElevenLabs
    Torque -->|errors + perf| Sentry

    %% n8n → externos
    n8n <-->|ingestão leads| Meta

    class AdminOrg,Membro,Master,Lead person
    class Torque system
    class Uazapi,Meta,n8n,Google,Gemini,Asaas,Tiny,SZChat,ElevenLabs,Sentry external
```

## Atores

| Ator | Papel |
|---|---|
| **Admin Org** | Configura organização: usuários, permissões, integrações |
| **Vendedor (SDR/Closer)** | Opera pipelines, chat, agenda |
| **Master** | Super-admin cross-org (Milennials staff) |
| **Lead** | Cliente final do cliente — interage via WhatsApp |

## Sistemas externos

| Sistema | Função | Tipo de relação |
|---|---|---|
| Uazapi | Provider WhatsApp multi-device | Bidirecional (webhook + send) |
| Meta | Ads + Messenger + Instagram | Bidirecional (lead ingestion + chat) |
| n8n | Orquestração de ingestão | Outbound webhook trigger |
| Google Calendar | Sync de meetings | Bidirecional OAuth |
| Google Gemini | LLM + embeddings | Outbound HTTP |
| Asaas | Pagamentos | Outbound + webhook inbound |
| TinyERP | ERP do cliente B2B | Bidirecional sync |
| SZ.Chat | Multi-canal (não-WhatsApp) | Bidirecional |
| ElevenLabs | TTS para audio msgs | Outbound |
| Sentry | Monitoring | Outbound (errors + perf) |

## Próximo nível

[02-containers.md](./02-containers.md) — zoom em containers do Torque.
