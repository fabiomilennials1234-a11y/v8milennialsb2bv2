/**
 * useInstanceCapabilities — resolve a WhatsApp instance's provider profile +
 * capability gating for the chat surface.
 *
 * Reads the org-wide instances (which carry `provider`) and maps to the pure
 * provider profile. Defaults to the Uazapi (legacy) profile when the instance
 * is unknown/still loading, so Uazapi-only actions never flicker-hide for the
 * common case — they only hide once we positively know it's a Meta/Evolution
 * number (cert Rule 13: positive allowlist, never `!== 'meta_cloud'`).
 */
import { useWhatsAppInstances } from "./useWhatsAppInstances";
import {
  getProviderProfile,
  canUseUazapiActions,
  type ProviderProfile,
} from "../lib/whatsapp-provider";

export interface InstanceCapabilities {
  profile: ProviderProfile;
  /** Render Uazapi-only actions (menu/pix/react/edit/pin/markRead/historySync)? */
  canUseUazapiActions: boolean;
}

export function useInstanceCapabilities(
  instanceId: string | null | undefined,
): InstanceCapabilities {
  const { data: instances } = useWhatsAppInstances();
  const instance = instances?.find((i) => i.id === instanceId);
  const provider = (instance as { provider?: string } | undefined)?.provider;
  return {
    profile: getProviderProfile(provider),
    canUseUazapiActions: canUseUazapiActions(provider),
  };
}
