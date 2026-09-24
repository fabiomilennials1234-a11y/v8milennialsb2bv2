// Canonical handler is shared with the standalone ingress service.
import { createWhatsAppWebhookHandler } from "./handler.ts";
import { createEdgeInboxBridge } from "./edge-inbox-bridge.ts";
export * from "./handler.ts";

export const whatsappWebhookHandler = createWhatsAppWebhookHandler({
  admitEvent: createEdgeInboxBridge(key => Deno.env.get(key)),
});

Deno.serve(whatsappWebhookHandler);
