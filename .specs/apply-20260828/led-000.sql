INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270903000000','metrica_por_etapa_para_de_degradar')
ON CONFLICT (version) DO NOTHING;
