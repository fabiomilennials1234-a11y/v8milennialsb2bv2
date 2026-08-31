INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270902000000','funil_sistema_deixa_de_nascer_sozinho')
ON CONFLICT (version) DO NOTHING;
