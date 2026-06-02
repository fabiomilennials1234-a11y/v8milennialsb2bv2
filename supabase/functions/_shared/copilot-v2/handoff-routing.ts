/**
 * handoff-routing — Copilot v2 role-aware handoff destination (Slice 5).
 *
 * Pure resolution of WHO receives a transfer_to_human notification. Order:
 * responsible_id → closer_id → sdr_id → sale_responsible_id → pre_sale_responsible_id
 * → active org team. Never returns an empty target set — a notification that
 * reaches no one is the v1 #7/#9 bug class. The WhatsApp phone is opt-in
 * (team_members.phone may be null); in-app still fires for those targets.
 */

export interface Member {
  id: string;
  user_id: string | null;
  phone: string | null;
  is_active: boolean;
  role: string;
}

export interface LeadOwners {
  responsible_id?: string | null;
  closer_id?: string | null;
  sdr_id?: string | null;
  sale_responsible_id?: string | null;
  pre_sale_responsible_id?: string | null;
}

export interface HandoffTarget {
  userId: string;
  memberId: string;
  phone: string | null;
  role: string;
}

export interface HandoffRouting {
  targets: HandoffTarget[];
  fallbackUsed: "org_active_team" | null;
}

const OWNER_ORDER: (keyof LeadOwners)[] = [
  "responsible_id", "closer_id", "sdr_id", "sale_responsible_id", "pre_sale_responsible_id",
];

export function resolveHandoffTargets(input: {
  lead: LeadOwners;
  members: Member[];
  activeTeam: Member[];
}): HandoffRouting {
  const byId = new Map(input.members.filter((m) => m.is_active && m.user_id).map((m) => [m.id, m]));
  for (const key of OWNER_ORDER) {
    const memberId = input.lead[key];
    if (memberId && byId.has(memberId)) {
      const m = byId.get(memberId)!;
      return { targets: [toTarget(m)], fallbackUsed: null };
    }
  }
  // Fallback: the active org team (admins first). Never empty.
  const team = input.activeTeam.filter((m) => m.is_active && m.user_id);
  const admins = team.filter((m) => m.role === "admin");
  const chosen = (admins.length ? admins : team).map(toTarget);
  return { targets: chosen, fallbackUsed: "org_active_team" };
}

function toTarget(m: Member): HandoffTarget {
  return { userId: m.user_id!, memberId: m.id, phone: m.phone, role: m.role };
}
