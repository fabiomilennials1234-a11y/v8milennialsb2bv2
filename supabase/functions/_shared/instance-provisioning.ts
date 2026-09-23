import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CreateInstanceInput, WhatsAppProvider } from "./whatsapp-client.ts";

/** Remote creation may have succeeded. Keep credentials, identity and safety leases. */
export class InstanceProvisioningUncertainError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Remote instance provisioning is uncertain", { cause });
    this.name = "InstanceProvisioningUncertainError";
  }
}

export async function provisionWhatsAppInstance(
  provider: Pick<WhatsAppProvider, "createInstance">,
  input: CreateInstanceInput,
  admin: SupabaseClient,
) {
  try {
    return await provider.createInstance(input);
  } catch (error) {
    if (!(error instanceof InstanceProvisioningUncertainError)) {
      // Only failures known to precede remote provisioning may discard the placeholder.
      const { error: cleanupError } = await admin.from("whatsapp_instances").delete()
        .eq("id", input.instance_id).eq("organization_id", input.organization_id);
      if (cleanupError) throw new Error("Instance placeholder cleanup failed", { cause: error });
    }
    throw error;
  }
}
