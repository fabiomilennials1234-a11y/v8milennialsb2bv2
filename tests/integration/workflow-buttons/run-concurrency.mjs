/** Explicit production-authorized probe. Only synthetic rows in an isolated, finally-dropped schema. */
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
const project = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!project || !/^[a-z]{20}$/.test(project) || !token) throw new Error('Explicit target and access token required');
const schema = `test_workflow_buttons_${randomBytes(8).toString('hex')}`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error((await response.json()).message || `HTTP ${response.status}`);
  return response.json();
}
const migrations = ['20271020000060_workflow_button_questions.sql', '20271020000062_workflow_button_inbox.sql', '20271020000063_workflow_button_send_recovery.sql', '20271020000064_workflow_button_queue.sql']
  .map(file => readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8').replaceAll('public.', `${schema}.`)).join('\n');
const tables = ['organizations','leads','whatsapp_instances','workflows','workflow_executions','whatsapp_messages','workflow_execution_steps','workflow_guided_versions'];
const definition = {nodes: [{id:'ask',type:'question_buttons',data:{text:'Synthetic race',timeoutHours:24,buttons:[{id:'a',label:'A'}]}}, ...['a','other','timeout','failure'].map(id=>({id,type:'end',data:{}}))], edges: [['button:a','a'],['other_response','other'],['timeout','timeout'],['send_failure','failure']].map(([sourceHandle,target])=>({source:'ask',sourceHandle,target}))};
const results = [];
let failure;
try {
  await query(`BEGIN; SET LOCAL statement_timeout='20s'; CREATE SCHEMA ${schema}; REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC; GRANT USAGE ON SCHEMA ${schema} TO service_role;
    ${tables.map(table=>`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL);`).join('\n')}
    ${migrations}
    GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO service_role; COMMIT;`);
  for (const firstKind of ['button','other']) {
    const org=randomUUID(), lead=randomUUID(), instance=randomUUID(), wf=randomUUID(), execution=randomUUID();
    const fixture = await query(`BEGIN; SET LOCAL ROLE service_role;
      INSERT INTO ${schema}.organizations(id,name,slug,is_sandbox,feature_flags) VALUES('${org}','Synthetic concurrency','race-${org}',true,'{"workflow_question_buttons":true}');
      INSERT INTO ${schema}.leads(id,organization_id,name,phone) VALUES('${lead}','${org}','Synthetic recipient','5548999990000');
      INSERT INTO ${schema}.whatsapp_instances(id,organization_id,instance_name,status,provider) VALUES('${instance}','${org}','synthetic-no-credentials','connected','uazapi');
      INSERT INTO ${schema}.workflows(id,organization_id,name,trigger_type,definition,is_active,re_enrollment_enabled) VALUES('${wf}','${org}','Synthetic race','manual',${literal(JSON.stringify(definition))}::jsonb,false,true);
      INSERT INTO ${schema}.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status) VALUES('${execution}','${wf}','${org}','${lead}','ask','running');
      SELECT ${schema}.freeze_workflow_button_definition('${execution}','${org}');
      SELECT ${schema}.prepare_workflow_button_question('${execution}','${org}','ask',1,'${instance}','5548999990000');
      COMMIT;
      SELECT id FROM ${schema}.workflow_button_questions WHERE execution_id='${execution}';`);
    const q=fixture.at(-1).id;
    await query(`SELECT ${schema}.accept_workflow_button_question('${q}','${org}','outbound-${q}',clock_timestamp());`);
    const payload = (id,kind) => literal(JSON.stringify({messageid:`${id}-${q}`,chatid:'5548999990000@s.whatsapp.net',fromMe:false,messageType:kind==='button'?'ButtonsResponseMessage':'conversation',text:'Synthetic reply',...(kind==='button'?{buttonOrListid:`${q}:a`,quoted:`outbound-${q}`}:{})}));
    const key = randomBytes(4).readUInt32BE(0);
    // Barrier is taken only after ingress has its authoritative DB receipt and both row locks.
    const first = query(`BEGIN; SET LOCAL statement_timeout='20s';
      SELECT id FROM ${schema}.workflow_executions WHERE id='${execution}' FOR UPDATE;
      SELECT id FROM ${schema}.workflow_button_questions WHERE id='${q}' FOR UPDATE;
      UPDATE ${schema}.workflow_button_questions SET deadline_at=clock_timestamp()+interval '500 milliseconds' WHERE id='${q}';
      SELECT ${schema}.register_workflow_button_ingress('${org}','${instance}',${payload('first',firstKind)}::jsonb,'webhook');
      SELECT pg_advisory_xact_lock(${key}::bigint); SELECT pg_sleep(7);
      SELECT pg_backend_pid() AS pid; COMMIT;`).then(value=>({value}),error=>({error}));
    let barrier=false;
    for(let attempt=0;attempt<30;attempt++) {
      const probe=await query(`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS available;`);
      if(probe[0].available===false){barrier=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!barrier){await first;throw new Error('Admission barrier not observed');}
    const contenders = await Promise.allSettled([
      query(`BEGIN; SET LOCAL statement_timeout='20s'; SELECT ${schema}.register_workflow_button_ingress('${org}','${instance}',${payload('second',firstKind==='button'?'other':'button')}::jsonb,'webhook'); SELECT ${schema}.resolve_workflow_button_question('${q}','${org}') AS resolved,pg_backend_pid() AS pid; COMMIT;`),
      query(`BEGIN; SET LOCAL statement_timeout='20s'; SELECT ${schema}.resolve_workflow_button_question('${q}','${org}') AS resolved,pg_backend_pid() AS pid; COMMIT;`),
    ]);
    const initial=await first;
    if(initial.error)throw initial.error;
    for(const contender of contenders)if(contender.status==='rejected')throw contender.reason;
    const check=await query(`SELECT q.selected_handle,e.current_node_id,(SELECT count(*)::int FROM ${schema}.workflow_execution_steps WHERE execution_id=e.id) AS steps, (SELECT min(received_at)<q.deadline_at FROM ${schema}.workflow_button_ingress WHERE question_id=q.id) AS first_before_deadline,clock_timestamp()>q.deadline_at AS resolved_after_deadline FROM ${schema}.workflow_button_questions q JOIN ${schema}.workflow_executions e ON e.id=q.execution_id WHERE q.id='${q}';`);
    const pids=[initial.value.at(-1).pid,...contenders.map(result=>result.value.at(-1).pid)];
    const expected=firstKind==='button'?'button:a':'other_response';
    if(check[0].selected_handle!==expected || check[0].current_node_id!==(firstKind==='button'?'a':'other') || check[0].steps!==1 || !check[0].first_before_deadline || !check[0].resolved_after_deadline || new Set(pids).size!==3)throw new Error(`Race assertion failed ${JSON.stringify({firstKind,check,pids})}`);
    results.push({firstKind,distinct_sessions:3,check:check[0]});
    if(firstKind==='button') {
      // Two queued questions compete for the slot after a prior node concludes.
      const execution2=randomUUID(), execution3=randomUUID();
      await query(`BEGIN; UPDATE ${schema}.workflow_executions SET current_node_id='ask',status='running' WHERE id='${execution}';
        SELECT ${schema}.prepare_workflow_button_question('${execution}','${org}','ask',2,'${instance}','5548999990000');
        INSERT INTO ${schema}.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status) VALUES
          ('${execution2}','${wf}','${org}','${lead}','ask','running'),('${execution3}','${wf}','${org}','${lead}','ask','running');
        SELECT ${schema}.freeze_workflow_button_definition('${execution2}','${org}'); SELECT ${schema}.freeze_workflow_button_definition('${execution3}','${org}');
        SELECT ${schema}.prepare_workflow_button_question('${execution2}','${org}','ask',1,'${instance}','5548999990000');
        SELECT ${schema}.prepare_workflow_button_question('${execution3}','${org}','ask',1,'${instance}','5548999990000');
        SELECT ${schema}.fail_workflow_button_question(id,'${org}','send_preflight_failed') FROM ${schema}.workflow_button_questions WHERE execution_id='${execution}' AND visit=2; COMMIT;`);
      const queueKey=randomBytes(4).readUInt32BE(0);
      const firstClaim=query(`BEGIN; SET LOCAL statement_timeout='20s';
        CREATE TEMP TABLE probe_queue_claim ON COMMIT DROP AS SELECT * FROM ${schema}.claim_workflow_button_queue(1);
        SELECT pg_advisory_xact_lock(${queueKey}::bigint); SELECT pg_sleep(7);
        SELECT pg_backend_pid() AS pid,(SELECT count(*)::int FROM probe_queue_claim) AS claimed; COMMIT;`).then(value=>({value}),error=>({error}));
      let observed=false;
      for(let attempt=0;attempt<30;attempt++){
        if((await query(`SELECT pg_try_advisory_xact_lock(${queueKey}::bigint) AS available;`))[0].available===false){observed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!observed){await firstClaim;throw new Error('Queue claim barrier not observed');}
      const secondClaim=await query(`SELECT pg_backend_pid() AS pid,count(*)::int AS claimed FROM ${schema}.claim_workflow_button_queue(1);`);
      const firstResult=await firstClaim;
      if(firstResult.error)throw firstResult.error;
      const queue=await query(`SELECT execution_id,state FROM ${schema}.workflow_button_questions WHERE execution_id IN ('${execution2}','${execution3}') ORDER BY created_at,id;`);
      if(firstResult.value.at(-1).claimed!==1 || secondClaim[0].claimed!==0 || firstResult.value.at(-1).pid===secondClaim[0].pid || queue[0].execution_id!==execution2 || queue[0].state!=='sending' || queue[1].state!=='queued')throw new Error('Queue concurrent ownership/FIFO assertion failed');
      results.push({queue_fifo:true,concurrent_claims:[1,0],distinct_sessions:2});
      // End the owned node, leaving its downstream execution running; next queue entry becomes eligible.
      const next=await query(`SELECT ${schema}.fail_workflow_button_question(id,'${org}','send_preflight_failed') FROM ${schema}.workflow_button_questions WHERE execution_id='${execution2}'; SELECT execution_id FROM ${schema}.claim_workflow_button_queue(1);`);
      if(next.at(-1).execution_id!==execution3)throw new Error('Queue did not release at node conclusion');
    }

  }
} catch(error) { failure=error; }
finally {
  await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
  const cleanup=await query(`SELECT to_regnamespace('${schema}') IS NULL AS schema_absent;`);
  console.log(JSON.stringify({tested_at:new Date().toISOString(),project,results,cleanup,limitations:'Empty LIKE clones omit existing dependency triggers and foreign keys; candidate migrations and candidate locks unchanged except namespace. No real workflow, send or activation.'},null,2));
  if(!cleanup[0].schema_absent)throw new Error('Isolated schema cleanup not confirmed');
}
if(failure)throw failure;
