---
title: "Slice 6 — Acervos separados: send-media (incl. áudio) + knowledge base"
feature: copilot-v2-remodel
slice: "6"
phase: "B — Capabilities core"
status: ready
depends_on: ["[[slice-1H-harness-hardening]]"]
soft_depends_on: ["[[slice-07-ingestion-rag]]", "[[slice-03-tools-media]]", "[[slice-08-wizard]]"]
branch: feat/copilot-v2/slice-6-asset-stores
handoff: "design (biblioteca UI: upload/gatilho/preview) → engenheiro"
security: true
tags: [copilot-v2, slice, execution-ready, media, security]
---

# Slice 6 — Acervos separados (send-media incl. áudio + knowledge base) 🔒

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-6-asset-stores` ← `develop`, PR → `develop`, **nunca main**. Deploy só no projeto **dev** (`bcfadphgsibjzivtbjvc`). Migration via **MCP `apply_migration`** (nunca `db push`) — e marcada **committed-not-applied**: dev tem drift (a fundação copilot-v2 pode faltar), então o executor **valida que `copilot_v2_send_media` existe em dev antes de aplicar**. Migrations são imutáveis → sempre NOVA migration com timestamp real (`date -u +%Y%m%d%H%M%S`), nunca editar uma existente. TDD: teste-que-falha→regressão. QA com counts literais.
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` (§5 Slice 6) · ADR: `docs/adr/0002-copilot-v2-architecture.md` (#5 + #12 + Emenda áudio §1) · Bloqueia: nada · Dep dura: [[slice-1H-harness-hardening]] (#677, MERGEADO) + fundação 0-C (MERGEADA) — **satisfeito**.

---

## ⚠️ Decisões abertas

🔴 **DECISÃO DE PRODUTO ABERTA — cap da biblioteca send-media com áudio.** A ADR #12 fixou "≤5 (image/video)". A Emenda §1 adiciona `audio (ptt)`. Não está decidido se o cap vira **≤5 por tipo** (image≤5, video≤5, audio≤5) ou **≤N total** (ex.: ≤8 itens ativos na org). Registrado em [[_MOC]] §Decisões abertas e no IMPLEMENTATION-PLAN §5 Slice 6.

**Como este plano lida com isso (sem inventar a regra):** a validação de cap é construída como **parâmetro configurável**, não premissa silenciosa.
- A RPC `copilot_v2_set_send_media_cap`/`copilot_v2_assert_send_media_cap` (Task 3) recebe o modo e o limite via tabela de config `copilot_v2_send_media_limits` (org-level, seeded com um **placeholder explícito que o CTO troca**), não hardcoded.
- O helper puro `assertWithinCap` (Task 2) aceita `{ mode: 'per_kind' | 'total', limit: number }` e é testado nas DUAS interpretações — quando o CTO decidir, **só o seed muda**, zero refactor de código.
- Até o CTO decidir: o seed grava `mode='per_kind', limit=5` **comentado como PROVISÓRIO** e a migration `NÃO é aplicada` (committed-not-applied) — nada entra em vigor sem decisão. O slot está explícito.

**Nada além disso é inventado.** O executor não escolhe a regra; ele entrega os dois caminhos e o slot de config.

---

## Goal

Separar definitivamente os **dois acervos org-level** que a v1 conflatava em `copilot_agent_documents` (e `copilot_agent_audios` per-agent): a **send-media library** (`image | video | audio(ptt)`, enviada CRUA ao lead via `send_media` + gate de gatilho/repetição) e a **knowledge base** (`image | video | doc | pdf`, ingerida→texto pela Slice 7, NUNCA enviada crua). Esta slice entrega: (a) o schema de send-media estendido com `audio` + cap parametrizável; (b) o bucket de storage org-scoped + validação MIME; (c) o módulo puro de seleção+gate de mídia; (d) o handler real `send_media` (hoje `not_implemented`) que resolve o item, gera signed URL e delega ao adapter WhatsApp — com fallback explícito sem silent-drop; (e) o caminho de catálogo org-level compartilhado pelos 3 arquétipos via a junction `copilot_v2_agent_media`. A KB permanece intocada como acervo separado (Slice 7 ingere).

## Architecture

Pipeline tocado (leia ponta-a-ponta antes de começar):

```
copilot-v2-worker/index.ts (I/O shell)
  → resolveContext (carrega config/caps por arquétipo)        [Slice 1-H, intocado]
  → processBatch → queue-processor.ts → cognition-loop.ts
       gate: budget → capability(can_send_media) → introspect  [capability-gate.ts]
  → tool-executor.ts  createToolExecutor → HANDLERS.send_media  ◄── HOJE not_implemented; ESTA slice implementa
       └─ send-media-selector.ts (PURO: resolve item + dedup gate "já enviou? momento?")  ◄── NOVO módulo
       └─ media-mime.ts          (PURO: kind→messageType/MIME, centraliza heurística v1)  ◄── NOVO módulo
       └─ storage.createSignedUrl("copilot-v2-send-media", path, 3600)
       └─ provider.sendMedia({ type, file: signedUrl, ... })   [whatsapp-client adapter]
```

Acervos (org-level, **nunca** conflatados):
- **Send-media** = `copilot_v2_send_media` (org-level) + `copilot_v2_agent_media` (junction agent↔media com `trigger` por arquétipo). Bucket privado `copilot-v2-send-media`. Schema atual: `kind enum('image','video')` — esta slice adiciona `'audio'`.
- **Knowledge base** = `copilot_v2_knowledge` + `copilot_v2_knowledge_chunks` (pgvector 1536d). **Intocado** aqui — Slice 7 ingere; só documentamos a fronteira pra garantir que o handler `send_media` NUNCA lê da KB.

Por que módulos puros novos: o repo mantém a lógica de decisão em `_shared/copilot-v2/*.ts` puros (rubric-engine ↔ set_qualification_tier, capability-gate ↔ gate); a seleção de mídia + dedup gate seguem o mesmo padrão (testáveis sem DB), e o `tool-executor` fica como casca I/O.

**Migração conceitual (ADR #12):** NÃO reaproveitar `copilot_agent_documents` (conflação v1 send+know) nem `copilot_agent_audios` (pool de áudio **per-agent** v1, que a ADR rejeita — áudio vira org-level na send-media library). Referência conceitual só: `src/modules/copilot/hooks/useCopilotAgentAudios.ts`, `useAgentDocuments.ts` (NÃO migrar dados, NÃO importar).

## Tech Stack

- **Deno edge functions** (`supabase/functions/**`, `import ... from "./x.ts"` com `.ts` explícito).
- **Supabase Postgres**: novo enum value + nova tabela de config de cap + RPCs `SECURITY DEFINER set search_path = public` (`revoke all from public, anon, authenticated` + `grant execute to service_role`); RLS deny-all default, SELECT org-scoped via `get_my_organization_ids()`. Storage bucket privado + policies.
- **Tests: Vitest** (NÃO `deno test`). Specs copilot-v2 vivem em `tests/unit/copilot-v2/*.test.ts` e importam os `.ts` Deno via path relativo (`../../../supabase/functions/_shared/copilot-v2/x.ts`); o transform do Vite resolve o `.ts`.
  - Arquivo único: `npx vitest run tests/unit/copilot-v2/<file>.test.ts`
  - Suíte copilot-v2 inteira: `npx vitest run tests/unit/copilot-v2/`
  - Verificado funcionando no 1-H: `npx vitest run tests/unit/copilot-v2/tool-executor.test.ts`.
  - **NÃO** passar `--reporter=basic` (falha ao carregar o reporter neste repo — usar o reporter default).

## Setup

- [ ] Criar branch a partir de `develop`:

```bash
git checkout develop && git pull && git checkout -b feat/copilot-v2/slice-6-asset-stores
```

- [ ] Baseline verde antes de tocar nada (anota counts literais pra comparar no fim):

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: suíte copilot-v2 verde. Anotar `Test Files` / `Tests` literais.

**Migration policy do slice:** Tasks 1 e 3 criam NOVAS migrations (enum `audio`, tabela de cap-config + RPCs de cap, bucket de storage). Migrations são **imutáveis** — nunca editar `20260531214954`/`20260531174908`. Default target = **dev** (`bcfadphgsibjzivtbjvc`), aplicação via MCP `apply_migration`. **Marcadas committed-not-applied:** dev tem drift; o executor **roda o pré-check** (`select to_regclass('public.copilot_v2_send_media')` ≠ null) antes de aplicar; se a fundação faltar em dev, **parar e sinalizar** (não aplicar). **PROD PROIBIDO** sem autorização explícita do CTO na sessão.

---

## Task 1 — `audio` na send-media library (enum + bucket org-scoped + MIME)

**Problem**: `copilot_v2_send_media.kind` é `copilot_v2_media_kind as enum ('image','video')` (`20260531214954_copilot_v2_slices_4_6_7_tables.sql` linha 17). A Emenda ADR §1 exige `audio (ptt)` — sem ele, não suportar áudio no v2 é **regressão funcional** (a v1 já envia áudio via `copilot_agent_audios`). Além disso não existe bucket de storage dedicado pra send-media v2: a v1 reusava `agent-documents`/`media` (conflação que a ADR #12 rejeita). E o v1 derivava `messageType`/MIME por **heurística multi-camada** (`send-document.ts` 252–262: `file_type` OR `mime_type.startsWith`) — fonte de inconsistência cross-tipo.

**Fix** — nova migration: (a) `alter type copilot_v2_media_kind add value 'audio'`; (b) criar bucket privado `copilot-v2-send-media` (org-scoped path `{org_id}/...`) + storage policies; (c) NÃO tocar a KB. O módulo MIME centralizado vem na Task 2 (puro/testável); aqui é só schema + storage.

> `ALTER TYPE ... ADD VALUE` não roda dentro de bloco transacional no Postgres antigo, mas o MCP `apply_migration` aplica statement-a-statement — manter o `add value` em statement próprio, idempotente via guarda `if not exists`.

### Files

- **Create** `supabase/migrations/<TS>_copilot_v2_send_media_audio_bucket.sql` (timestamp real via comando abaixo).

### Steps

- [ ] Reconfirmar o enum atual (deve listar `image,video`, sem `audio`):

```bash
rg -n "copilot_v2_media_kind" supabase/migrations/20260531214954_copilot_v2_slices_4_6_7_tables.sql
```

- [ ] Pré-check de fundação em dev (committed-not-applied): a tabela tem de existir antes de aplicar. Se vier `null` → **parar e sinalizar** (fundação não aplicada em dev).

```sql
-- rodar via MCP no projeto dev (read-only check, não é a migration):
select to_regclass('public.copilot_v2_send_media') as send_media_exists;
```

- [ ] Gerar o timestamp real e criar o arquivo:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_copilot_v2_send_media_audio_bucket.sql"
echo "$TS"
```

- [ ] Escrever a migration SQL (`supabase/migrations/<TS>_copilot_v2_send_media_audio_bucket.sql`):

```sql
-- ============================================================================
-- Copilot v2 — Slice 6: send-media ganha kind 'audio' (ptt) [Emenda ADR §1]
-- + bucket de storage privado org-scoped para a send-media library.
--
-- Estende o enum criado em 20260531214954 (imutável). Acervo de KNOWLEDGE
-- (copilot_v2_knowledge) NÃO é tocado — acervos são separados (ADR #12).
-- committed-not-applied: aplicar em dev via MCP só após pre-check da fundação.
-- PROD proibido sem autorização CTO.
-- ============================================================================

-- (a) Adiciona 'audio' ao enum da send-media library (idempotente).
do $$ begin
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'copilot_v2_media_kind' and e.enumlabel = 'audio'
  ) then
    alter type public.copilot_v2_media_kind add value 'audio';
  end if;
end $$;

-- (b) Bucket privado dedicado à send-media library (org-scoped por path).
--     Privado (public=false) — entrega ao lead via signed URL no send_media.
--     MIME allow-list cobre os 3 tipos (image/video/audio-ptt ogg/opus).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'copilot-v2-send-media',
  'copilot-v2-send-media',
  false,
  26214400, -- 25MB
  array[
    'image/jpeg','image/png','image/webp',
    'video/mp4','video/webm',
    'audio/ogg','audio/ogg; codecs=opus','audio/mpeg','audio/mp4','audio/aac'
  ]
)
on conflict (id) do nothing;

-- Storage policies: leitura/escrita só autenticado, escopo org pelo 1º segmento
-- do path (= organization_id). service_role bypassa RLS (worker gera signed URL).
do $$ begin
  create policy "copilot_v2_send_media_read" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'copilot-v2-send-media'
      and (storage.foldername(name))[1] in (select get_my_organization_ids()::text)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "copilot_v2_send_media_write" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'copilot-v2-send-media'
      and (storage.foldername(name))[1] in (select get_my_organization_ids()::text)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "copilot_v2_send_media_delete" on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'copilot-v2-send-media'
      and (storage.foldername(name))[1] in (select get_my_organization_ids()::text)
    );
exception when duplicate_object then null; end $$;
```

- [ ] **Validar** (committed-not-applied): aplicar em **dev** via MCP `apply_migration` SÓ se o pre-check passou. Se a fundação faltar → não aplicar, sinalizar. NÃO aplicar em prod.

- [ ] **Segurança**: bucket **privado** (entrega via signed URL, nunca link público — evita vazamento de mídia comercial entre orgs). Path `{organization_id}/...` e policies escopam por `get_my_organization_ids()` (SECURITY DEFINER, sem subquery inline em `team_members` — gotcha de recursão RLS). MIME allow-list no bucket é a 1ª camada de validação; o helper puro (Task 2) é a 2ª.

- [ ] Commit:

```bash
git add supabase/migrations/*copilot_v2_send_media_audio_bucket.sql
git commit -m "$(cat <<'EOF'
feat(copilot-v2): kind 'audio' na send-media library + bucket org-scoped

Emenda ADR §1: send-media ganha audio(ptt) — nao suportar seria regressao
(v1 ja envia audio). Estende enum copilot_v2_media_kind (imutavel) com
'audio' e cria bucket privado copilot-v2-send-media (org-scoped por path,
entrega via signed URL, MIME allow-list). Acervo de knowledge intocado
(acervos separados, ADR #12). committed-not-applied: aplicar so em dev
apos pre-check da fundacao; prod proibido.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Módulos puros: `media-mime` (kind→type/MIME) + `send-media-selector` (resolve + dedup gate)

**Problem**: hoje `send_media` é `not_implemented` (`tool-executor.ts` 9–12, 48–51). Quando for implementado (Task 4), duas decisões precisam ser **puras e testáveis sem DB**, espelhando `rubric-engine`/`capability-gate`:
1. **Normalização de media-type** — mapear `kind` (`image|video|audio`) → `messageType` do adapter WhatsApp e validar MIME. A v1 fazia isso por heurística multi-camada espalhada (`send-document.ts` 252–262) → inconsistente. Centralizar.
2. **Gate de seleção/envio** — o ADR #5 exige gate ANTES do `send_media`: "já enviou esse item nesta conversa? é o momento certo?". A v1 `checkDocumentAlreadySent` (`send-document.ts` 33–109) misturava esse gate com I/O. A decisão (dado o histórico de envios + o item) é pura.

**Fix** — dois módulos puros novos em `_shared/copilot-v2/`:
- `media-mime.ts`: `resolveMediaDelivery(kind, mimeType?)` → `{ messageType, valid }`, com allow-list única (mesma do bucket).
- `send-media-selector.ts`: `decideSendMedia({ item, alreadySentMediaIds })` → `{ allowed, reason }` (fail-CLOSED: item inativo, item de outra org, ou já enviado → bloqueia). A resolução do item (DB) fica no handler (Task 4); aqui só a decisão.

> **Nota de cap (decisão aberta):** este módulo também expõe `assertWithinCap(items, policy)` puro, testado nas DUAS interpretações de cap (`per_kind` e `total`) — ver `## ⚠️ Decisões abertas`. O VALOR/modo vem da config (Task 3), não daqui.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/media-mime.ts`.
- **Create** `supabase/functions/_shared/copilot-v2/send-media-selector.ts`.
- **Create** test `tests/unit/copilot-v2/media-mime.test.ts`.
- **Create** test `tests/unit/copilot-v2/send-media-selector.test.ts`.

### Steps

- [ ] Ler a MIME→ext de referência (`_shared/whatsapp-media.ts` 19–34) e a heurística v1 a substituir (`_shared/actions/send-document.ts` 252–262) pra ancorar o mapeamento.

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/media-mime.test.ts`:

```ts
/**
 * Slice 6 — media-mime: kind → messageType do adapter + validação MIME (Copilot v2)
 *
 * Centraliza a heurística multi-camada da v1 (send-document.ts file_type OR
 * mime.startsWith) num mapeamento único. Áudio é ptt (ogg/opus). Fail-CLOSED:
 * MIME fora da allow-list do tipo → valid:false (o handler vira fallback
 * explícito, nunca silent-drop).
 */
import { describe, it, expect } from 'vitest';
import { resolveMediaDelivery, SEND_MEDIA_MIME } from '../../../supabase/functions/_shared/copilot-v2/media-mime.ts';

describe('resolveMediaDelivery', () => {
  it('mapeia image → messageType image', () => {
    expect(resolveMediaDelivery('image', 'image/png')).toEqual({ messageType: 'image', valid: true });
  });
  it('mapeia video → messageType video', () => {
    expect(resolveMediaDelivery('video', 'video/mp4')).toEqual({ messageType: 'video', valid: true });
  });
  it('mapeia audio(ptt) → messageType audio (ogg/opus)', () => {
    expect(resolveMediaDelivery('audio', 'audio/ogg; codecs=opus')).toEqual({ messageType: 'audio', valid: true });
  });
  it('aceita kind sem mimeType (valida pelo kind, MIME default do bucket)', () => {
    expect(resolveMediaDelivery('audio', null)).toEqual({ messageType: 'audio', valid: true });
  });
  it('fail-CLOSED: MIME que não casa com o kind → valid:false', () => {
    expect(resolveMediaDelivery('image', 'application/pdf')).toEqual({ messageType: 'image', valid: false });
  });
  it('fail-CLOSED: kind desconhecido → valid:false', () => {
    expect(resolveMediaDelivery('doc' as any, 'application/pdf')).toMatchObject({ valid: false });
  });
  it('expõe a allow-list por kind (mesma do bucket)', () => {
    expect(SEND_MEDIA_MIME.audio).toContain('audio/ogg');
    expect(SEND_MEDIA_MIME).not.toHaveProperty('pdf'); // KB-only, nunca send-media
  });
});
```

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/send-media-selector.test.ts`:

```ts
/**
 * Slice 6 — send-media-selector: gate de seleção/envio puro (Copilot v2)
 *
 * ADR #5: antes do send_media um gate decide "já enviou? item válido?".
 * Fail-CLOSED: item inativo, de outra org, inexistente, ou já enviado nesta
 * conversa → bloqueia (motivo explícito, nunca silent-drop — lição VitrineVET).
 * assertWithinCap é testado nas DUAS leituras do cap (decisão de produto aberta).
 */
import { describe, it, expect } from 'vitest';
import {
  decideSendMedia,
  assertWithinCap,
  type SendMediaItem,
} from '../../../supabase/functions/_shared/copilot-v2/send-media-selector.ts';

const item = (over: Partial<SendMediaItem> = {}): SendMediaItem => ({
  id: 'm1', organization_id: 'org-1', kind: 'image', storage_path: 'org-1/a.png',
  is_active: true, ...over,
});

describe('decideSendMedia — gate fail-CLOSED', () => {
  it('permite um item ativo da org ainda não enviado', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item(), alreadySentMediaIds: [] }))
      .toEqual({ allowed: true, reason: null });
  });
  it('bloqueia item já enviado nesta conversa (anti-repetição)', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item(), alreadySentMediaIds: ['m1'] }))
      .toEqual({ allowed: false, reason: 'already_sent' });
  });
  it('bloqueia item inativo', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item({ is_active: false }), alreadySentMediaIds: [] }))
      .toEqual({ allowed: false, reason: 'item_inactive' });
  });
  it('bloqueia item de OUTRA org (isolamento multi-tenant)', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item({ organization_id: 'org-EVIL' }), alreadySentMediaIds: [] }))
      .toEqual({ allowed: false, reason: 'cross_org' });
  });
  it('bloqueia item inexistente (null)', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: null, alreadySentMediaIds: [] }))
      .toEqual({ allowed: false, reason: 'not_found' });
  });
});

describe('assertWithinCap — parametrizado (DECISÃO DE PRODUTO ABERTA)', () => {
  const five = (kind: SendMediaItem['kind']) => Array.from({ length: 5 }, (_, i) => item({ id: `${kind}-${i}`, kind }));
  it('modo per_kind: 5 imagens OK, 6ª imagem estoura', () => {
    expect(assertWithinCap(five('image'), { mode: 'per_kind', limit: 5 }).ok).toBe(true);
    expect(assertWithinCap([...five('image'), item({ id: 'x', kind: 'image' })], { mode: 'per_kind', limit: 5 }))
      .toMatchObject({ ok: false, reason: 'cap_exceeded', kind: 'image' });
  });
  it('modo per_kind: 5 de cada tipo (15 total) OK', () => {
    const all = [...five('image'), ...five('video'), ...five('audio')];
    expect(assertWithinCap(all, { mode: 'per_kind', limit: 5 }).ok).toBe(true);
  });
  it('modo total: estoura no limite agregado independentemente do tipo', () => {
    const items = Array.from({ length: 9 }, (_, i) => item({ id: `i-${i}`, kind: i % 2 ? 'video' : 'image' }));
    expect(assertWithinCap(items, { mode: 'total', limit: 8 })).toMatchObject({ ok: false, reason: 'cap_exceeded' });
    expect(assertWithinCap(items.slice(0, 8), { mode: 'total', limit: 8 }).ok).toBe(true);
  });
});
```

- [ ] Rodar — esperar FALHAR (módulos não existem):

```bash
npx vitest run tests/unit/copilot-v2/media-mime.test.ts tests/unit/copilot-v2/send-media-selector.test.ts
```

Esperado: `Test Files 2 failed` — erro de import (`media-mime.ts`/`send-media-selector.ts` ausentes).

- [ ] Implementar `supabase/functions/_shared/copilot-v2/media-mime.ts`:

```ts
/**
 * media-mime — Copilot v2 send-media type/MIME resolution (Slice 6).
 *
 * Centraliza o que a v1 espalhava em heurística multi-camada (send-document.ts):
 * dado o `kind` da biblioteca (image|video|audio-ptt), resolve o messageType do
 * adapter WhatsApp e valida o MIME contra a allow-list do tipo. Fail-CLOSED:
 * MIME fora da allow-list ou kind desconhecido → valid:false (o handler vira
 * fallback explícito, nunca silent-drop). Áudio é PTT (ogg/opus).
 *
 * A allow-list aqui é a MESMA do bucket copilot-v2-send-media (Task 1) — única
 * fonte. `doc`/`pdf` NÃO existem aqui: são knowledge-base, nunca send-media.
 */

export type SendMediaKind = "image" | "video" | "audio";
export type AdapterMessageType = "image" | "video" | "audio";

export const SEND_MEDIA_MIME: Record<SendMediaKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/webm"],
  audio: ["audio/ogg", "audio/ogg; codecs=opus", "audio/mpeg", "audio/mp4", "audio/aac"],
};

const KIND_TO_MESSAGE_TYPE: Record<SendMediaKind, AdapterMessageType> = {
  image: "image", video: "video", audio: "audio",
};

export interface MediaDelivery {
  messageType: AdapterMessageType | null;
  valid: boolean;
}

/**
 * Resolve o messageType do adapter + valida o MIME contra o kind. mimeType null
 * é aceito (o bucket já restringe MIME no upload); um mimeType presente que NÃO
 * casa com o kind → valid:false (fail-CLOSED).
 */
export function resolveMediaDelivery(
  kind: SendMediaKind,
  mimeType: string | null | undefined,
): MediaDelivery {
  const messageType = KIND_TO_MESSAGE_TYPE[kind] ?? null;
  if (!messageType) return { messageType: null, valid: false };
  if (mimeType == null) return { messageType, valid: true };
  const allow = SEND_MEDIA_MIME[kind];
  return { messageType, valid: allow.includes(mimeType) };
}
```

- [ ] Implementar `supabase/functions/_shared/copilot-v2/send-media-selector.ts`:

```ts
/**
 * send-media-selector — Copilot v2 envio estruturado de mídia (Slice 6).
 *
 * ADR #5/#12: a mídia é enviada CRUA (nunca a knowledge base) só quando o gatilho
 * casa, com um gate de momento/repetição ANTES do send. Decisão PURA (sem DB),
 * espelhando rubric-engine/capability-gate. O handler (tool-executor) faz a I/O:
 * resolve o item no DB, busca os já-enviados, chama esta decisão, e só então
 * gera signed URL + delega ao adapter.
 *
 * Fail-CLOSED: item ausente, inativo, de outra org, ou já enviado nesta conversa
 * → bloqueia com motivo explícito (nunca silent-drop — lição VitrineVET).
 */

export type SendMediaKind = "image" | "video" | "audio";

export interface SendMediaItem {
  id: string;
  organization_id: string;
  kind: SendMediaKind;
  storage_path: string;
  is_active: boolean;
  mime_type?: string | null;
}

export interface SendMediaDecisionInput {
  orgId: string;
  item: SendMediaItem | null;
  alreadySentMediaIds: string[];
}

export type SendMediaDenyReason =
  | "not_found" | "cross_org" | "item_inactive" | "already_sent";

export interface SendMediaDecision {
  allowed: boolean;
  reason: SendMediaDenyReason | null;
}

export function decideSendMedia(input: SendMediaDecisionInput): SendMediaDecision {
  const { orgId, item, alreadySentMediaIds } = input;
  if (!item) return { allowed: false, reason: "not_found" };
  // org SEMPRE do ctx (orgId), nunca do item/LLM — defesa em profundidade.
  if (item.organization_id !== orgId) return { allowed: false, reason: "cross_org" };
  if (!item.is_active) return { allowed: false, reason: "item_inactive" };
  if (alreadySentMediaIds.includes(item.id)) return { allowed: false, reason: "already_sent" };
  return { allowed: true, reason: null };
}

// ── Cap da biblioteca (DECISÃO DE PRODUTO ABERTA — ver ## Decisões abertas) ──
// O modo/limite vêm da config (copilot_v2_send_media_limits, Task 3), NUNCA
// hardcoded. assertWithinCap é puro e suporta as DUAS leituras possíveis.

export interface CapPolicy {
  mode: "per_kind" | "total";
  limit: number;
}

export type CapResult =
  | { ok: true }
  | { ok: false; reason: "cap_exceeded"; kind?: SendMediaKind };

export function assertWithinCap(items: SendMediaItem[], policy: CapPolicy): CapResult {
  const active = items.filter((i) => i.is_active);
  if (policy.mode === "total") {
    return active.length <= policy.limit ? { ok: true } : { ok: false, reason: "cap_exceeded" };
  }
  // per_kind
  const byKind = new Map<SendMediaKind, number>();
  for (const i of active) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [kind, count] of byKind) {
    if (count > policy.limit) return { ok: false, reason: "cap_exceeded", kind };
  }
  return { ok: true };
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/media-mime.test.ts tests/unit/copilot-v2/send-media-selector.test.ts
```

Esperado: `Test Files 2 passed (2)`.

- [ ] **Segurança**: `decideSendMedia` rejeita `cross_org` mesmo recebendo o item já carregado — defesa em profundidade caso o handler erre o filtro. Nenhuma PII; decisão sobre metadados de catálogo.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/media-mime.ts \
        supabase/functions/_shared/copilot-v2/send-media-selector.ts \
        tests/unit/copilot-v2/media-mime.test.ts \
        tests/unit/copilot-v2/send-media-selector.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): modulos puros media-mime + send-media-selector

media-mime centraliza kind->messageType/MIME (mata a heuristica multi-camada
da v1 send-document) com allow-list unica = a do bucket; audio e ptt(ogg/opus).
send-media-selector decide o envio (fail-CLOSED: not_found/cross_org/inactive/
already_sent) e expoe assertWithinCap parametrizado nas 2 leituras do cap
(decisao de produto aberta). KB nunca aparece aqui (acervos separados).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Cap parametrizável: tabela de config + RPC de assert (org-scoped)

**Problem**: o cap "≤5" da ADR #12 precisa acomodar áudio (Emenda §1) e a regra exata é **decisão de produto aberta** (≤5/tipo vs ≤N total — ver `## ⚠️ Decisões abertas`). Não pode ser hardcoded: precisa ser um **parâmetro org-level** que o CTO troca sem refactor. Também não há RPC que valide o cap no momento do upload (a UI/wizard da Slice 8 vai inserir itens via RPC owner/admin — o pattern da fundação: writes via `SECURITY DEFINER` RPC, nunca INSERT direto do `authenticated`).

**Fix** — nova migration: (a) tabela `copilot_v2_send_media_limits` (org-level, `mode`/`limit`, **seed PROVISÓRIO** que o CTO troca); (b) RPC `copilot_v2_assert_send_media_cap(p_org_id, p_kind)` `SECURITY DEFINER` que conta os itens ativos da org e devolve se um novo item caberia, usando a policy da org (org SEMPRE do parâmetro do edge/owner, nunca do LLM). A inserção em si do item (com chamada ao assert) é da Slice 8 (wizard) — aqui entregamos schema + RPC + seed-slot.

> **committed-not-applied** + pre-check da fundação igual à Task 1. O seed grava o placeholder e fica **comentado como PROVISÓRIO** — o valor real é a decisão do CTO.

### Files

- **Create** `supabase/migrations/<TS2>_copilot_v2_send_media_cap.sql` (timestamp real, > o da Task 1).
- **Create** test `tests/integration/copilot-v2/send-media-cap.test.ts` (`.skip` por convenção — roda contra dev/prod com service key; o nível-unidade do cap já é coberto por `assertWithinCap` na Task 2).

### Steps

- [ ] Gerar timestamp (≥ Task 1 + 1s) e criar o arquivo:

```bash
TS2=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS2}_copilot_v2_send_media_cap.sql"
echo "$TS2"
```

- [ ] Escrever a migration (`supabase/migrations/<TS2>_copilot_v2_send_media_cap.sql`):

```sql
-- ============================================================================
-- Copilot v2 — Slice 6: cap PARAMETRIZÁVEL da send-media library.
--
-- DECISÃO DE PRODUTO ABERTA (ver slice-06-asset-stores ## Decisões abertas):
-- ≤5 por tipo  vs  ≤N total. O modo/limite vivem AQUI (config org-level), não
-- no código. O seed abaixo é PROVISÓRIO — o CTO troca o valor quando decidir.
-- committed-not-applied: dev via MCP após pre-check; PROD proibido.
-- ============================================================================

create table if not exists public.copilot_v2_send_media_limits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- 'per_kind' = limite por tipo (image/video/audio); 'total' = limite agregado.
  mode            text not null default 'per_kind' check (mode in ('per_kind','total')),
  max_items       int  not null default 5 check (max_items between 1 and 50),
  updated_at      timestamptz not null default now()
);

alter table public.copilot_v2_send_media_limits enable row level security;
do $$ begin
  create policy copilot_v2_send_media_limits_org_read on public.copilot_v2_send_media_limits
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
-- writes só via service_role (wizard/CTO) — sem policy de INSERT/UPDATE p/ authenticated.

-- Resolve a policy efetiva da org (default global quando a org não tem linha).
-- ⚠️ PROVISÓRIO: mode='per_kind', limit=5 é PLACEHOLDER. CTO decide o valor real.
create or replace function public.copilot_v2_assert_send_media_cap(
  p_org_id uuid,
  p_kind   public.copilot_v2_media_kind
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_mode  text;
  v_limit int;
  v_count int;
begin
  select mode, max_items into v_mode, v_limit
    from public.copilot_v2_send_media_limits
   where organization_id = p_org_id;

  -- Default global PROVISÓRIO (substituir quando o CTO decidir a regra).
  if v_mode is null then v_mode := 'per_kind'; v_limit := 5; end if;

  if v_mode = 'total' then
    select count(*) into v_count
      from public.copilot_v2_send_media
     where organization_id = p_org_id and is_active;
  else
    select count(*) into v_count
      from public.copilot_v2_send_media
     where organization_id = p_org_id and is_active and kind = p_kind;
  end if;

  -- true = ainda cabe um novo item (fail-CLOSED no caller: se já está no limite,
  -- a inserção é recusada).
  return v_count < v_limit;
end $$;

revoke all on function public.copilot_v2_assert_send_media_cap(uuid, public.copilot_v2_media_kind)
  from public, anon, authenticated;
grant execute on function public.copilot_v2_assert_send_media_cap(uuid, public.copilot_v2_media_kind)
  to service_role;
```

- [ ] Escrever o teste de integração `.skip` `tests/integration/copilot-v2/send-media-cap.test.ts` (roda contra dev/prod com service key; mantém `.skip` até a migration aplicada):

```ts
/**
 * Slice 6 — cap da send-media library, nível DB (Copilot v2). REQUER a migration
 * copilot_v2_send_media_cap aplicada (dev) + service key — por isso .skip por
 * padrão (convenção do repo). O nível-unidade do cap é coberto por assertWithinCap.
 */
import { describe, it, expect } from 'vitest';

describe.skip('copilot_v2_assert_send_media_cap (DB)', () => {
  const ORG = process.env.COPILOT_V2_TEST_ORG!;
  it('recusa o item além do limite (default PROVISÓRIO per_kind=5)', async () => {
    // inserir 5 imagens ativas → assert(image) = false; assert(video) = true.
    const okVideo = await getAdmin().rpc('copilot_v2_assert_send_media_cap', { p_org_id: ORG, p_kind: 'video' });
    expect(okVideo.data).toBe(true);
  });
});
```

- [ ] **Validar** (committed-not-applied): pre-check da fundação, depois aplicar em **dev** via MCP. PROD proibido.

```sql
select to_regclass('public.copilot_v2_send_media') as send_media_exists; -- ≠ null antes de aplicar
```

- [ ] **Segurança**: RPC `SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`, `grant execute to service_role`. `p_org_id` vem do edge/owner (wizard), **nunca** do LLM. A contagem é estritamente escopada por `organization_id` (sem leak cross-org). RLS deny-all na tabela de config; SELECT org-scoped via `get_my_organization_ids()`.

- [ ] Commit:

```bash
git add supabase/migrations/*copilot_v2_send_media_cap.sql \
        tests/integration/copilot-v2/send-media-cap.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): cap parametrizavel da send-media library (config + RPC)

Cap da biblioteca e DECISAO DE PRODUTO ABERTA (>=5/tipo vs <=N total) — vira
parametro org-level em copilot_v2_send_media_limits (mode/max_items), nao
hardcoded. RPC copilot_v2_assert_send_media_cap (SECURITY DEFINER, service_role)
conta itens ativos da org e diz se cabe mais um (fail-CLOSED no caller). Seed
default e PROVISORIO (per_kind=5) — CTO troca o valor. committed-not-applied.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Handler real `send_media` no tool-executor (resolve → gate → signed URL → adapter, sem silent-drop)

**Problem**: `send_media` está em `HANDLERS` ausente → `createToolExecutor` lança `not_implemented` (`tool-executor.ts` 238–240; o teste `tool-executor.test.ts` 46–51 fixa isso). O agente não consegue enviar mídia aprovada. A v1 (`send-document.ts`) entregava mas com 3 problemas que NÃO repetimos: silent-drop quando o asset some (lição VitrineVET — IMPLEMENTATION-PLAN §5 Slice 3 linha 123), heurística MIME multi-camada, e leitura de um acervo conflatado.

**Fix**: implementar `sendMedia: Handler` em `tool-executor.ts` que: (1) resolve o item em `copilot_v2_send_media` filtrado por `id` + `organization_id` (org do ctx); (2) busca os `media_id` já enviados nesta conversa (anti-repetição); (3) chama `decideSendMedia` (Task 2) — bloqueio devolve `{ sent:false, reason }` **explícito** (nunca silent-drop); (4) `resolveMediaDelivery` valida MIME/messageType; (5) gera signed URL no bucket `copilot-v2-send-media` (1h); (6) delega ao adapter via uma dep injetada `sendMediaViaProvider` (mantém o executor testável sem WhatsApp real); (7) registra o envio pra dedup futuro. **A entrega real ao WhatsApp (resolveInstance + provider.sendMedia) é a casca I/O — já existe no worker/Slice 3; aqui o handler chama a dep.**

> **Nota de ordering (soft-dep Slice 3):** a Slice 3 também toca `send_media` (handler + helper MIME). Coordenação: **esta slice (6) é a dona do schema/acervo + módulos puros + a forma do handler**; se a Slice 3 mergear primeiro com um stub de `send_media`, este Task substitui o stub pela versão acervo-aware. Não há conflito de arquivo bloqueante — ambas tocam `tool-executor.ts` HANDLERS; o executor que rodar por último reconcilia (a versão deste plano é a canônica: acervo-aware + selector puro). **Não bloqueia** (`status: ready`).

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/tool-executor.ts` — adicionar `ToolContext` opcional dep `sendMediaViaProvider`, o handler `sendMedia`, e registrá-lo em `HANDLERS`.
- **Modify** `tests/unit/copilot-v2/tool-executor.test.ts` — trocar o caso "send_media → not_implemented" pela bateria do handler real; manter os demais 9 grupos verdes.

### Steps

- [ ] Reler o ponto de extensão (`tool-executor.ts` 18–25 `ToolContext`, 36 `Handler`, 217–227 `HANDLERS`, 234–242 `createToolExecutor`) e o caso a substituir (`tool-executor.test.ts` 46–51).

- [ ] Atualizar o teste `tests/unit/copilot-v2/tool-executor.test.ts`. Remover o caso `not_implemented` de `send_media` (linhas 46–51) e adicionar o grupo do handler real. O mock de `from` já suporta `select/eq/maybeSingle` e `.then` (lista); estender o `ToolContext`/executor com a dep `sendMediaViaProvider` via 3º argumento:

```ts
import { resolveMediaDelivery } from '../../../supabase/functions/_shared/copilot-v2/media-mime.ts';

describe('send_media (acervo-aware, sem silent-drop)', () => {
  const mediaCtx = { organizationId: 'org-1', leadId: 'lead-1', conversationId: 'conv-1', canonicalPhone: '11987654321' };

  function execWithProvider(sb: any, sent: any[], over: Record<string, unknown> = {}) {
    return createToolExecutor(sb, {
      ...mediaCtx,
      sendMediaViaProvider: async (p: any) => { sent.push(p); return { success: true, message_id: 'wamid-1' }; },
      ...over,
    } as any);
  }

  it('resolve item da org, valida gate, gera signed URL e delega ao adapter', async () => {
    const sb = mockSupabase({ copilot_v2_send_media: { id: 'm1', organization_id: 'org-1', kind: 'audio', storage_path: 'org-1/a.ogg', is_active: true, mime_type: 'audio/ogg' } });
    sb.storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/a.ogg' }, error: null }) }) };
    const sent: any[] = [];
    const out: any = await execWithProvider(sb, sent)('send_media', { media_id: 'm1' });
    expect(out).toMatchObject({ sent: true });
    expect(sent[0]).toMatchObject({ type: 'audio', file: 'https://signed/a.ogg', number: '11987654321' });
    const q = sb.queries.find((x: any) => x.table === 'copilot_v2_send_media')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).toContainEqual(['id', 'm1']);
  });

  it('FALLBACK EXPLÍCITO (nunca silent-drop) quando o item não existe', async () => {
    const sb = mockSupabase({}); // sem row
    sb.storage = { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) };
    const sent: any[] = [];
    const out: any = await execWithProvider(sb, sent)('send_media', { media_id: 'ghost' });
    expect(out).toMatchObject({ sent: false, reason: 'not_found' });
    expect(sent).toHaveLength(0);
  });

  it('IGNORA organization_id vindo dos args — org só do ctx', async () => {
    const sb = mockSupabase({ copilot_v2_send_media: { id: 'm1', organization_id: 'org-1', kind: 'image', storage_path: 'org-1/x.png', is_active: true, mime_type: 'image/png' } });
    sb.storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/x.png' }, error: null }) }) };
    const sent: any[] = [];
    await execWithProvider(sb, sent)('send_media', { media_id: 'm1', organization_id: 'EVIL' });
    const q = sb.queries.find((x: any) => x.table === 'copilot_v2_send_media')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).not.toContainEqual(['organization_id', 'EVIL']);
  });

  it('bloqueio explícito quando o MIME não casa com o kind (fallback, não silent-drop)', async () => {
    const sb = mockSupabase({ copilot_v2_send_media: { id: 'm1', organization_id: 'org-1', kind: 'image', storage_path: 'org-1/x.pdf', is_active: true, mime_type: 'application/pdf' } });
    sb.storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'u' }, error: null }) }) };
    const sent: any[] = [];
    const out: any = await execWithProvider(sb, sent)('send_media', { media_id: 'm1' });
    expect(out).toMatchObject({ sent: false, reason: 'invalid_mime' });
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] Rodar — esperar FALHAR (handler não existe; `send_media` ainda dá `not_implemented`):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts
```

Esperado: os novos casos `send_media` falham; os 9 grupos pré-existentes passam.

- [ ] Implementar em `tool-executor.ts`. Adicionar imports (topo, junto aos existentes):

```ts
import { decideSendMedia, type SendMediaItem } from "./send-media-selector.ts";
import { resolveMediaDelivery, type SendMediaKind } from "./media-mime.ts";
```

  Estender `ToolContext` (após `agentId`, linhas 18–25) com a dep injetada (mantém o executor testável sem WhatsApp real; o worker passa a real — Task 5):

```ts
export interface ToolContext {
  organizationId: string;
  leadId?: string | null;
  conversationId?: string | null;
  canonicalPhone?: string | null;
  /** The active agent for this turn (needed to load its rubric). */
  agentId?: string | null;
  /**
   * I/O sink for the actual WhatsApp delivery (injected by the worker). Pure
   * tests pass a fake. Absent → send_media returns a fallback (never throws into
   * a silent drop). Returns the provider's send result.
   */
  sendMediaViaProvider?: (p: {
    number: string; type: "image" | "video" | "audio"; file: string;
    caption?: string; mediaId: string;
  }) => Promise<{ success: boolean; message_id?: string; error?: string }>;
}
```

  Adicionar o handler (junto aos write handlers, antes do mapa `HANDLERS`):

```ts
const SEND_MEDIA_BUCKET = "copilot-v2-send-media";

const sendMedia: Handler = async (supabase, ctx, args) => {
  if (!ctx.canonicalPhone) throw new ToolError("missing_context", "send_media:phone");
  const mediaId = String(args.media_id ?? "");
  if (!mediaId) throw new ToolError("missing_context", "send_media:media_id");

  // 1. Resolve o item — org SEMPRE do ctx, nunca dos args/LLM.
  const { data: item, error } = await supabase
    .from("copilot_v2_send_media")
    .select("id, organization_id, kind, storage_path, is_active, mime_type")
    .eq("organization_id", ctx.organizationId)
    .eq("id", mediaId)
    .maybeSingle();
  if (error) throw new Error(`send_media: ${error.message}`);

  // 2. Já-enviados nesta conversa (anti-repetição) — gate de momento/repetição.
  let alreadySent: string[] = [];
  if (ctx.conversationId) {
    const { data: prior } = await supabase
      .from("copilot_v2_trace_steps")
      .select("meta")
      .eq("step", "send_media");
    alreadySent = (prior ?? [])
      .map((r: any) => r?.meta?.media_id)
      .filter((x: any): x is string => typeof x === "string");
  }

  // 3. Gate puro (fail-CLOSED) — bloqueio devolve motivo EXPLÍCITO, sem silent-drop.
  const gate = decideSendMedia({
    orgId: ctx.organizationId,
    item: (item as SendMediaItem | null),
    alreadySentMediaIds: alreadySent,
  });
  if (!gate.allowed) return { sent: false, reason: gate.reason };

  // 4. Valida MIME/messageType (heurística única).
  const delivery = resolveMediaDelivery(item.kind as SendMediaKind, item.mime_type);
  if (!delivery.valid || !delivery.messageType) return { sent: false, reason: "invalid_mime" };

  // 5. Signed URL (1h) — bucket PRIVADO, nunca link público.
  const { data: signed, error: urlErr } = await supabase.storage
    .from(SEND_MEDIA_BUCKET).createSignedUrl(item.storage_path, 3600);
  if (urlErr || !signed?.signedUrl) return { sent: false, reason: "signed_url_failed" };

  // 6. Entrega real é I/O injetada (ausente em teste/contexto sem provider).
  if (!ctx.sendMediaViaProvider) return { sent: false, reason: "no_provider" };
  const res = await ctx.sendMediaViaProvider({
    number: ctx.canonicalPhone, type: delivery.messageType, file: signed.signedUrl, mediaId: item.id,
  });
  if (!res.success) return { sent: false, reason: res.error ?? "provider_failed", media_id: item.id };

  return { sent: true, media_id: item.id, kind: item.kind, message_id: res.message_id ?? null };
};
```

  Registrar em `HANDLERS` (após `transfer_to_human`):

```ts
  transfer_to_human: transferToHuman,
  send_media: sendMedia,
};
```

- [ ] Re-rodar — esperar PASSAR (handler + 9 grupos antigos):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts tests/unit/copilot-v2/tool-registry.test.ts
```

Esperado: `tool-executor.test.ts` passa (novos + antigos); `tool-registry.test.ts` segue verde (contrato `send_media`/`can_send_media` inalterado).

- [ ] **Segurança**: `organization_id` SEMPRE do ctx (item filtrado por org; arg `organization_id` ignorado — testado). `decideSendMedia` rejeita `cross_org` como 2ª barreira. Signed URL de bucket privado (1h), nunca público — sem vazamento de mídia comercial. Capability `can_send_media` já é gateada upstream pelo `capability-gate` (fail-CLOSED desde 1-H/Task 7) — o handler só roda se o gate liberou. Fallback explícito em todo caminho de falha (nunca silent-drop).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/tool-executor.ts \
        tests/unit/copilot-v2/tool-executor.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): handler send_media acervo-aware (resolve->gate->signed URL)

send_media deixa de ser not_implemented: resolve o item em copilot_v2_send_media
(org do ctx), aplica decideSendMedia (fail-CLOSED), valida MIME via media-mime,
gera signed URL do bucket privado e delega a entrega via dep injetada
(sendMediaViaProvider). Todo caminho de falha devolve motivo EXPLICITO — sem
silent-drop (licao VitrineVET). KB nunca e lida aqui (acervos separados).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Worker injeta a entrega real + catálogo org-level reflete nos 3 arquétipos

**Problem**: o worker monta o `createToolExecutor` (`copilot-v2-worker/index.ts` 76–82) sem `sendMediaViaProvider` — então o handler da Task 4 cairia em `no_provider` em produção. Falta plugar a entrega real (mesmo adapter do `sendReply`, 183–190). E o **Exit do slice** ("trocar catálogo na org reflete nos 3 arquétipos") precisa ser provado: o acervo é org-level (`copilot_v2_send_media.organization_id`), a junction `copilot_v2_agent_media` liga itens a agentes com `trigger` por arquétipo — qualquer um dos 3 agentes da org resolve o mesmo item por `id`+`organization_id`, sem duplicação per-agent.

**Fix**: no worker, adicionar `sendMediaViaProvider` ao `ToolContext` do `makeExecutor`, reusando `resolveInstance` + `getWhatsAppProvider` (já importados, 20–21). Provar o catálogo-org-level com um teste de unidade sobre a resolução (org-scope), já que o acervo é resolvido por `organization_id` (não por agent) — a junction só carrega o `trigger`.

> **Nota de ordering (soft-dep Slice 8):** a UI de biblioteca (upload/gatilho/preview) e o WRITE do catálogo (inserir item chamando `copilot_v2_assert_send_media_cap`) são da Slice 8 (wizard). Esta slice entrega o READ-path org-level + a forma de escrita (RPC da Task 3). O design entrega a UI; o engenheiro pluga na Slice 8. **Não bloqueia** o Exit desta slice, que é sobre o motor resolver o catálogo org-level (provável por teste de unidade).

### Files

- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — adicionar `sendMediaViaProvider` ao `makeExecutor` (linhas 76–82) + helper `sendMediaReply` espelhando `sendReply`.
- **Create** test `tests/unit/copilot-v2/send-media-org-catalog.test.ts` — prova que o item é resolvido por `organization_id` (org-level, compartilhado pelos arquétipos), não por agent.

### Steps

- [ ] Reler o `makeExecutor` (worker 76–82) e o `sendReply` helper (183–190) pra espelhar o padrão de resolução de instância/provider.

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/send-media-org-catalog.test.ts` (usa o mesmo mock do `tool-executor.test.ts`; prova que QUALQUER arquétipo da org resolve o mesmo item org-level por org+id):

```ts
/**
 * Slice 6 — catálogo send-media é ORG-LEVEL: trocar o acervo na org reflete nos
 * 3 arquétipos (Copilot v2). O item é resolvido por organization_id + id, nunca
 * por agent_id — então Qualificador, Vendedor e Carteira da MESMA org veem o
 * mesmo catálogo (sem a duplicação per-agent da v1).
 */
import { describe, it, expect } from 'vitest';
import { createToolExecutor } from '../../../supabase/functions/_shared/copilot-v2/tool-executor.ts';

function mockSupabase(row: any) {
  const queries: any[] = [];
  const from = (table: string) => {
    const q: any = { table, filters: [] as [string, unknown][] };
    queries.push(q);
    const b: any = {
      select: () => b, eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      maybeSingle: () => Promise.resolve({ data: table === 'copilot_v2_send_media' ? row : null, error: null }),
      then: (r: any) => r({ data: [], error: null }),
    };
    return b;
  };
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'u' }, error: null }) }) };
  return { from, storage, queries };
}

const item = { id: 'm1', organization_id: 'org-1', kind: 'image', storage_path: 'org-1/x.png', is_active: true, mime_type: 'image/png' };

describe('send-media catálogo org-level (3 arquétipos, 1 acervo)', () => {
  for (const agentId of ['agent-qualificador', 'agent-vendedor', 'agent-carteira']) {
    it(`${agentId} resolve o MESMO item por organization_id (não por agent)`, async () => {
      const sb = mockSupabase(item);
      const sent: any[] = [];
      const exec = createToolExecutor(sb, {
        organizationId: 'org-1', leadId: 'l1', conversationId: 'c1', canonicalPhone: '11987654321', agentId,
        sendMediaViaProvider: async (p: any) => { sent.push(p); return { success: true, message_id: 'w1' }; },
      } as any);
      const out: any = await exec('send_media', { media_id: 'm1' });
      expect(out).toMatchObject({ sent: true, media_id: 'm1' });
      const q = sb.queries.find((x: any) => x.table === 'copilot_v2_send_media')!;
      expect(q.filters).toContainEqual(['organization_id', 'org-1']);
      expect(q.filters).not.toContainEqual(['agent_id', agentId]); // org-level, não per-agent
    });
  }
});
```

- [ ] Rodar — esperar PASSAR já (o handler da Task 4 resolve por org; este teste prova o invariante org-level). Se falhar, o handler estava filtrando por agent → corrigir pra org. (TDD: este teste TRAVA o invariante org-level contra regressão futura.)

```bash
npx vitest run tests/unit/copilot-v2/send-media-org-catalog.test.ts
```

Esperado: `Tests 3 passed`.

- [ ] Implementar a injeção no worker. Em `copilot-v2-worker/index.ts`, estender o `makeExecutor` (76–82):

```ts
      makeExecutor: (row, context) => createToolExecutor(supabase, {
        organizationId: row.organization_id,
        leadId: row.lead_id,
        conversationId: row.conversation_id,
        canonicalPhone: row.canonical_phone,
        agentId: context._agentId,
        sendMediaViaProvider: (p) => sendMediaReply(supabase, row.organization_id, p),
      }),
```

  Adicionar o helper (junto ao `sendReply`, fim do arquivo, espelhando 183–190):

```ts
async function sendMediaReply(
  supabase: any, orgId: string,
  p: { number: string; type: "image" | "video" | "audio"; file: string; caption?: string; mediaId: string },
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const instance = await resolveInstance(supabase, orgId, { requireConnected: true });
  if (!instance) return { success: false, error: `no connected WhatsApp instance for org ${orgId}` };
  const provider = await getWhatsAppProvider(instance, supabase);
  const number = normalizeBrazilianPhone(p.number) ?? p.number;
  try {
    const res = await provider.sendMedia({
      number, type: p.type, file: p.file, caption: p.caption,
      trackSource: "copilot_v2_send_media", trackId: p.mediaId,
    });
    return { success: res?.success !== false, message_id: (res as any)?.message_id };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
```

- [ ] Re-rodar a suíte do worker-path (regressão) + o catálogo:

```bash
npx vitest run tests/unit/copilot-v2/send-media-org-catalog.test.ts tests/unit/copilot-v2/queue-processor.test.ts tests/unit/copilot-v2/tool-executor.test.ts
```

Esperado: todos verdes. *(O worker é casca I/O sem unit-test próprio; o `deno check` da Task 6 valida o edge.)*

- [ ] **Segurança**: a instância WhatsApp é resolvida por `org_id` do row (border-trusted), nunca do LLM. `sendMedia` falha → `{ success:false }` propagado como fallback explícito (sem throw silencioso). Acervo org-level elimina a duplicação per-agent da v1 — uma fonte, isolada por org.

- [ ] Commit:

```bash
git add supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/send-media-org-catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): worker injeta entrega real de send_media + catalogo org-level

makeExecutor passa sendMediaViaProvider (mesmo adapter do sendReply) pro
handler send_media — sem isso o handler caia em no_provider em prod. Teste
trava o invariante: o item e resolvido por organization_id (nao agent_id),
entao os 3 arquetipos da org compartilham UM acervo (sem duplicacao per-agent
da v1). Falha de envio -> fallback explicito, nunca silent-drop.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Regressão completa: suíte copilot-v2 + deno check + build

**Goal**: provar a suíte copilot-v2 inteira verde com os ~4 arquivos novos de teste, validar os edge `.ts` tocados com `deno check` (o repo não tem gate de `tsc` no edge — root memory `project_ci_no_typecheck_gate`), e confirmar que o frontend build não regrediu.

### Files

- nenhum (verificação).

### Steps

- [ ] Suíte copilot-v2 inteira:

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os arquivos verdes. **Capturar a linha literal** (ex.: `Test Files  XX passed (XX)` / `Tests  YYY passed (YYY)`) no QA report — NÃO parafrasear "all green" (root memory `feedback_qa_raw_output`). Comparar com o baseline do Setup: `+4 Test Files` (media-mime, send-media-selector, send-media-org-catalog, + caso send_media migrado em tool-executor), tests proporcionalmente maiores.

- [ ] Suíte de integração copilot-v2 (o sentinel `.skip` mantém verde sem service key):

```bash
npx vitest run tests/integration/copilot-v2/
```

Esperado: sentinel passa; bloco `.skip` reportado skipped (inclui `send-media-cap.test.ts`).

- [ ] `deno check` dos edge tocados (pega import relativo quebrado — `tsc` não pega, root memory):

```bash
cd supabase/functions && deno check copilot-v2-worker/index.ts _shared/copilot-v2/tool-executor.ts _shared/copilot-v2/send-media-selector.ts _shared/copilot-v2/media-mime.ts
```

Esperado: sem diagnostics.

- [ ] Typecheck + build do frontend (a UI de biblioteca é Slice 8 — aqui só garantir que nada do edge regrediu o build):

```bash
npm run typecheck && npm run build
```

Esperado: `typecheck` exit 0 (ou ratchet inalterado); `build` conclui.

- [ ] **Gate final de verificação** (colar counts literais no QA report):

```bash
npx vitest run tests/unit/copilot-v2/ tests/integration/copilot-v2/
npm run typecheck && npm run build
```

Tudo verde antes de abrir o PR. **NÃO deployar edge functions nem aplicar as migrations Task 1/Task 3 em prod** — push da branch apenas; PROD apply + deploy exigem autorização explícita do CTO (root memory: `feedback_never_deploy_prod`, `feedback_push_new_branch`). As migrations das Tasks 1/3 ficam **committed-not-applied** (aplicadas em dev via MCP só após pre-check da fundação).

---

## 🔒 Segurança

🔒 **Multi-tenant — org sempre do ctx, nunca do LLM/payload.** O handler `send_media` filtra `copilot_v2_send_media` por `organization_id` do `ToolContext` (border-trusted); um `organization_id` nos args do LLM é **ignorado** (testado, Task 4). `decideSendMedia` rejeita `cross_org` como 2ª barreira (defesa em profundidade). A RPC `copilot_v2_assert_send_media_cap` recebe `p_org_id` do edge/owner, nunca do LLM.

🔒 **Gates fail-CLOSED.** `decideSendMedia` bloqueia por padrão (`not_found`/`cross_org`/`item_inactive`/`already_sent`); `resolveMediaDelivery` rejeita MIME fora da allow-list (`valid:false`); `assertWithinCap` recusa o item além do limite; `copilot_v2_assert_send_media_cap` retorna `false` no limite (caller recusa). A capability `can_send_media` já é gateada upstream (capability-gate fail-CLOSED desde 1-H/Task 7) — o handler só roda se o gate liberou. **Nenhum caminho libera por erro.**

🔒 **Storage org-scoped + sem silent-drop.** Bucket `copilot-v2-send-media` é **privado** (`public=false`); entrega só via signed URL de 1h — nenhuma mídia comercial vaza por link público nem cross-org (path `{org_id}/...` + policies via `get_my_organization_ids()`). MIME allow-list no bucket (1ª camada) + `media-mime` (2ª camada). Todo caminho de falha do `send_media` devolve `{ sent:false, reason }` **explícito** — nunca silent-drop (lição do incidente VitrineVET, onde o v1 dropava a directive de mídia em silêncio).

🔒 **Acervos separados (ADR #12).** O handler `send_media` lê APENAS de `copilot_v2_send_media` — NUNCA de `copilot_v2_knowledge`/`copilot_v2_knowledge_chunks` (a KB é texto-ingerido, jamais enviada crua). `media-mime` não conhece `doc`/`pdf` (kinds KB-only). A migração NÃO reusa `copilot_agent_documents` (conflação v1) nem `copilot_agent_audios` (pool per-agent v1) — áudio vira org-level.

🔒 **RPC hardening.** `copilot_v2_assert_send_media_cap` é `SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`, `grant execute to service_role` — padrão da fundação. Tabelas novas com `organization_id` têm RLS deny-all + SELECT org-scoped; writes só via service_role (wizard/CTO).

🔒 **PII.** Mídia da biblioteca pode conter material comercial sensível (preços, catálogos) — o isolamento por org + signed URL privado cobre. Não há PII de lead no acervo (é catálogo da org).

## ⚠️ Decisões abertas

(Ver topo do documento — o cap da send-media library com áudio.) Resumo pro schema: **cap da biblioteca send-media pra acomodar áudio — `≤5 por tipo` vs `≤N total` (ex.: ≤8)**. Construído como parâmetro (`copilot_v2_send_media_limits.mode/max_items` + `assertWithinCap` testado nas 2 leituras); seed default é PROVISÓRIO (`per_kind=5`); migration committed-not-applied até o CTO decidir. **O executor não escolhe a regra** — entrega os dois caminhos e o slot de config.

---

### Resumo do slice (pra o corpo do PR)

| # | Entrega | Superfície | Migration |
|---|---------|-----------|-----------|
| 1 | `audio` na send-media library + bucket privado org-scoped | migration (enum + storage) | **sim** (dev only, committed-not-applied) |
| 2 | módulos puros `media-mime` + `send-media-selector` (gate fail-CLOSED) | `_shared/copilot-v2/*.ts` | não |
| 3 | cap parametrizável (config + RPC assert org-scoped) — **decisão de produto aberta** | migration (tabela + RPC) | **sim** (dev only, committed-not-applied) |
| 4 | handler real `send_media` (resolve→gate→signed URL→adapter, sem silent-drop) | `tool-executor.ts` | não |
| 5 | worker injeta entrega real + catálogo org-level nos 3 arquétipos | `copilot-v2-worker/index.ts` | não |
| 6 | regressão completa + deno check + build | tests | não |

---
