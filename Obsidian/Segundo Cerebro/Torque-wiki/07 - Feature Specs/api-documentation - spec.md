---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/api-documentation/spec.md
---

# API Documentation - Spec

## Visao Geral

Pagina de documentacao de API world-class dentro da secao de Configuracoes, inspirada em Stripe Docs e Twilio Console. A documentacao mostra endpoints reais do sistema com exemplos pre-preenchidos usando dados da organizacao logada (org ID, base URL, API key).

## Referencia de Design

**Inspiracoes primarias:** Stripe API Docs, Twilio Console, Resend Docs
**Padrao:** Three-panel layout (nav lateral, conteudo central, painel de codigo)

## Requisitos Funcionais

### REQ-01: Tab de API Docs em Configuracoes
- Nova tab "API" na pagina de Configuracoes (`/configuracoes`)
- Icone: `Code2` do lucide-react
- Ao clicar, renderiza o componente `ApiDocsSettings` (nao navega para outra rota)
- Segue o mesmo padrao de tabs existente (Radix `Tabs`)

### REQ-02: Layout Three-Panel (Stripe-like)
- **Painel esquerdo (~220px):** Navegacao lateral fixa com categorias e endpoints agrupados
  - Categorias colapsaveis com icone e contagem de endpoints
  - Endpoint ativo destacado com borda lateral `border-l-2 border-primary`
  - Scroll independente do conteudo
- **Painel central (~flex-1):** Documentacao do endpoint selecionado
  - Badge colorido do metodo HTTP + path do endpoint
  - Descricao do endpoint
  - Secao de autenticacao
  - Tabela de parametros (expandivel para objetos aninhados)
  - Notas e observacoes
- **Painel direito (~420px, dark bg):** Painel de codigo + Try It
  - Background escuro (`bg-zinc-900`) mesmo no light mode (padrao Stripe)
  - Language switcher: cURL, JavaScript, Python
  - Exemplos de request com syntax highlighting
  - Exemplos de response colapsavel
  - Botao "Testar" para API Explorer

### REQ-03: Injecao de Dados da Organizacao
- Quando logado, os exemplos de codigo substituem placeholders por dados reais:
  - `SUA_API_KEY` → valor real da chave da org (ou placeholder explicativo se nao tiver)
  - `uuid-da-organizacao` → `organizationId` real
  - Base URL → URL real do Supabase da org
- Banner sutil acima dos exemplos: "Estes exemplos usam os dados da sua organizacao"
- Quando nao ha API key configurada: mostra banner com CTA para gerar uma

### REQ-04: API Explorer (Try It)
- Formulario interativo no painel direito para testar endpoints
- Campos do formulario gerados dinamicamente a partir dos `parameters` do endpoint
- Campos obrigatorios marcados visualmente
- Suporte a objetos aninhados (expandir/colapsar)
- Botao "Enviar Request" que executa a chamada real via fetch
- Response exibido inline com syntax highlighting e status code
- Loading state durante a execucao
- Historico da ultima request/response persistido na sessao

### REQ-05: Tabela de Parametros
- Colunas: Nome, Tipo, Obrigatorio, Descricao
- Parametros obrigatorios com badge vermelho `required`
- Parametros opcionais com badge cinza `optional`
- Objetos aninhados (children) expandiveis com indentacao visual
- Valores default exibidos quando existem

### REQ-06: Metodo HTTP Badge Colors
- `GET` → verde (`bg-emerald-500/20 text-emerald-400`)
- `POST` → azul (`bg-blue-500/20 text-blue-400`)
- `PUT` → amarelo (`bg-amber-500/20 text-amber-400`)
- `DELETE` → vermelho (`bg-red-500/20 text-red-400`)

### REQ-07: Secao de Autenticacao
- Cada endpoint mostra seu tipo de autenticacao
- Para `api-key`: mostra o header esperado e exemplo de uso
- Para `none`: aviso de que nao requer autenticacao
- Para `bearer`: mostra formato do token JWT
- Snippet copiavel de como autenticar

### REQ-08: Response Fields
- Tabela identica a de parametros mas para campos da resposta
- Mostra tipo, obrigatoriedade, e descricao
- JSON colapsavel com syntax highlighting

### REQ-09: Copy to Clipboard
- Botao de copiar em todos os blocos de codigo
- Feedback visual (icone muda para check por 2s)
- Copia o codigo com os dados da org ja injetados

### REQ-10: Responsividade
- Em telas < 1024px: layout empilhado (painel de codigo abaixo do conteudo)
- Navegacao lateral vira drawer/sheet no mobile
- Painel de codigo ocupa largura total no mobile

## Requisitos Nao-Funcionais

### NFR-01: Performance
- Componentes lazy-loaded (nao impacta o bundle da tab de Configuracoes)
- Syntax highlighting com lazy import

### NFR-02: Extensibilidade
- Novos endpoints adicionados apenas editando `src/lib/api-docs/endpoints.ts`
- Novos code generators adicionados em `src/lib/api-docs/code-generators.ts`
- Types centralizados em `src/lib/api-docs/types.ts`

### NFR-03: Acessibilidade
- Navegacao por teclado no sidebar e language switcher
- Roles ARIA corretos para expandir/colapsar
- Contraste adequado no painel dark

## Fundacao Existente

Ja existe:
- `src/lib/api-docs/types.ts` - Tipos `ApiEndpoint`, `ApiParam`, `ApiCategory`
- `src/lib/api-docs/endpoints.ts` - 3 endpoints documentados (lead-webhook, webhook-orchestrator, webhook-new-lead)
- `src/lib/api-docs/code-generators.ts` - Geradores para cURL, JavaScript, Python

## Fora de Escopo

- Criacao de API keys per-org (feature separada futura)
- Documentacao de endpoints internos (agent-message, copilot, etc.)
- Versionamento de API
- Rate limiting UI
- OpenAPI/Swagger export


## Links relacionados

- [[MOC - Arquitetura]]

- [[API Docs]]

- [[Webhooks]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
