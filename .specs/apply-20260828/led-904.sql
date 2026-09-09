INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270904000000','desfecho_do_negocio')
ON CONFLICT (version) DO NOTHING;
