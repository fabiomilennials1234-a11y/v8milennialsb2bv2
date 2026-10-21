import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (path) => readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const query = (text,params=[]) => db.query(text,params);
const one = async (text,params=[]) => (await query(text,params)).rows[0];
const login = async (user=1,role='authenticated') => {
  await db.exec('RESET ROLE');
  await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[user?id(user):'',role]);
  await db.exec(`SET ROLE ${role}`);
};
const createEntry = async (n=40,owner=11) => {
  await db.exec('RESET ROLE');
  await query(`insert into pipeline_entries(id,organization_id,pipeline_id,stage_id,stage_key,assigned_to,lead_id)
    values($1,$2,$3,$4,'proposta',$5,$6)`,[id(n),id(10),id(20),id(21),owner?id(owner):null,id(30)]);
};
before(async () => {
  db=new PGlite();
  await db.exec(sql('tests/fixtures/task-playbook-schema.sql'));
  const orgGate=sql('supabase/migrations/20260101000000_baseline_prod_schema.sql').match(/CREATE OR REPLACE FUNCTION "public"\."assert_org_access"[\s\S]*?\$\$;/)?.[0];
  assert.ok(orgGate,'uses the real tenancy gate');
  await db.exec(orgGate);
  await db.exec(sql('supabase/migrations/20270825000000_is_org_admin_helper.sql'));
  const unified=sql('supabase/migrations/20270908001000_inversao_do_silo_custom.sql');
  const trigger=unified.match(/CREATE OR REPLACE FUNCTION public\.apply_stage_checklist\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(trigger,'uses the real unified legacy trigger');
  await db.exec(trigger);
  await db.exec(sql('supabase/migrations/20271212000000_tarefas_playbook_opcao_b.sql'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false),set_config('test.master','false',false),set_config('test.followups','true',false);
    TRUNCATE organizations,team_members,leads,deals,pipelines,pipeline_stages,pipeline_entries,checklists,checklist_items CASCADE;
    INSERT INTO organizations(id,name) VALUES('${id(10)}','Org A'),('${id(90)}','Org B');
    INSERT INTO team_members(id,organization_id,user_id,name,role) VALUES
      ('${id(11)}','${id(10)}','${id(1)}','Admin','admin'),
      ('${id(12)}','${id(10)}','${id(2)}','Bruno','member'),
      ('${id(13)}','${id(10)}','${id(3)}','Ana','member'),
      ('${id(91)}','${id(90)}','${id(9)}','Outra org','admin');
    INSERT INTO leads VALUES('${id(30)}','${id(10)}','Metalúrgica Alfa');
    INSERT INTO deals VALUES('${id(50)}');
    INSERT INTO pipelines(id,organization_id,name,slug) VALUES('${id(20)}','${id(10)}','Vendas','vendas');
    INSERT INTO checklists(id,organization_id,title,description) VALUES('${id(31)}','${id(10)}','Modelo original','Roteiro original');
    INSERT INTO checklist_items(id,checklist_id,title,position) VALUES
      ('${id(32)}','${id(31)}','Enviar proposta',0),('${id(33)}','${id(31)}','Ligar em dois dias',1);
    INSERT INTO pipeline_stages(id,organization_id,pipeline_id,pipeline_type,stage_key,name,checklist_template_id) VALUES
      ('${id(21)}','${id(10)}','${id(20)}','vendas','proposta','Proposta','${id(31)}'),
      ('${id(22)}','${id(10)}','${id(20)}','vendas','negociacao','Negociação',null);
    INSERT INTO pipeline_entries(id,organization_id,pipeline_id,stage_id,stage_key,assigned_to,lead_id,deal_id)
      VALUES('${id(39)}','${id(10)}','${id(20)}','${id(21)}','proposta','${id(12)}','${id(30)}','${id(50)}');
    UPDATE checklist_items SET is_completed=true WHERE checklist_id<>'${id(31)}' AND position=0;
    UPDATE organizations SET ui_v5_enabled=true WHERE id='${id(10)}';`);
});

test('converte apenas modelos por etapa; preserva itens antigos e não cria backlog',async()=>{
  const activities=(await query('select * from task_playbook_activities order by position')).rows;
  assert.equal(activities.length,2);
  assert.deepEqual(activities.map(a=>a.source_checklist_item_id),[id(32),id(33)]);
  assert.ok(activities.every(a=>!a.required && a.due_days===0));
  assert.equal((await one('select count(*)::int n from task_work_items')).n,0);
  const historic=await one("select c.playbook_archived_at,count(i.*)::int n,count(*) filter(where i.is_completed)::int done from checklists c join checklist_items i on i.checklist_id=c.id where c.pipeline_entry_id=$1 group by c.id",[id(39)]);
  assert.ok(historic.playbook_archived_at);
  assert.deepEqual([historic.n,historic.done],[2,1]);
  await login(); await query('select task_activate($1)',[id(10)]);
  assert.equal((await one('select count(*)::int n from task_playbook_activities')).n,2);
});
test('novas entradas recebem atividades com responsável, prazo local e sem duplicar checklist',async()=>{
  await createEntry(40,12);
  const rows=(await query('select * from task_work_items order by position')).rows;
  assert.equal(rows.length,2); assert.ok(rows.every(t=>t.assignee_id===id(12)));
  assert.equal((await one('select count(*)::int n from checklists where pipeline_entry_id=$1',[id(40)])).n,0);
  assert.equal((await one("select bool_and((due_at at time zone 'America/Sao_Paulo')::time='23:59:59') ok from task_work_items")).ok,true);
  await query('update pipeline_entries set stage_id=$2,stage_key=$3 where id=$1',[id(40),id(22),'negociacao']);
  await query('update pipeline_entries set stage_id=$2,stage_key=$3 where id=$1',[id(40),id(21),'proposta']);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,2);
  await createEntry(41,13);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,4,'a second deal of the same lead gets its own tasks');
});
test('troca de responsável reassocia só tarefas abertas e recusa membro de outra org',async()=>{
  await createEntry(40,12); await login(2);
  const first=(await one('select id from task_work_items order by position limit 1')).id;
  await query("select task_transition($1,'complete','Enviei')",[first]);
  await db.exec('RESET ROLE');
  await query('update pipeline_entries set assigned_to=$2 where id=$1',[id(40),id(13)]);
  assert.equal((await one('select assignee_id from task_work_items where id=$1',[first])).assignee_id,id(12));
  assert.equal((await one("select assignee_id from task_work_items where status='pending'")).assignee_id,id(13));
  await query('update pipeline_entries set assigned_to=$2 where id=$1',[id(40),id(91)]);
  assert.equal((await one("select assignee_id from task_work_items where status='pending'")).assignee_id,null);
});
test('membro lê somente suas tarefas; admin lê equipe, mas não conclui tarefa alheia',async()=>{
  await createEntry(40,12); await createEntry(41,13); await login(2);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,2);
  assert.equal((await one('select task_queue($1) result',[id(10)])).result.total,2);
  assert.equal((await one('select task_queue($1,$2) result',[id(10),id(13)])).result.total,0);
  await assert.rejects(query('insert into task_work_items(organization_id) values($1)',[id(10)]),/permission denied/i);
  await login(1);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,4);
  const task=(await one('select id from task_work_items limit 1')).id;
  await assert.rejects(query("select task_transition($1,'complete')",[task]),/Somente o responsável/);
  await login(9);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,0);
  await assert.rejects(query('select task_queue($1)',[id(10)]),/access_denied/);
  await assert.rejects(query('select task_pending_for_move($1)',[id(40)]),/access_denied/);
});
test('configuração é admin-only, valida tenancy da etapa e do responsável',async()=>{
  await login(2);
  await assert.rejects(query('select task_configuration($1)',[id(10)]),/forbidden/);
  await assert.rejects(query('select task_activate($1)',[id(10)]),/forbidden/);
  await assert.rejects(query("select task_save_routine($1,null,null,'Diária','',array[1]::smallint[],'18:00',true)",[id(10)]),/forbidden/);
  await login(1);
  await assert.rejects(query("select task_save_routine($1,null,$2,'Diária','',array[1]::smallint[],'18:00',true)",[id(10),id(91)]),/invalid_assignee/);
  await assert.rejects(query("select task_save_activity($1,null,$2,'Teste','task',0,false,'','',0,true)",[id(90),id(21)]),/access_denied/);
});
test('avançar com obrigatória exige motivo, consome uma vez e mantém a pendência',async()=>{
  await login(1);
  await query("select task_save_activity($1,null,$2,'Ligar','call',2,true,'Roteiro','Olá!',2,true)",[id(10),id(21)]);
  await createEntry(40,12); await login(2);
  assert.equal((await one('select task_pending_for_move($1) pending',[id(40)])).pending.length,1);
  await assert.rejects(query('update pipeline_entries set stage_id=$2,stage_key=$3 where id=$1',[id(40),id(22),'negociacao']),/task_reason_required/);
  await assert.rejects(query('select task_authorize_move($1,$2)',[id(40),' ']),/Informe o motivo/);
  await query('select task_authorize_move($1,$2)',[id(40),'Cliente pediu para avançar']);
  await query('update pipeline_entries set stage_id=$2,stage_key=$3 where id=$1',[id(40),id(22),'negociacao']);
  await db.exec('RESET ROLE');
  const event=await one('select * from task_stage_exceptions');
  assert.equal(event.reason,'Cliente pediu para avançar'); assert.equal(event.actor_id,id(2));
  assert.equal(event.pending_task_ids.length,1);
  assert.equal((await one("select count(*)::int n from task_work_items where required and status='pending'")).n,1);
  await query('update pipeline_entries set stage_id=$2,stage_key=$3 where id=$1',[id(40),id(21),'proposta']);
  await login(2);
  await assert.rejects(query('update pipeline_entries set stage_id=$2,stage_key=$3 where id=$1',[id(40),id(22),'negociacao']),/task_reason_required/);
});
test('motivo expirado não libera movimento; automação registra origem explícita',async()=>{
  await db.exec('RESET ROLE'); await query('update task_playbook_activities set required=true');
  await createEntry(40,12); await login(2);
  await query('select task_authorize_move($1,$2)',[id(40),'Razão antiga']);
  await db.exec("RESET ROLE; UPDATE private.task_move_authorizations SET expires_at=now()-interval '1 minute'");
  await login(2);
  await assert.rejects(query('update pipeline_entries set stage_id=$2 where id=$1',[id(40),id(22)]),/task_reason_required/);
  await login(0,'service_role');
  await query('update pipeline_entries set stage_id=$2 where id=$1',[id(40),id(22)]);
  await db.exec('RESET ROLE');
  assert.equal((await one('select reason from task_stage_exceptions')).reason,'Movimentação automática do sistema');
});
test('rotina gera uma ocorrência por dia/pessoa, encerra a anterior e respeita o fuso',async()=>{
  await login(1);
  const routine=(await one("select task_save_routine($1,null,$2,'Prospectar 15 empresas','Roteiro',array[1,2,3,4,5,6,7]::smallint[],'08:30',true) id",[id(10),id(12)])).id;
  await query('select task_sync_day($1)',[id(10)]); await query('select task_sync_day($1)',[id(10)]);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,1);
  await db.exec('RESET ROLE');
  await query("insert into task_work_items(organization_id,routine_id,assignee_id,title,kind,work_date,due_at) select organization_id,routine_id,assignee_id,title,kind,work_date-1,due_at-interval '1 day' from task_work_items where routine_id=$1",[routine]);
  await login(2); await query('select task_sync_day($1)',[id(10)]);
  assert.equal((await one("select count(*)::int n from task_work_items where status='missed'")).n,1);
  const history=await one('select task_queue($1,null,true) result',[id(10)]);
  assert.equal(history.result.items[0].status,'missed');
  const missed=history.result.items[0].id;
  await assert.rejects(query("select task_transition($1,'complete')",[missed]),/encerrada/);
  assert.equal((await one("select (due_at at time zone 'America/Sao_Paulo')::time::text as due_hour from task_work_items where status='pending'")).due_hour,'08:30:00');
});
test('fila sequencial permite só uma tarefa em execução e registra conclusão real',async()=>{
  await createEntry(40,12); await login(2);
  const tasks=(await query('select id from task_work_items order by position')).rows;
  await query("select task_transition($1,'start')",[tasks[0].id]);
  await assert.rejects(query("select task_transition($1,'start')",[tasks[1].id]),/em andamento/);
  await query("select task_transition($1,'complete','Proposta enviada')",[tasks[0].id]);
  const done=await one('select * from task_work_items where id=$1',[tasks[0].id]);
  assert.equal(done.completed_by,id(2)); assert.equal(done.result,'Proposta enviada'); assert.ok(done.completed_at);
  await query("select task_transition($1,'start')",[tasks[1].id]);
  await assert.rejects(query("select task_transition($1,null)",[tasks[1].id]),/encerrada/);
});
test('histórico de checklist é legível mas não pode ser alterado pelo cliente',async()=>{
  await login(2);
  const old=(await one('select id from checklists where pipeline_entry_id=$1',[id(39)])).id;
  assert.equal((await one('select count(*)::int n from checklist_items where checklist_id=$1',[old])).n,2);
  await assert.rejects(query('update checklist_items set is_completed=false where checklist_id=$1',[old]),/histórico/);
  await assert.rejects(query('delete from checklists where id=$1',[old]),/histórico/);
});
test('Classic continua usando o gatilho legado e não gera atividades',async()=>{
  await db.exec('RESET ROLE'); await query('update organizations set ui_v5_enabled=false where id=$1',[id(10)]);
  await createEntry(40,12);
  assert.equal((await one('select count(*)::int n from checklists where pipeline_entry_id=$1',[id(40)])).n,1);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,0);
});
test('histórico impede reparentear um item, mas não quebra exclusão autorizada de lead/negócio',async()=>{
  await db.exec(`INSERT INTO checklists(id,organization_id,lead_id,title) VALUES('${id(38)}','${id(10)}','${id(30)}','Novo checklist');`);
  await login(2);
  const historic=(await one('select id from checklists where pipeline_entry_id=$1',[id(39)])).id;
  await assert.rejects(query('update checklist_items set checklist_id=$2 where checklist_id=$1',[historic,id(38)]),/histórico/);
  await query('delete from deals where id=$1',[id(50)]);
  assert.equal((await one('select deal_id from checklists where id=$1',[historic])).deal_id,null);
  assert.equal((await one('select count(*)::int n from checklist_items where checklist_id=$1',[historic])).n,2);
  await query('delete from leads where id=$1',[id(30)]);
  assert.equal((await one('select count(*)::int n from checklists where id=$1',[historic])).n,0);
});
test('anon não tem acesso a dados nem aos RPCs',async()=>{
  await login(0,'anon');
  await assert.rejects(query('select * from task_work_items'),/permission denied/);
  await assert.rejects(query('select task_queue($1)',[id(10)]),/permission denied/);
  await assert.rejects(query('select task_authorize_move($1,$2)',[id(39),'Motivo']),/permission denied/);
});

test('movimento em lote registra um motivo para cada negócio e não aceita outro tenant',async()=>{
  await db.exec('RESET ROLE');await query('update task_playbook_activities set required=true');
  await createEntry(40,12);await createEntry(41,13);await login(1);
  const pending=(await one('select task_pending_for_moves($1::uuid[]) pending',[[id(40),id(41)]])).pending;
  assert.equal(pending.length,4);
  await query('select task_authorize_moves($1::uuid[],$2)',[[id(40),id(41)],'Cliente alinhou a próxima etapa']);
  assert.equal((await one('select task_pending_for_moves($1::uuid[]) pending',[[id(40),id(41)]])).pending.length,0);
  await query('update pipeline_entries set stage_id=$2 where id=any($1::uuid[])',[[id(40),id(41)],id(22)]);
  await db.exec('RESET ROLE');
  assert.equal((await one('select count(*)::int n from task_stage_exceptions')).n,2);
  await login(9);
  await assert.rejects(query('select task_authorize_moves($1::uuid[],$2)',[[id(40),id(41)],'Outra conta']),/access_denied/);
  await login(1);
  const refs=(await one('select task_open_entries_for_leads($1,$2::uuid[]) ids',[id(20),[id(30)]])).ids;
  assert.deepEqual(new Set(refs),new Set([id(39),id(40),id(41)]));
});
test('encerrar negócio sem mudar de etapa também registra a pendência',async()=>{
  await db.exec('RESET ROLE');await query('update task_playbook_activities set required=true');
  await createEntry(40,12);await login(2);
  await assert.rejects(query('update pipeline_entries set closed_at=now() where id=$1',[id(40)]),/task_reason_required/);
  await query('select task_authorize_move($1,$2)',[id(40),'Cliente fechou durante a ligação']);
  await query('update pipeline_entries set closed_at=now() where id=$1',[id(40)]);
  const events=(await one('select task_entry_history($1) events',[id(40)])).events;
  assert.equal(events.length,1);assert.equal(events[0].reason,'Cliente fechou durante a ligação');
});
test('tarefa futura fica nas próximas e a pessoal é sempre do chamador',async()=>{
  await login(1);await query("select task_save_activity($1,null,$2,'Contato futuro','call',5,false,'','',2,true)",[id(10),id(21)]);
  await createEntry(40,12);await login(2);
  assert.equal((await one('select task_queue($1) result',[id(10)])).result.total,2);
  assert.equal((await one('select task_queue($1,null,false,0,null,true) result',[id(10)])).result.total,1);
  const own=(await one("select task_create_manual($1,'Preparar proposta',current_date+2,'Revisar valores') id",[id(10)])).id;
  assert.equal((await one('select assignee_id from task_work_items where id=$1',[own])).assignee_id,id(12));
  assert.equal((await one('select origin from task_work_items where id=$1',[own])).origin,'member');
  const queue=(await one('select task_queue($1,null,false,0,null,true) result',[id(10)])).result;
  assert.deepEqual(new Set(queue.items.map(t=>t.origin)),new Set(['admin','member']));
  await assert.rejects(query("select task_create_manual($1,'Invasão',current_date,'')",[id(90)]),/access_denied/);
  await login(1);
  const adminOwn=(await one("select task_create_manual($1,'Revisar operação',current_date,'') id",[id(10)])).id;
  assert.equal((await one('select origin from task_work_items where id=$1',[adminOwn])).origin,'member');
});
test('revogar a permissão ou o vínculo impede leitura e execução',async()=>{
  await createEntry(40,12);await login(2);
  const own=(await one('select id from task_work_items limit 1')).id;
  await query("select set_config('test.followups','false',false)");
  assert.equal((await one('select count(*)::int n from task_work_items')).n,0);
  await assert.rejects(query("select task_transition($1,'complete')",[own]),/forbidden/);
  await db.exec("RESET ROLE; SELECT set_config('test.followups','true',false)");
  await query('update team_members set is_active=false where id=$1',[id(12)]);await login(2);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,0);
  await assert.rejects(query('select task_queue($1)',[id(10)]),/access_denied/);
});
test('paginação mantém contagem global e o resumo usa conclusões reais do dia',async()=>{
  await createEntry(40,12);
  await db.exec(`INSERT INTO task_work_items(organization_id,assignee_id,title,kind,work_date,due_at)
    SELECT '${id(10)}','${id(12)}','Rotina manual '||n,'task',current_date,now() FROM generate_series(1,105) n;`);
  await login(2);
  const page=(await one('select task_queue($1) result',[id(10)])).result;
  assert.equal(page.total,107);assert.equal(page.items.length,100);
  assert.equal((await one('select task_queue($1,null,false,100) result',[id(10)])).result.items.length,7);
  await query("select task_transition($1,'complete')",[page.items[0].id]);
  const after=(await one('select task_queue($1) result',[id(10)])).result;
  assert.equal(after.total,106);assert.equal(after.overview[0].completed_today,1);
});

test('atribuição a membros específicos é isolada por org, priorizada e concluída por pessoa',async()=>{
  await login(1);
  const group=(await one("select task_assign($1,'Revisar proposta',current_date,'members',$2::uuid[],'high','Confira os valores') id",[id(10),[id(12),id(13)]])).id;
  await query("select task_assign($1,'Organizar notas',current_date,'members',$2::uuid[],'low','')",[id(10),[id(12)]]);
  assert.equal((await one('select task_queue($1) result',[id(10)])).result.total,0,'admin Comando is personal');
  assert.equal((await one('select task_queue($1,null,false,0,null,false,true) result',[id(10)])).result.total,3,'admin management is explicit');
  await login(2);
  const own=(await one('select task_queue($1) result',[id(10)])).result;
  assert.deepEqual(own.items.map(t=>t.priority),['high','low']);
  assert.ok(own.items.every(t=>t.assignee_id===id(12) && t.origin==='admin'));
  await assert.rejects(query('select task_queue($1,null,false,0,null,false,true)',[id(10)]),/forbidden/);
  await query("select task_transition($1,'complete','Feito')",[own.items[0].id]);
  await login(3);
  const other=(await one('select task_queue($1) result',[id(10)])).result;
  assert.equal(other.total,1);assert.equal(other.items[0].status,'pending');assert.equal(other.items[0].assignment_id,group);
  await assert.rejects(query("select task_transition($1,'complete')",[own.items[1].id]),/Somente o responsável/);
});
test('admin só atribui na própria org e não aceita destinatários vazios, repetidos ou estrangeiros',async()=>{
  await login(1);
  for(const recipients of [[],[id(91)],[id(12),id(91)],[id(12),id(12)],[null]]) {
    await assert.rejects(query("select task_assign($1,'Não gravar',current_date,'members',$2::uuid[],'high','')",[id(10),recipients]),/invalid_assignee/);
  }
  await assert.rejects(query("select task_assign($1,'Sem seleção',current_date,null,'{}','medium','')",[id(10)]),/Selecione os destinatários/);
  await assert.rejects(query("select task_assign($1,'Outra org',current_date,'team','{}','medium','')",[id(90)]),/access_denied/);
  await assert.rejects(query("select task_assign($1,'Prioridade inválida',current_date,'team','{}','urgent','')",[id(10)]),/check constraint/);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,0);
  await login(2);await assert.rejects(query("select task_assign($1,'Membro não configura',current_date,'team','{}','medium','')",[id(10)]),/forbidden/);
  await login(9);await assert.rejects(query("select task_assign($1,'Ataque',current_date,'team','{}','medium','')",[id(10)]),/access_denied/);
});
test('equipe inteira inclui somente pessoas ativas da org; rotina aceita vários membros',async()=>{
  await db.exec(`UPDATE team_members SET is_active=false WHERE id='${id(13)}'`);
  await login(1);
  await query("select task_assign($1,'Equipe',current_date,'team','{}','low','')",[id(10)]);
  assert.deepEqual((await query('select distinct assignee_id from task_work_items order by assignee_id')).rows.map(t=>t.assignee_id),[id(11),id(12)]);
  await db.exec(`RESET ROLE; UPDATE team_members SET is_active=true WHERE id='${id(13)}'`);await login(1);
  const routine=(await one("select task_save_routine($1,null,null,'Rotina seletiva','',array[extract(isodow from now() at time zone 'America/Sao_Paulo')::smallint],'18:00',true,'high','members',$2::uuid[]) id",[id(10),[id(12),id(13)]])).id;
  const rows=(await query('select assignee_id,priority from task_work_items where routine_id=$1 order by assignee_id',[routine])).rows;
  assert.deepEqual(rows,[{assignee_id:id(12),priority:'high'},{assignee_id:id(13),priority:'high'}]);
  await assert.rejects(query("select task_save_routine($1,$2,null,'Inválida','',array[1]::smallint[],'18:00',true,'high','members',$3::uuid[])",[id(10),routine,[id(91)]]),/invalid_assignee/);
});
test('playbook direcionado cria uma execução por destinatário e preserva atribuições fixas',async()=>{
  await login(1);
  const activity=(await one("select task_save_activity($1,null,$2,'Revisão conjunta','task',0,false,'','',0,true,'high','members',$3::uuid[]) id",[id(10),id(22),[id(12),id(13)]])).id;
  await createEntry(40,11);
  await query("update pipeline_entries set stage_id=$2,stage_key='negociacao' where id=$1",[id(40),id(22)]);
  await query('update pipeline_entries set assigned_to=$2 where id=$1',[id(40),id(13)]);
  const rows=(await query('select assignee_id,priority,follows_deal_owner from task_work_items where activity_id=$1 order by assignee_id',[activity])).rows;
  assert.deepEqual(rows,[{assignee_id:id(12),priority:'high',follows_deal_owner:false},{assignee_id:id(13),priority:'high',follows_deal_owner:false}]);
  await query("update pipeline_entries set stage_id=$2,stage_key='proposta' where id=$1",[id(40),id(21)]);
  await query("update pipeline_entries set stage_id=$2,stage_key='negociacao' where id=$1",[id(40),id(22)]);
  assert.equal((await one('select count(*)::int n from task_work_items where activity_id=$1',[activity])).n,2);
  await login(1);await assert.rejects(query("select task_save_activity($1,$2,$3,'Inválida','task',0,false,'','',0,true,'high','members',$4::uuid[])",[id(10),activity,id(22),[id(91)]]),/invalid_assignee/);
});

test('tarefas pessoais existentes validam organização e autor no servidor',async()=>{
  await login(2);
  await query("insert into acoes_do_dia(user_id,organization_id,title) values($1,$2,'Minha tarefa')",[id(2),id(10)]);
  await assert.rejects(query("insert into acoes_do_dia(user_id,organization_id,title) values($1,$2,'Outra org')",[id(2),id(90)]),/access_denied/);
  await assert.rejects(query("insert into acoes_do_dia(user_id,organization_id,title) values($1,$2,'Outro autor')",[id(3),id(10)]),/forbidden/);
  await login(1);await assert.rejects(query('update acoes_do_dia set organization_id=$1',[id(90)]),/access_denied/);
  await login(9);await assert.rejects(query("insert into acoes_do_dia(user_id,organization_id,lead_id,title) values($1,$2,$3,'Lead de outra org')",[id(9),id(90),id(30)]),/invalid_lead_organization/);
});

test('pausa por organização preserva tarefas e histórico sem reativar ao sincronizar',async()=>{
  await createEntry(40,12);
  await query("select set_config('torque.task_pause_org',$1,false)",[id(10)]);
  await db.exec(sql('scripts/pause-task-playbooks.sql'));
  await createEntry(41,13);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,2);
  assert.equal((await one('select count(*)::int n from checklists where pipeline_entry_id=$1',[id(41)])).n,1,'legacy trigger resumes');
  await login(2);await query('select task_sync_day($1)',[id(10)]);
  assert.equal((await one('select enabled from task_workspaces where organization_id=$1',[id(10)])).enabled,false);
  await assert.rejects(query('select task_activate($1)',[id(10)]),/forbidden/);
  await login(1);await query('select task_activate($1)',[id(10)]);
  await createEntry(42,13);
  assert.equal((await one('select count(*)::int n from task_work_items')).n,4);
});

test('master administra uma organização sem assento nela e mantém o escopo explícito',async()=>{
  await login(8);await query("select set_config('test.master','true',false)");
  const config=(await one('select task_configuration($1) data',[id(10)])).data;
  assert.deepEqual(new Set(config.members.map(m=>m.id)),new Set([id(11),id(12),id(13)]));
  await query("select task_assign($1,'Tarefa pelo master',current_date,'members',$2::uuid[],'high','')",[id(10),[id(12)]]);
  await assert.rejects(query("select task_assign($1,'Não misturar orgs',current_date,'members',$2::uuid[],'high','')",[id(10),[id(91)]]),/invalid_assignee/);
  const queue=(await one('select task_queue($1,null,false,0,null,false,true) data',[id(10)])).data;
  assert.equal(queue.total,1);assert.equal(queue.items[0].assignee_id,id(12));
});
