import type { ActionInput, ActionResult } from "./types.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

export async function createCalendarEvent(input: ActionInput): Promise<ActionResult> {
  const { organizationId, leadId, params } = input;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const title = (params.eventTitle as string) || "Evento";
  const description = (params.eventDescription as string) || "";
  const durationMinutes = (params.eventDurationMinutes as number) || 60;

  const res = await fetch(`${supabaseUrl}/functions/v1/google-calendar-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      organization_id: organizationId,
      lead_id: leadId,
      title,
      description,
      duration_minutes: durationMinutes,
    }),
  });

  if (!res.ok) return { success: false, error: `Calendar event failed: ${await res.text()}` };
  return { success: true, message: "Calendar event created" };
}
