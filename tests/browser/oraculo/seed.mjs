// Synthetic fixtures for a disposable Supabase branch, never production.
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const url = process.env.TEST_SUPABASE_URL;
if (!url || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url) || /jsjsmuncfkbsbzqzqhfq|bcfadphgsibjzivtbjvc/.test(url)) throw new Error('Disposable branch URL required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, options);
const checked = async (query) => { const r = await query; if (r.error) throw r.error; return r.data; };
const orgs = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
await checked(service.from('subscription_plans').insert([
  { name: 'oracle-smoke', display_name: 'Oracle QA', features: { oraculo: true }, limits: { max_users: 5 } },
  { name: 'oracle-smoke-blocked', display_name: 'Oracle QA blocked', features: { oraculo: false }, limits: { max_users: 5 } },
]));
await checked(service.from('organizations').insert(orgs.map((id, i) => ({ id, name: `Oracle smoke ${i}`, slug: `oracle-smoke-${i}`, subscription_plan: 'oracle-smoke', subscription_status: 'active' }))));
await checked(service.from('org_quotas').upsert(orgs.map(organization_id => ({ organization_id, resource_key: 'max_users', plan_base: 5 })), { onConflict: 'organization_id,resource_key' }));
const email = `oracle-${crypto.randomUUID()}@example.test`, password = crypto.randomUUID() + '!Aa9';
const { user } = await checked(service.auth.admin.createUser({ email, password, email_confirm: true }));
await checked(service.from('team_members').insert(orgs.map(organization_id => ({ organization_id, user_id: user.id, name: 'Oracle QA', role: 'admin' }))));
const conversationId = '30000000-0000-4000-8000-000000000001';
await checked(service.from('oraculo_conversations').insert({ id: conversationId, organization_id: orgs[0], user_id: user.id, title: 'Conversa existente A' }));
await checked(service.from('oraculo_turns').insert({ conversation_id: conversationId, organization_id: orgs[0], user_id: user.id, role: 'user', content: 'O contrato confidencial da organização A vale R$ 713.250.' }));
const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
const { session } = await checked(client.auth.signInWithPassword({ email, password }));
writeFileSync(process.env.ORACULO_SMOKE_SESSION_FILE, JSON.stringify({ session, storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token` }), { mode: 0o600 });
console.log('Synthetic orgs, user and conversation ready.');
