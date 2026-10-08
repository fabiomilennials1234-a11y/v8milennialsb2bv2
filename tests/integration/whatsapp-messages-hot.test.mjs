// Prova, em Postgres de verdade (PGlite, sem Docker), o efeito das migrations
// 20271107140003..05 sobre whatsapp_messages:
//   1. C1 grava fillfactor=85 e toast_tuple_target=1024 em reloptions;
//   2. tupla > ~2 kB com raw_payload compressível sai do heap (vai pro toast);
//      tupla de 1–2 kB NÃO muda (gatilho do TOAST é fixo — limite declarado);
//   3. UPDATE de `status` vira HOT: n_tup_newpage_upd/n_tup_upd < 5% (90 não bastaria);
//   4. A1/A2 são um statement só, idempotentes, recusados em transação, e os
//      rollbacks recriam a definição exata de prod.
// Comparação sempre contra um esqueleto idêntico SEM C1 (schema `antes`).
// PGlite roda PG 18; o caminho de TOAST/HOT usado aqui é o mesmo do PG 17
// (heapam.c: TOAST_TUPLE_THRESHOLD fixo; heaptoast.c: alvo = toast_tuple_target).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = '../../supabase/migrations/';
const C1 = '20271107140003_whatsapp_messages_fillfactor_toast_target.sql';
const A1 = '20271107140004_drop_idx_whatsapp_messages_org.sql';
const A2 = '20271107140005_drop_idx_whatsapp_conversations_instance.sql';
const ORG = '00000000-0000-0000-0000-000000000100';
const INST = '00000000-0000-0000-0000-000000000200';

// Colunas que pesam na largura da tupla e todos os índices relevantes ao
// UPDATE de status (nenhum toca `status` — pré-condição do HOT em prod).
const skeleton = (s) => `
  CREATE SCHEMA IF NOT EXISTS ${s};
  CREATE TABLE ${s}.whatsapp_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    instance_id uuid,
    message_id text NOT NULL,
    remote_jid text NOT NULL,
    phone_number text NOT NULL,
    normalized_phone text,
    direction text NOT NULL,
    message_type text NOT NULL DEFAULT 'text',
    content text,
    status text DEFAULT 'received',
    lead_id uuid,
    "timestamp" timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz DEFAULT now(),
    raw_payload jsonb,
    reactions jsonb NOT NULL DEFAULT '[]'::jsonb,
    deleted_at timestamptz,
    is_group boolean NOT NULL DEFAULT false,
    sent_source text NOT NULL DEFAULT 'manual',
    search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED
  ) WITH (autovacuum_vacuum_scale_factor = 0.10, autovacuum_analyze_scale_factor = 0.10);
  CREATE UNIQUE INDEX ${s}_uq ON ${s}.whatsapp_messages (organization_id, instance_id, message_id);
  CREATE INDEX ${s}_org_instance_ts ON ${s}.whatsapp_messages (organization_id, instance_id, "timestamp" DESC);
  CREATE INDEX ${s}_org_lead_dir ON ${s}.whatsapp_messages (organization_id, lead_id, direction);
  CREATE INDEX ${s}_org_phone_instance_ts ON ${s}.whatsapp_messages (organization_id, normalized_phone, instance_id, "timestamp" DESC)
    WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL;
  CREATE INDEX ${s}_unread_cover ON ${s}.whatsapp_messages (organization_id, instance_id, "timestamp" DESC)
    INCLUDE (normalized_phone) WHERE direction = 'incoming' AND deleted_at IS NULL AND is_group = false;
`;

// raw_payload no formato do webhook: chaves repetidas (comprimem) + ids/base64
// aleatórios (não comprimem). `body`/`pad` calibram o tamanho.
const payload = (body, pad) => JSON.stringify({
  event: 'messages', instanceName: 'inst', owner: '5511999999999',
  message: { id: randomBytes(12).toString('hex'), body: randomBytes(body).toString('base64'), type: 'conversation' },
  chat: { name: 'Fulano', image: 'https://pps.whatsapp.net/v/t61.24694-24/' + 'x'.repeat(pad) },
});

async function insertRows(db, s, n, body, pad, prefix) {
  for (let i = 0; i < n; i++) {
    await db.query(
      `INSERT INTO ${s}.whatsapp_messages
         (organization_id, instance_id, message_id, remote_jid, phone_number, normalized_phone, direction, content, status, raw_payload)
       VALUES ($1, $2, $3, '5511988887777@s.whatsapp.net', '5511988887777', '5511988887777', 'outgoing', 'Olá, tudo bem?', 'sent', $4::jsonb)`,
      [ORG, INST, `${prefix}-${i}`, payload(body, pad)],
    );
  }
}

const stats = async (db, s) => {
  await db.query('SELECT pg_stat_force_next_flush()');
  return (await db.query(
    `SELECT n_tup_upd::int AS upd, n_tup_hot_upd::int AS hot, n_tup_newpage_upd::int AS newpage
       FROM pg_stat_user_tables WHERE schemaname = $1 AND relname = 'whatsapp_messages'`, [s])).rows[0];
};

const statementsOf = (sql) => sql.replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean);

test('cada migration e cada rollback tem exatamente um statement', () => {
  for (const f of [C1, A1, A2]) {
    assert.equal(statementsOf(read(MIG + f)).length, 1, f);
    assert.equal(statementsOf(read(MIG + 'rollback/' + f)).length, 1, `rollback/${f}`);
  }
});

test('C1: reloptions, tupla > 2 kB sai do heap, tupla de 1–2 kB fica como está', async () => {
  const db = new PGlite();
  try {
    await db.exec(skeleton('public') + skeleton('antes'));
    await db.exec(read(MIG + C1));
    const opts = async (s) => (await db.query(
      `SELECT c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = 'whatsapp_messages'`, [s])).rows[0].reloptions;
    assert.deepEqual(await opts('public'), [
      'autovacuum_vacuum_scale_factor=0.10', 'autovacuum_analyze_scale_factor=0.10',
      'fillfactor=85', 'toast_tuple_target=1024',
    ]);

    // Grande e compressível (~2,3 kB cru, ~1,5 kB comprimido): o caso das
    // tuplas recentes de prod acima do gatilho de ~2 kB.
    for (const s of ['public', 'antes']) await insertRows(db, s, 120, 800, 1000, 'big');
    const big = async (s) => (await db.query(
      `SELECT min(octet_length(raw_payload::text))::int AS raw_min,
              bool_and(pg_column_compression(raw_payload) IS NOT NULL) AS compressed,
              count(*) FILTER (WHERE pg_column_toast_chunk_id(raw_payload) IS NOT NULL)::int AS external,
              pg_relation_size('${s}.whatsapp_messages')::int AS heap,
              pg_relation_size((SELECT reltoastrelid FROM pg_class WHERE oid = '${s}.whatsapp_messages'::regclass))::int AS toast
         FROM ${s}.whatsapp_messages WHERE message_id LIKE 'big-%'`)).rows[0];
    const [bAntes, bDepois] = [await big('antes'), await big('public')];
    assert.ok(bAntes.raw_min > 2032, `payload precisa passar do gatilho: ${bAntes.raw_min}`);
    assert.equal(bAntes.compressed, true);
    assert.equal(bAntes.external, 0, 'sem C1: comprimido, mas INLINE no heap');
    assert.equal(bDepois.external, 120, 'com C1: raw_payload vai inteiro pro toast');
    assert.ok(bDepois.heap * 4 <= bAntes.heap, `heap deveria cair ≥4×: antes ${bAntes.heap} depois ${bDepois.heap}`);
    assert.ok(bDepois.toast > bAntes.toast);
    // Largura da linha no heap: o datum externo vira ponteiro de 18 bytes.
    const avgRow = async (s) => (await db.query(
      `SELECT avg(pg_column_size(raw_payload))::int AS stored,
              (pg_relation_size('${s}.whatsapp_messages') / count(*))::int AS heap_per_row
         FROM ${s}.whatsapp_messages WHERE message_id LIKE 'big-%'`)).rows[0];
    const [rAntes, rDepois] = [await avgRow('antes'), await avgRow('public')];
    assert.ok(rDepois.heap_per_row < 400 && rAntes.heap_per_row > 1300,
      `bytes de heap por linha: antes ${rAntes.heap_per_row}, depois ${rDepois.heap_per_row}`);

    // Médio (~1,5 kB, abaixo do gatilho fixo TOAST_TUPLE_THRESHOLD): C1 não muda
    // nada nesta tupla. 82% das recentes de prod estão nesta faixa.
    for (const s of ['public', 'antes']) await insertRows(db, s, 1, 400, 600, 'mid');
    const mid = async (s) => (await db.query(
      `SELECT pg_column_size(raw_payload)::int AS sz, pg_column_compression(raw_payload) AS c,
              pg_column_toast_chunk_id(raw_payload) AS chunk
         FROM ${s}.whatsapp_messages WHERE message_id = 'mid-0'`)).rows[0];
    const [mAntes, mDepois] = [await mid('antes'), await mid('public')];
    assert.equal(mDepois.c, null); assert.equal(mDepois.chunk, null);
    assert.ok(Math.abs(mDepois.sz - mAntes.sz) < 100 && mDepois.sz > 1024, 'faixa 1–2 kB fica inline');

    // Rollback exato: volta só aos autovacuum de prod.
    await db.exec(read(MIG + 'rollback/' + C1));
    assert.deepEqual(await opts('public'), ['autovacuum_vacuum_scale_factor=0.10', 'autovacuum_analyze_scale_factor=0.10']);
  } finally { await db.close(); }
});

// Fluxo calibrado em prod (2026-10-05, 2.910 mensagens/2 h, largura NO HEAP):
//   < 1 kB 17% · 1,0–1,3 kB 36% · 1,3–1,5 kB 25% · 1,5–2,0 kB 22%, dos quais
//   412 linhas (14%) são raw_payload > 2 kB COMPRIMIDO inline (alvo 2040 hoje).
// Metade é outgoing e recebe 2 UPDATEs de status (delivered em +3, read em +15
// mensagens), cada um em sua transação — o padrão do webhook (message-update.ts).
// A MESMA sequência entra nos três esquemas; quem decide inline × toast é o
// próprio Postgres, pelas reloptions de cada um.
const MIX = [
  // [peso, gerador de raw_payload]
  [489, () => ({ a: randomBytes(40).toString('base64') })],                 // < 1 kB
  [1043, () => ({ a: randomBytes(620).toString('base64') })],               // ~1,15 kB
  [724, () => ({ a: randomBytes(810).toString('base64') })],                // ~1,4 kB
  [174, () => ({ a: randomBytes(1000).toString('base64') })],               // ~1,65 kB incompressível
  [53, () => ({ a: randomBytes(1180).toString('base64') })],                // ~1,9 kB incompressível
  [412, () => JSON.parse(payload(800 + Math.floor(Math.random() * 250), 1000))], // > 2 kB compressível
];

async function replayProdStream(db, schemas, n) {
  const total = MIX.reduce((a, [w]) => a + w, 0);
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pending = new Map();
  const later = (at, id, status) => (pending.get(at) ?? pending.set(at, []).get(at)).push([id, status]);
  for (let i = 0; i < n; i++) {
    let r = rnd() * total, gen = MIX[0][1];
    for (const [w, g] of MIX) { if ((r -= w) < 0) { gen = g; break; } }
    const raw = JSON.stringify(gen());
    const outgoing = rnd() < 0.5;
    for (const s of schemas) {
      await db.query(
        `INSERT INTO ${s}.whatsapp_messages
           (organization_id, instance_id, message_id, remote_jid, phone_number, normalized_phone, direction, content, status, raw_payload)
         VALUES ($1, $2, $3, '5511988887777@s.whatsapp.net', '5511988887777', '5511988887777', $4, 'Olá, tudo bem?', 'sent', $5::jsonb)`,
        [ORG, INST, `s-${i}`, outgoing ? 'outgoing' : 'incoming', raw]);
    }
    if (outgoing) { later(i + 3, `s-${i}`, 'delivered'); later(i + 15, `s-${i}`, 'read'); }
    for (const [mid, status] of pending.get(i) ?? []) {
      for (const s of schemas) {
        await db.query(`UPDATE ${s}.whatsapp_messages SET status = $2
                         WHERE organization_id = $1 AND instance_id = $3 AND message_id = $4`, [ORG, status, INST, mid]);
      }
    }
  }
}

test('C1 (85/1024): UPDATE de status no fluxo de prod fica < 5% fora da página; 90 não bastaria', async () => {
  const db = new PGlite();
  try {
    await db.exec(skeleton('public') + skeleton('antes') + skeleton('ff90'));
    await db.exec(read(MIG + C1));
    // Alternativa descartada, mantida como referência da decisão.
    await db.exec('ALTER TABLE ff90.whatsapp_messages SET (fillfactor = 90, toast_tuple_target = 1024)');
    await replayProdStream(db, ['antes', 'public', 'ff90'], 1500);
    const ratio = async (s) => {
      const st = await stats(db, s);
      const pages = (await db.query(`SELECT (pg_relation_size('${s}.whatsapp_messages') / 8192)::int AS p`)).rows[0].p;
      return { ...st, pages, newpagePct: (100 * st.newpage) / st.upd };
    };
    const [antes, c1, ff90] = [await ratio('antes'), await ratio('public'), await ratio('ff90')];
    const msg = JSON.stringify({ antes, c1, ff90 });
    assert.ok(antes.upd > 1000 && antes.upd === c1.upd && c1.upd === ff90.upd, msg);
    // CONTROLE POSITIVO: sem C1 o fluxo reproduz o que prod mede (24,7% fora da
    // página, 1600/6466). Se sair da faixa, o modelo deixou de valer e as
    // asserções abaixo não provam nada.
    assert.ok(antes.newpagePct >= 18 && antes.newpagePct <= 32, `calibração: ${msg}`);
    // C1 (85/1024) fecha o critério do protocolo: < 5% fora da página…
    assert.ok(c1.newpagePct < 5, `C1 deveria ficar < 5%: ${msg}`);
    assert.ok(c1.hot > antes.hot, msg);
    // …com heap menor que o de hoje e não maior que o de 90: menos UPDATE fora
    // da página = menos cópia de linha em página nova.
    assert.ok(c1.pages < antes.pages, `heap C1 vs hoje: ${msg}`);
    assert.ok(c1.pages <= ff90.pages * 1.03, `heap C1 vs 90: ${msg}`);
    // Por que não 90: ele corta, mas fica ≥ 5% (12% medido) — reprova o critério.
    assert.ok(ff90.newpagePct >= 5, `se isto falhar, 90 passou a bastar: ${msg}`);
  } finally { await db.close(); }
});

test('A1/A2: idempotentes, recusados em transação, rollback recria a definição de prod', async () => {
  const db = new PGlite();
  try {
    await db.exec(skeleton('public') + `
      CREATE INDEX idx_whatsapp_messages_org ON public.whatsapp_messages USING btree (organization_id);
      CREATE TABLE public.whatsapp_conversations (id uuid PRIMARY KEY, instance_id uuid NOT NULL, phone_number text NOT NULL,
        UNIQUE (instance_id, phone_number));
      CREATE INDEX idx_whatsapp_conversations_instance ON public.whatsapp_conversations USING btree (instance_id);`);
    const def = async (name) => (await db.query(
      `SELECT pg_get_indexdef(to_regclass($1)) AS d`, [`public.${name}`])).rows[0].d;

    // O aviso do cabeçalho é real: em transação (db push / apply_migration) falha.
    await assert.rejects(db.exec('BEGIN;' + read(MIG + A1)), /cannot run inside a transaction block/);
    await db.exec('ROLLBACK');
    assert.ok(await def('idx_whatsapp_messages_org'));

    for (const f of [A1, A2, A1, A2]) await db.exec(read(MIG + f)); // 2ª passada = IF EXISTS
    assert.equal(await def('idx_whatsapp_messages_org'), null);
    assert.equal(await def('idx_whatsapp_conversations_instance'), null);

    for (const f of [A1, A2]) await db.exec(read(MIG + 'rollback/' + f));
    assert.equal(await def('idx_whatsapp_messages_org'),
      'CREATE INDEX idx_whatsapp_messages_org ON public.whatsapp_messages USING btree (organization_id)');
    assert.equal(await def('idx_whatsapp_conversations_instance'),
      'CREATE INDEX idx_whatsapp_conversations_instance ON public.whatsapp_conversations USING btree (instance_id)');
  } finally { await db.close(); }
});
