BEGIN;
INSERT INTO organizations(id) VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO team_members VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001',true);
INSERT INTO whatsapp_instances VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000002');
INSERT INTO whatsapp_conversation_summary(organization_id,instance_id,normalized_phone,phone_number,last_message,last_message_time,last_message_direction)
SELECT organization_id,id,'51999999999','5551999999999','old outgoing',now()-interval '90 days','outgoing' FROM whatsapp_instances;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
DO $$ DECLARE org uuid := '00000000-0000-0000-0000-000000000001'; box uuid := '00000000-0000-0000-0000-000000000101'; otherbox uuid := '00000000-0000-0000-0000-000000000102'; n int;
BEGIN
 IF has_function_privilege('anon','public.mark_conversation_unread(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'anon grant'; END IF;
 IF has_function_privilege('anon','public.is_conversation_marked_unread(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'anon helper grant'; END IF;
 PERFORM mark_conversation_unread(box,'51999999999');
 PERFORM mark_conversation_unread(box,'51999999999');
 IF NOT is_conversation_marked_unread(org,box,'51999999999') THEN RAISE EXCEPTION 'unread not persisted'; END IF;
 IF is_conversation_marked_unread(org,otherbox,'51999999999') THEN RAISE EXCEPTION 'other box affected'; END IF;
 IF get_unread_total(ARRAY[box,otherbox]) <> 1 THEN RAISE EXCEPTION 'unread count/idempotency'; END IF;
 SELECT count(*) INTO n FROM get_whatsapp_conversation_list(org,box,p_unread=>true) WHERE unread_count=1;
 IF n<>1 THEN RAISE EXCEPTION 'single list old outgoing unread filter'; END IF;
 SELECT count(*) INTO n FROM get_whatsapp_conversation_list_multi(org,ARRAY[box,otherbox],p_unread=>true) WHERE unread_count=1 AND instance_id=box;
 IF n<>1 THEN RAISE EXCEPTION 'multi list old outgoing unread filter'; END IF;
 BEGIN PERFORM mark_conversation_unread('00000000-0000-0000-0000-000000000103','51999999999'); RAISE EXCEPTION 'cross org accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM mark_conversation_unread(box,'bad:phone'); RAISE EXCEPTION 'bad phone accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
 IF is_conversation_marked_unread(org,box,'51999999999') OR get_unread_total(ARRAY[box])<>0 THEN RAISE EXCEPTION 'other user affected'; END IF;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
 PERFORM mark_conversation_read(box,'51999999999');
 IF is_conversation_marked_unread(org,box,'51999999999') OR get_unread_total(ARRAY[box])<>0 THEN RAISE EXCEPTION 'opening must clear manual unread'; END IF;
 SELECT count(*) INTO n FROM get_whatsapp_conversation_list_multi(org,ARRAY[box],p_unread=>true);
 IF n<>0 THEN RAISE EXCEPTION 'read conversation remains in unread filter'; END IF;
END $$;
RESET ROLE;
INSERT INTO whatsapp_messages(organization_id,instance_id,normalized_phone,direction,timestamp)
SELECT '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102','51999999999','incoming',now() FROM generate_series(1,3);
SET LOCAL ROLE authenticated;
DO $$ DECLARE box uuid := '00000000-0000-0000-0000-000000000102'; BEGIN
 IF get_unread_total(ARRAY[box]) <> 3 THEN RAISE EXCEPTION 'natural count changed'; END IF;
 PERFORM mark_conversation_unread(box,'51999999999');
 IF get_unread_total(ARRAY[box]) <> 3 THEN RAISE EXCEPTION 'manual unread inflated natural count'; END IF;
 PERFORM mark_conversation_read(box,'51999999999');
 IF get_unread_total(ARRAY[box]) <> 0 THEN RAISE EXCEPTION 'read must clear natural and manual'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'chat unread assertions passed' AS result;
