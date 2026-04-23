/**
 * HistorySyncPanel — lista de jobs ativos + CTA para criar novo.
 *
 * Consumido no WhatsAppSettings como collapse ou section "Histórico".
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Info } from "lucide-react";
import { HistorySyncDialog } from "./HistorySyncDialog";
import { SyncProgressCard } from "./SyncProgressCard";
import { useHistorySyncJobs } from "@/hooks/useHistorySyncJobs";

interface Props {
  instanceId: string;
}

export function HistorySyncPanel({ instanceId }: Props) {
  const { data: jobs = [], isLoading } = useHistorySyncJobs({ instanceId });
  const [open, setOpen] = useState(false);

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const recent = jobs.filter((j) => j.status !== "queued" && j.status !== "running").slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Histórico de mensagens</h3>
          <p className="text-xs text-muted-foreground">
            Importa mensagens antigas do WhatsApp via Uazapi.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Download className="h-3.5 w-3.5 mr-2" />
          Importar
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : active.length === 0 && recent.length === 0 ? (
        <div className="rounded-md border border-border/40 bg-muted/20 p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Nenhum job de import executado. Clique em "Importar" para puxar histórico.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {active.map((job) => (
            <SyncProgressCard key={job.id} job={job} />
          ))}
          {recent.length > 0 && active.length > 0 && (
            <div className="pt-2 text-xs text-muted-foreground">Jobs recentes</div>
          )}
          {recent.map((job) => (
            <SyncProgressCard key={job.id} job={job} />
          ))}
        </div>
      )}

      <HistorySyncDialog
        instanceId={instanceId}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
