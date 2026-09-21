import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronAuth } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createUnavailableTothPreorderAdapter } from "../_shared/erp/toth-preorders/adapter.ts";
import { processTothPreorder } from "../_shared/erp/toth-preorders/engine.ts";
import { createTothPreorderStore } from "../_shared/erp/toth-preorders/repository.ts";
import { createTothPreorderWorkerHandler } from "../_shared/erp/toth-preorders/worker-handler.ts";

// No cron is installed by this release. The verified supplier adapter must be
// implemented and homologated before new submissions can be admitted by SQL.
Deno.serve(withErrorBoundary("toth-process-preorder", createTothPreorderWorkerHandler({
  authorize: (request) => requireCronAuth(request).authorized,
  headers: (request) => withSecurityHeaders(getCorsHeaders(request.headers.get("origin"))),
  async process(operationId) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("toth_preorder_worker_unconfigured");
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return await processTothPreorder(operationId, {
      store: createTothPreorderStore(client),
      adapter: createUnavailableTothPreorderAdapter(),
      // Independent emergency switch for creates; disabling does not stop
      // lookup or local recovery. This switch cannot configure the adapter.
      send_enabled: Deno.env.get("TOTH_PREORDER_SEND_ENABLED") === "true",
    });
  },
})));
