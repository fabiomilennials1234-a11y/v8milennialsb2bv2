import { useEffect, useState } from "react";
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
 *   estreia → takeover de LANÇAMENTO (1x por navegador)
 *   depois  → COACH-MARK a cada entrada (1x por sessão), até o X desligar.
 *
 * A decisão é tirada UMA vez, na montagem — não é reativa, para os filhos poderem
 * marcar o storage sem re-disparar a escolha. Todos os usuários veem, o master
 * inclusive (pedido do CTO). Para restringir a clientes de novo, volte o gate
 * `const { isMaster } = useMasterAuth()` → decisão "none" quando master.
 *
 * Kill-switch em ENABLED: desligar a feature inteira é uma linha.
 */
const ENABLED = true;

export function SupportRealtimeAnnouncement() {
  const [decision, setDecision] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!ENABLED) return;
    setDecision(decideAnnouncement());
  }, []);

  if (decision === "launch") {
    return <SupportRealtimeLaunchModal onClose={markLaunchSeen} />;
  }
  if (decision === "nudge") {
    return <SupportRealtimeNudge onDismissForever={dismissNudgeForever} />;
  }
  return null;
}
