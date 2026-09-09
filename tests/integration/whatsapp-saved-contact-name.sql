BEGIN;
INSERT INTO whatsapp_conversation_summary VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','5511','5511',NULL),('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','5511','5511',NULL);
INSERT INTO whatsapp_messages VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','5511','{"wa_contactName":"Cliente agenda"}');
INSERT INTO whatsapp_messages VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','5511','{"pushName":"Perfil novo"}');
DO $$ BEGIN
 IF (SELECT saved_contact_name FROM whatsapp_conversation_summary WHERE organization_id='00000000-0000-0000-0000-000000000001') IS DISTINCT FROM 'Cliente agenda' THEN RAISE EXCEPTION 'Nome perdido'; END IF;
 IF EXISTS(SELECT 1 FROM whatsapp_conversation_summary WHERE organization_id='00000000-0000-0000-0000-000000000002' AND saved_contact_name IS NOT NULL) THEN RAISE EXCEPTION 'Cross-org'; END IF;
 IF has_function_privilege('authenticated','capture_whatsapp_saved_contact_name()','execute') OR has_function_privilege('anon','capture_whatsapp_saved_contact_name()','execute') THEN RAISE EXCEPTION 'ACL'; END IF;
END $$;
ROLLBACK;
