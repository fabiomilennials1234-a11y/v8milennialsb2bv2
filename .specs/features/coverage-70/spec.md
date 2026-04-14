# Coverage 70% — Spec

**Scope:** Complex
**Status:** In Progress
**Created:** 2026-04-13
**Owner:** QA Agent

## Summary

Elevar o test coverage do sistema de 9.33% para 70%+. Escopo: `src/hooks/`, `src/lib/`, `src/contexts/`, `supabase/functions/_shared/`. Total de 11,331 linhas — precisa cobrir 7,932 (hoje: 1,058).

## Estado atual (atualizado 2026-04-13 sessão 2 — final)

```
All files:       69.49% (7,876 / 11,333 linhas)    ← era 20.48%
src/hooks/:      ~66%   (5,013+ / 7,640)            ← era 12.7%
_shared/:        ~75%   (2,008+ / 2,682)            ← era 26.2%
src/lib/:        ~80%   (711+ / 895)                 ← era 67.4%
src/contexts/:   97%    (113 / 116)                  ← era 38.8%

Tests: 2,193 (era 977) | Files: 112 (era 74)
Gap p/ 70%: 58 linhas — QUASE LÁ
```

## Estado anterior (sessão 1)

```
All files:       20.48% (2,321 / 11,333 linhas)    ← era 6.61%
src/hooks/:      12.7%  (970 / 7,640)               ← era 0%
_shared/:        26.2%  (703 / 2,682)               ← era 2.4%
src/lib/:        67.4%  (435 / 645)                  ← era 27%
src/lib/copilot/: 63.7% (142 / 223)                 ← era 0%
src/contexts/:   38.8%  (45 / 116)                   ← era 36.4%
src/lib/api-docs/: 96.3% (26 / 27)                  ← era 0%

Tests: 977 (era 273) | Files: 74 (era 16) | 0% files: 42
Gap p/ 70%: 5,613 linhas
```

## Baseline original (início da sessão)

```
All files:       6.61%  (era 9.33% com hooks excluídos)
Total antigo:    273 testes em 16 arquivos
src/hooks/:      1.1%   (81 / 7,640)    — 115 de 122 arquivos em 0%
_shared/:       12.5%   (334 / 2,680)   — 22 de 33 arquivos em 0%
src/lib/:       66.7%   (430 / 645)     — 3 de 19 em 0%
src/lib/copilot/: 63.7% (142 / 223)     — 2 de 7 em 0%
src/contexts/:  38.8%   (45 / 116)      — 2 de 3 em 0%
src/lib/api-docs/: 96.3% (26 / 27)      — done
```

## Meta

- **Total:** 70%+ (7,932+ linhas cobertas)
- **src/lib/:** 80%+
- **src/hooks/:** 65%+
- **_shared/:** 55%+
- **src/contexts/:** 80%+

## Decisões

### D1: Hooks são o alvo principal
67% do gap (5,267 linhas) está nos hooks. Cada hook segue o mesmo padrão (useQuery/useMutation + Supabase). Um helper de teste reutilizável permite escalar testes rapidamente.

### D2: _shared usa mock Deno + Supabase
Módulos _shared dependem de Deno runtime e Supabase client. Usamos:
- `tests/helpers/deno-mock.ts` — mock do Deno.env global
- `tests/helpers/supabase-mock.ts` — mock do Supabase client chain
- Testes de integração contra produção (org `__integration_test_org__`) para fluxos E2E

### D3: Sem push até validação local
Todo trabalho de coverage é local. Push só quando a suite estiver estável e o CI não vai quebrar.

### D4: Prioridade por criticidade de negócio
Hooks são testados na ordem de: mais importados → mais críticos (auth, leads, pipelines, copilot, campaigns).

## Infraestrutura criada

| Arquivo | Propósito |
|---------|-----------|
| `tests/helpers/supabase-mock.ts` | Mock leve do Supabase client (from/select/eq/insert chain) |
| `tests/helpers/deno-mock.ts` | Mock do Deno.env.get() pra _shared modules |
| `tests/integration/setup-prod.ts` | Setup de integração contra produção (org isolada) |
| `vitest.config.ts` | Coverage expandido: lib + hooks + contexts + _shared. Reporter: json-summary |

## Comandos

```bash
# Rodar todos os unit tests
npm run test:unit

# Rodar com coverage (text + html + json-summary)
npm run test:coverage

# Rodar testes de integração (precisa de rede)
npx vitest run tests/integration/

# Rodar um arquivo de teste específico
npx vitest run tests/unit/nome-do-teste.test.ts

# Ver coverage HTML detalhado
open coverage/index.html

# Ver números exatos do gap
node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('coverage/coverage-summary.json','utf8'));
const t = d.total;
console.log('Lines:', t.lines.pct+'%', '('+t.lines.covered+'/'+t.lines.total+')');
console.log('Gap p/ 70%:', Math.ceil(t.lines.total*0.7) - t.lines.covered, 'linhas');
"
```

## Padrão de teste — Hooks

Todos os hooks seguem o mesmo padrão. Copie este template:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// 1. Mock Supabase ANTES dos imports
const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
  },
}));

// 2. Mock dependências do hook
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: {} }),
}));

// 3. Import o hook DEPOIS dos mocks
import { useNomeDoHook } from "@/hooks/useNomeDoHook";

// 4. Wrapper com QueryClient
function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// 5. Helper pra mock de query chain
function mockSupabaseQuery(data: unknown[], error = null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          then: (fn: Function) => fn({ data, error }),
        }),
      }),
    }),
  });
}

// 6. Testes
describe("useNomeDoHook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns data when query succeeds", async () => {
    mockSupabaseQuery([{ id: "1", name: "Test" }]);
    const { result } = renderHook(() => useNomeDoHook(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
  });

  it("returns empty array when no data", async () => {
    mockSupabaseQuery([]);
    const { result } = renderHook(() => useNomeDoHook(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
```

## Padrão de teste — _shared modules

```typescript
import { describe, it, expect, vi } from "vitest";
import "../../tests/helpers/deno-mock";       // Mock Deno.env
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Se o módulo usa fetch:
global.fetch = vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
});

import { minhaFuncao } from "../../supabase/functions/_shared/meu-modulo";

describe("minhaFuncao", () => {
  it("funciona com mock", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("leads", [{ id: "1", name: "Test" }]);
    const result = await minhaFuncao(sb, "org-1");
    expect(result).toBeDefined();
  });
});
```

## Padrão de teste — Integração contra produção

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabaseProd, ensureTestOrg, cleanupTestData } from "./setup-prod";

let orgId = "";

describe("meu-modulo — production", () => {
  beforeAll(async () => { orgId = await ensureTestOrg(); }, 30000);
  afterAll(async () => { await cleanupTestData(); }, 30000);

  it("cria dado na org de teste", async () => {
    const { data } = await supabaseProd.from("leads").insert({
      name: "Test", organization_id: orgId, origin: "test",
    }).select("id").single();
    expect(data?.id).toBeTruthy();
  });
});
```
