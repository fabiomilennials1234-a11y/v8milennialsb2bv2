/**
 * Synthetic concurrency probe. No production rows, providers or credentials.
 *
 * Adapters make the core usable through Supabase MCP as well as Management API:
 * - query(sql): execute_sql, returning its parsed row array.
 * - ddl(sql, suffix): apply_migration; throw on error.
 * - safeSql: contents of workflow-safe-custom-move.sql.
 * - winTriggerSql: contents of 20271021000039_negocio_ganho_vai_para_etapa_won.sql.
 * - schema: a fresh test_riofix_move_<16 lowercase hex> identifier.
 * - randomUUID(): UUID generator supplied by the caller.
 *
 * The exact candidate RPC and existing win trigger are copied with namespace
 * substitution only. Minimal synthetic tables omit unrelated triggers, RLS,
 * foreign keys and ledgers: this proves the selected lock interactions only.
 * All sessions settle before finally cleanup; failed assertions still clean up.
 * Do not run without explicit authorization for the target database.
 */
export async function runSafeMoveConcurrency({
  query, ddl, schema, randomUUID, safeSql, winTriggerSql,
  holdSeconds = 12, onProgress = () => {},
}) {
  if (!/^test_riofix_move_[a-f0-9]{16}$/.test(schema)) throw new Error("Invalid synthetic schema name");
  if (![query, ddl, randomUUID].every(fn => typeof fn === "function")) throw new Error("query, ddl and randomUUID adapters required");
  if (!Number.isInteger(holdSeconds) || holdSeconds < 4 || holdSeconds > 30) throw new Error("holdSeconds must be 4..30");
  if (!/for update nowait/i.test(safeSql) || !/for share nowait/i.test(safeSql)) throw new Error("Candidate must contain both NOWAIT protections");
  const winMatch = winTriggerSql.match(/CREATE OR REPLACE FUNCTION public\.fn_negocio_ganho_vai_para_etapa_won\(\)[\s\S]*?\$function\$;/i);
  if (!winMatch) throw new Error("Canonical win trigger body not found");
  const namespace = sql => sql.replaceAll("public.", `${schema}.`).replace(/SET search_path TO 'public'/gi, "SET search_path TO ''");
  const uuid = () => {
    const id = randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("Invalid synthetic UUID");
    return id;
  };
  const key = () => Math.floor(Math.random() * 2_000_000_000) + 1;
  const pending = new Set();
  const results = [];
  const diagnostics = [];
  let currentCase = "setup";
  let failure;
  let cleanup;
  const note = (phase, detail = {}, caseName = currentCase) => {
    const entry = { case: caseName, phase, at: new Date().toISOString(), ...detail };
    diagnostics.push(entry);
    onProgress(JSON.stringify(entry));
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const outcome = rows => {
    check(Array.isArray(rows) && rows.length === 1 && rows[0].result, "Probe result missing");
    return typeof rows[0].result === "string" ? JSON.parse(rows[0].result) : rows[0].result;
  };
  const start = (sql, label) => {
    const meta = { label, case: currentCase, started: Date.now(), settled: false };
    note("probe_started", { label });
    const operation = Promise.resolve().then(() => query(sql)).then(rows => {
      meta.settled = true;
      try {
        const result = outcome(rows);
        meta.summary = { sqlstate: result.sqlstate, status: result.result?.status, pid: result.pid,
          message: result.message, started_at: result.started_at, finished_at: result.finished_at };
      } catch (error) {
        meta.summary = { parse_error: error.message, row_count: Array.isArray(rows) ? rows.length : null };
      }
      note("probe_finished", { label, elapsed_ms: Date.now() - meta.started, ...meta.summary }, meta.case);
      return { rows };
    }, error => {
      meta.settled = true;
      meta.summary = { transport_error: String(error?.message ?? error).slice(0, 2000) };
      note("probe_failed", { label, elapsed_ms: Date.now() - meta.started, ...meta.summary }, meta.case);
      return { error };
    });
    operation.probe = meta;
    pending.add(operation);
    operation.then(() => pending.delete(operation));
    return operation;
  };
  const finish = async operation => {
    const settled = await operation;
    if (settled.error) throw settled.error;
    return outcome(settled.rows);
  };
  const waitFor = async (sql, read, message, stopWhen = () => false) => {
    const deadline = Date.now() + Math.min(holdSeconds * 800, 20_000);
    while (Date.now() < deadline) {
      const value = read(await query(sql));
      if (value) return value;
      if (stopWhen()) throw new Error(message + "; holder finished before its lock was observed");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(message);
  };
  const barrier = async (k, operation) => {
    try {
      const pid = await waitFor(
        `select pid from pg_locks where locktype='advisory' and classid=0::oid and objid=${k}::oid and objsubid=1 and granted`,
        rows => rows[0]?.pid,
        "Synthetic lock barrier not observed",
        () => operation.probe.settled,
      );
      note("barrier_observed", { label: operation.probe.label, pid });
      return pid;
    } catch (error) {
      // Preserve the holder's actual SQLSTATE/transport failure instead of
      // reporting only a missing barrier. This also identifies serialized MCP
      // calls: the holder succeeds, but no concurrent query ever sees its lock.
      await operation;
      note("barrier_failed", { label: operation.probe.label, ...operation.probe.summary });
      throw new Error(`${error.message}; holder=${JSON.stringify(operation.probe.summary)}`);
    }
  };
  const waiting = pid => waitFor(
    `select exists(select 1 from pg_locks where pid=${Number(pid)} and not granted) as waiting`,
    rows => rows[0]?.waiting === true,
    "Expected contender did not wait while automation owned the locks",
  );
  const makeFixture = async () => {
    const f = { org: uuid(), lead: uuid(), pipe: uuid(), source: uuid(), target: uuid(), won: uuid(), deal: uuid(), entry: uuid() };
    await query(`begin;
      insert into ${schema}.pipelines values('${f.pipe}','${f.org}',true,'custom');
      insert into ${schema}.leads values('${f.lead}','${f.org}',null);
      insert into ${schema}.pipeline_stages(id,organization_id,pipeline_id,stage_key,stage_role,position) values
        ('${f.source}','${f.org}','${f.pipe}','waiting','open',1),
        ('${f.target}','${f.org}','${f.pipe}','talking','open',2),
        ('${f.won}','${f.org}','${f.pipe}','won','won',3);
      insert into ${schema}.deals(id,organization_id,source_lead_id,outcome,value) values('${f.deal}','${f.org}','${f.lead}','open',1);
      insert into ${schema}.pipeline_entries(id,organization_id,lead_id,pipeline_id,stage_id,stage_key,deal_id)
        values('${f.entry}','${f.org}','${f.lead}','${f.pipe}','${f.source}','waiting','${f.deal}');
      commit;`);
    return f;
  };
  // The connected role can default to an 8s timeout, shorter than the barrier
  // hold. Set it in the same transaction as every probe, never globally.
  const probeSql = sql => `begin; set local statement_timeout='55s'; ${sql}; commit;`;
  const probe = (sql, label) => finish(start(sql, label));
  const move = (f, k = null, hold = 0) => probeSql(`select ${schema}.probe_move('${f.org}','${f.lead}','${f.entry}','${f.pipe}','${f.target}','${f.source}',${k ?? "null"},${hold}) as result`);
  const win = (f, k, hold, lockFirst) => probeSql(`select ${schema}.probe_win('${f.deal}',${k},${hold},${lockFirst}) as result`);
  const verify = async f => (await query(`select pe.stage_key,d.outcome,st.stage_role as target_role,st.is_active as target_active
    from ${schema}.pipeline_entries pe join ${schema}.deals d on d.id=pe.deal_id
    join ${schema}.pipeline_stages st on st.id='${f.target}' where pe.id='${f.entry}'`))[0];

  // Refuse an existing namespace before entering cleanup ownership.
  const absent = (await query(`select to_regnamespace('${schema}') is null as schema_absent`))[0];
  check(absent?.schema_absent === true, "Synthetic schema already exists; refusing to reuse or remove it");
  try {
    onProgress("Creating isolated synthetic schema");
    await ddl(`set local statement_timeout='25s';
      create schema ${schema}; revoke all on schema ${schema} from public;
      grant usage on schema ${schema} to service_role;
      create table ${schema}.pipelines(id uuid primary key,organization_id uuid,is_active boolean,type text);
      create table ${schema}.leads(id uuid primary key,organization_id uuid,deleted_at timestamptz);
      create table ${schema}.pipeline_stages(id uuid primary key,organization_id uuid,pipeline_id uuid,stage_key text,
        stage_role text,is_active boolean default true,is_final_positive boolean default false,is_final_negative boolean default false,position integer);
      create table ${schema}.deals(id uuid primary key,organization_id uuid,source_lead_id uuid,deleted_at timestamptz,outcome text,value numeric);
      create table ${schema}.pipeline_entries(id uuid primary key,organization_id uuid,lead_id uuid,pipeline_id uuid,stage_id uuid,
        stage_key text,closed_at timestamptz,deal_id uuid,stage_changed_at timestamptz,updated_at timestamptz,metadata jsonb default '{}');
      create function ${schema}.assert_org_access(p_org uuid) returns void language plpgsql as $$begin
        if not exists(select 1 from ${schema}.leads where organization_id=p_org) then raise exception 'synthetic scope mismatch';end if;
      end$$;
      ${namespace(safeSql)}
      ${namespace(winMatch[0])}
      create trigger synthetic_win_moves_entry after update of outcome on ${schema}.deals for each row
        when(new.outcome='won' and old.outcome is distinct from 'won' and new.deleted_at is null)
        execute function ${schema}.fn_negocio_ganho_vai_para_etapa_won();
      create function ${schema}.probe_move(p_org uuid,p_lead uuid,p_entry uuid,p_pipe uuid,p_target uuid,p_source uuid,p_barrier bigint,p_hold integer)
      returns jsonb language plpgsql as $$declare result jsonb;started timestamptz:=clock_timestamp();begin
        result:=${schema}.workflow_move_custom_entry_safely(p_org,p_lead,p_entry,p_pipe,p_target::text,array[p_source]);
        if p_barrier is not null then perform pg_advisory_xact_lock(p_barrier);end if;
        if p_hold>0 then perform pg_sleep(p_hold);end if;
        return jsonb_build_object('sqlstate','00000','result',result,'pid',pg_backend_pid(),'started_at',started,'finished_at',clock_timestamp());
      exception when others then
        return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm,'pid',pg_backend_pid(),'started_at',started,'finished_at',clock_timestamp());
      end$$;
      create function ${schema}.probe_win(p_deal uuid,p_barrier bigint,p_hold integer,p_lock_first boolean)
      returns jsonb language plpgsql as $$declare started timestamptz:=clock_timestamp();begin
        if p_lock_first then perform 1 from ${schema}.deals where id=p_deal for update;end if;
        perform pg_advisory_xact_lock(p_barrier);
        if p_hold>0 then perform pg_sleep(p_hold);end if;
        update ${schema}.deals set outcome='won' where id=p_deal;
        return jsonb_build_object('sqlstate','00000','pid',pg_backend_pid(),'started_at',started,'finished_at',clock_timestamp());
      exception when others then
        return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm,'pid',pg_backend_pid(),'started_at',started,'finished_at',clock_timestamp());
      end$$;
      create function ${schema}.probe_target_change(p_stage uuid,p_role text,p_active boolean,p_barrier bigint,p_hold integer)
      returns jsonb language plpgsql as $$begin
        update ${schema}.pipeline_stages set stage_role=p_role,is_active=p_active where id=p_stage;
        perform pg_advisory_xact_lock(p_barrier); perform pg_sleep(p_hold);
        return jsonb_build_object('sqlstate','00000','pid',pg_backend_pid());
      end$$;
      grant all on all tables in schema ${schema} to service_role;
      revoke execute on all functions in schema ${schema} from public,anon,authenticated;
      grant execute on all functions in schema ${schema} to service_role;`, "setup");

    currentCase = "sale_first";
    onProgress("Testing a manual sale holding the deal before automation");
    {
      const f = await makeFixture(); const k = key();
      const seller = start(win(f, k, holdSeconds, true), "manual_sale");
      const sellerPid = await barrier(k, seller);
      const automation = await probe(move(f), "automation");
      const sale = await finish(seller);
      const state = await verify(f);
      check(automation.sqlstate === "55P03", `Automation should yield 55P03, received ${automation.sqlstate}`);
      check(sale.sqlstate === "00000" && state.outcome === "won" && state.stage_key === "won", "Manual sale was interrupted or its final position was overwritten");
      check(automation.pid !== sellerPid && sale.pid === sellerPid, "Expected two distinct database sessions");
      results.push({ case: "sale_first", automation_sqlstate: automation.sqlstate, sale_sqlstate: sale.sqlstate, state, distinct_sessions: 2 });
      note("case_passed", { state });
    }

    currentCase = "automation_first";
    onProgress("Testing automation holding the locks before a manual sale");
    {
      const f = await makeFixture(); const aKey = key(); const sKey = key();
      const automation = start(move(f, aKey, holdSeconds), "automation");
      const automationPid = await barrier(aKey, automation);
      const seller = start(win(f, sKey, 0, false), "manual_sale");
      const sellerPid = await barrier(sKey, seller);
      await waiting(sellerPid);
      note("sale_wait_observed", { pid: sellerPid });
      const [moved, sale] = await Promise.all([finish(automation), finish(seller)]);
      const state = await verify(f);
      check(moved.sqlstate === "00000" && moved.result?.status === "moved", "Automation did not move before releasing its locks");
      check(sale.sqlstate === "00000" && state.outcome === "won" && state.stage_key === "won", "Waiting sale did not commit after automation");
      check(automationPid !== sellerPid && moved.pid === automationPid && sale.pid === sellerPid, "Expected two distinct database sessions");
      results.push({ case: "automation_first", sale_wait_observed: true, automation_sqlstate: moved.sqlstate, sale_sqlstate: sale.sqlstate, state, distinct_sessions: 2 });
      note("case_passed", { state });
    }

    for (const change of [{ name: "destination_becomes_won", role: "won", active: true }, { name: "destination_becomes_inactive", role: "open", active: false }]) {
      currentCase = change.name;
      onProgress(`Testing ${change.name}`);
      const f = await makeFixture(); const k = key();
      const editor = start(probeSql(`select ${schema}.probe_target_change('${f.target}','${change.role}',${change.active},${k},${holdSeconds}) as result`), "stage_editor");
      const editorPid = await barrier(k, editor);
      const automation = await probe(move(f), "automation");
      const edited = await finish(editor);
      const retry = await probe(move(f), "automation_retry");
      const state = await verify(f);
      check(automation.sqlstate === "55P03", `Concurrent destination change should yield 55P03, received ${automation.sqlstate}`);
      check(edited.sqlstate === "00000" && retry.sqlstate === "22023", "Committed destination change was not rejected on retry");
      check(state.stage_key === "waiting" && state.outcome === "open" && state.target_role === change.role && state.target_active === change.active, "Invalid destination changed a deal or its position");
      check(automation.pid !== editorPid && edited.pid === editorPid, "Expected two distinct database sessions");
      results.push({ case: change.name, automation_sqlstate: automation.sqlstate, retry_sqlstate: retry.sqlstate, state, distinct_sessions: 2 });
      note("case_passed", { state });
    }
  } catch (error) {
    failure = error;
    note("case_failed", { message: String(error?.message ?? error).slice(0, 3000) });
  } finally {
    await Promise.all([...pending]);
    currentCase = "cleanup";
    onProgress("Removing synthetic schema and verifying cleanup");
    try {
      await ddl(`set local lock_timeout='5s'; set local statement_timeout='25s'; drop schema if exists ${schema} cascade;`, "cleanup");
      cleanup = (await query(`select to_regnamespace('${schema}') is null as schema_absent`))[0];
      check(cleanup?.schema_absent === true, "Synthetic schema cleanup was not confirmed");
      note("cleanup_confirmed", cleanup);
    } catch (error) {
      failure = new Error(`${failure ? failure.message + "; " : ""}Cleanup failed for ${schema}: ${error.message}`);
    }
  }
  const report = { tested_at: new Date().toISOString(), schema, results, diagnostics, cleanup,
    limitations: "Synthetic tables and namespace-copied RPC/win trigger; unrelated triggers, RLS, FKs and ledgers omitted. No customer rows or external sends." };
  if (failure) { failure.report = report; throw failure; }
  return report;
}
