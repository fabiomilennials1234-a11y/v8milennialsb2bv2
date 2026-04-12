---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# API Docs

## O que faz

Documentacao interativa da API com code snippets (curl/Node/Python), endpoint explorer, e parameter tables. Permite testar auth e entender a integracao. Embeddable em Settings > API.

## Regras de negocio

- Endpoints definidos estaticamente no codigo
- Code generators produzem snippets em 3 linguagens
- Sem backend dedicado — config-driven
- Documenta: Lead Webhook, Campaign mutations, etc.

## Como o usuario usa

1. Configuracoes → Tab API
2. Navega endpoints no sidebar
3. Ve parametros, exemplos request/response
4. Copia snippets curl/Node/Python
5. Testa auth headers

---

## Como funciona (tecnico)

### Componentes

- `src/pages/ApiDocs.tsx` — Pagina standalone
- `src/components/settings/api-docs/ApiDocsSettings.tsx` — Embedded em Settings
- `ApiDocsContent.tsx`, `ApiDocsSidebar.tsx`, `ApiExplorer.tsx`, `ApiEndpointHeader.tsx`, `ApiParamsTable.tsx`, `ApiAuthSection.tsx`, `ApiCodePanel.tsx`, `CodeBlock.tsx`, `JsonBlock.tsx`, `MethodBadge.tsx`

### Lib

- `src/lib/api-docs/endpoints.ts` — Categorias e endpoints
- `src/lib/api-docs/code-generators.ts` — Gera curl/Node/Python
- `src/lib/api-docs/types.ts` — TypeScript interfaces

---

## Historico de mudancas

## Links relacionados

- [[Webhooks]]
- [[Configuracoes]]
