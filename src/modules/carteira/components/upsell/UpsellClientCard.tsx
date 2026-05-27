/**
 * @deprecated Use LeadCard variant="upsell_client" instead. This component is kept for reference only.
 */
import { motion } from "framer-motion";
import { Building2, Phone, DollarSign, User, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UpsellClientWithRelations } from "@/modules/carteira/hooks/useUpsellClients";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface UpsellClientCardProps {
  client: UpsellClientWithRelations;
  totalVendas?: number;
  onClick?: () => void;
}

const potencialConfig: Record<string, { class: string; label: string }> = {
  baixo: { class: "bg-muted text-muted-foreground", label: "Baixo" },
  medio: { class: "bg-primary/10 text-primary", label: "Medio" },
  alto: { class: "bg-green-500/10 text-green-600", label: "Alto" },
  estrategico: { class: "bg-purple-500/10 text-purple-600", label: "Estrategico" },
};

export function UpsellClientCard({ client, totalVendas = 0, onClick }: UpsellClientCardProps) {
  const isInactive = !client.is_active;
  const config = potencialConfig[client.potencial] || potencialConfig.medio;

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`kanban-card ${isInactive ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-medium text-sm truncate flex-1">{client.name}</h4>
        <div className="flex gap-1">
          {isInactive && (
            <Badge className="text-[10px] px-1.5 py-0 bg-destructive/10 text-destructive border-0">
              Inativo
            </Badge>
          )}
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${config.class}`}>
            {config.label}
          </Badge>
        </div>
      </div>

      {client.company && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <div className="p-0.5 rounded bg-muted">
            <Building2 className="h-3 w-3" />
          </div>
          <span className="truncate">{client.company}</span>
        </div>
      )}

      {client.phone && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <div className="p-0.5 rounded bg-muted">
            <Phone className="h-3 w-3" />
          </div>
          <span>{client.phone}</span>
        </div>
      )}

      {client.created_at && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-2">
          <Clock className="w-3 h-3" />
          <span>{formatDistanceToNow(new Date(client.created_at), { addSuffix: true, locale: ptBR })}</span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs">
          <div className="p-0.5 rounded bg-green-500/10">
            <DollarSign className="h-3 w-3 text-green-600" />
          </div>
          <span className="font-semibold text-green-600">
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
              minimumFractionDigits: 0,
            }).format(totalVendas)}
          </span>
        </div>
        {(client.closer as any)?.name && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="truncate max-w-[80px]">{(client.closer as any).name}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
