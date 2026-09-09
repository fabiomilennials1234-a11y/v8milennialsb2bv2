SELECT version, name FROM supabase_migrations.schema_migrations
 WHERE version LIKE '202709%' ORDER BY version;
