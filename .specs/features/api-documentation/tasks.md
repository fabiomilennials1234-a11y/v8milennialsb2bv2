# API Documentation — Tasks

## T1: Atualizar code-generators para aceitar OrgContext [P]
- **Where:** `src/lib/api-docs/code-generators.ts`
- **What:** Refatorar os 3 geradores para aceitar `OrgContext` e substituir placeholders por dados reais
- **Done when:** Geradores aceitam `{ baseUrl, organizationId, apiKey? }` e injetam nos exemplos

## T2: Criar componentes atomicos (MethodBadge, CodeBlock, JsonBlock) [P]
- **Where:** `src/components/settings/api-docs/`
- **What:** Componentes reutilizaveis base
- **Done when:** MethodBadge renderiza badge colorido por metodo; CodeBlock renderiza codigo com copy e syntax highlighting; JsonBlock renderiza JSON colapsavel

## T3: Criar ApiDocsSidebar [P]
- **Where:** `src/components/settings/api-docs/ApiDocsSidebar.tsx`
- **What:** Navegacao lateral com categorias e endpoints
- **Depends on:** T2 (usa MethodBadge)
- **Done when:** Sidebar renderiza categorias colapsaveis, endpoints clicaveis, endpoint ativo destacado

## T4: Criar ApiParamsTable
- **Where:** `src/components/settings/api-docs/ApiParamsTable.tsx`
- **What:** Tabela de parametros com suporte a children expandiveis
- **Done when:** Renderiza parametros com tipo, required badge, descricao, e children indentados

## T5: Criar ApiEndpointHeader + ApiAuthSection + ApiNotesSection [P]
- **Where:** `src/components/settings/api-docs/`
- **What:** Componentes do painel central
- **Depends on:** T2 (usa MethodBadge)
- **Done when:** Header mostra badge+path+descricao, auth mostra tipo e exemplo, notes mostra lista

## T6: Criar ApiCodePanel
- **Where:** `src/components/settings/api-docs/ApiCodePanel.tsx`
- **What:** Painel direito dark com language switcher, code examples, org banner
- **Depends on:** T1 (code generators), T2 (CodeBlock, JsonBlock)
- **Done when:** Painel dark renderiza codigo por linguagem com dados da org injetados

## T7: Criar ApiExplorer (Try It)
- **Where:** `src/components/settings/api-docs/ApiExplorer.tsx`
- **What:** Formulario interativo para testar endpoints + response viewer
- **Depends on:** T1 (org context), T4 (form fields pattern)
- **Done when:** Formulario dinamico por parametros do endpoint, envia request real, mostra response com status

## T8: Criar ApiDocsContent (painel central orquestrador)
- **Where:** `src/components/settings/api-docs/ApiDocsContent.tsx`
- **What:** Orquestra os componentes do painel central
- **Depends on:** T4, T5
- **Done when:** Renderiza header, auth, params, response fields, e notes do endpoint selecionado

## T9: Criar ApiDocsSettings (container principal)
- **Where:** `src/components/settings/api-docs/ApiDocsSettings.tsx`
- **What:** Container do layout 3-panel com state management
- **Depends on:** T3, T6, T7, T8
- **Done when:** Layout 3-panel funcional com sidebar, content e code panel responsivos

## T10: Integrar tab na pagina de Configuracoes
- **Where:** `src/pages/Configuracoes.tsx`
- **What:** Adicionar tab "API" com lazy-load do ApiDocsSettings
- **Depends on:** T9
- **Done when:** Tab aparece em Configuracoes, clica e renderiza a documentacao
