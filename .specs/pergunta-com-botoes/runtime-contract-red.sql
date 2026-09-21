-- Read-only RED probe; no data, schema or production messages changed.
DO $$ BEGIN
  IF to_regprocedure('public.prepare_workflow_button_question(uuid,uuid,text,integer,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'RED: durable question reservation RPC does not exist';
  END IF;
END $$;
