// Local-only external services, real deployed HTTP entrypoint and business logic.
import { ExternalServices, ORG_A } from '../../../supabase/functions/oraculo-turno/http-fixture.ts';
const services = new ExternalServices();
for (const org of services.tables.organizations) Object.assign(org, { org_type: 'crm', timezone: 'America/Sao_Paulo' });
services.model = () => services.completion('Resposta verificada pelo smoke.');
const serve = Deno.serve;
globalThis.fetch = services.fetch;
Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54399');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
Deno.env.set('ANON_KEY_2', 'test-anon');
Deno.env.set('OPENROUTER_API_KEY', 'test-model-key');
Deno.serve = ((handler: (req: Request) => Promise<Response>) => serve({ hostname: '127.0.0.1', port: 54399 }, async (req) => {
  const url = new URL(req.url);
  let response: Response;
  if (req.method === 'OPTIONS') response = new Response(null, { status: 204 });
  else if (url.pathname === '/functions/v1/oraculo-turno') response = await handler(req);
  else if (url.pathname === '/functions/v1/attach-to-org-by-pending-invite') response = Response.json({ attached: false });
  else if (url.pathname === '/qa/deny-plan') { services.features.oraculo = false; response = Response.json({ ok: true }); }
  else response = await services.fetch(req);
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', 'http://127.0.0.1:8094');
  headers.set('access-control-allow-headers', req.headers.get('access-control-request-headers') ?? '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS,HEAD');
  return new Response(response.body, { status: response.status, headers });
})) as typeof Deno.serve;
services.tables.oraculo_conversations[0].title = 'Conversa existente A';
services.tables.oraculo_conversations[0].organization_id = ORG_A;
await import('../../../supabase/functions/oraculo-turno/index.ts');
