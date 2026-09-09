INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270904000010','desfecho_pela_ui')
ON CONFLICT (version) DO NOTHING;
