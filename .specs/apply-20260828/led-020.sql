INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270903000020','etapa_exige_valor')
ON CONFLICT (version) DO NOTHING;
