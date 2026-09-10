import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OracleActor } from "./scope.ts";

export function createAdminBriefingStore(db: SupabaseClient) {
  return {
    async current(actor: OracleActor): Promise<unknown | null> {
      const { data, error } = await db.rpc("oraculo_admin_briefing_current", {
        p_organization_id: actor.organizationId,
        p_user_id: actor.userId,
      });
      if (error) throw new Error("Não foi possível carregar o briefing.");
      return data ?? null;
    },
    async open(actor: OracleActor, briefingId: string): Promise<unknown> {
      const { data, error } = await db.rpc("oraculo_open_admin_briefing", {
        p_briefing_id: briefingId,
        p_organization_id: actor.organizationId,
        p_user_id: actor.userId,
      });
      if (error || !data) throw new Error("Não foi possível abrir o briefing.");
      return data;
    },
  };
}
