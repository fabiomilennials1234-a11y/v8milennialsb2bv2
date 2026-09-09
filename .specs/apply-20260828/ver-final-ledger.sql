SELECT version, name FROM supabase_migrations.schema_migrations
 WHERE version IN ('20270903000000','20270903000010','20270903000020','20270904000000','20270904000010')
 ORDER BY version;
