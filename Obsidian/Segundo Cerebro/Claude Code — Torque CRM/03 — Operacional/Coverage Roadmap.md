---
tags:
  - coverage
  - operacional
  - torque-crm
  - roadmap
date: 2026-04-14
---

# Coverage Roadmap — Onde Paramos e Como Retomar

## TL;DR

- **22 módulos com threshold travado** (regressão impossível no CI).
- **Global**: 69.54 stmts / 60.84 branches / 67.86 funcs / 74.53 lines.
- **Floor global**: 72/68/67/59.
- **Próximo alvo**: `_shared/logger.ts` (88%).
- **Restantes**: ~35 módulos até **85% global**.

Detalhes em [[04 — Decisões/ADR-2026-04-14-coverage-roadmap]].

## Como retomar na próxima sessão

Pedir uma dessas:

> "Continua o plano de coverage de onde paramos no `logger.ts`"

Ou mais explícito:

> "Retoma a Fase 1 do coverage roadmap. Último alvo concluído: `natural-messaging` (D031 no STATE). Próximo: `_shared/logger.ts`."

A sessão automaticamente:
1. Lê `.specs/project/STATE.md` (D009–D031 com tudo detalhado)
2. Lê `vitest.config.ts` (thresholds travados)
3. Roda `npm run test:coverage` pra estado atual
4. Segue na ordem já definida abaixo

## Ordem de execução (próximos alvos)

### Próximos `_shared/` (faltam ratchetar os últimos pontos)

1. **`_shared/logger.ts`** — 88% → 95+ (fácil, usado por 60+ edge functions)
2. **`_shared/sentry.ts`** — 88% → 95+ (error tracking wrapper)
3. **`_shared/validation.ts`** — 87% → 95+ (input validators)
4. **`_shared/track.ts`** — 86% → 95+
5. **`_shared/message-humanizer.ts`** — 90% → 95+
6. **`_shared/job-tracker.ts`** — 92% → 95+

### Depois: `src/lib/` (4 arquivos)

7. **`src/lib/audioToMp3.ts`** — 0% (browser MP3 encoder, WebAssembly wrapper)
8. **`src/lib/whatsapp.ts`** — 45%
9. **`src/lib/subscription.ts`** — 55%
10. **`src/lib/evolutionApi.ts`** — 64%

### Depois: 30 hooks React Query críticos

Ordem sugerida por valor de negócio:

| Hook | Lines | Domínio |
|---|---|---|
| `useAcoesDoDia` | 14% | Dashboard home |
| `useImportLeads` | 24% | Ingestão manual |
| `useOraculoChat` | 42% | Oráculo IA |
| `useCompetitions` | 19% | Gamificação time |
| `useBadges` | 30% | Gamificação time |
| `useUpsellClients` | 19% | Upsell pós-venda |
| `useKanbanRules` | 17% | Configuração funis |
| `useCopilotAgentAudios` | 12% | Copilot TTS |
| `useInsertLeadAction` | 0% | Ação em lead |
| `useLogger` | 30% | Runtime log |
| `useCopilotConversationHistory` | 52% | Histórico IA |
| `useCopilotConversationNotes` | 54% | Notas conversa |
| `useCopilotAgents` | 82% | CRUD agentes |
| `useLeads` | 82% | Lista leads |
| `usePipeWhatsapp` | 67% | Kanban qualificação |
| `usePipeConfirmacao` | 68% | Kanban confirmação |
| `usePipePropostas` | 69% | Kanban propostas |
| `useCustomPipelines` | 78% | Funis customizados |
| `useCustomFieldValidation` | 26% | Validação campos |
| `useCampaignTemplates` | 97% | Templates (quase feito) |
| `useChannelChat` | 76% | Chat multi-canal |
| `useCheckout` | 74% | Checkout assinatura |
| `useCommissions` | 79% | Comissões time |
| `useExportLeads` | 78% | Exportação |
| `useFollowUps` | 94% | Follow-up (quase feito) |
| `useGoogleCalendar` | 55% | Integração Google |
| `useGoogleCalendarSharing` | 67% | Compartilhamento |
| `useLeadHistory` | 45% | Timeline lead |
| `useLeadTimeline` | 54% | Timeline UI |
| `useMetaConnection` | 61% | Conexão Meta |

## Padrões técnicos pra reusar

Ao retomar, estes padrões já estão validados:

### Mock supabase com erros injetáveis

```ts
// tests/unit/lead-service-branches.test.ts
function scripted(tableResponses: Record<string, Step[]>) {
  // Cada step é uma resposta: { data, error }
  // O mock dá shift() por chamada, permitindo simular:
  // 1ª chamada = sucesso, 2ª = erro 23505, 3ª = retry sucesso.
}
```

### Re-import com env diferente

```ts
// Para módulos que fazem Deno.env.get() no top-level
async function loadModule() {
  vi.resetModules();
  return await import("../../supabase/functions/_shared/<modulo>");
}
beforeEach(async () => {
  clearDenoEnv();
  setDenoEnv("MY_KEY", "value");
  // Depois chamar `const mod = await loadModule();` dentro do teste
});
```

### Testar edge function com serve()

```ts
// Mock serve + withSentry pra capturar o handler
const capture = vi.hoisted(() => ({ handler: null as any }));
vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (h: any) => { capture.handler = h; },
}));
vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_name: string, handler: any) => handler,
}));
// Depois: const res = await capture.handler(new Request(...));
```

### HMAC real via Node crypto

```ts
// vitest.config.ts aliases the Deno URL to Node's crypto,
// so vi.mock é INERTE. Use o crypto real:
import { createHmac as realCreateHmac } from "crypto";
const expected = "sha256=" + realCreateHmac("sha256", secret).update(payload).digest("hex");
```

### Web Crypto SHA-256 para API keys

```ts
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

### Chunked base64 pra buffers grandes

```ts
// Testar com Uint8Array de >32KB pra forçar o loop
const big = new Uint8Array(100_000);
for (let i = 0; i < big.length; i++) big[i] = i % 256;
```

## Checklist ao cobrir um novo módulo

- [ ] Rodar `npm run test:coverage` pra ver estado atual
- [ ] Identificar uncovered lines via `awk '/SF:.*<modulo>/,/end_of_record/' coverage/lcov.info | grep -E "^DA:" | awk -F: '{split($2,a,","); if (a[2]==0) print a[1]}'`
- [ ] Ler o módulo + existing test (se houver)
- [ ] Escrever/completar teste cobrindo os uncovered lines
- [ ] Rodar só o teste novo — deve passar
- [ ] Rodar coverage completo — nenhum threshold falha
- [ ] Adicionar threshold novo em `vitest.config.ts` com comentário do baseline
- [ ] Validar coverage passa com threshold
- [ ] Atualizar `.specs/project/STATE.md` com decision D0XX

## Thresholds globais travados

No `vitest.config.ts` root (`coverage.thresholds`):

```
lines: 72
statements: 68
functions: 67
branches: 59
```

Qualquer PR que derrubar qualquer uma dessas falha o CI.

## Referências

- Decisão: [[04 — Decisões/ADR-2026-04-14-coverage-roadmap]]
- Changelog: [[07 — Changelog/2026-04-14]]
- Config: `vitest.config.ts`
- Estado: `.specs/project/STATE.md` (D009–D031)
- CI: `.github/workflows/test.yml`
