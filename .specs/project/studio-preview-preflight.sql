SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS public_tables,
       (SELECT count(*) FROM supabase_migrations.schema_migrations) AS ledger_rows;
