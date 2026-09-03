/**
 * Sub-barrel — componentes **legacy de confirmação** (standalone, pré-modelo-novo).
 *
 * Reexportado pela API pública (`../../../index.ts`) com os mesmos nomes.
 * NÃO inclui `CompareceuModal` — esse vive em `@/modules/leads` (inversão F7) e
 * é re-exportado direto pelo barrel público para manter a API estável.
 */
export { AddMeetingModal } from "./AddMeetingModal";
export { ConfirmacaoCard } from "./ConfirmacaoCard";
export { ConfirmacaoStats } from "./ConfirmacaoStats";
export { MeetingCountdown } from "./MeetingCountdown";
export { MeetingTimeline } from "./MeetingTimeline";
export { QuickAddDailyAction } from "./QuickAddDailyAction";
export { RescheduleModal } from "./RescheduleModal";
export type { ReschedulingMode } from "./RescheduleModal";
