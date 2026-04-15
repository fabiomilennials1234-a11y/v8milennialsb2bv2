---
tags:
  - claude-code
  - feature
  - torque-crm
  - vendas
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Funis Hub

## O que faz

Dashboard central mostrando todos os pipes estruturais (WhatsApp, Confirmacao, Propostas, Upsell) e custom funnels. Entry point unico para navegacao entre funis.

## Regras de negocio

- Pipes estruturais podem ser ocultados via `pipeline_display_config.is_visible`
- Custom pipelines separados em permanentes e temporarios
- Temporarios mostram status, deadline, e progresso de metas
- Criar novo funil ou campanha via modal central

## Como o usuario usa

1. Abre Funis Hub no menu lateral
2. Ve cards dos pipes estruturais (WhatsApp, Confirmacao, Propostas, Upsell)
3. Abaixo, ve custom pipelines permanentes e temporarios
4. Clica em qualquer card → navega para o kanban do pipe
5. Pode criar novo pipeline ou campanha direto do hub

## Edge cases

- Pipe ocultado via display_config nao aparece mas continua funcionando
- Pipeline sem leads mostra card vazio

---

## Como funciona (tecnico)

### Componentes

- `src/pages/FunisHub.tsx` - Pagina principal
- `src/components/funis/CreateFunilOuCampanhaModal.tsx` - Modal para criar novo funil ou campanha
- `src/components/funis/CreateTemporaryFunnelModal.tsx` - Wizard de campanha temporaria

### Hooks

- `usePipelineDisplayConfig.ts` - Toggle de visibilidade dos pipes estruturais
- `usePermanentCustomFunnels.ts` - Pipelines permanentes
- `useTemporaryFunnels.ts` - Pipelines temporarios (campanhas)

### Tabelas

- `pipeline_display_config` - is_visible per pipe (whatsapp, confirmacao, propostas, upsell)
- `custom_pipelines` - Filtrado por lifecycle_type e status

### Fluxo de dados

```
Usuario abre Funis Hub
  → Busca pipeline_display_config → mostra/oculta pipes estruturais
  → Busca custom_pipelines permanentes → mostra cards
  → Busca custom_pipelines temporarios (status=active) → mostra com progresso
  → Click no card → navega para pagina do pipe
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Metas]]

- [[Dashboard]]

- [[WhatsApp Evolution]]

- [[Pipe WhatsApp]]
- [[Pipe Confirmacao]]
- [[Pipe Propostas]]
- [[Pipelines Customizados]]
- [[Campanhas]]
- [[Upsell]]
