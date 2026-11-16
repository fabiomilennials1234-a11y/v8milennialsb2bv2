// Prepare reviewable SQL from the backed-up live workflow and the official IBGE
// municipality response reduced to [{ id, name, uf }]. This script sends nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { regionalWorkflow } from './lib/jrtex-regional-workflow.mjs';
const [snapshotDir] = process.argv.slice(2);
if (!snapshotDir) throw new Error('Usage: node scripts/prepare-jrtex-rollout.mjs <snapshot-directory>');
const read = name => JSON.parse(readFileSync(join(snapshotDir,name),'utf8').replace(/^\uFEFF/,''));
const snapshot=read('before.json'), drafts=read('drafts-before.json').drafts;
const old=snapshot.versions.toSorted((a,b)=>b.version_number-a.version_number)[0];
const draft=drafts.find(d=>d.workflow_id===old.workflow_id);
const owner=snapshot.people.find(p=>p.name==='Karine Chaves'&&p.active);
if(!old||!draft||!owner)throw new Error('Incomplete snapshot');
const nodes=old.definition.nodes;
const routes={};
for(const n of nodes.filter(n=>n.type==='assign_responsible'&&/^REP_[A-Z]{2}$/.test(n.data.routeCode))){
 const uf=n.data.routeCode.slice(4);routes[uf]??={uf,member_ids:[],remote_cities:[]};
 if(snapshot.people.some(p=>p.id===n.data.assigneeId&&p.active)) routes[uf].member_ids.push(n.data.assigneeId);
}
for(const n of nodes.filter(n=>/^jr_stored_remote_[a-z]{2}_/.test(n.id))){
 const uf=n.id.split('_')[3].toUpperCase();
 if(routes[uf])routes[uf].remote_cities.push(...n.data.guidedCondition.children.map(c=>c.value));
}
const quote=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const cities=read('ibge-cities.json');
if(cities.length<5500||new Set(cities.map(c=>c.uf)).size!==27)throw new Error('Incomplete IBGE dictionary');
writeFileSync(join(snapshotDir,'seed-cities.sql'),`INSERT INTO private.regional_sales_cities(uf,city_key,name,ibge_id)
SELECT x.uf,private.regional_normalize(x.name),x.name,x.id FROM jsonb_to_recordset(${quote(cities)}) x(id integer,name text,uf text)
ON CONFLICT(uf,city_key) DO UPDATE SET name=EXCLUDED.name,ibge_id=EXCLUDED.ibge_id;`);
writeFileSync(join(snapshotDir,'seed-routes.sql'),`INSERT INTO private.regional_sales_routes(organization_id,uf,member_ids,remote_cities)
SELECT o.id,x.uf,x.member_ids,ARRAY(SELECT DISTINCT private.regional_normalize(c) FROM unnest(x.remote_cities) c)
FROM organizations o CROSS JOIN jsonb_to_recordset(${quote(Object.values(routes))}) x(uf text,member_ids uuid[],remote_cities text[])
WHERE o.slug='jrtex'
ON CONFLICT(organization_id,uf) DO UPDATE SET member_ids=EXCLUDED.member_ids,remote_cities=EXCLUDED.remote_cities;`);

// IDs below are pre-existing references verified during the audit, never new IDs.
const workflow=regionalWorkflow({instanceId:'859ee852-2102-4a5d-b249-98a6fe0b601c',pipelineId:'29a9ade8-0273-4893-8ef4-5d290e98f419',triageMemberId:owner.id,statusFieldId:'7e1f7cad-af35-4d40-a5ed-c85ccf58e644'});
writeFileSync(join(snapshotDir,'workflow-after.json'),JSON.stringify(workflow,null,2));
writeFileSync(join(snapshotDir,'activate.sql'),`BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollout$
DECLARE w public.workflows%ROWTYPE; v uuid; data jsonb:=${quote(workflow)}; required text[];
BEGIN
 SELECT * INTO STRICT w FROM public.workflows WHERE id='${old.workflow_id}' AND organization_id='${old.organization_id}' FOR UPDATE;
 IF NOT w.is_active THEN RAISE EXCEPTION 'Expected already-active workflow; activation requires the application administrator'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workflow_guided_publications WHERE workflow_id=w.id AND version_id='${old.id}')
 OR NOT EXISTS(SELECT 1 FROM public.workflow_guided_drafts WHERE workflow_id=w.id AND revision=${draft.revision}) THEN RAISE EXCEPTION 'Workflow changed since backup'; END IF;
 IF EXISTS(SELECT 1 FROM public.workflow_executions WHERE workflow_id=w.id AND status IN('running','waiting','pending')) THEN RAISE EXCEPTION 'Workflow has active executions'; END IF;
 IF (SELECT count(*) FROM private.regional_sales_cities)<5500 OR (SELECT count(*) FROM private.regional_sales_routes WHERE organization_id=w.organization_id)<>8 THEN RAISE EXCEPTION 'Routing seed incomplete'; END IF;
 SELECT array_agg(x) INTO required FROM jsonb_array_elements_text(data->'required_fields') x;
 -- Operational publication under the authorized database session. NULL actor
 -- explicitly records that no application user's identity was impersonated.
 UPDATE public.workflow_data_grants SET fields=ARRAY(SELECT DISTINCT x FROM unnest(fields||required) x),revision=revision+1,updated_at=now(),approved_by=NULL WHERE workflow_id=w.id AND organization_id=w.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expected existing workflow data grant'; END IF;
 UPDATE public.workflow_guided_drafts SET definition=data->'definition',settings=data->'settings',revision=revision+1,updated_at=now(),updated_by=NULL WHERE workflow_id=w.id;
 INSERT INTO public.workflow_guided_versions(workflow_id,organization_id,version_number,source_revision,definition,settings,required_fields,published_by)
 VALUES(w.id,w.organization_id,${old.version_number+1},${draft.revision+1},data->'definition',data->'settings',required,NULL) RETURNING id INTO v;
 UPDATE public.workflow_guided_publications SET version_id=v WHERE workflow_id=w.id;
 UPDATE public.workflows SET definition=data->'definition',updated_at=now() WHERE id=w.id;
 UPDATE private.regional_sales_config SET routing_enabled=true,enabled_at=now() WHERE organization_id=w.organization_id;
END $rollout$;
SELECT cron.schedule('regional-sales-distribution','*/5 * * * *','SELECT private.process_regional_sales();');
COMMIT;`);
writeFileSync(join(snapshotDir,'pause.sql'),`BEGIN;
UPDATE private.regional_sales_config SET routing_enabled=false WHERE organization_id='${old.organization_id}';
UPDATE public.workflows SET is_active=false WHERE id='${old.workflow_id}';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='regional-sales-distribution';
COMMIT;
-- Reports and restrictive lead/chat RLS remain enabled. Already-completed
-- ownership changes are intentionally not undone without reviewing the log.
`);
console.log(JSON.stringify({routes:Object.values(routes).map(r=>({uf:r.uf,members:r.member_ids.length,remoteCities:r.remote_cities.length})),cities:cities.length,version:old.version_number+1,revision:draft.revision+1}));
