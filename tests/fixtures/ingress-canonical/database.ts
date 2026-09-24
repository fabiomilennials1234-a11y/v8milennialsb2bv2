import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Test-only query adapter. Predicates and mutations execute in PostgreSQL;
 * this is not a PostgREST/auth/production-schema integration test. */
export function canonicalDatabase(pg: PGlite): SupabaseClient {
  const identifier = (name: string) => {
    if (!/^[a-z_]+$/.test(name)) throw new Error(`Unsupported fixture identifier: ${name}`);
    return `"${name}"`;
  };
  return {
    from(table: string) {
      if (!['whatsapp_messages', 'copilot_quotes', 'conversation_messages'].includes(table)) throw new Error('Unexpected table');
      const values: unknown[] = [];
      const predicates: string[] = [];
      const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
      const column = (name: string) => name.split('->').map((part, index) => index ? `->'${identifier(part).slice(1, -1)}'` : identifier(part)).join('');
      let columns = '*';
      let assignments: string[] | undefined;
      let single = false;
      let limit: number | undefined;
      const chain = {
        select(selection = '*') { columns = selection === '*' ? '*' : selection.split(',').map(identifier).join(','); return chain; },
        eq(name: string, value: unknown) { predicates.push(`${column(name)} = ${bind(value)}`); return chain; },
        in(name: string, list: unknown[]) { predicates.push(`${column(name)} = ANY(${bind(list)}::text[])`); return chain; },
        is(name: string, value: unknown) {
          if (value !== null) throw new Error('Unsupported fixture IS predicate');
          predicates.push(`${column(name)} IS NULL`); return chain;
        },
        not(name: string, operator: string, value: unknown) {
          if (operator !== 'is' || value !== null) throw new Error('Unsupported fixture NOT predicate');
          predicates.push(`${column(name)} IS NOT NULL`); return chain;
        },
        contains(name: string, value: unknown) { predicates.push(`${column(name)} @> ${bind(JSON.stringify(value))}::jsonb`); return chain; },
        update(update: Record<string, unknown>) {
          assignments = Object.entries(update).map(([name, value]) => {
            const json = name === 'metadata' || name === 'reactions';
            return `${identifier(name)} = ${bind(json ? JSON.stringify(value) : value)}${json ? '::jsonb' : ''}`;
          });
          return chain;
        },
        maybeSingle() { single = true; return chain; },
        limit(count: number) { if (!Number.isInteger(count) || count < 1) throw new Error('Invalid limit'); limit = count; return chain; },
        then(resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
          const sql = assignments
            ? `UPDATE ${identifier(table)} SET ${assignments.join(',')} ${where} RETURNING ${columns}`
            : `SELECT ${columns} FROM ${identifier(table)} ${where}${limit ? ` LIMIT ${limit}` : ''}`;
          return pg.query(sql, values).then(result => {
            if (single && result.rows.length > 1) throw new Error('Multiple fixture rows for maybeSingle');
            return { data: single ? result.rows[0] ?? null : result.rows, error: null };
          }).catch(error => ({ data: null, error: { message: error.message } })).then(resolve, reject);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

export const canonicalSchema = `
  CREATE TABLE whatsapp_messages (
    id text PRIMARY KEY, message_id text NOT NULL, organization_id text NOT NULL,
    instance_id text NOT NULL, direction text NOT NULL, status text NOT NULL,
    reactions jsonb, edited boolean DEFAULT false, deleted_at timestamptz, pinned_at timestamptz
  );
  CREATE TABLE copilot_quotes (
    id text PRIMARY KEY, organization_id text NOT NULL, conversation_id text NOT NULL,
    revision integer NOT NULL, status text NOT NULL
  );
  CREATE TABLE conversation_messages (id text PRIMARY KEY, conversation_id text NOT NULL, metadata jsonb NOT NULL);
  CREATE FUNCTION fail_fixture_seal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('fixture.fail_seal',true) = 'true' THEN RAISE EXCEPTION 'injected seal failure'; END IF;
      RETURN NEW;
    END;
  $$;
  CREATE TRIGGER fail_fixture_seal BEFORE UPDATE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION fail_fixture_seal();
`;
