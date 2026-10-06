import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let db;
const master = "00000000-0000-4000-8000-000000000001";
const customer = "00000000-0000-4000-8000-000000000002";
const ticket = "00000000-0000-4000-8000-000000000010";
const otherTicket = "00000000-0000-4000-8000-000000000020";
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE support_tickets(id uuid PRIMARY KEY, first_response_at timestamptz);
    CREATE TABLE support_ticket_comments(ticket_id uuid REFERENCES support_tickets(id), author_user_id uuid,
      from_staff boolean, is_internal boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
    CREATE FUNCTION is_master_user(user_id uuid) RETURNS boolean LANGUAGE sql AS
      $$ SELECT user_id = '${master}'::uuid $$;
  `);
  await db.exec(readFileSync(new URL("../../supabase/migrations/20271106000030_support_first_response_origin.sql", import.meta.url), "utf8"));
  await db.exec("CREATE TRIGGER trg_support_ticket_first_response AFTER INSERT ON support_ticket_comments FOR EACH ROW EXECUTE FUNCTION stamp_support_ticket_first_response()");
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE support_ticket_comments, support_tickets;
    INSERT INTO support_tickets(id) VALUES ('${ticket}'), ('${otherTicket}');`);
});
const insert = (author, staff, internal = false, at = "2026-10-05T10:00:00Z") => db.query(
  "INSERT INTO support_ticket_comments VALUES ($1,$2,$3,$4,$5)", [ticket, author, staff, internal, at],
);
const response = async (id = ticket) => (await db.query("SELECT first_response_at FROM support_tickets WHERE id=$1", [id])).rows[0].first_response_at;

test("master commenting as customer cannot start first-response clock", async () => {
  await insert(master, false);
  assert.equal(await response(), null);
  await insert(master, null);
  assert.equal(await response(), null);
});
test("internal notes and forged customer staff flag do not start clock", async () => {
  await insert(master, true, true);
  await insert(customer, true);
  assert.equal(await response(), null);
});
test("public staff response stamps only its ticket once", async () => {
  await insert(master, true);
  await insert(master, true, false, "2026-10-05T11:00:00Z");
  assert.equal((await response()).toISOString(), "2026-10-05T10:00:00.000Z");
  assert.equal(await response(otherTicket), null);
});
