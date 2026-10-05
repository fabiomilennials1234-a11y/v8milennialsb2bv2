// get_pipeline_page / get_pipeline_stage_counts_by_id: SET plan_cache_mode.
//
// 1. O SET da função governa o plano cacheado do PL/pgSQL executado dentro dela
//    (a premissa da migration — doc do PG 17 + prova aqui, em PG 17 real).
// 2. A migration só acrescenta `plan_cache_mode` ao proconfig: corpo, SECURITY,
//    search_path e o EXECUTE de cada papel ficam idênticos; o rollback volta.
//
// As funções vêm das migrations do repo, conferidas contra prod pelo md5 do
// prosrc (lido em 2026-10-05). md5 divergente = o repo não é mais o esqueleto de
// prod, e o teste avisa antes de qualquer outra coisa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIGRATION = '../../supabase/migrations/20271107110000_funil_pagina_plano_generico.sql';
const ROLLBACK = '../../supabase/migrations/rollback/20271107110000_funil_pagina_plano_generico.sql';

const PROD = {
  get_pipeline_page: {
    file: '../../supabase/migrations/20271021000040_funil_projeta_data_do_desfecho.sql',
    md5: '5e77632f6d575d30b27d8977da81a0bd',
  },
  get_pipeline_stage_counts_by_id: {
    file: '../../supabase/migrations/20270908003000_rpcs_fundidas_por_pipeline_id.sql',
    md5: 'df02e1583326d8836f0d3a913dda3896',
  },
};
const ROLES = ['anon', 'authenticated', 'service_role'];

const createStatement = (file, name) => {
  const m = read(file).match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$(\\w*)\\$;`),
  );
  assert.ok(m, `CREATE de ${name} não encontrado em ${file}`);
  return m[0];
};

const snapshot = async (db) => (await db.query(`
  SELECT p.proname, p.oid::regprocedure::text AS sig, md5(p.prosrc) AS body,
         p.prosecdef, p.provolatile, p.proacl::text AS acl, p.proconfig,
         ${ROLES.map((r) => `has_function_privilege('${r}', p.oid, 'EXECUTE') AS "${r}"`).join(', ')}
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_pipeline_page', 'get_pipeline_stage_counts_by_id')
   ORDER BY p.proname`)).rows;

test('SET plan_cache_mode da função governa o plano cacheado do PL/pgSQL', async () => {
  const db = new PGlite();
  try {
    // Predicado pega-tudo: o plano específico usa o índice de k (1 linha); o
    // genérico não pode, e varre pelo índice de c filtrando a tabela inteira.
    await db.exec(`
      CREATE TABLE t(id serial PRIMARY KEY, k int, c int);
      INSERT INTO t(k, c) SELECT g, g FROM generate_series(1, 5000) g;
      CREATE INDEX t_k ON t(k);
      CREATE INDEX t_c ON t(c);
      ANALYZE t;
      CREATE FUNCTION f(p int) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
      DECLARE n bigint;
      BEGIN
        SELECT count(*) INTO n FROM (SELECT id FROM t WHERE (p IS NULL OR k = p) ORDER BY c DESC LIMIT 20) s;
        RETURN n;
      END $$;`);
    const tuplesRead = async () => {
      await db.exec('BEGIN');
      const q = `SELECT coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0) AS n
                   FROM pg_stat_xact_user_tables WHERE relname = 't'`;
      const before = Number((await db.query(q)).rows[0].n);
      await db.query('SELECT f(7)');
      const after = Number((await db.query(q)).rows[0].n);
      await db.exec('COMMIT');
      return after - before;
    };
    const runs = async () => { const out = []; for (let i = 0; i < 8; i++) out.push(await tuplesRead()); return out; };

    await db.exec('ALTER FUNCTION f(int) SET plan_cache_mode = force_generic_plan');
    const generic = await runs();
    await db.exec('ALTER FUNCTION f(int) SET plan_cache_mode = force_custom_plan');
    const custom = await runs();

    assert.ok(generic.every((n) => n >= 5000), `genérico deveria varrer a tabela: ${generic}`);
    assert.ok(custom.every((n) => n <= 5), `específico deveria ler ~1 linha: ${custom}`);
    // E o SET não vaza para a sessão depois da chamada.
    assert.equal((await db.query('SHOW plan_cache_mode')).rows[0].plan_cache_mode, 'auto');
  } finally { await db.close(); }
});

test('migration só acrescenta plan_cache_mode; corpo e grants idênticos; rollback volta', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
    for (const [name, { file }] of Object.entries(PROD)) {
      await db.exec(createStatement(file, name));
      // ACL de prod em 2026-10-05: {postgres=X, authenticated=X, service_role=X}.
      await db.exec(`
        REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.${name} TO authenticated, service_role;`);
    }

    const before = await snapshot(db);
    assert.equal(before.length, 2, 'uma sobrecarga de cada, como em prod');
    for (const fn of before) {
      assert.equal(fn.body, PROD[fn.proname].md5, `${fn.proname}: corpo do repo divergiu de prod`);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
      assert.deepEqual([fn.anon, fn.authenticated, fn.service_role], [false, true, true]);
    }

    await db.exec(read(MIGRATION));
    const after = await snapshot(db);
    for (const [i, fn] of after.entries()) {
      assert.deepEqual(fn.proconfig, ['search_path=""', 'plan_cache_mode=force_generic_plan']);
      const { proconfig: _a, ...rest } = fn;
      const { proconfig: _b, ...was } = before[i];
      assert.deepEqual(rest, was, `${fn.proname}: só o proconfig pode mudar`);
    }

    // A guarda recusa uma sobrecarga nova que nasça sem o SET.
    await db.exec(`CREATE FUNCTION public.get_pipeline_page(p_x int) RETURNS int
      LANGUAGE sql SET search_path = '' AS 'SELECT 1';
      REVOKE ALL ON FUNCTION public.get_pipeline_page(int) FROM PUBLIC;`);
    await assert.rejects(db.exec(read(MIGRATION)), /sem plan_cache_mode=force_generic_plan/);
    await db.exec(`ROLLBACK; DROP FUNCTION public.get_pipeline_page(int);`);

    await db.exec(read(ROLLBACK));
    assert.deepEqual(await snapshot(db), before, 'rollback devolve o estado de prod');
  } finally { await db.close(); }
});
