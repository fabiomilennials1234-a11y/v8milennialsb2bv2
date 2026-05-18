import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useOrderEventNotifications() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  useEffect(() => {
    if (!organizationId || !user) return;

    const channel = supabase
      .channel("order-events-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_events",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const event = payload.new as {
            event_type: string;
            actor_id: string | null;
            comment: string | null;
            order_id: string;
          };

          if (event.actor_id === user.id) return;

          if (event.event_type === "approved") {
            toast.success("Pedido aprovado", {
              description: "Um pedido que você acompanha foi aprovado.",
            });
          } else if (event.event_type === "rejected") {
            toast.error("Pedido rejeitado", {
              description: event.comment
                ? `Motivo: ${event.comment}`
                : "Um pedido foi rejeitado.",
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, user]);
}
