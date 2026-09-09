import { supabase } from "@/integrations/supabase/client";
import { selectInChunks, IN_CHUNK_SIZE, type ChunkedResult } from "@/shared/supabase/selectInChunks";
import type { ChatContact } from "../types";

type SavedName = { phone_number: string; saved_contact_name: string | null };
/** Never match an address-book entry across WhatsApp accounts. */
export async function enrichSavedContactNames(contacts: ChatContact[], organizationId: string, defaultInstance?: string) {
  const instances = new Set(contacts.filter(c => c.channel === "whatsapp").map(c => c.instance_id ?? defaultInstance).filter((id): id is string => !!id));
  await Promise.all([...instances].map(async instanceId => {
    const targets = contacts.filter(c => c.channel === "whatsapp" && (c.instance_id ?? defaultInstance) === instanceId && !c.is_group);
    try {
      const rows = await selectInChunks<SavedName>([...new Set(targets.map(c => c.phone_number))], chunk =>
        supabase.from("whatsapp_conversation_summary").select("phone_number, saved_contact_name")
          .eq("organization_id", organizationId).eq("instance_id", instanceId).in("phone_number", chunk) as unknown as PromiseLike<ChunkedResult<SavedName>>, IN_CHUNK_SIZE);
      const names = new Map(rows.map(r => [r.phone_number, r.saved_contact_name]));
      for (const c of targets) c.saved_contact_name = names.get(c.phone_number) ?? null;
    } catch {
      console.warn("[inbox] Nome salvo indisponível; usando identificação existente.");
    }
  }));
}

