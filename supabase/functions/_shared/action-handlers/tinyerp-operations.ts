import type { ActionInput, ActionResult } from "./types.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

async function handleTinyErpOrder(input: ActionInput, functionName: string): Promise<ActionResult> {
  const { organizationId, leadId, params } = input;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      organization_id: organizationId,
      lead_id: leadId,
      product_id: (params.tinyProductId as string) || null,
    }),
  });

  if (!res.ok) return { success: false, error: `TinyERP order failed: ${await res.text()}` };
  return { success: true, message: `TinyERP order created via ${functionName}` };
}

export async function createTinyerpOrder(input: ActionInput): Promise<ActionResult> {
  return handleTinyErpOrder(input, "tinyerp-push-order");
}

export async function createTinyerpUpsellOrder(input: ActionInput): Promise<ActionResult> {
  return handleTinyErpOrder(input, "tinyerp-push-upsell-order");
}
