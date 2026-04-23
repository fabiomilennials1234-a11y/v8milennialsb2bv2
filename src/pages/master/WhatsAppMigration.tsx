/**
 * WhatsAppMigration — admin master-only dashboard.
 *
 * Lista 30+ orgs com status de migração, botão "Migrar" por org (abre
 * RepairingWizard no contexto daquela org), toggle provider_override
 * (kill-switch).
 *
 * Access: só master admin (useMasterAuth).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw } from "lucide-react";
import { RepairingWizard } from "@/components/whatsapp-migration/RepairingWizard";
import {
  useSetMigrationStatus,
  useSetProviderOverride,
  type MigrationStatus,
} from "@/hooks/useOrgWhatsAppMigration";
import { toast } from "sonner";

type OrgRow = {
  id: string;
  name: string;
  whatsapp_provider_override: string | null;
  whatsapp_migration_status: MigrationStatus;
  whatsapp_migration_completed_at: string | null;
};

function statusBadge(status: MigrationStatus) {
  const map: Record<MigrationStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    not_started: { label: "Não iniciada", variant: "outline" },
    pending: { label: "Pendente", variant: "secondary" },
    in_progress: { label: "Em progresso", variant: "secondary" },
    migrated: { label: "Migrada", variant: "default" },
    failed: { label: "Falhou", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export default function WhatsAppMigration() {
  const qc = useQueryClient();
  const [wizardOrgId, setWizardOrgId] = useState<string | null>(null);
  const setStatus = useSetMigrationStatus();
  const setOverride = useSetProviderOverride();

  const { data: orgs, isLoading } = useQuery({
    queryKey: ["master_whatsapp_migration_list"],
    queryFn: async (): Promise<OrgRow[]> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, whatsapp_provider_override, whatsapp_migration_status, whatsapp_migration_completed_at")
        .order("name");
      if (error) throw error;
      return (data ?? []) as OrgRow[];
    },
  });

  const handleMarkPending = async (orgId: string) => {
    try {
      await setStatus.mutateAsync({ organizationId: orgId, status: "pending" });
      toast.success("Org marcada como pendente. Banner vai aparecer no próximo login.");
      qc.invalidateQueries({ queryKey: ["master_whatsapp_migration_list"] });
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    }
  };

  const handleOverride = async (orgId: string, value: string) => {
    const override = value === "none" ? null : (value as "uazapi" | "evolution");
    try {
      await setOverride.mutateAsync({ organizationId: orgId, override });
      toast.success(override ? `Override setado: ${override}` : "Override removido");
      qc.invalidateQueries({ queryKey: ["master_whatsapp_migration_list"] });
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const total = orgs?.length ?? 0;
  const migrated = orgs?.filter((o) => o.whatsapp_migration_status === "migrated").length ?? 0;
  const pending = orgs?.filter((o) => o.whatsapp_migration_status === "pending").length ?? 0;
  const failed = orgs?.filter((o) => o.whatsapp_migration_status === "failed").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Migração WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Gerencia rollout Evolution→Uazapi em {total} organizações.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs">Total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{total}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs">Migradas</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-green-600">{migrated}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs">Pendentes</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-amber-600">{pending}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs">Falharam</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-destructive">{failed}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Organizações</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Override</TableHead>
                <TableHead>Concluída em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs?.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>{statusBadge(org.whatsapp_migration_status)}</TableCell>
                  <TableCell>
                    <Select
                      value={org.whatsapp_provider_override ?? "none"}
                      onValueChange={(v) => handleOverride(org.id, v)}
                    >
                      <SelectTrigger className="w-[130px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— nenhum —</SelectItem>
                        <SelectItem value="uazapi">uazapi</SelectItem>
                        <SelectItem value="evolution">evolution (fallback)</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {org.whatsapp_migration_completed_at
                      ? new Date(org.whatsapp_migration_completed_at).toLocaleString("pt-BR")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {org.whatsapp_migration_status === "not_started" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleMarkPending(org.id)}
                      >
                        Agendar
                      </Button>
                    )}
                    {(org.whatsapp_migration_status === "pending" ||
                      org.whatsapp_migration_status === "failed") && (
                      <Button
                        size="sm"
                        onClick={() => setWizardOrgId(org.id)}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Migrar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {wizardOrgId && (
        <RepairingWizard
          open={!!wizardOrgId}
          onOpenChange={(o) => !o && setWizardOrgId(null)}
          organizationId={wizardOrgId}
        />
      )}
    </div>
  );
}
