/**
 * torquecalls-recording-maintenance — o áudio some em 90 dias, e a busca que
 * falhou é tentada de novo (Gravação S4, #1360 do PRD #1356).
 *
 * Duas tarefas na mesma invocação, disparadas por pg_cron a cada 5 minutos:
 *
 *   1. EXPURGO. Gravação de ligação com mais de 90 dias é apagada — o objeto
 *      sai do ARMAZENAMENTO, não só a referência.
 *   2. REENFILEIRAMENTO. Busca que falhou volta para a fila, com teto.
 *
 * POR QUE UMA EDGE FUNCTION E NÃO UM CRON DE SQL
 * ----------------------------------------------
 * `storage.objects` tem `protect_objects_delete`: DELETE vindo do SQL levanta
 * 42501 ("Use the Storage API instead"). Apagar de verdade só é possível daqui.
 * A regra de QUEM vence continua no banco, onde a suíte pgTAP a prova; este
 * arquivo é o braço, não a cabeça.
 *
 * POR QUE AS DUAS NA MESMA FUNÇÃO
 * -------------------------------
 * A cadência é da retentativa: 5 minutos é o menor degrau da escada de
 * espaçamento. O expurgo não tem opinião entre 5 minutos e um dia — a fronteira
 * dele são 90 dias — e é idempotente. Separá-las custaria um segundo deploy, um
 * segundo segredo e um segundo lugar para desligar por engano; juntá-las custa
 * uma consulta indexada que quase sempre devolve zero.
 *
 * AUTENTICAÇÃO
 * ------------
 * `x-cron-secret` ou `service_role`, como todo cron deste projeto. Não há
 * caminho de usuário: as quatro RPCs que este arquivo chama estão revogadas de
 * `anon` e de `authenticated` no banco, então mesmo um chamador autenticado que
 * passasse por aqui não moveria nada.
 *
 * `?dryRun=1` lista e não apaga. A primeira execução em produção destrói áudio
 * que não tem de onde voltar, e a forma de olhar antes é esta — mesma cautela do
 * `whatsapp-media-retention`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { asMaintenanceStore, runPurge, runRetryQueue } from "./maintenance.ts";

Deno.serve(
  withErrorBoundary("torquecalls-recording-maintenance", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    const headers = withSecurityHeaders({
      ...getCorsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json",
    });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST" && req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    // Comparação com o segredo VAZIO nunca autoriza: sem `CRON_SECRET`
    // configurado, um chamador que mandasse o header vazio passaria.
    const cronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("authorization") ?? "";
    const authorized = (!!CRON_SECRET && cronSecret === CRON_SECRET) ||
      (!!SERVICE_ROLE_KEY && authHeader.includes(SERVICE_ROLE_KEY));
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    let dryRun = false;
    const qp = new URL(req.url).searchParams.get("dryRun");
    if (qp === "1" || qp === "true") dryRun = true;
    if (!dryRun && req.method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      if (body && (body.dryRun === true || body.dryRun === "1")) dryRun = true;
    }

    const db = asMaintenanceStore(
      createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );

    // Em série, e não em paralelo: as duas mexem nas mesmas linhas de
    // `voip_calls` e num mesmo bucket, e a única coisa que o paralelismo
    // compraria seriam alguns segundos numa tarefa que roda a cada 5 minutos.
    const purge = await runPurge(db, { dryRun });
    const retry = await runRetryQueue(db, { dryRun });

    return new Response(
      JSON.stringify({ dryRun, retention_days: 90, purge, retry }),
      { status: 200, headers },
    );
  }),
);
