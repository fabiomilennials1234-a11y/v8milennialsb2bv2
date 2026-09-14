CREATE TABLE organizations(id uuid PRIMARY KEY);
CREATE TABLE leads(id uuid PRIMARY KEY,organization_id uuid,name text,company text,pre_sale_responsible_id uuid);
CREATE TABLE team_members(id uuid PRIMARY KEY,user_id uuid,organization_id uuid,name text);
CREATE TABLE pipelines(id uuid PRIMARY KEY,organization_id uuid);
CREATE TABLE deals(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid);
CREATE TABLE pipeline_entries(id uuid PRIMARY KEY,organization_id uuid,pipeline_id uuid,lead_id uuid,deal_id uuid,assigned_to uuid,closed_at timestamptz,metadata jsonb DEFAULT '{}',stage_key text);
CREATE TABLE meeting_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,event_type text,booked_event_id uuid REFERENCES meeting_events(id),pre_sale_responsible_id uuid,meeting_date timestamptz,occurred_at timestamptz DEFAULT now(),source text,source_entry_id uuid,metadata jsonb DEFAULT '{}');
CREATE UNIQUE INDEX outcome_unique ON meeting_events(booked_event_id) WHERE event_type IN ('meeting_held','meeting_no_show');
CREATE TABLE meetings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,title text,start_at timestamptz,end_at timestamptz,all_day boolean DEFAULT false,event_type text DEFAULT 'meeting',status text DEFAULT 'scheduled',lead_id uuid,pipeline_id uuid,deal_id uuid,created_by uuid,external_ref text,created_at timestamptz DEFAULT now(),meet_link text,description text,location text,color text,google_event_id text);
CREATE TABLE follow_ups(id uuid,organization_id uuid,lead_id uuid,title text,description text,due_date timestamptz,completed_at timestamptz,assigned_to uuid,archived_at timestamptz,source_pipe text,pipeline_entry_id uuid,deal_id uuid,created_at timestamptz DEFAULT now());
CREATE TABLE scheduled_user_messages(id uuid,organization_id uuid,lead_id uuid,message_content text,scheduled_at timestamptz,status text,created_by uuid);
INSERT INTO organizations VALUES ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
INSERT INTO leads VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Lead',NULL,NULL),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Foreign',NULL,NULL);
INSERT INTO pipelines VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO pipeline_entries (id,organization_id,pipeline_id,lead_id,metadata,stage_key) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"meeting_date":"2026-09-02T18:00:00Z"}','agendado');
INSERT INTO meeting_events(id,organization_id,lead_id,event_type,meeting_date,source,source_entry_id) VALUES
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','meeting_booked','2026-09-02T18:00:00Z','pipeline:whatsapp','40000000-0000-0000-0000-000000000001');
INSERT INTO meeting_events(id,organization_id,lead_id,event_type,meeting_date,source) VALUES
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','meeting_booked','2026-09-08T16:00:00Z','pipeline:confirmacao'),
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','meeting_booked','2026-09-09T16:00:00Z','pipeline:confirmacao');
INSERT INTO meeting_events(organization_id,lead_id,event_type,meeting_date,source,booked_event_id) VALUES
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','meeting_held','2026-09-08T16:00:00Z','pipeline:confirmacao','50000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','meeting_no_show','2026-09-09T16:00:00Z','pipeline:confirmacao','50000000-0000-0000-0000-000000000003');
