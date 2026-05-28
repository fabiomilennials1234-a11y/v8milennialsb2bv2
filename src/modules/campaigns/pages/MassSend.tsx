/**
 * /campaigns/mass-send — admin page para criar + monitorar blasts Uazapi.
 *
 * Minimal UI: form de criação (CSV paste ou lead selection) + dashboard
 * de jobs ativos com controls.
 */
import { useState } from "react";
import { useWhatsAppInstances } from "@/modules/communication/hooks/useWhatsAppInstances";
import {
  useMassSendJobs,
  useCreateMassSend,
  useControlMassSend,
  useRefreshMassSendStatus,
} from "@/modules/campaigns/hooks/useMassSendJobs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Pause,
  StopCircle,
  RefreshCw,
  Loader2,
  Send,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

type Row = { number: string; text?: string };

function parseCsv(input: string): Row[] {
  return input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [number, ...rest] = line.split(",");
      const text = rest.join(",").trim() || undefined;
      return { number: number.trim(), text };
    });
}

export default function MassSend() {
  const { data: instances = [] } = useWhatsAppInstances();
  const { data: jobs = [] } = useMassSendJobs();
  const createMut = useCreateMassSend();
  const controlMut = useControlMassSend();
  const refreshMut = useRefreshMassSendStatus();

  const [instanceId, setInstanceId] = useState<string>("");
  const [templateText, setTemplateText] = useState("");
  const [csv, setCsv] = useState("");
  const [delayMin, setDelayMin] = useState(5000);
  const [delayMax, setDelayMax] = useState(30000);
  const [scheduledFor, setScheduledFor] = useState("");

  const uazapiInstances = instances.filter((i) => i.provider === "uazapi");
  const recipients = parseCsv(csv);

  const handleSubmit = async () => {
    if (!instanceId || recipients.length === 0 || !templateText.trim()) {
      toast.error("Preencha instância, destinatários e template");
      return;
    }
    try {
      await createMut.mutateAsync({
        instance_id: instanceId,
        recipients,
        template_text: templateText,
        delay_min_ms: delayMin,
        delay_max_ms: delayMax,
        scheduled_for: scheduledFor || undefined,
      });
      toast.success(`Blast criado — ${recipients.length} destinatários na fila`);
      setCsv("");
      setTemplateText("");
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    }
  };

  const handleControl = async (
    jobId: string,
    action: "pause" | "resume" | "stop"
  ) => {
    try {
      await controlMut.mutateAsync({ job_id: jobId, action });
      toast.success(`Ação ${action} OK`);
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Envio em massa</h1>
        <p className="text-sm text-muted-foreground">
          Dispara blasts grandes via <code className="px-1 bg-muted rounded">/sender/advanced</code> Uazapi.
          Mensagens em fluxos IA devem usar automações (rotas diferentes).
        </p>
      </header>

      {uazapiInstances.length === 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <p className="text-sm">
              Nenhuma instância Uazapi encontrada. Blasts server-side requerem
              provider=uazapi.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Novo blast</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Instância</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma instância Uazapi" />
              </SelectTrigger>
              <SelectContent>
                {uazapiInstances.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.instance_name} — {i.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Template (texto da mensagem)</Label>
            <Textarea
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              rows={3}
              placeholder="Olá! Tenho uma oferta exclusiva pra você..."
            />
          </div>

          <div className="space-y-2">
            <Label>
              Destinatários ({recipients.length}) — 1 por linha (formato: <code>number,texto_opcional</code>)
            </Label>
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              placeholder="5511999999999,Olá João&#10;5511888888888&#10;5511777777777"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Delay min (ms)</Label>
              <Input
                type="number"
                value={delayMin}
                onChange={(e) => setDelayMin(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label>Delay max (ms)</Label>
              <Input
                type="number"
                value={delayMax}
                onChange={(e) => setDelayMax(Number(e.target.value))}
                min={delayMin}
              />
            </div>
            <div className="space-y-2">
              <Label>Agendar para</Label>
              <Input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={createMut.isPending || recipients.length === 0 || !instanceId}
            className="w-full"
          >
            {createMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Enviar para {recipients.length} destinatários
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Jobs ativos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum blast criado ainda.</p>
          ) : (
            jobs.map((job) => {
              const isActive = job.status === "running" || job.status === "queued";
              const pct = job.total_messages > 0
                ? Math.round((job.sent / job.total_messages) * 100)
                : 0;
              return (
                <div key={job.id} className="rounded-md border border-border/40 p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>
                        {job.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {job.sent}/{job.total_messages} enviadas, {job.failed} falhas
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refreshMut.mutate(job.id)}
                        disabled={refreshMut.isPending}
                        aria-label="Atualizar status"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                      {isActive && (
                        <>
                          {job.status === "running" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleControl(job.id, "pause")}
                              aria-label="Pausar"
                            >
                              <Pause className="h-3 w-3" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleControl(job.id, "resume")}
                              aria-label="Retomar"
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleControl(job.id, "stop")}
                            className="text-destructive"
                            aria-label="Parar"
                          >
                            <StopCircle className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                  <div className="text-xs text-muted-foreground">
                    Criado: {new Date(job.created_at).toLocaleString("pt-BR")}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
