import { motion } from "framer-motion";
import { Calendar, User, DollarSign, Building2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { UpsellCampanhaWithRelations } from "@/hooks/useUpsellCampanhas";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface UpsellCampanhaCardProps {
  campanha: UpsellCampanhaWithRelations;
  onClick?: () => void;
}

const potencialConfig: Record<string, { class: string; label: string }> = {
  baixo: { class: "bg-muted text-muted-foreground", label: "Baixo" },
  medio: { class: "bg-primary/10 text-primary", label: "Medio" },
  alto: { class: "bg-green-500/10 text-green-600", label: "Alto" },
  estrategico: { class: "bg-purple-500/10 text-purple-600", label: "Estrategico" },
};

export function UpsellCampanhaCard({ campanha, onClick }: UpsellCampanhaCardProps) {
  const client = campanha.client as any;
  const config = potencialConfig[client?.potencial] || potencialConfig.medio;

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="kanban-card"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-medium text-sm truncate flex-1">
          {client?.name || "Cliente"}
        </h4>
        {client?.potencial && (
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${config.class}`}>
            {config.label}
          </Badge>
        )}
      </div>

      {client?.company && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          <div className="p-0.5 rounded bg-muted">
            <Building2 className="h-3 w-3" />
          </div>
          <span className="truncate">{client.company}</span>
        </div>
      )}

      {(campanha.mrr_planejado || campanha.projeto_planejado) ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
          {campanha.mrr_planejado ? (
            <div className="flex items-center gap-1">
              <div className="p-0.5 rounded bg-blue-500/10">
                <DollarSign className="h-3 w-3 text-blue-500" />
              </div>
              <span>MRR: R$ {Number(campanha.mrr_planejado).toLocaleString("pt-BR")}</span>
            </div>
          ) : null}
          {campanha.projeto_planejado ? (
            <div className="flex items-center gap-1">
              <div className="p-0.5 rounded bg-amber-500/10">
                <DollarSign className="h-3 w-3 text-amber-500" />
              </div>
              <span>Proj: R$ {Number(campanha.projeto_planejado).toLocaleString("pt-BR")}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {campanha.created_at && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-2">
          <Clock className="w-3 h-3" />
          <span>{formatDistanceToNow(new Date(campanha.created_at), { addSuffix: true, locale: ptBR })}</span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border">
        {campanha.data_abordagem ? (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{new Date(campanha.data_abordagem).toLocaleDateString("pt-BR")}</span>
          </div>
        ) : <span />}
        {campanha.closer && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="truncate max-w-[80px]">{(campanha.closer as any)?.name}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
