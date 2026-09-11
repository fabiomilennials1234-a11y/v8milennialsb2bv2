-- Exclusivamente em preview recém-criada; o runner recusa prod/dev aposentado.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public') THEN
    RAISE EXCEPTION 'A branch não está vazia; não limpar seu ledger';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) > 3 THEN
    RAISE EXCEPTION 'Ledger diferente das três linhas fantasma conhecidas';
  END IF;
END $$;
DELETE FROM supabase_migrations.schema_migrations;
