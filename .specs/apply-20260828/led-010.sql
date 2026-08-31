INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20270903000010','metrica_valor_por_etapa')
ON CONFLICT (version) DO NOTHING;
