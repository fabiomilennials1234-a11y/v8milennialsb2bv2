import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = path => readFileSync(new URL('../../' + path,import.meta.url),'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
let db;
const query = (text,params=[]) => db.query(text,params);
const one = async (text,params=[]) => (await query(text,params)).rows[0];
const login = async (user=1,role='authenticated') => {
  await db.exec('RESET ROLE');
  await query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)",[user?id(user):'',role]);
  await db.exec('SET ROLE ' + role);
};
const call = (kind,address=40) => kind==='pin'
  ? query('select lead_address_set_pin($1,-23.5,-46.6)',[id(address)])
  : query('select lead_address_retry_geocode($1)',[id(address)]);

before(async()=>{
  db=new PGlite();
  await db.exec(sql('tests/fixtures/lead-address-authorization-schema.sql'));
  const migration=sql('supabase/migrations/20271227000000_app_representantes_enderecos.sql');
  for (const name of ['lead_address_authorize','lead_address_set_pin','lead_address_retry_geocode']) {
    const definition=migration.match(new RegExp('CREATE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$fn\\$;'))?.[0];
    assert.ok(definition,'executes actual migration function: '+name);
    await db.exec(definition);
  }
  await db.exec([
    'REVOKE ALL ON FUNCTION lead_address_authorize(uuid) FROM PUBLIC,anon,authenticated,service_role;',
    'REVOKE ALL ON FUNCTION lead_address_set_pin(uuid,double precision,double precision),lead_address_retry_geocode(uuid) FROM PUBLIC,anon;',
    'GRANT EXECUTE ON FUNCTION lead_address_set_pin(uuid,double precision,double precision),lead_address_retry_geocode(uuid) TO authenticated,service_role;',
  ].join('\n'));
  await db.exec(sql('supabase/tests/_rls_invariants_detectors.sql'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('RESET ROLE; TRUNCATE leads,test_permissions,lead_addresses,lead_address_events CASCADE');
  await query('insert into leads(id,organization_id) values($1,$2),($3,$4)',[id(30),id(10),id(90),id(90)]);
  await query('insert into test_permissions values($1,$2,true,true)',[id(1),id(10)]);
  await query('insert into lead_addresses(id,lead_id) values($1,$2),($3,$4)',[id(40),id(30),id(91),id(90)]);
});

test('detector recognizes the actual protected address RPCs without increasing the baseline',async()=>{
  const rows=(await query("select functionname from _rls_inv_definer_without_gate() where functionname in ('lead_address_set_pin','lead_address_retry_geocode')")).rows;
  assert.deepEqual(rows,[]);
});

test('detector still flags removing the gate from either caller',async()=>{
  await db.exec('BEGIN');
  try {
    for (const name of ['lead_address_set_pin','lead_address_retry_geocode']) {
      const {definition}=await one('select pg_get_functiondef(oid) definition from pg_proc where proname=$1',[name]);
      assert.ok(definition.includes('v_org := public.lead_address_authorize(v_lead);'));
      await db.exec(definition.replace('v_org := public.lead_address_authorize(v_lead);', 'v_org := NULL;'));
    }
    const rows=(await query("select functionname from _rls_inv_definer_without_gate() where functionname in ('lead_address_set_pin','lead_address_retry_geocode') order by functionname")).rows;
    assert.deepEqual(rows.map(r=>r.functionname),['lead_address_retry_geocode','lead_address_set_pin']);
  } finally { await db.exec('ROLLBACK'); }
});

test('a helper in another schema or a comment cannot satisfy the detector',async()=>{
  const matches=async src=>(await one('select _rls_inv_strip_sql_comments($1) ~* (select pattern from _rls_inv_gate_helper_pattern()) matched',[src])).matched;
  assert.equal(await matches('PERFORM public.lead_address_authorize(p_lead);'),true);
  assert.equal(await matches('PERFORM attacker.lead_address_authorize(p_lead);'),false);
  assert.equal(await matches('/* public.lead_address_authorize(p_lead) */ RETURN;'),false);
});

for(const kind of ['pin','retry']) {
  test(kind+': an authorized member changes its own address and records the real actor',async()=>{
    await login(); await call(kind);
    const address=await one('select * from lead_addresses where id=$1',[id(40)]);
    assert.equal(address.geocode_status,kind==='pin'?'manual':'pending');
    assert.equal(address.updated_by,id(1));
    const event=await one('select * from lead_address_events');
    assert.equal(event.organization_id,id(10)); assert.equal(event.actor,id(1));
    assert.equal((await one('select geocode_status from lead_addresses where id=$1',[id(91)])).geocode_status,'failed');
  });

  test(kind+': missing identity and foreign tenant cannot write or produce events',async()=>{
    await login(null);
    await assert.rejects(()=>call(kind),e=>e.code==='42501');
    await login();
    await assert.rejects(()=>call(kind,91),e=>e.code==='PT404');
    assert.equal((await one('select count(*)::int n from lead_address_events')).n,0);
    assert.equal((await one('select count(*)::int n from lead_addresses where geocode_status<>$1',['failed'])).n,0);
  });

  for(const denied of ['can_update','can_address']) {
    test(kind+': membership does not override denied '+denied,async()=>{
      await db.exec('update test_permissions set '+denied+'=false');
      await login();
      await assert.rejects(()=>call(kind),e=>e.code==='42501');
      assert.equal((await one('select count(*)::int n from lead_address_events')).n,0);
    });
  }

  test(kind+': deleted leads and addresses are unreachable',async()=>{
    await query('update leads set deleted_at=now() where id=$1',[id(30)]);
    await login();
    await assert.rejects(()=>call(kind),e=>e.code==='PT404');
    await db.exec('RESET ROLE; update leads set deleted_at=null; update lead_addresses set deleted_at=now()');
    await login();
    await assert.rejects(()=>call(kind),e=>e.code==='PT404');
  });

  test(kind+': anon cannot execute the RPC; service role keeps its intended backend access',async()=>{
    await login(null,'anon');
    await assert.rejects(()=>call(kind),e=>e.code==='42501');
    await login(null,'service_role'); await call(kind,91);
    assert.equal((await one('select organization_id from lead_address_events')).organization_id,id(90));
  });
}
