import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('scheduled conversations support a null lead while keeping the foreign key', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE leads(id uuid PRIMARY KEY);
      CREATE TABLE scheduled_user_messages(lead_id uuid NOT NULL REFERENCES leads,
        organization_id uuid, whatsapp_instance_id uuid, phone_number text, scheduled_at timestamptz, status text);
    `);
    await assert.rejects(db.exec("INSERT INTO scheduled_user_messages(lead_id) VALUES ('')"), /invalid input syntax/);
    await assert.rejects(db.exec('INSERT INTO scheduled_user_messages(lead_id) VALUES (NULL)'), /not-null/);
    await db.exec(readFileSync(new URL('../../supabase/migrations/20260916130218_scheduled_messages_optional_lead.sql', import.meta.url), 'utf8'));
    await db.exec("INSERT INTO scheduled_user_messages(lead_id,phone_number,status) VALUES (NULL,'5551999999999','scheduled')");
    assert.equal((await db.query('SELECT lead_id FROM scheduled_user_messages')).rows[0].lead_id, null);
    await assert.rejects(db.exec("INSERT INTO scheduled_user_messages(lead_id) VALUES ('00000000-0000-0000-0000-000000000001')"), /foreign key/);
    await db.exec("INSERT INTO leads VALUES ('00000000-0000-0000-0000-000000000001'); INSERT INTO scheduled_user_messages(lead_id) VALUES ('00000000-0000-0000-0000-000000000001')");
  } finally { await db.close(); }
});
