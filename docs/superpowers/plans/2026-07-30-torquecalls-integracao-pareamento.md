# TorqueCalls — integração e pareamento self-service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o cliente ligue a chamada de voz num número de WhatsApp que ele já tem, pelo catálogo de integrações do CRM, escaneando um QR — sem script de terminal.

**Architecture:** A tela vive no `IntegrationsCatalog` como as outras integrações. O QR chega ao navegador por SSE direto da VPS, com um token de 60 s no header, e é renderizado no cliente — nunca é persistido. Um leitor de SSE isolado (`torquecallsEvents`) esconde `fetch`, `ReadableStream` e renovação de token, e será reaproveitado pela chamada entrante.

**Tech Stack:** React 18 + TS 5.8, TanStack Query v5, shadcn/ui, Vitest + Testing Library, Supabase Edge Functions (Deno), Postgres.

## Global Constraints

- Worktree: `/Users/gabrielaureliogipp/Dev/wt-torquecalls-s8`, branch `feat/torquecalls-voip-foundation`.
- Spec: `docs/superpowers/specs/2026-07-30-torquecalls-integracao-pareamento-design.md`.
- Cross-module sempre pelo barrel `@/modules/<bc>`; deep import só para `pages/*`.
- Toda query filtra `organization_id`; o frontend nunca envia org_id — vem do auth context.
- O QR é credencial: não persistir, não logar, não colocar em query string.
- Token vai em header `Authorization`, nunca em query string.
- Escopo v1: **parear e desconectar**. Estado ao vivo, teto diário editável e consentimento ficam de fora.
- Teto por organização: `organizations.voice_sessions_cap`, `integer NOT NULL DEFAULT 10`, `CHECK >= 0`. Aqui `0` significa zero mesmo.
- Feature de gate: `voice_calls`, nasce **false** em todos os planos, verificada no cliente **e** no servidor.
- Toda asserção de fronteira nasce com uma planta que a deixa vermelha.
- Comandos: `npm run test:unit` (Vitest), `npm run lint`, `npm run build`.
- As funções `torquecalls-*` existem **só em produção**. Deploy: `supabase functions deploy <fn> --project-ref jsjsmuncfkbsbzqzqhfq`.

## Correção à spec

A spec fala em `org_features`. O mecanismo real do projeto é outro, e foi conferido: `useOrgFeatures().hasFeature(key)` resolve contra `subscription_plans.features` (jsonb), com `FeatureKey` declarada em `src/modules/platform/lib/feature-registry.ts`. Master sempre recebe `true`. O plano segue o mecanismo real.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20270730000004_voip_gate_e_teto_por_org.sql` | feature `voice_calls` nos planos; coluna `voice_sessions_cap` |
| `supabase/functions/torquecalls-control/index.ts` | passa a ler o teto da coluna, exigir a feature, e ligar/desligar `voice_calls_enabled` |
| `src/modules/platform/lib/feature-registry.ts` | `voice_calls` na union `FeatureKey` |
| `src/modules/communication/lib/torquecallsEvents.ts` | leitor de SSE sobre `fetch` |
| `src/modules/communication/lib/torquecallsApi.ts` | ações de controle e `pair` no streamToken |
| `src/modules/communication/hooks/useVoipSessions.ts` | lista de sessões da org |
| `src/modules/communication/hooks/useVoicePairing.ts` | máquina de estados do pareamento |
| `src/modules/communication/components/voice/VoicePairingDialog.tsx` | modal do QR |
| `src/modules/platform/components/settings/TorqueCallsSettings.tsx` | a tela |
| `src/modules/platform/components/settings/IntegrationsCatalog.tsx` | entrada no catálogo |

---

### Task 1: Gate comercial e teto por organização

**Files:**
- Create: `supabase/migrations/20270730000004_voip_gate_e_teto_por_org.sql`
- Test: `supabase/tests/voip_gate_test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `public.organizations.voice_sessions_cap integer NOT NULL DEFAULT 10`; chave `voice_calls` presente em `subscription_plans.features` com valor `false` em todo plano.

- [ ] **Step 1: Escrever o teste pgTAP que falha**

Criar `supabase/tests/voip_gate_test.sql`:

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

SELECT has_column('public', 'organizations', 'voice_sessions_cap',
  'organizations tem a coluna do teto de números de voz');

SELECT col_not_null('public', 'organizations', 'voice_sessions_cap',
  'o teto nunca é nulo — ausência de teto se escreve com 0, não com NULL');

SELECT col_default_is('public', 'organizations', 'voice_sessions_cap', '10',
  'o padrão é 10, que cobre 55 das 56 organizações');

SELECT is(
  (SELECT count(*)::int FROM public.subscription_plans
    WHERE NOT (features ? 'voice_calls')),
  0,
  'todo plano declara voice_calls — chave ausente vira false silencioso'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

O banco local do Supabase já está de pé nesta máquina, na porta 54322, com o
schema carregado. Rode **só este arquivo**, não `supabase test db`: a suíte
inteira tem 17 arquivos herdados vermelhos por motivo alheio a esta tarefa, e o
vermelho deles esconderia o seu.

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/tests/voip_gate_test.sql
```

Expected: FAIL — `column "voice_sessions_cap" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20270730000004_voip_gate_e_teto_por_org.sql`:

```sql
-- Duas chaves da voz, conforme a spec de 2026-07-30.
--
-- A do cliente é `whatsapp_instances.voice_calls_enabled`, que acompanha
-- parear e desconectar. A nossa é a feature `voice_calls`: sem ela a
-- integração não aparece e não há botão para o cliente religar.
--
-- O teto de números sai de `MAX_SESSIONS_PER_ORG = 2`, escrito à mão na edge
-- function quando nada tinha sido medido, e vira coluna por organização.
-- Diferente de `daily_call_cap`, aqui 0 significa zero mesmo: organização sem
-- direito a número de voz.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS voice_sessions_cap integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.organizations'::regclass
       AND conname = 'organizations_voice_sessions_cap_nonneg'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_voice_sessions_cap_nonneg
      CHECK (voice_sessions_cap >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.voice_sessions_cap IS
  'Quantos números de WhatsApp desta organização podem ter voz ligada. '
  'Padrão 10. 0 significa nenhum — ao contrário de daily_call_cap, onde quem '
  'libera é NULL.';

-- A feature nasce declarada e falsa em todo plano. Chave ausente resolveria
-- para false do mesmo jeito, mas silenciosamente: quem for editar planos
-- depois não veria que a voz existe.
UPDATE public.subscription_plans
   SET features = features || jsonb_build_object('voice_calls', false),
       updated_at = now()
 WHERE NOT (features ? 'voice_calls');
```

- [ ] **Step 4: Aplicar a migration no banco local e rodar o teste**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/migrations/20270730000004_voip_gate_e_teto_por_org.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/tests/voip_gate_test.sql
```

Expected: as quatro linhas do teste saem `ok`, e a última é `# Looks like you
planned 4 tests` sem nenhum `not ok`.

- [ ] **Step 5: Planta — provar que a asserção morde**

Sem esta prova, um teste verde não significa nada. Derrube a chave em uma linha
e confirme que o teste acusa:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -c \
  "UPDATE public.subscription_plans SET features = features - 'voice_calls' WHERE id = (SELECT id FROM public.subscription_plans LIMIT 1)"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/tests/voip_gate_test.sql
```

Expected: `not ok` em `todo plano declara voice_calls`.

Depois restaure e confirme o verde de novo:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -c \
  "UPDATE public.subscription_plans SET features = features || jsonb_build_object('voice_calls', false) WHERE NOT (features ? 'voice_calls')"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
  -f supabase/tests/voip_gate_test.sql
```

Expected: nenhum `not ok`.

**Não aplique nada em produção.** O banco de produção é responsabilidade do
controlador desta sessão, fora do escopo desta tarefa.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20270730000004_voip_gate_e_teto_por_org.sql supabase/tests/voip_gate_test.sql
git commit -m "feat(voip): gate comercial voice_calls e teto de números por organização"
```

---

### Task 2: A edge function passa a usar as duas chaves

**Files:**
- Modify: `supabase/functions/torquecalls-control/index.ts`
- Test: `supabase/functions/torquecalls-control/control_gate.test.ts`

**Interfaces:**
- Consumes: `organizations.voice_sessions_cap` e a feature `voice_calls` da Task 1.
- Produces: `createSession` recusa com `code: "voice_feature_off"` (HTTP 403) quando o plano não tem a feature; recusa com `code: "session_cap_reached"` (HTTP 409) usando o teto da coluna; liga `voice_calls_enabled = true` na instância ao criar a sessão e volta para `false` em `logoutSession` e `deleteSession`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `supabase/functions/torquecalls-control/control_gate.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { resolveSessionCap, voiceFeatureOn } from "./index.ts";

Deno.test("teto vem da organização, não de constante", () => {
  assertEquals(resolveSessionCap({ voice_sessions_cap: 3 }), 3);
});

Deno.test("teto 0 significa nenhum número de voz", () => {
  assertEquals(resolveSessionCap({ voice_sessions_cap: 0 }), 0);
});

Deno.test("organização sem linha cai no padrão 10", () => {
  assertEquals(resolveSessionCap(null), 10);
});

Deno.test("feature ausente no plano é desligada, não liberada", () => {
  assertEquals(voiceFeatureOn({}), false);
  assertEquals(voiceFeatureOn({ voice_calls: false }), false);
  assertEquals(voiceFeatureOn({ voice_calls: true }), true);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `deno test --allow-all supabase/functions/torquecalls-control/control_gate.test.ts`
Expected: FAIL — `resolveSessionCap` e `voiceFeatureOn` não existem.

- [ ] **Step 3: Implementar os dois helpers e exportá-los**

Em `supabase/functions/torquecalls-control/index.ts`, substituir a constante `MAX_SESSIONS_PER_ORG` por:

```ts
/** Padrão quando a organização não tem linha — mesmo default da coluna. */
const DEFAULT_VOICE_SESSIONS_CAP = 10;

export function resolveSessionCap(org: { voice_sessions_cap?: number | null } | null): number {
  const cap = org?.voice_sessions_cap;
  return typeof cap === "number" ? cap : DEFAULT_VOICE_SESSIONS_CAP;
}

/**
 * Chave ausente é chave desligada. O contrário — tratar ausência como
 * liberação — é como uma feature paga vaza para quem não comprou.
 */
export function voiceFeatureOn(features: Record<string, unknown> | null | undefined): boolean {
  return features?.voice_calls === true;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `deno test --allow-all supabase/functions/torquecalls-control/control_gate.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Ligar o gate e o teto no `createSession`**

Em `createSession`, logo depois da checagem de tenant da instância, inserir:

```ts
  const { data: plan } = await db
    .from("organizations")
    .select("voice_sessions_cap, subscription_plans(features)")
    .eq("id", caller.orgId)
    .maybeSingle();

  // Gate de interface não é gate. A mesma feature que esconde o cartão no
  // catálogo precisa recusar aqui, senão basta chamar a função direto.
  if (!voiceFeatureOn((plan as { subscription_plans?: { features?: Record<string, unknown> } })?.subscription_plans?.features)) {
    return json(403, { error: "Chamada de voz não está no plano desta organização", code: "voice_feature_off" }, cors);
  }
```

E trocar a comparação do teto:

```ts
  const cap = resolveSessionCap(plan as { voice_sessions_cap?: number | null } | null);
  if ((count ?? 0) >= cap) {
    return json(409, {
      error: `Limite de ${cap} números de voz por organização atingido`,
      code: "session_cap_reached",
    }, cors);
  }
```

- [ ] **Step 6: Ligar e desligar `voice_calls_enabled`**

Ainda em `createSession`, depois do INSERT em `voip_sessions` dar certo:

```ts
  // Sem isto o cliente pareia com sucesso e toda ligação continua recusada
  // com `voice_calls_disabled`, na raiz de fn_voip_call_reserve. Era o elo
  // que faltava para a voz sair do estado "construída e nunca ligada".
  await db.from("whatsapp_instances")
    .update({ voice_calls_enabled: true })
    .eq("id", instanceId)
    .eq("organization_id", caller.orgId);
```

Em `forwardSessionAction`, no ramo de `logoutSession` e no de `deleteSession`, desligar:

```ts
  if (action === "logoutSession" || action === "deleteSession") {
    const { data: sess } = await db
      .from("voip_sessions")
      .select("whatsapp_instance_id")
      .eq("tc_session_id", sid)
      .eq("organization_id", caller.orgId)
      .maybeSingle();
    if (sess?.whatsapp_instance_id) {
      await db.from("whatsapp_instances")
        .update({ voice_calls_enabled: false })
        .eq("id", sess.whatsapp_instance_id)
        .eq("organization_id", caller.orgId);
    }
  }
```

- [ ] **Step 7: Rodar a suíte e o lint**

Run: `deno test --allow-all supabase/functions/torquecalls-control/` e `npm run lint`
Expected: PASS nos dois.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/torquecalls-control/
git commit -m "feat(voip): gate por plano, teto por organização e voice_calls_enabled no pareamento"
```

---

### Task 3: Leitor de SSE

**Files:**
- Create: `src/modules/communication/lib/torquecallsEvents.ts`
- Test: `src/modules/communication/lib/torquecallsEvents.test.ts`

**Interfaces:**
- Consumes: nada — recebe `fetch` por injeção.
- Produces:

```ts
export interface SessionEvent {
  type: "session-qr" | "auth-state" | "session-list" | "call-status"
      | "call-ended" | "call-list" | "incoming" | "incoming-claimed";
  sessionId?: string;
  qr?: string;
  paired?: boolean;
  state?: string;
  [key: string]: unknown;
}

export interface SubscribeArgs {
  vpsUrl: string;
  token: string;
  onEvent: (event: SessionEvent) => void;
  signal: AbortSignal;
  /** Injetado nos testes. Padrão: o fetch global. */
  fetchImpl?: typeof fetch;
}

export function subscribeSessionEvents(args: SubscribeArgs): Promise<void>;
```

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/modules/communication/lib/torquecallsEvents.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { subscribeSessionEvents, type SessionEvent } from "./torquecallsEvents";

/** Monta um Response cujo corpo entrega os chunks na ordem dada. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("subscribeSessionEvents", () => {
  it("entrega um evento completo", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      fetchImpl: async () => streamOf(['data: {"type":"session-qr","sessionId":"s1","qr":"abc"}\n\n']),
    });
    expect(seen).toEqual([{ type: "session-qr", sessionId: "s1", qr: "abc" }]);
  });

  it("remonta evento partido entre dois chunks", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      // A quebra cai no meio do JSON — é o caso que uma implementação
      // ingênua, que faz JSON.parse por chunk, perde em silêncio.
      fetchImpl: async () => streamOf(['data: {"type":"session-q', 'r","sessionId":"s1","qr":"abc"}\n\n']),
    });
    expect(seen).toEqual([{ type: "session-qr", sessionId: "s1", qr: "abc" }]);
  });

  it("junta data: de várias linhas no mesmo evento", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      fetchImpl: async () => streamOf(['data: {"type":"auth-state",\ndata: "paired":true}\n\n']),
    });
    expect(seen).toEqual([{ type: "auth-state", paired: true }]);
  });

  it("manda o token no header e nunca na URL", async () => {
    const spy = vi.fn(async () => streamOf([]));
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "segredo",
      onEvent: () => {},
      signal: new AbortController().signal,
      fetchImpl: spy as unknown as typeof fetch,
    });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("segredo");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
  });

  it("ignora linha que não é JSON em vez de derrubar o stream", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      fetchImpl: async () => streamOf([': heartbeat\n\n', 'data: {"type":"auth-state"}\n\n']),
    });
    expect(seen).toEqual([{ type: "auth-state" }]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- src/modules/communication/lib/torquecallsEvents.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/modules/communication/lib/torquecallsEvents.ts`:

```ts
/**
 * Leitor do stream de eventos da VPS.
 *
 * `EventSource` nativo não serve aqui: ele não aceita header customizado, e a
 * credencial do stream não pode ir em query string — query vaza para log de
 * proxy, histórico do navegador e Referer. Por isso o transporte é `fetch` com
 * o corpo lido em pedaços.
 *
 * O `fetch` entra por injeção para que o parse — evento partido entre chunks,
 * `data:` de várias linhas, linha de comentário — seja testado sem navegador e
 * sem VPS.
 */

export interface SessionEvent {
  type:
    | "session-qr" | "auth-state" | "session-list" | "call-status"
    | "call-ended" | "call-list" | "incoming" | "incoming-claimed";
  sessionId?: string;
  qr?: string;
  paired?: boolean;
  state?: string;
  [key: string]: unknown;
}

export interface SubscribeArgs {
  vpsUrl: string;
  token: string;
  onEvent: (event: SessionEvent) => void;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function subscribeSessionEvents(args: SubscribeArgs): Promise<void> {
  const doFetch = args.fetchImpl ?? fetch;
  const response = await doFetch(`${args.vpsUrl.replace(/\/$/, "")}/api/events`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "text/event-stream",
    },
    signal: args.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`stream de eventos recusado: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // Sobra do chunk anterior. Sem ela, um evento que atravessa a fronteira de
  // dois chunks é perdido sem erro nenhum.
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const payload = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!payload) continue;
        try {
          args.onEvent(JSON.parse(payload) as SessionEvent);
        } catch {
          // Linha que não é JSON não derruba o stream. Heartbeat e comentário
          // do servidor caem aqui.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- src/modules/communication/lib/torquecallsEvents.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Planta — provar que o teste do chunk partido morde**

Trocar o corpo do laço por `args.onEvent(JSON.parse(decoder.decode(value)))`, ou seja, parse por chunk sem buffer.
Expected: FAIL em "remonta evento partido entre dois chunks". Desfazer e confirmar verde.

- [ ] **Step 6: Commit**

```bash
git add src/modules/communication/lib/torquecallsEvents.ts src/modules/communication/lib/torquecallsEvents.test.ts
git commit -m "feat(voip): leitor de SSE da VPS com token em header"
```

---

### Task 4: Ações de controle no cliente

**Files:**
- Modify: `src/modules/communication/lib/torquecallsApi.ts`
- Test: `src/modules/communication/lib/torquecallsApi.control.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:

```ts
export async function createVoiceSession(args: { whatsappInstanceId: string; name?: string }): Promise<{ tcSessionId: string }>;
export async function pairVoiceSession(args: { tcSessionId: string }): Promise<void>;
export async function logoutVoiceSession(args: { tcSessionId: string }): Promise<void>;
export async function requestStreamToken(args: { tcSessionId: string; pair?: boolean }): Promise<StreamTokenResult>;
export class VoiceControlError extends Error { code: string; }
export const VOICE_CONTROL_MESSAGES: Record<string, string>;
```

`pairVoiceSession` existe por um motivo concreto: pedir um QR novo numa sessão
que já existe. Sem ela, "tentar de novo" chamaria `createVoiceSession` e criaria
outra sessão a cada tentativa — três tentativas frustradas estourariam o teto da
organização com sessões órfãs.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/modules/communication/lib/torquecallsApi.control.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  createVoiceSession,
  requestStreamToken,
  VOICE_CONTROL_MESSAGES,
  VoiceControlError,
} from "./torquecallsApi";

beforeEach(() => invoke.mockReset());

describe("createVoiceSession", () => {
  it("manda a instância e devolve o id da sessão", async () => {
    invoke.mockResolvedValue({ data: { tc_session_id: "tc-1" }, error: null });
    const out = await createVoiceSession({ whatsappInstanceId: "inst-1" });
    expect(out).toEqual({ tcSessionId: "tc-1" });
    expect(invoke).toHaveBeenCalledWith("torquecalls-control", {
      body: { action: "createSession", whatsapp_instance_id: "inst-1", name: "TorqueCalls" },
    });
  });

  it("traduz o código do erro em vez de vazar o cru", async () => {
    invoke.mockResolvedValue({ data: { code: "session_cap_reached" }, error: { message: "409" } });
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({ code: "session_cap_reached" });
  });
});

describe("requestStreamToken", () => {
  it("só pede o QR quando pair é explícito", async () => {
    invoke.mockResolvedValue({ data: { token: "t", expires_at: 1, renew_in_ms: 1, vps_url: "u" }, error: null });
    await requestStreamToken({ tcSessionId: "tc-1" });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("pair");

    invoke.mockClear();
    await requestStreamToken({ tcSessionId: "tc-1", pair: true });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ pair: true });
  });
});

describe("VOICE_CONTROL_MESSAGES", () => {
  it("cobre todos os códigos que a tela pode receber", () => {
    for (const code of [
      "voice_feature_off",
      "session_cap_reached",
      "session_orphaned",
      "device_limit_reached",
    ]) {
      expect(VOICE_CONTROL_MESSAGES[code]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- src/modules/communication/lib/torquecallsApi.control.test.ts`
Expected: FAIL — `createVoiceSession` não existe.

- [ ] **Step 3: Implementar**

Acrescentar em `src/modules/communication/lib/torquecallsApi.ts`:

```ts
/**
 * Mensagens das recusas do plano de controle. Sem esta tabela o cliente vê o
 * código cru — e "session_cap_reached" não diz a ninguém o que fazer.
 */
export const VOICE_CONTROL_MESSAGES: Record<string, string> = {
  voice_feature_off:
    "A chamada de voz não está incluída no plano desta organização.",
  session_cap_reached:
    "Limite de números com voz atingido. Desconecte um número antes de ligar outro.",
  session_orphaned:
    "O número foi criado no servidor de voz mas não ficou registrado aqui. Tente de novo — o sistema vai adotar o que já existe.",
  device_limit_reached:
    "Este WhatsApp já tem 4 aparelhos conectados, que é o limite do próprio WhatsApp. Desconecte um aparelho no celular e tente de novo.",
};

export class VoiceControlError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? VOICE_CONTROL_MESSAGES[code] ?? "Não foi possível concluir a operação.");
    this.name = "VoiceControlError";
  }
}

async function control<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("torquecalls-control", {
    body: { action, ...body },
  });
  if (error) {
    const code = (data as { code?: string } | null)?.code ?? "unknown";
    throw new VoiceControlError(code, (data as { error?: string } | null)?.error);
  }
  return data as T;
}

export async function createVoiceSession(args: {
  whatsappInstanceId: string;
  name?: string;
}): Promise<{ tcSessionId: string }> {
  const data = await control<{ tc_session_id: string }>("createSession", {
    whatsapp_instance_id: args.whatsappInstanceId,
    name: args.name ?? "TorqueCalls",
  });
  return { tcSessionId: data.tc_session_id };
}

/** Pede um QR novo para uma sessão que já existe, sem criar outra. */
export async function pairVoiceSession(args: { tcSessionId: string }): Promise<void> {
  await control("pairSession", { tc_session_id: args.tcSessionId });
}

export async function logoutVoiceSession(args: { tcSessionId: string }): Promise<void> {
  await control("logoutSession", { tc_session_id: args.tcSessionId });
}
```

Acrescentar ao teste do Step 1, no `describe("createVoiceSession")`:

```ts
it("pairVoiceSession reusa a sessão em vez de criar outra", async () => {
  invoke.mockResolvedValue({ data: {}, error: null });
  const { pairVoiceSession } = await import("./torquecallsApi");
  await pairVoiceSession({ tcSessionId: "tc-1" });
  expect(invoke).toHaveBeenCalledWith("torquecalls-control", {
    body: { action: "pairSession", tc_session_id: "tc-1" },
  });
});
```

E trocar a assinatura de `requestStreamToken`:

```ts
export async function requestStreamToken(args: {
  tcSessionId: string;
  /** Só true quando a tela precisa do QR — o servidor exige permissão extra. */
  pair?: boolean;
}): Promise<StreamTokenResult> {
  const raw = await signal<{
    token: string; expires_at: number; renew_in_ms: number; vps_url: string;
  }>("streamToken", {
    tc_session_id: args.tcSessionId,
    ...(args.pair ? { pair: true } : {}),
  });
  return {
    token: raw.token,
    expiresAt: raw.expires_at,
    renewInMs: raw.renew_in_ms,
    vpsUrl: raw.vps_url,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- src/modules/communication/lib/torquecallsApi.control.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir que nada quebrou nos chamadores existentes**

Run: `npm run test:unit -- src/modules/communication/` e `npm run lint`
Expected: PASS. `useVoiceCall` chama `requestStreamToken({ tcSessionId })` sem `pair`, que continua válido.

- [ ] **Step 6: Commit**

```bash
git add src/modules/communication/lib/torquecallsApi.ts src/modules/communication/lib/torquecallsApi.control.test.ts
git commit -m "feat(voip): ações de controle de sessão no cliente, com erros traduzidos"
```

---

### Task 5: Lista de sessões de voz

**Files:**
- Create: `src/modules/communication/hooks/useVoipSessions.ts`
- Test: `src/modules/communication/hooks/useVoipSessions.test.ts`
- Modify: `src/modules/communication/index.ts` (barrel)

**Interfaces:**
- Consumes: nada.
- Produces: `useVoipSessions(): UseQueryResult<VoipSession[]>` onde `VoipSession = { tcSessionId: string; name: string | null; jid: string | null; status: string; whatsappInstanceId: string }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/modules/communication/hooks/useVoipSessions.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const rows = [
  { tc_session_id: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsapp_instance_id: "i-1" },
  { tc_session_id: "tc-2", name: "Suporte", jid: null, status: "pending", whatsapp_instance_id: "i-2" },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    }),
  },
}));

vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));

import { useVoipSessions } from "./useVoipSessions";

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useVoipSessions", () => {
  it("devolve TODAS as sessões, não só a aberta", async () => {
    const { result } = renderHook(() => useVoipSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.map((s) => s.status)).toEqual(["open", "pending"]);
  });

  it("expõe a instância de cada sessão, que é como a tela casa número e voz", async () => {
    const { result } = renderHook(() => useVoipSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].whatsappInstanceId).toBe("i-1");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- src/modules/communication/hooks/useVoipSessions.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/modules/communication/hooks/useVoipSessions.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface VoipSession {
  tcSessionId: string;
  name: string | null;
  jid: string | null;
  status: string;
  whatsappInstanceId: string;
}

/**
 * Todas as sessões de voz da organização.
 *
 * `useVoipSession` (singular) devolve só a sessão aberta, porque o botão de
 * ligar no chat precisa de uma. A tela de integração precisa das outras
 * também: uma sessão `pending` é justamente a que está esperando o QR ser
 * escaneado, e sumir com ela deixaria o cliente sem saber o que aconteceu.
 */
export function useVoipSessions() {
  const { organizationId } = useOrganization();

  return useQuery<VoipSession[]>({
    queryKey: ["voip_sessions", organizationId],
    enabled: !!organizationId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("voip_sessions")
        .select("tc_session_id, name, jid, status, whatsapp_instance_id")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        tcSessionId: r.tc_session_id as string,
        name: (r.name as string) ?? null,
        jid: (r.jid as string) ?? null,
        status: r.status as string,
        whatsappInstanceId: r.whatsapp_instance_id as string,
      }));
    },
  });
}
```

No mesmo arquivo, o teto da organização. Ele mora aqui e não em
`useOrganization` porque aquele contexto **não expõe o objeto da organização** —
só `organizationId`, `role`, `orgType` e `timezone`. Foi conferido; assumir o
contrário não compilaria.

```ts
/**
 * Quantos números de voz esta organização pode ter. A tela precisa disso para
 * mostrar o teto ANTES de o cliente esbarrar num 409.
 */
export function useVoiceSessionsCap() {
  const { organizationId } = useOrganization();

  return useQuery<number>({
    queryKey: ["voice_sessions_cap", organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("organizations")
        .select("voice_sessions_cap")
        .eq("id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      // Mesmo default da coluna. Ausência de linha não deve virar teto zero,
      // que trancaria a tela inteira por um erro de leitura.
      return (data?.voice_sessions_cap as number | undefined) ?? 10;
    },
  });
}
```

O mock do Step 1 precisa distinguir as duas tabelas, porque o encadeamento é
diferente: `voip_sessions` termina em `.order()`, `organizations` em
`.maybeSingle()`. Substituir o `vi.mock` do cliente por:

```ts
let orgRow: { voice_sessions_cap: number } | null = { voice_sessions_cap: 4 };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: orgRow, error: null }) }) }),
        };
      }
      return {
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
      };
    },
  },
}));
```

E acrescentar os dois testes do teto:

```ts
describe("useVoiceSessionsCap", () => {
  it("lê o teto da organização", async () => {
    orgRow = { voice_sessions_cap: 4 };
    const { result } = renderHook(() => useVoiceSessionsCap(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(4);
  });

  it("cai no padrão 10 quando não acha a linha, e não em zero", async () => {
    // Zero trancaria a tela inteira por causa de uma leitura que falhou.
    orgRow = null;
    const { result } = renderHook(() => useVoiceSessionsCap(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(10);
  });
});
```

Importar `useVoiceSessionsCap` junto de `useVoipSessions` no topo do arquivo de
teste.

Exportar no barrel `src/modules/communication/index.ts`:

```ts
export { useVoipSessions, useVoiceSessionsCap, type VoipSession } from "./hooks/useVoipSessions";
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- src/modules/communication/hooks/useVoipSessions.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/modules/communication/hooks/useVoipSessions.ts src/modules/communication/hooks/useVoipSessions.test.ts src/modules/communication/index.ts
git commit -m "feat(voip): hook da lista de sessões de voz da organização"
```

---

### Task 6: Máquina de estados do pareamento

**Files:**
- Create: `src/modules/communication/hooks/useVoicePairing.ts`
- Test: `src/modules/communication/hooks/useVoicePairing.test.ts`

**Interfaces:**
- Consumes: `createVoiceSession`, `requestStreamToken` (Task 4); `subscribeSessionEvents` (Task 3).
- Produces:

```ts
export type PairingStatus = "ocioso" | "criando" | "aguardando-qr" | "qr-na-tela" | "pareado" | "falhou";
export function useVoicePairing(): {
  status: PairingStatus;
  qr: string | null;
  error: string | null;
  start: (whatsappInstanceId: string) => Promise<void>;
  /** Pede QR novo para a sessão já criada. NÃO cria outra. */
  retry: () => Promise<void>;
  cancel: () => void;
};
```

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/modules/communication/hooks/useVoicePairing.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@/modules/communication/lib/torquecallsEvents";

const createVoiceSession = vi.fn();
const requestStreamToken = vi.fn();
let emit: (e: SessionEvent) => void = () => {};

vi.mock("@/modules/communication/lib/torquecallsApi", () => ({
  createVoiceSession: (...a: unknown[]) => createVoiceSession(...a),
  requestStreamToken: (...a: unknown[]) => requestStreamToken(...a),
  VoiceControlError: class extends Error { constructor(public code: string, m?: string) { super(m); } },
  VOICE_CONTROL_MESSAGES: { session_cap_reached: "Limite atingido." },
}));

vi.mock("@/modules/communication/lib/torquecallsEvents", () => ({
  subscribeSessionEvents: (args: { onEvent: (e: SessionEvent) => void }) => {
    emit = args.onEvent;
    return new Promise<void>(() => {}); // stream fica aberto
  },
}));

import { useVoicePairing } from "./useVoicePairing";

beforeEach(() => {
  createVoiceSession.mockReset().mockResolvedValue({ tcSessionId: "tc-1" });
  requestStreamToken.mockReset().mockResolvedValue({
    token: "tk", expiresAt: 0, renewInMs: 50_000, vpsUrl: "https://calls.example",
  });
});

describe("useVoicePairing", () => {
  it("vai de ocioso até o QR na tela", async () => {
    const { result } = renderHook(() => useVoicePairing());
    expect(result.current.status).toBe("ocioso");

    await act(async () => { await result.current.start("inst-1"); });
    await waitFor(() => expect(result.current.status).toBe("aguardando-qr"));

    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "codigo-do-qr" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));
    expect(result.current.qr).toBe("codigo-do-qr");
  });

  it("troca o QR quando ele rotaciona, sem sair do estado", async () => {
    const { result } = renderHook(() => useVoicePairing());
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "primeiro" }));
    await waitFor(() => expect(result.current.qr).toBe("primeiro"));
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "segundo" }));
    await waitFor(() => expect(result.current.qr).toBe("segundo"));
    expect(result.current.status).toBe("qr-na-tela");
  });

  it("conclui quando o auth-state diz que pareou, e larga o QR", async () => {
    const { result } = renderHook(() => useVoicePairing());
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "tc-1", qr: "codigo" }));
    await waitFor(() => expect(result.current.status).toBe("qr-na-tela"));

    act(() => emit({ type: "auth-state", sessionId: "tc-1", paired: true }));
    await waitFor(() => expect(result.current.status).toBe("pareado"));
    // O QR é credencial: some assim que deixa de ser necessário.
    expect(result.current.qr).toBeNull();
  });

  it("ignora evento de outra sessão", async () => {
    const { result } = renderHook(() => useVoicePairing());
    await act(async () => { await result.current.start("inst-1"); });
    act(() => emit({ type: "session-qr", sessionId: "OUTRA", qr: "nao-e-meu" }));
    await waitFor(() => expect(result.current.status).toBe("aguardando-qr"));
    expect(result.current.qr).toBeNull();
  });

  it("mostra a mensagem traduzida quando a criação é recusada", async () => {
    const { VoiceControlError } = await import("@/modules/communication/lib/torquecallsApi");
    createVoiceSession.mockRejectedValue(new (VoiceControlError as any)("session_cap_reached", "Limite atingido."));
    const { result } = renderHook(() => useVoicePairing());
    await act(async () => { await result.current.start("inst-1"); });
    await waitFor(() => expect(result.current.status).toBe("falhou"));
    expect(result.current.error).toBe("Limite atingido.");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- src/modules/communication/hooks/useVoicePairing.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/modules/communication/hooks/useVoicePairing.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createVoiceSession,
  requestStreamToken,
  VoiceControlError,
} from "@/modules/communication/lib/torquecallsApi";
import {
  subscribeSessionEvents,
  type SessionEvent,
} from "@/modules/communication/lib/torquecallsEvents";

export type PairingStatus =
  | "ocioso" | "criando" | "aguardando-qr" | "qr-na-tela" | "pareado" | "falhou";

/**
 * Orquestra o pareamento de um número.
 *
 * O QR vive só aqui, em memória, e é descartado assim que o pareamento
 * conclui: quem o lê pareia o WhatsApp da organização, então ele não fica na
 * tela nem um segundo a mais do que precisa.
 */
export function useVoicePairing() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PairingStatus>("ocioso");
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  // Guardado para que `retry` saiba recomeçar quando a falha aconteceu antes
  // de existir sessão.
  const instanceRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current = null;
    setStatus("ocioso");
    setQr(null);
    setError(null);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = useCallback((event: SessionEvent) => {
    // O stream é da organização inteira. Sem este filtro, o QR de outro
    // número apareceria no modal errado.
    if (event.sessionId && event.sessionId !== sessionRef.current) return;

    if (event.type === "session-qr" && typeof event.qr === "string") {
      setQr(event.qr);
      setStatus("qr-na-tela");
      return;
    }
    if (event.type === "auth-state" && event.paired === true) {
      setQr(null);
      setStatus("pareado");
      abortRef.current?.abort();
      abortRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["voip_sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    }
  }, [queryClient]);

  const start = useCallback(async (whatsappInstanceId: string) => {
    instanceRef.current = whatsappInstanceId;
    setError(null);
    setQr(null);
    setStatus("criando");
    try {
      const { tcSessionId } = await createVoiceSession({ whatsappInstanceId });
      sessionRef.current = tcSessionId;

      const stream = await requestStreamToken({ tcSessionId, pair: true });
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("aguardando-qr");

      void subscribeSessionEvents({
        vpsUrl: stream.vpsUrl,
        token: stream.token,
        onEvent: handleEvent,
        signal: controller.signal,
      }).catch(() => {
        if (controller.signal.aborted) return;
        setStatus("falhou");
        setError("A conexão com o servidor de voz caiu. Tente de novo.");
      });
    } catch (err) {
      setStatus("falhou");
      setError(
        err instanceof VoiceControlError
          ? err.message
          : "Não foi possível iniciar o pareamento.",
      );
    }
  }, [handleEvent]);

  /**
   * Tentar de novo NÃO recria a sessão. Se recriasse, três tentativas
   * frustradas deixariam três sessões órfãs e estourariam o teto da
   * organização — e o cliente veria "limite atingido" logo depois de falhar
   * ao conectar o primeiro número.
   */
  const retry = useCallback(async () => {
    const tcSessionId = sessionRef.current;
    // Falhou antes de a sessão existir (gate, teto, rede): aí sim é caso de
    // criar. A decisão fica aqui, e não na tela, porque só o hook sabe se
    // chegou a existir sessão.
    if (!tcSessionId) {
      if (instanceRef.current) await start(instanceRef.current);
      return;
    }
    setError(null);
    setQr(null);
    setStatus("aguardando-qr");
    try {
      await pairVoiceSession({ tcSessionId });
    } catch (err) {
      setStatus("falhou");
      setError(
        err instanceof VoiceControlError ? err.message : "Não foi possível gerar outro código.",
      );
    }
  }, [start]);

  return { status, qr, error, start, retry, cancel };
}
```

O import no topo passa a incluir `pairVoiceSession`:

```ts
import {
  createVoiceSession,
  pairVoiceSession,
  requestStreamToken,
  VoiceControlError,
} from "@/modules/communication/lib/torquecallsApi";
```

Acrescentar ao mock do Step 1 e um teste:

```ts
// no vi.mock de torquecallsApi:
pairVoiceSession: (...a: unknown[]) => pairVoiceSession(...a),

// e o teste:
it("tentar de novo reusa a sessão em vez de criar outra", async () => {
  const { result } = renderHook(() => useVoicePairing());
  await act(async () => { await result.current.start("inst-1"); });
  createVoiceSession.mockClear();

  await act(async () => { await result.current.retry(); });

  expect(pairVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1" });
  expect(createVoiceSession).not.toHaveBeenCalled();
});
```

com `const pairVoiceSession = vi.fn();` junto dos outros mocks e
`pairVoiceSession.mockReset().mockResolvedValue(undefined);` no `beforeEach`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit -- src/modules/communication/hooks/useVoicePairing.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Planta — provar que o filtro de sessão morde**

Remover a linha `if (event.sessionId && event.sessionId !== sessionRef.current) return;`.
Expected: FAIL em "ignora evento de outra sessão". Recolocar e confirmar verde.

- [ ] **Step 6: Commit**

```bash
git add src/modules/communication/hooks/useVoicePairing.ts src/modules/communication/hooks/useVoicePairing.test.ts
git commit -m "feat(voip): máquina de estados do pareamento"
```

---

### Task 7: Modal do QR

**Files:**
- Create: `src/modules/communication/components/voice/VoicePairingDialog.tsx`
- Test: `src/modules/communication/components/voice/VoicePairingDialog.test.tsx`
- Modify: `package.json` (dependência `qrcode.react`)
- Modify: `src/modules/communication/index.ts` (barrel)

**Interfaces:**
- Consumes: `useVoicePairing` (Task 6).
- Produces: `<VoicePairingDialog instanceId={string} instanceName={string} open={boolean} onOpenChange={(o: boolean) => void} />`.

- [ ] **Step 1: Instalar a dependência do QR**

O QR do TorqueCalls é string crua, não imagem — diferente do Uazapi, que já vem em base64. Precisa ser renderizado no cliente.

```bash
npm install qrcode.react@^4.2.0
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `src/modules/communication/components/voice/VoicePairingDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pairing = {
  status: "ocioso" as string,
  qr: null as string | null,
  error: null as string | null,
  start: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("@/modules/communication/hooks/useVoicePairing", () => ({
  useVoicePairing: () => pairing,
}));

import { VoicePairingDialog } from "./VoicePairingDialog";

function renderOpen() {
  return render(
    <VoicePairingDialog instanceId="i-1" instanceName="Comercial" open onOpenChange={() => {}} />,
  );
}

describe("VoicePairingDialog", () => {
  it("mostra o QR quando ele chega", () => {
    pairing.status = "qr-na-tela";
    pairing.qr = "codigo-do-qr";
    renderOpen();
    expect(screen.getByTestId("voice-pairing-qr")).toBeInTheDocument();
  });

  it("não desenha QR nenhum antes de ele chegar", () => {
    pairing.status = "aguardando-qr";
    pairing.qr = null;
    renderOpen();
    expect(screen.queryByTestId("voice-pairing-qr")).not.toBeInTheDocument();
    expect(screen.getByText(/gerando o código/i)).toBeInTheDocument();
  });

  it("mostra a mensagem de erro traduzida, não o código", () => {
    pairing.status = "falhou";
    pairing.qr = null;
    pairing.error = "Este WhatsApp já tem 4 aparelhos conectados.";
    renderOpen();
    expect(screen.getByText(/4 aparelhos conectados/i)).toBeInTheDocument();
  });

  it("confirma o pareamento", () => {
    pairing.status = "pareado";
    pairing.qr = null;
    pairing.error = null;
    renderOpen();
    expect(screen.getByText(/voz ativada/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test:unit -- src/modules/communication/components/voice/VoicePairingDialog.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 4: Implementar**

Criar `src/modules/communication/components/voice/VoicePairingDialog.tsx`:

```tsx
import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useVoicePairing } from "@/modules/communication/hooks/useVoicePairing";

interface Props {
  instanceId: string;
  instanceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoicePairingDialog({ instanceId, instanceName, open, onOpenChange }: Props) {
  const { status, qr, error, start, retry, cancel } = useVoicePairing();

  useEffect(() => {
    if (open && status === "ocioso") void start(instanceId);
    if (!open) cancel();
  }, [open, status, instanceId, start, cancel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ativar voz em {instanceName}</DialogTitle>
          <DialogDescription>
            No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[18rem] flex-col items-center justify-center gap-4">
          {(status === "criando" || status === "aguardando-qr") && (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Gerando o código…</p>
            </>
          )}

          {status === "qr-na-tela" && qr && (
            <>
              {/* Fundo branco fixo: leitor de QR precisa de contraste, e o
                  tema escuro é o padrão do produto. */}
              <div data-testid="voice-pairing-qr" className="rounded-lg bg-white p-4">
                <QRCodeSVG value={qr} size={224} level="L" />
              </div>
              <p className="text-sm text-muted-foreground">
                O código se renova sozinho a cada poucos segundos.
              </p>
            </>
          )}

          {status === "pareado" && (
            <>
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-medium">Voz ativada em {instanceName}.</p>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </>
          )}

          {status === "falhou" && (
            <>
              <TriangleAlert className="h-8 w-8 text-destructive" />
              <p className="max-w-sm text-center text-sm">{error}</p>
              {/* `retry` quando já existe sessão; `start` só quando a falha foi
                  antes de criar uma. Chamar `start` sempre criaria uma sessão
                  nova a cada tentativa e estouraria o teto da organização. */}
              {/* Só `retry`: o hook decide sozinho entre pedir QR novo e
                  recomeçar, porque só ele sabe se chegou a existir sessão. */}
              <Button variant="outline" onClick={() => void retry()}>
                Tentar de novo
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Exportar no barrel `src/modules/communication/index.ts`. A Task 8 consome tudo
isto de fora do módulo, e cross-module só passa pelo barrel:

```ts
export { VoicePairingDialog } from "./components/voice/VoicePairingDialog";
export {
  createVoiceSession,
  logoutVoiceSession,
  pairVoiceSession,
  VoiceControlError,
  VOICE_CONTROL_MESSAGES,
} from "./lib/torquecallsApi";
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test:unit -- src/modules/communication/components/voice/VoicePairingDialog.test.tsx`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/modules/communication/components/voice/ src/modules/communication/index.ts
git commit -m "feat(voip): modal de pareamento com QR renderizado no cliente"
```

---

### Task 8: A tela no catálogo de integrações

**Files:**
- Create: `src/modules/platform/components/settings/TorqueCallsSettings.tsx`
- Test: `src/modules/platform/components/settings/TorqueCallsSettings.test.tsx`
- Modify: `src/modules/platform/components/settings/IntegrationsCatalog.tsx`
- Modify: `src/modules/platform/lib/feature-registry.ts`

**Interfaces:**
- Consumes: `useVoipSessions` (Task 5), `VoicePairingDialog` (Task 7), `useWhatsAppInstances`, `useOrgFeatures`.
- Produces: nada — é a folha da árvore.

- [ ] **Step 1: Declarar a feature**

Em `src/modules/platform/lib/feature-registry.ts`, no bloco `// Integrations` da union `FeatureKey`, acrescentar:

```ts
  | "voice_calls"
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `src/modules/platform/components/settings/TorqueCallsSettings.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const instances = [
  { id: "i-1", instance_name: "Comercial", phone_number: "5548884334050", voice_calls_enabled: true },
  { id: "i-2", instance_name: "Suporte", phone_number: "5548991005289", voice_calls_enabled: false },
];
let cap = 10;

const logoutVoiceSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/communication", () => ({
  useVoipSessions: () => ({
    data: [{ tcSessionId: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsappInstanceId: "i-1" }],
    isLoading: false,
  }),
  useWhatsAppInstances: () => ({ data: instances, isLoading: false }),
  useVoiceSessionsCap: () => ({ data: cap }),
  logoutVoiceSession: (...a: unknown[]) => logoutVoiceSession(...a),
  VoiceControlError: class extends Error {},
  VoicePairingDialog: () => null,
}));

import { TorqueCallsSettings } from "./TorqueCallsSettings";

describe("TorqueCallsSettings", () => {
  it("lista os números e diz quais têm voz", () => {
    render(<TorqueCallsSettings />);
    expect(screen.getByText("Comercial")).toBeInTheDocument();
    expect(screen.getByText("Suporte")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ativar voz/i })).toBeInTheDocument();
  });

  it("mostra o teto antes de o cliente esbarrar nele", () => {
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/1 de 10/i)).toBeInTheDocument();
  });

  it("desabilita ativar quando o teto já foi atingido", () => {
    cap = 1;
    render(<TorqueCallsSettings />);
    expect(screen.getByRole("button", { name: /ativar voz/i })).toBeDisabled();
    cap = 10;
  });

  it("desconectar chama a ação de verdade — o botão não é enfeite", async () => {
    render(<TorqueCallsSettings />);
    await userEvent.click(screen.getByRole("button", { name: /desconectar/i }));
    expect(logoutVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1" });
  });
});
```

O teste precisa de `import userEvent from "@testing-library/user-event";` e do
`QueryClientProvider` em volta do render, porque o componente usa
`useQueryClient` para invalidar as listas:

```tsx
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test:unit -- src/modules/platform/components/settings/TorqueCallsSettings.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 4: Implementar**

Criar `src/modules/platform/components/settings/TorqueCallsSettings.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  logoutVoiceSession,
  useVoiceSessionsCap,
  useVoipSessions,
  useWhatsAppInstances,
  VoiceControlError,
  VoicePairingDialog,
} from "@/modules/communication";

/**
 * Voz não é um número novo: é uma capacidade de um número que a organização já
 * tem no WhatsApp — `voip_sessions.whatsapp_instance_id` é NOT NULL. Por isso
 * a tela é a lista das instâncias, e não um formulário de cadastro.
 */
export function TorqueCallsSettings() {
  const queryClient = useQueryClient();
  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const { data: sessions = [] } = useVoipSessions();
  const { data: cap = 10 } = useVoiceSessionsCap();
  const [pairing, setPairing] = useState<{ id: string; name: string } | null>(null);
  const [desconectando, setDesconectando] = useState<string | null>(null);

  const ativos = sessions.filter((s) => s.status !== "closed").length;
  const noTeto = ativos >= cap;

  const sessionDe = (instanceId: string) =>
    sessions.find((s) => s.whatsappInstanceId === instanceId && s.status !== "closed");

  async function desconectar(tcSessionId: string) {
    setDesconectando(tcSessionId);
    try {
      await logoutVoiceSession({ tcSessionId });
      // A lista e as instâncias mudam juntas: desconectar também desliga
      // `voice_calls_enabled` no servidor.
      await queryClient.invalidateQueries({ queryKey: ["voip_sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    } catch (err) {
      toast({
        title: "Não foi possível desconectar",
        description: err instanceof VoiceControlError ? err.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setDesconectando(null);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando números…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ligue por WhatsApp a partir do CRM. A voz é ativada num número que você já
        conectou — <strong>{ativos} de {cap}</strong> em uso.
      </p>

      <div className="space-y-2">
        {instances.map((inst) => {
          const sessao = sessionDe(inst.id);
          return (
            <div key={inst.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{inst.instance_name}</p>
                <p className="truncate text-xs text-muted-foreground">{inst.phone_number}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sessao ? (
                  <>
                    <Badge variant="outline">Voz ativa</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={desconectando === sessao.tcSessionId}
                      onClick={() => void desconectar(sessao.tcSessionId)}
                    >
                      <PhoneOff className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={noTeto}
                    onClick={() => setPairing({ id: inst.id, name: inst.instance_name })}
                  >
                    <Phone className="mr-2 h-4 w-4" />
                    Ativar voz
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pairing && (
        <VoicePairingDialog
          instanceId={pairing.id}
          instanceName={pairing.name}
          open
          onOpenChange={(o) => !o && setPairing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test:unit -- src/modules/platform/components/settings/TorqueCallsSettings.test.tsx`
Expected: PASS, 3/3.

- [ ] **Step 6: Entrar no catálogo, atrás da feature**

Em `src/modules/platform/components/settings/IntegrationsCatalog.tsx`:

```tsx
import { TorqueCallsSettings } from "./TorqueCallsSettings";
```

Na lista `INTEGRATIONS`, depois da entrada `whatsapp`:

```tsx
  {
    id: "torquecalls",
    name: "TorqueCalls",
    description: "Ligue por WhatsApp direto do CRM, sem sair da conversa.",
    longDescription: "Ative chamada de voz num número de WhatsApp que você já conectou. O vendedor liga pelo chat do lead, e a ligação sai pelo próprio WhatsApp da empresa.",
    category: "messaging",
    logo: <Phone className="h-6 w-6" />,
    features: ["Chamada pelo chat", "Usa o número que já existe", "Histórico no lead"],
    settingsId: "torquecalls",
    featureKey: "voice_calls",
  },
```

Em `getSettingsComponent`:

```tsx
    case "torquecalls":
      return TorqueCallsSettings;
```

E filtrar a lista pela feature, logo antes de renderizar os cartões:

```tsx
  const { hasFeature } = useOrgFeatures();
  const visiveis = INTEGRATIONS.filter(
    (i) => !i.featureKey || hasFeature(i.featureKey as FeatureKey),
  );
```

Acrescentar o campo opcional na interface `IntegrationDef`:

```tsx
  /** Quando presente, o cartão só aparece se a organização tiver a feature. */
  featureKey?: string;
```

- [ ] **Step 7: Rodar tudo**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: PASS nos três.

- [ ] **Step 8: Commit**

```bash
git add src/modules/platform/
git commit -m "feat(voip): TorqueCalls no catálogo de integrações, atrás da feature voice_calls"
```

---

## Depois do plano

Aplicar a migration da Task 1 em produção e deployar `torquecalls-control`:

```bash
supabase functions deploy torquecalls-control --project-ref jsjsmuncfkbsbzqzqhfq
```

Atenção ao deploy: ele empacota `_shared/` do working tree. Deployar de checkout atrasado reverte a `main` em produção.

Ligar a feature `voice_calls` no plano da organização de teste antes de esperar ver o cartão.
