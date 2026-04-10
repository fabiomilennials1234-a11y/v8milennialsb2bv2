/**
 * QuotaManagementPanel — Painel de gerenciamento de quotas no master admin.
 * Mostra breakdown de quotas por recurso e permite ajustes com audit trail.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Settings, History } from "lucide-react";
import { toast } from "sonner";

interface QuotaManagementPanelProps {
  organizationId: string;
}

interface QuotaRow {
  id: string;
  organization_id: string;
  resource_key: string;
  plan_base: number;
  purchased_addons: number;
  admin_adjustment: number;
  effective_limit: number;
  current_usage: number;
  created_at: string;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  resource_key: string;
  field_changed: string;
  old_value: number;
  new_value: number;
  changed_by: string;
  change_reason: string;
  created_at: string;
}

const RESOURCE_LABELS: Record<string, string> = {
  max_whatsapp_instances: "Instâncias WhatsApp",
  max_users: "Usuários (Seats)",
  max_copilot_agents: "Agentes Copilot",
};

export function QuotaManagementPanel({ organizationId }: QuotaManagementPanelProps) {
  const queryClient = useQueryClient();
  const [adjustingResource, setAdjustingResource] = useState<string | null>(null);
  const [adjustmentValue, setAdjustmentValue] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const { data: summary, isLoading } = useQuery<{
    quotas: QuotaRow[];
    recent_audit: AuditEntry[];
  }>({
    queryKey: ["admin-quota-summary", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_org_quota_summary", {
        p_org_id: organizationId,
      });
      if (error) throw error;
      return data as unknown as { quotas: QuotaRow[]; recent_audit: AuditEntry[] };
    },
    enabled: !!organizationId,
  });

  const handleAdjust = async () => {
    if (!adjustingResource || !adjustmentReason.trim()) {
      toast.error("Informe o motivo do ajuste");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc("admin_set_quota_adjustment", {
        p_org_id: organizationId,
        p_resource_key: adjustingResource,
        p_admin_adjustment: parseInt(adjustmentValue) || 0,
        p_reason: adjustmentReason.trim(),
      });
      if (error) throw error;

      toast.success("Quota ajustada com sucesso!");
      setAdjustingResource(null);
      setAdjustmentValue("");
      setAdjustmentReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-quota-summary", organizationId] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao ajustar quota");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatLimit = (limit: number) => (limit === -1 ? "∞" : String(limit));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const quotas = summary?.quotas ?? [];
  const audit = summary?.recent_audit ?? [];

  return (
    <div className="space-y-4">
      {/* Quota Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left p-3 font-medium">Recurso</th>
              <th className="text-center p-3 font-medium">Base</th>
              <th className="text-center p-3 font-medium">Extra</th>
              <th className="text-center p-3 font-medium">Ajuste</th>
              <th className="text-center p-3 font-medium">=</th>
              <th className="text-center p-3 font-medium">Uso</th>
              <th className="text-right p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {quotas.map((q) => (
              <tr key={q.resource_key} className="border-t">
                <td className="p-3 font-medium">
                  {RESOURCE_LABELS[q.resource_key] ?? q.resource_key}
                </td>
                <td className="p-3 text-center text-muted-foreground">
                  {formatLimit(q.plan_base)}
                </td>
                <td className="p-3 text-center text-muted-foreground">
                  {q.purchased_addons > 0 ? `+${q.purchased_addons}` : "0"}
                </td>
                <td className="p-3 text-center">
                  <Badge
                    variant={q.admin_adjustment !== 0 ? "default" : "outline"}
                    className="text-xs"
                  >
                    {q.admin_adjustment > 0 ? `+${q.admin_adjustment}` : String(q.admin_adjustment)}
                  </Badge>
                </td>
                <td className="p-3 text-center font-bold">
                  {formatLimit(q.effective_limit)}
                </td>
                <td className="p-3 text-center">
                  <span
                    className={
                      q.effective_limit !== -1 && q.current_usage >= q.effective_limit
                        ? "text-destructive font-medium"
                        : ""
                    }
                  >
                    {q.current_usage}
                    {q.effective_limit !== -1 && `/${q.effective_limit}`}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAdjustingResource(q.resource_key);
                      setAdjustmentValue(String(q.admin_adjustment));
                    }}
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {quotas.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  Nenhuma quota configurada para esta organização
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Audit Log */}
      {audit.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAudit(!showAudit)}
            className="gap-2 text-muted-foreground"
          >
            <History className="w-4 h-4" />
            {showAudit ? "Ocultar" : "Ver"} Histórico ({audit.length})
          </Button>

          {showAudit && (
            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
              {audit.map((entry) => (
                <div key={entry.id} className="text-xs p-2 bg-muted/50 rounded flex items-center justify-between">
                  <div>
                    <span className="font-medium">
                      {RESOURCE_LABELS[entry.resource_key] ?? entry.resource_key}
                    </span>{" "}
                    — {entry.field_changed}: {entry.old_value} → {entry.new_value}
                    <span className="text-muted-foreground ml-2">({entry.change_reason})</span>
                  </div>
                  <span className="text-muted-foreground whitespace-nowrap ml-4">
                    {new Date(entry.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Adjust Dialog */}
      <Dialog open={!!adjustingResource} onOpenChange={() => setAdjustingResource(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Ajustar Quota — {adjustingResource ? RESOURCE_LABELS[adjustingResource] ?? adjustingResource : ""}
            </DialogTitle>
            <DialogDescription>
              Defina o ajuste administrativo (positivo para adicionar, negativo para restringir)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Ajuste (admin_adjustment)</Label>
              <Input
                type="number"
                value={adjustmentValue}
                onChange={(e) => setAdjustmentValue(e.target.value)}
                placeholder="Ex: 5, -2, 0"
              />
              <p className="text-xs text-muted-foreground">
                Positivo = adicionar ao limite. Negativo = restringir. 0 = sem ajuste.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Motivo *</Label>
              <Textarea
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder="Ex: Cliente comprou pacote adicional, ajuste comercial..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustingResource(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={!adjustmentReason.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar Ajuste"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
