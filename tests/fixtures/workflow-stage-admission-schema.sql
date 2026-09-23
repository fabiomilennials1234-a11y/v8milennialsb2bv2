CREATE FUNCTION workflow_admission_test.uid() RETURNS uuid LANGUAGE sql AS $$
 SELECT '00000000-0000-0000-0000-000000000005'::uuid $$;
CREATE TABLE workflow_admission_test.pipelines(id uuid PRIMARY KEY,slug text,type text);
CREATE TABLE workflow_admission_test.team_members(id uuid,user_id uuid,organization_id uuid,is_active boolean);
CREATE TABLE workflow_admission_test.workflows(organization_id uuid,trigger_type text,is_active boolean);
CREATE TABLE workflow_admission_test.cron_config(key text,value text);
CREATE TABLE workflow_admission_test.pipeline_entries(id uuid PRIMARY KEY,organization_id uuid,pipeline_id uuid,lead_id uuid,deal_id uuid,stage_id uuid,stage_key text);
CREATE TABLE workflow_admission_test.http_calls(url text,headers jsonb,body jsonb);
CREATE FUNCTION workflow_admission_test.http_post(url text,headers jsonb,body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
 BEGIN INSERT INTO workflow_admission_test.http_calls VALUES(url,headers,body); RETURN 1; END $$;
INSERT INTO workflow_admission_test.pipelines VALUES('00000000-0000-0000-0000-000000000003','whatsapp','system');
INSERT INTO workflow_admission_test.team_members VALUES('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',true);
INSERT INTO workflow_admission_test.cron_config VALUES('campaign_rule_dispatch_url','https://fixture.example/functions/v1/campaign-rule-dispatch'),('cron_secret','test-secret');
INSERT INTO workflow_admission_test.pipeline_entries VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','before');
CREATE FUNCTION workflow_admission_test.assert_move(expected integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual integer;
BEGIN
 TRUNCATE workflow_admission_test.http_calls;
 UPDATE workflow_admission_test.pipeline_entries SET stage_key=stage_key||'_next';
 SELECT count(*) INTO actual FROM workflow_admission_test.http_calls;
 IF actual<>expected THEN RAISE EXCEPTION 'Expected % HTTP, got %',expected,actual; END IF;
END $$;
