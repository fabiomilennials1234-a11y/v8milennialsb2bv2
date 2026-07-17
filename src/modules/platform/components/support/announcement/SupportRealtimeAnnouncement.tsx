import { useEffect, useState } from "react";
import { useMasterAuth } from "@/modules/identity";
import {
  decideAnnouncement,
  markLaunchSeen,
  dismissNudgeForever,
  type Announcement,
} from "./announcement-state";
import { SupportRealtimeLaunchModal } from "./SupportRealtimeLaunchModal";
import { SupportRealtimeNudge } from "./SupportRealtimeNudge";

/**
 * Orquestra os dois avisos do "suporte ao vivo":
 *   estreia → takeout de LANÇAMENTO (1x por navegador)
 *   depois  → COACH-MARK a cada entrada (1x por sessão), até o X desligar.
 *
 * A decisão é tirada UMA vez, quando o papel do usuário resolve — não é reativa,
 * para os filhos poderem marcar o storage sem re-disparar a escolha. O staff
 * (master) nunca vê: é anúncio de feature para o cliente.
 *
 * Kill-switch em ENABLED: desligar a feature inteira é uma linha, sem caçar
 * pontos de montagem.
 */
const ENABLED = true;

export function SupportRealtimeAnnouncement() {
  const { isMaster, isLoading } = useMasterAuth();
  const [decision, setDecision] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!ENABLED || isLoading) return;
    setDecision(isMaster ? "none" : decideAnnouncement());
  }, [isLoading, isMaster]);

  if (decision === "launch") {
    return <SupportRealtimeLaunchModal onClose={markLaunchSeen} />;
  }
  if (decision === "nudge") {
    return <SupportRealtimeNudge onDismissForever={dismissNudgeForever} />;
  }
  return null;
}
