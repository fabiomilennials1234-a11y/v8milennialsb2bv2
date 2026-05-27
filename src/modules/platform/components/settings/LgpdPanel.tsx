/**
 * LgpdPanel — LGPD/GDPR admin panel.
 * Consent records, data retention config, data export requests.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Download,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
  User,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useLeadConsents,
  useRecordConsent,
  useRevokeConsent,
  type ConsentType,
} from "@/modules/platform/hooks/useConsent";
import {
  useDataExportRequests,
  useRequestDataExport,
  useExportLeadData,
  type ExportStatus,
} from "@/hooks/useDataExport";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Consent labels ────────────────────────────────────────────

const CONSENT_LABELS: Record<ConsentType, string> = {
  marketing_email: "Email marketing",
  marketing_whatsapp: "WhatsApp marketing",
  marketing_sms: "SMS marketing",
  data_processing: "Processamento de dados",
  data_sharing: "Compartilhamento de dados",
};

const STATUS_CONFIG: Record<ExportStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "Pendente", icon: Clock, className: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  processing: { label: "Processando", icon: Loader2, className: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  completed: { label: "Concluido", icon: CheckCircle, className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  failed: { label: "Falhou", icon: XCircle, className: "text-red-500 bg-red-500/10 border-red-500/20" },
};

// ── Component ─────────────────────────────────────────────────

export function LgpdPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          LGPD / Privacidade
        </h3>
        <p className="text-sm text-muted-foreground">
          Gerencie consentimentos, retencao de dados e solicitacoes de exportacao
        </p>
      </div>

      <Tabs defaultValue="consent" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="consent">Consentimentos</TabsTrigger>
          <TabsTrigger value="retention">Retencao</TabsTrigger>
          <TabsTrigger value="exports">Exportacoes</TabsTrigger>
        </TabsList>

        <TabsContent value="consent" className="mt-4">
          <ConsentViewer />
        </TabsContent>

        <TabsContent value="retention" className="mt-4">
          <RetentionConfig />
        </TabsContent>

        <TabsContent value="exports" className="mt-4">
          <ExportRequests />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Consent Viewer ────────────────────────────────────────────

function ConsentViewer() {
  const [leadId, setLeadId] = useState("");
  const { data: consents = [], isLoading } = useLeadConsents(leadId || null);
  const revokeConsent = useRevokeConsent();

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="ID do lead para consultar consentimentos..."
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {!leadId ? (
          <div className="text-center py-8">
            <User className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Insira o ID de um lead para ver consentimentos
            </p>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : consents.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground">Nenhum consentimento registrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {consents.map((consent) => (
              <motion.div
                key={consent.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  {consent.granted && !consent.revoked_at ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {CONSENT_LABELS[consent.consent_type] || consent.consent_type}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Fonte: {consent.source} &middot;{" "}
                      {format(new Date(consent.created_at), "dd/MM/yyyy HH:mm")}
                    </p>
                  </div>
                </div>

                {consent.granted && !consent.revoked_at && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive"
                    onClick={() => revokeConsent.mutate({ id: consent.id, leadId })}
                    disabled={revokeConsent.isPending}
                  >
                    Revogar
                  </Button>
                )}

                {consent.revoked_at && (
                  <Badge variant="outline" className="text-[10px] text-red-500">
                    Revogado {format(new Date(consent.revoked_at), "dd/MM")}
                  </Badge>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Retention Config ──────────────────────────────────────────

function RetentionConfig() {
  const [inactiveMonths, setInactiveMonths] = useState(24);
  const [autoAnonymize, setAutoAnonymize] = useState(false);

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex items-center gap-4 p-4 rounded-lg border border-border">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Politica de retencao define quando dados de leads inativos sao anonimizados automaticamente.
          </p>
        </div>

        <div className="grid gap-4 max-w-md">
          <div className="grid gap-2">
            <Label>Meses de inatividade para considerar retencao</Label>
            <Input
              type="number"
              min={6}
              max={120}
              value={inactiveMonths}
              onChange={(e) => setInactiveMonths(Number(e.target.value) || 24)}
            />
            <p className="text-xs text-muted-foreground">
              Leads sem interacao ha esse periodo serao candidatos a anonimizacao
            </p>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="space-y-0.5">
              <Label>Anonimizacao automatica</Label>
              <p className="text-xs text-muted-foreground">
                Anonimizar dados pessoais automaticamente apos o periodo
              </p>
            </div>
            <Switch
              checked={autoAnonymize}
              onCheckedChange={setAutoAnonymize}
            />
          </div>

          <Button className="w-fit" disabled>
            Salvar politica
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Export Requests ────────────────────────────────────────────

function ExportRequests() {
  const { data: requests = [], isLoading } = useDataExportRequests();
  const requestExport = useRequestDataExport();
  const exportLeadData = useExportLeadData();
  const [exportLeadId, setExportLeadId] = useState("");

  const handleExport = () => {
    if (!exportLeadId.trim()) return;
    requestExport.mutate({
      lead_id: exportLeadId.trim(),
      export_type: "full_export",
    });
    setExportLeadId("");
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {/* Quick export */}
        <div className="flex gap-3">
          <Input
            placeholder="ID do lead para exportar dados..."
            value={exportLeadId}
            onChange={(e) => setExportLeadId(e.target.value)}
            className="flex-1"
          />
          <Button
            onClick={handleExport}
            disabled={!exportLeadId.trim() || requestExport.isPending}
            className="gap-2"
          >
            {requestExport.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Exportar dados do lead
          </Button>
        </div>

        {/* Requests list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-6">
            <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma solicitacao de exportacao</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => {
              const status = STATUS_CONFIG[req.status];
              const StatusIcon = status.icon;

              return (
                <motion.div
                  key={req.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon className={cn("w-4 h-4", status.className.split(" ")[0], req.status === "processing" && "animate-spin")} />
                    <div>
                      <p className="text-sm font-medium">
                        {req.export_type === "full_export" ? "Exportacao completa" : req.export_type === "erasure" ? "Exclusao" : "Portabilidade"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(req.created_at), "dd/MM/yyyy HH:mm")}
                        {req.lead_id && ` · Lead: ${req.lead_id.slice(0, 8)}...`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-[10px]", status.className)}>
                      {status.label}
                    </Badge>
                    {req.status === "completed" && req.file_url && (
                      <a href={req.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="gap-1 text-xs">
                          <Download className="w-3 h-3" />
                          Baixar
                        </Button>
                      </a>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
