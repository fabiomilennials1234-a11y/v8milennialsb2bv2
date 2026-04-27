# API Documentation — Design

## Arvore de Componentes

```
Configuracoes.tsx (tab "api")
└── ApiDocsSettings (lazy-loaded)
    ├── ApiDocsSidebar
    │   ├── ApiCategoryGroup (per category)
    │   │   └── ApiEndpointLink (per endpoint)
    │   └── SearchInput (filter endpoints)
    └── ApiDocsContent
        ├── ApiEndpointHeader
        │   ├── MethodBadge
        │   └── EndpointPath (with copy)
        ├── ApiAuthSection
        ├── ApiParamsTable
        │   └── ApiParamRow (recursive for children)
        ├── ApiResponseSection
        │   ├── ApiParamsTable (response fields)
        │   └── JsonBlock (collapsible response example)
        ├── ApiNotesSection
        └── ApiCodePanel (right panel, dark bg)
            ├── OrgDataBanner
            ├── LanguageSwitcher (curl/js/python)
            ├── CodeBlock (request example)
            ├── JsonBlock (response example)
            └── ApiExplorer
                ├── ApiExplorerForm
                │   └── ApiParamField (dynamic per param)
                ├── SendButton
                └── ApiExplorerResponse
```

## Localizacao dos Arquivos

```
src/components/settings/api-docs/
├── ApiDocsSettings.tsx          — Container principal (3-panel layout)
├── ApiDocsSidebar.tsx           — Navegacao lateral
├── ApiDocsContent.tsx           — Painel central
├── ApiCodePanel.tsx             — Painel direito (dark)
├── ApiEndpointHeader.tsx        — Badge + path + descricao
├── ApiAuthSection.tsx           — Secao de autenticacao
├── ApiParamsTable.tsx           — Tabela de parametros (reutilizada para request e response)
├── ApiNotesSection.tsx          — Notas e observacoes
├── ApiExplorer.tsx              — Try It form + response
├── MethodBadge.tsx              — Badge colorido do metodo HTTP
├── CodeBlock.tsx                — Bloco de codigo com copy + syntax highlight
└── JsonBlock.tsx                — JSON colapsavel com syntax highlight
```

## Data Flow

```
useOrganization() ──→ organizationId
                  ──→ baseUrl (VITE_SUPABASE_URL)

apiCategories[] ──→ ApiDocsSidebar (lista endpoints)
              ──→ ApiDocsContent (detalhes do endpoint selecionado)

selectedEndpoint ──→ code-generators.ts ──→ CodeBlock (com org data injetado)
                ──→ ApiExplorer (gera form dinamico)

ApiExplorer.onSubmit() ──→ fetch() real ──→ ApiExplorerResponse
```

## State Management

```typescript
// Estado local do ApiDocsSettings
const [selectedEndpointId, setSelectedEndpointId] = useState<string>("lead-webhook");
const [selectedLanguage, setSelectedLanguage] = useState<"curl" | "javascript" | "python">("curl");
const [explorerMode, setExplorerMode] = useState(false); // toggle entre code view e try-it
const [explorerResponse, setExplorerResponse] = useState<ExplorerResponse | null>(null);
const [isExecuting, setIsExecuting] = useState(false);
```

## Injecao de Dados da Org

Os code generators ja existentes recebem `baseUrl` como parametro. Vamos estender:

```typescript
interface OrgContext {
  baseUrl: string;        // import.meta.env.VITE_SUPABASE_URL
  organizationId: string; // de useOrganization()
  apiKey?: string;        // futuramente, por agora placeholder
}

// Atualizar geradores para aceitar orgContext e substituir placeholders
function generateCurl(endpoint, orgContext: OrgContext): string
function generateJavaScript(endpoint, orgContext: OrgContext): string
function generatePython(endpoint, orgContext: OrgContext): string
```

## Layout Responsivo

```
Desktop (>=1280px):  [sidebar 220px] [content flex-1] [code-panel 420px]
Tablet (1024-1279):  [sidebar 200px] [content flex-1, code abaixo]
Mobile (<1024):      [sidebar drawer] [content full-width] [code abaixo]
```

## Syntax Highlighting

Usar `prism-react-renderer` (leve, ~3.5kb) com tema dark (vsDark).
Lazy import para nao impactar bundle:
```typescript
const { Highlight, themes } = await import("prism-react-renderer");
```

## Paleta de Cores do Painel Dark

```css
/* Painel direito - sempre escuro, mesmo no light mode */
.api-code-panel {
  --panel-bg: #0a0a0a;
  --panel-border: #27272a;
  --panel-text: #fafafa;
  --panel-muted: #a1a1aa;
  --panel-accent: #3b82f6;
}
```

## API Explorer - Execucao Real

O formulario gera o body JSON e executa:

```typescript
async function executeRequest(endpoint: ApiEndpoint, formData: Record<string, unknown>, orgContext: OrgContext) {
  const url = `${orgContext.baseUrl}${endpoint.path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  
  if (endpoint.auth.type === "api-key") {
    const headerName = endpoint.auth.header.includes(" ") ? "X-Webhook-Key" : endpoint.auth.header;
    headers[headerName] = orgContext.apiKey || "SUA_API_KEY";
  }
  
  const response = await fetch(url, {
    method: endpoint.method,
    headers,
    body: JSON.stringify(formData),
  });
  
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.json(),
    duration: performance.now() - start,
  };
}
```
