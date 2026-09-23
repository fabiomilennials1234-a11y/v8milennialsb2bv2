// Canonical handler is shared with the standalone ingress service.
import { whatsappWebhookHandler } from "./handler.ts";
export * from "./handler.ts";

Deno.serve(whatsappWebhookHandler);
