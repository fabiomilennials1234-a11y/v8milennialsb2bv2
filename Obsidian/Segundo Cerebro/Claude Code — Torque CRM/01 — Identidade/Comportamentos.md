---
tags:
  - claude-code
  - identidade
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Comportamentos do Agente

## Resumo

Regras de conduta, padroes de qualidade e diretrizes comportamentais extraidas do `CLAUDE.md` global do usuario e do `CLAUDE.md` do projeto.

## Identidade do usuario

- **Role**: Fundador e CTO
- **Estilo**: Descreve o que precisa ser construido em detalhe. O agente executa.
- **Padrao**: World-class. Inegociavel. Em todas as camadas.
- **Decisoes**: O usuario toma decisoes tecnicas. Nao pedir confirmacao de decisoes obvias.

## Regras de qualidade (CLAUDE.md global)

> [!important] Literalmente copiado — nao parafrasear
> - Toda escolha tecnica e a melhor escolha disponivel. Nao a padrao. Nao a popular. A melhor.
> - Toda decisao de arquitetura tem uma razao. "A gente geralmente faz assim" nao e uma razao.
> - Seguranca nao e uma preocupacao pra depois. E construida desde o primeiro commit.
> - Performance nao e uma fase de otimizacao. E uma restricao de design.
> - Qualidade de codigo nao e sobre estilo. E sobre estrutura, clareza e resiliencia.
> - Se alguem auditasse esse codebase pra comprar, nao encontraria nada pra ter vergonha.

## Padrao de design

Referencias: Apple, Airbnb, Linear, Stripe, Vercel.

- Dark-first
- Tipografia editorial
- Sensibilidade cinematografica
- Sofisticacao, diferenciacao, encantamento

> [!danger] Reprova automatica
> - Se parece um template, reprovou
> - Se poderia pertencer a qualquer produto, reprovou
> - Se escolheu a opcao segura em vez da opcao certa, reprovou

## Regras absolutas (CLAUDE.md global)

1. Nunca shippe trabalho mediano
2. Nunca escolha uma ferramenta porque e popular — escolha porque e a melhor
3. Nunca pule seguranca
4. Nunca deixe testes pra depois
5. Nunca construa pro passado

## Regras do projeto (CLAUDE.md do projeto)

### Naming

| Tipo | Convencao | Exemplo |
|------|-----------|---------|
| Componentes | PascalCase | `LeadCard.tsx` |
| Hooks | camelCase com `use` | `useLeads.ts` |
| Tabelas DB | snake_case | `lead_tags` |
| Query keys | array camelCase | `["pipe_whatsapp", orgId]` |
| Env vars | `VITE_SCREAMING_SNAKE` | `VITE_SUPABASE_URL` |

### Roles no codigo

> [!danger] REGRA CRITICA
> No codigo, roles sao SEMPRE `admin`, `master`, `membro`. Nunca usar "SDR" ou "Closer" como identificador no codigo. SDR/Closer sao conceitos de negocio — usados apenas na UI e documentacao.

### Imports

Sempre usar alias `@/`:
```typescript
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
```

### Edge functions

Padrao obrigatorio:
```typescript
Deno.serve(withSentry('nome', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req));
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // ... logica
}));
```

### React Query hooks

```typescript
// Query
export function useLeads() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["leads", organizationId],
    queryFn: async () => { /* ... */ },
    enabled: !!organizationId,
  });
}

// Mutation
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => { /* ... */ },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}
```

### Tipos do banco

```typescript
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
type Lead = Tables<"leads">;
```

## Skills disponiveis

| Comando          | Proposito                                                     |     |
| ---------------- | ------------------------------------------------------------- | --- |
| `/hm-init`       | Comecar novo projeto com melhores ferramentas                 |     |
| `/hm-engineer`   | Validar codigo em todas as camadas                            |     |
| `/hm-design`     | Validar interface contra o mais alto padrao                   |     |
| `/hm-qa`         | Testar tudo, encontrar gaps                                   |     |
| `/hm-align`      | Checar se e a coisa certa pra construir                       |     |
| /tlc-spec-driven | Sempre que começar uma nova feature no sistema, ou alteração. |     |

## Feedback persistido (memoria do agente)

- Sempre usar SDD (tlc-spec-driven) em toda conversa
- `--no-verify-jwt=false` habilita JWT (double negative trap)
- Nunca usar SDR/Closer no codigo
- Explicar banco de dados de forma simples pro dev junior
- Copilot e permissoes sao areas frageis com bugs recorrentes

## Links relacionados

- [[Permissoes]]
- [[Limitacoes]]
- [[00 — INDEX]]

## Notas do agente

> Fonte: `/Users/gabrielaureliogipp/.claude/CLAUDE.md` (global) e `/Volumes/Untitled/v8milennialsb2bv2-main/CLAUDE.md` (projeto).
> As regras de qualidade foram copiadas literalmente conforme instrucao do usuario.
