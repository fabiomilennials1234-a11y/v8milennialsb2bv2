-- Contract for public.apply_external_conversation_read (Chamado 6ebb4b73).
-- Runs only in a disposable Postgres via tests/integration/run-sql-contract.sh,
-- after tests/fixtures/chat-unread-schema.sql and the migration. Never production.
\set ON_ERROR_STOP 1

-- Org A (a…a): instance IA (1a…1) and IA2 (1a…2); members u1 (two rows), u2 (manually
-- marked unread), u3 inactive, one active row without user. Org B (b…b): instance IB, member u4.
INSERT INTO public.organizations(id) VALUES
  ('a0000000-0000-0000-0000-00000000000a'), ('b0000000-0000-0000-0000-00000000000b');
INSERT INTO public.whatsapp_instances(id, organization_id) VALUES
  ('1a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'),
  ('1a000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a'),
  ('1b000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b');
INSERT INTO public.team_members(id, user_id, organization_id, is_active) VALUES
  (gen_random_uuid(), 'c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', true),
  (gen_random_uuid(), 'c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', true),
  (gen_random_uuid(), 'c2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', true),
  (gen_random_uuid(), 'c3000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', false),
  (gen_random_uuid(), NULL,                                   'a0000000-0000-0000-0000-00000000000a', true),
  (gen_random_uuid(), 'c4000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', true);

INSERT INTO public.whatsapp_messages(organization_id, instance_id, message_id, normalized_phone, direction, is_group, deleted_at, "timestamp") VALUES
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', 'm1',  '5548999990001', 'incoming', false, NULL, '2026-10-05 10:00:00+00'),
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', 'm2',  '5548999990001', 'incoming', false, NULL, '2026-10-05 10:05:00+00'),
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', 'm3',  '5548999990001', 'incoming', false, NULL, '2026-10-05 10:10:00+00'),
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', 'o1',  '5548999990001', 'outgoing', false, NULL, '2026-10-05 10:20:00+00'),
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', 'g1',  '120363000000',  'incoming', true,  NULL, '2026-10-05 10:20:00+00'),
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', 'd1',  '5548999990001', 'incoming', false, '2026-10-05 10:30:00+00', '2026-10-05 10:20:00+00'),
  ('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000002', 'x1',  '5548999990001', 'incoming', false, NULL, '2026-10-05 10:20:00+00'),
  ('b0000000-0000-0000-0000-00000000000b', '1b000000-0000-0000-0000-000000000001', 'b1',  '5548999990001', 'incoming', false, NULL, '2026-10-05 10:20:00+00'),
  ('b0000000-0000-0000-0000-00000000000b', '1b000000-0000-0000-0000-000000000001', 'm2',  '5548999990001', 'incoming', false, NULL, '2026-10-05 10:25:00+00');

-- u2 had manually marked the conversation unread, with an older read mark.
INSERT INTO public.conversation_read_state(organization_id, user_id, conversation_key, last_read_at, updated_at, marked_unread) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-000000000002',
   'whatsapp:1a000000-0000-0000-0000-000000000001:5548999990001', '2026-10-05 09:00:00+00', '2026-10-05 09:00:00+00', true);

CREATE TEMP TABLE results(step text PRIMARY KEY, n integer);
GRANT ALL ON results TO service_role;

-- Every call below runs as the webhook does: service_role.
SET ROLE service_role;
INSERT INTO results VALUES ('read_m2',      public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['m2', 'owner:m2']));
INSERT INTO results VALUES ('replay_old',   public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['m1']));
INSERT INTO results VALUES ('replay_same',  public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['m2']));
INSERT INTO results VALUES ('non_targets',  public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['o1', 'g1', 'd1', 'unknown']));
INSERT INTO results VALUES ('other_inst',   public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['x1']));
INSERT INTO results VALUES ('other_org_id', public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['b1']));
INSERT INTO results VALUES ('org_b_inst_a', public.apply_external_conversation_read('b0000000-0000-0000-0000-00000000000b', '1a000000-0000-0000-0000-000000000001', ARRAY['m2', 'm3']));
INSERT INTO results VALUES ('org_a_inst_b', public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1b000000-0000-0000-0000-000000000001', ARRAY['b1', 'm2']));
INSERT INTO results VALUES ('empty',        public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY[]::text[]));
INSERT INTO results VALUES ('null_ids',     public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', NULL));
RESET ROLE;

DO $$
DECLARE
  k_a constant text := 'whatsapp:1a000000-0000-0000-0000-000000000001:5548999990001';
  mark constant timestamptz := '2026-10-05 10:05:00+00';
  r record;
BEGIN
  -- 1. read mark = timestamp of the message read, for every active member (u1 once, u2), nobody else.
  ASSERT (SELECT n FROM results WHERE step = 'read_m2') = 2, 'read_m2 must write exactly u1 and u2';
  ASSERT (SELECT count(*) FROM public.conversation_read_state
          WHERE organization_id = 'a0000000-0000-0000-0000-00000000000a' AND conversation_key = k_a AND last_read_at = mark) = 2,
         'u1 and u2 must have last_read_at = message timestamp';
  ASSERT NOT EXISTS (SELECT 1 FROM public.conversation_read_state WHERE user_id = 'c3000000-0000-0000-0000-000000000003'),
         'inactive member must not be written';

  -- 2. incoming that arrived after the read stays unread (timestamp > last_read_at).
  ASSERT (SELECT "timestamp" FROM public.whatsapp_messages WHERE message_id = 'm3')
       > (SELECT last_read_at FROM public.conversation_read_state WHERE user_id = 'c1000000-0000-0000-0000-000000000001'),
         'later incoming must remain unread';

  -- 3. manual "mark unread" is untouched.
  ASSERT (SELECT marked_unread FROM public.conversation_read_state WHERE user_id = 'c2000000-0000-0000-0000-000000000002' AND conversation_key = k_a),
         'marked_unread must stay true';

  -- 4. the mark never moves back; replays are no-ops.
  ASSERT (SELECT n FROM results WHERE step = 'replay_old') = 0, 'older id must write 0 rows';
  ASSERT (SELECT n FROM results WHERE step = 'replay_same') = 0, 'replay must write 0 rows';
  ASSERT (SELECT bool_and(last_read_at = mark) FROM public.conversation_read_state WHERE conversation_key = k_a),
         'last_read_at must never regress';

  -- 5. outgoing, group, deleted, unknown, other instance, other org: zero rows.
  FOR r IN SELECT step, n FROM results WHERE step IN ('non_targets', 'other_inst', 'other_org_id', 'org_b_inst_a', 'org_a_inst_b', 'empty', 'null_ids') LOOP
    ASSERT r.n = 0, format('%s must write 0 rows, wrote %s', r.step, r.n);
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM public.conversation_read_state WHERE organization_id = 'b0000000-0000-0000-0000-00000000000b'),
         'cross-tenant call must not write in org B';
  ASSERT NOT EXISTS (SELECT 1 FROM public.conversation_read_state WHERE conversation_key LIKE '%1b000000-0000-0000-0000-000000000001%'
                     OR conversation_key LIKE '%1a000000-0000-0000-0000-000000000002%' OR conversation_key LIKE '%120363000000%'),
         'no key for another instance or a group';
  ASSERT (SELECT count(*) FROM public.conversation_read_state) = 2, 'exactly two read-state rows overall';

  -- 6. ACL: only service_role may execute.
  ASSERT NOT has_function_privilege('anon', 'public.apply_external_conversation_read(uuid,uuid,text[])', 'EXECUTE'), 'anon must not execute';
  ASSERT NOT has_function_privilege('authenticated', 'public.apply_external_conversation_read(uuid,uuid,text[])', 'EXECUTE'), 'authenticated must not execute';
  ASSERT has_function_privilege('service_role', 'public.apply_external_conversation_read(uuid,uuid,text[])', 'EXECUTE'), 'service_role must execute';
  ASSERT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc
          WHERE oid = 'public.apply_external_conversation_read(uuid,uuid,text[])'::regprocedure),
         'must be SECURITY DEFINER with empty search_path';
END $$;

-- 7. A real call as authenticated is refused (not just reported by has_function_privilege).
SET ROLE authenticated;
DO $$
BEGIN
  PERFORM public.apply_external_conversation_read('a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-000000000001', ARRAY['m3']);
  RAISE EXCEPTION 'authenticated executed the RPC';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

SELECT 'CONTRACT_OK' AS result;
