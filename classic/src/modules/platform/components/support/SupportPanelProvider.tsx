import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { SupportPrefill } from "@/shared/errors";
import { SupportPanelContext } from "./SupportPanelContext";

export function SupportPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [prefill, setPrefill] = useState<SupportPrefill | null>(null);

  const open = useCallback(() => {
    setTicketId(null);
    setComposing(false);
    setIsOpen(true);
  }, []);

  const openNewTicket = useCallback(() => {
    setTicketId(null);
    setPrefill(null);
    setComposing(true);
    setIsOpen(true);
  }, []);

  const openNewTicketWith = useCallback((next: SupportPrefill) => {
    setTicketId(null);
    setPrefill(next);
    setComposing(true);
    setIsOpen(true);
  }, []);

  const openTicket = useCallback((id: string) => {
    setComposing(false);
    setTicketId(id);
    setIsOpen(true);
  }, []);

  const backToList = useCallback(() => {
    setTicketId(null);
    setComposing(false);
  }, []);

  // Fechar não volta para a lista: reabrir deve mostrar onde o usuário parou.
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({
      isOpen,
      ticketId,
      composing,
      prefill,
      open,
      openNewTicket,
      openNewTicketWith,
      openTicket,
      backToList,
      close,
    }),
    [isOpen, ticketId, composing, prefill, open, openNewTicket, openNewTicketWith, openTicket, backToList, close],
  );

  return <SupportPanelContext.Provider value={value}>{children}</SupportPanelContext.Provider>;
}
