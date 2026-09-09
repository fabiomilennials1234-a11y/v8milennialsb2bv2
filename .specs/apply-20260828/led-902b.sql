INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270902000010','delete_system_pipeline_hard')
ON CONFLICT (version) DO NOTHING;
