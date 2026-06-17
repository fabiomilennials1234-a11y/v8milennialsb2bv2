/**
 * whatsapp-provider — UI-facing provider profiles for the connections surface.
 *
 * One place that answers "what is this number, how do you connect it, and what
 * can it do?" so the chooser, instance cards, and capability gating all agree.
 *
 * Capability gating is a POSITIVE allowlist (cert Rule 13): Uazapi-only actions
 * are enabled only for the uazapi profile (and legacy/unset instances, which
 * predate the provider column and are Uazapi in practice) — never via a
 * negative `!== 'meta_cloud'` check, which would wrongly enable unknown providers.
 */

export type WhatsAppProviderId = "uazapi" | "evolution" | "meta_cloud";

export type ConnectKind = "qr" | "embedded_signup";

export interface ProviderCapabilities {
  /** Free-form text + media — every provider. */
  text: boolean;
  media: boolean;
  /** Uazapi-only rich/interactive + ops. */
  menu: boolean;
  pix: boolean;
  reactions: boolean;
  edit: boolean;
  pin: boolean;
  markRead: boolean;
  historySync: boolean;
  massSend: boolean;
  /** Meta Cloud official-only. */
  templates: boolean;
  /** Subject to Meta's 24h customer-service window (free-form only inside it). */
  window24h: boolean;
}

export interface ProviderProfile {
  id: WhatsAppProviderId;
  /** Short identity shown on the instance card / chooser. */
  label: string;
  /** One-line positioning for the chooser. */
  tagline: string;
  connectKind: ConnectKind;
  official: boolean;
  capabilities: ProviderCapabilities;
}

const UAZAPI: ProviderProfile = {
  id: "uazapi",
  label: "Uazapi",
  tagline: "Escaneia um QR. Qualquer número, recursos completos.",
  connectKind: "qr",
  official: false,
  capabilities: {
    text: true, media: true,
    menu: true, pix: true, reactions: true, edit: true, pin: true, markRead: true,
    historySync: true, massSend: true,
    templates: false, window24h: false,
  },
};

const EVOLUTION: ProviderProfile = {
  id: "evolution",
  label: "Evolution",
  tagline: "Provedor legado (kill-switch de migração).",
  connectKind: "qr",
  official: false,
  capabilities: {
    text: true, media: true,
    menu: false, pix: false, reactions: false, edit: false, pin: false, markRead: false,
    historySync: false, massSend: false,
    templates: false, window24h: false,
  },
};

const META_CLOUD: ProviderProfile = {
  id: "meta_cloud",
  label: "Meta Oficial",
  tagline: "Login Meta. Número oficial verificado, templates aprovados.",
  connectKind: "embedded_signup",
  official: true,
  capabilities: {
    text: true, media: true,
    menu: false, pix: false, reactions: false, edit: false, pin: false, markRead: false,
    historySync: false, massSend: false,
    templates: true, window24h: true,
  },
};

const PROFILES: Record<WhatsAppProviderId, ProviderProfile> = {
  uazapi: UAZAPI,
  evolution: EVOLUTION,
  meta_cloud: META_CLOUD,
};

/**
 * Resolve a provider profile. Legacy/unset/unknown values fall back to the
 * Uazapi profile — pre-`provider`-column instances are Uazapi in practice, and
 * an unknown value should degrade to the safe legacy default rather than crash.
 */
export function getProviderProfile(provider: string | null | undefined): ProviderProfile {
  if (provider && provider in PROFILES) {
    return PROFILES[provider as WhatsAppProviderId];
  }
  return UAZAPI;
}

/**
 * Positive allowlist for Uazapi-only chat actions (react/edit/pin/menu/pix/
 * historySync/massSend). True only for genuine uazapi instances and legacy/unset
 * ones. Meta Cloud, Evolution, and unknown providers are excluded.
 */
export function canUseUazapiActions(provider: string | null | undefined): boolean {
  return provider == null || provider === "uazapi";
}
