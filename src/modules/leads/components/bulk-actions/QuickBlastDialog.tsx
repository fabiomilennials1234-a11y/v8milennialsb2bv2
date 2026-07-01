import { useMemo, useRef, useState } from "react";
import { Loader2, Send, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWhatsAppInstances } from "@/modules/communication";
import { useQuickBlast } from "@/modules/leads/hooks/useQuickBlast";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { UpgradeModal } from "@/shared/components/UpgradeModal";

interface QuickBlastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onDone?: () => void;
}

const CONNECTED = new Set(["open", "connected"]);

// Variables resolved per recipient by the server. Lead vars work on any board;
// carteira vars resolve only for Upsell/Carteira leads (empty otherwise).
const LEAD_VARS = [
  { token: "primeiro_nome", label: "Primeiro nome", sample: "Pedro" },
  { token: "nome", label: "Nome", sample: "Pedro Silva" },
  { token: "empresa", label: "Empresa", sample: "SacoEcoMulti" },
];
const CARTEIRA_VARS = [
  { token: "segmento", label: "Segmento", sample: "ouro" },
  { token: "ticket_medio", label: "Ticket médio", sample: "R$ 1.500,00" },
  { token: "dias_sem_pedido", label: "Dias sem pedido", sample: "30" },
  { token: "ltv", label: "LTV", sample: "R$ 9.000,00" },
];
const ALL_SAMPLES: Record<string, string> = Object.fromEntries(
  [...LEAD_VARS, ...CARTEIRA_VARS].map((v) => [v.token, v.sample]),
);

/** Sample-data preview — mirrors resolveBlastMessage: substitute variables with
 *  example values, then collapse each spintax {a|b|c} to its first option (the
 *  server randomizes per recipient). */
function previewMessage(template: string): string {
  const withVars = template.replace(/\{(\w+)\}/g, (_m, key: string) => ALL_SAMPLES[key] ?? "");
  return withVars.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, body: string) => body.split("|")[0]);
}

/**
 * Plan gate — disparo rápido é feature `whatsapp_bulk`. Wrapper pra não
 * condicionar a ordem dos hooks do dialog.
 */
export function QuickBlastDialog(props: QuickBlastDialogProps) {
  const orgFeatures = useOrgFeaturesOptional();
  const locked = orgFeatures ? !orgFeatures.hasFeature("whatsapp_bulk") : false;

  if (locked) {
    return (
      <UpgradeModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        featureLabel="Disparo em Massa"
        featureDescription="O envio de mensagens em lote não está disponível no seu plano atual."
      />
    );
  }
  return <QuickBlastDialogInner {...props} />;
}

function QuickBlastDialogInner({ open, onOpenChange, leadIds, onDone }: QuickBlastDialogProps) {
  const { data: instances = [] } = useWhatsAppInstances();
  const blast = useQuickBlast();

  const [message, setMessage] = useState("");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [instanceId, setInstanceId] = useState<string>("");
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(30);
  const [maxLeads, setMaxLeads] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string>(""); // datetime-local

  const connectedInstances = useMemo(
    () => instances.filter((i: any) => CONNECTED.has(i.status)),
    [instances],
  );
  const selectable = connectedInstances.length > 0 ? connectedInstances : instances;

  const canFire =
    message.trim().length > 0 &&
    !!instanceId &&
    delayMin >= 0 &&
    delayMax >= delayMin &&
    leadIds.length > 0 &&
    (scheduledFor === "" || new Date(scheduledFor).getTime() > Date.now()) &&
    !uploading &&
    !blast.isPending;

  function insertVariable(token: string) {
    const el = messageRef.current;
    const snippet = `{${token}}`;
    if (!el) {
      setMessage((m) => m + snippet);
      return;
    }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const next = message.slice(0, start) + snippet + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const preview = previewMessage(message);

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    setUploading(true);
    try {
      const path = `quick-blast/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type,
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (e) {
      toast.error(`Falha no upload: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleFire() {
    try {
      const res = await blast.mutateAsync({
        instance_id: instanceId,
        lead_ids: leadIds,
        message: message.trim(),
        delay_min_ms: Math.round(delayMin * 1000),
        delay_max_ms: Math.round(delayMax * 1000),
        max_leads: maxLeads ? Number(maxLeads) : undefined,
        image_url: imageUrl ?? undefined,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      });
      const { noPhone, duplicates, overCap } = res.skipped;
      const skippedParts = [
        noPhone ? `${noPhone} sem telefone` : null,
        duplicates ? `${duplicates} duplicados` : null,
        overCap ? `${overCap} acima do teto` : null,
      ].filter(Boolean);
      const verb = scheduledFor ? "agendado" : "iniciado";
      toast.success(
        `Disparo ${verb} para ${res.count} lead(s)` +
          (skippedParts.length ? ` — ${skippedParts.join(", ")} ignorados` : ""),
      );
      setMessage("");
      setImageUrl(null);
      setScheduledFor("");
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao iniciar disparo");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Disparo rápido</DialogTitle>
          <DialogDescription>
            {leadIds.length} lead(s) selecionados. Leads sem telefone e números duplicados são
            filtrados automaticamente; o teto da organização limita o volume.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="qb-message">Mensagem</Label>
            <Textarea
              id="qb-message"
              ref={messageRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escreva a mensagem do disparo…"
              rows={5}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {LEAD_VARS.map((v) => (
                <Button
                  key={v.token}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 text-xs"
                  onClick={() => insertVariable(v.token)}
                >
                  {v.label}
                </Button>
              ))}
              {CARTEIRA_VARS.map((v) => (
                <Button
                  key={v.token}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => insertVariable(v.token)}
                  title="Resolve apenas para leads da Carteira/Upsell"
                >
                  {v.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Variáveis claras valem em qualquer board. As de contorno (Carteira) só preenchem para
              leads da Carteira/Upsell — nos demais ficam vazias.
            </p>
            <p className="text-xs text-muted-foreground">
              Spintax: escreva <code className="rounded bg-muted px-1">{"{oi|olá|e aí}"}</code> e cada
              lead recebe uma das opções ao acaso — reduz risco de bloqueio.
            </p>
            {message.trim().length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-2.5">
                <p className="text-xs font-medium text-muted-foreground mb-1">Prévia (dados de exemplo)</p>
                <p className="text-sm whitespace-pre-wrap">{preview}</p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Instância</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a instância de envio" />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((i: any) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.instance_name ?? i.name ?? i.id}
                    {CONNECTED.has(i.status) ? "" : " (desconectada)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qb-min">Delay mín (s)</Label>
              <Input
                id="qb-min"
                type="number"
                min={0}
                value={delayMin}
                onChange={(e) => setDelayMin(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qb-max">Delay máx (s)</Label>
              <Input
                id="qb-max"
                type="number"
                min={0}
                value={delayMax}
                onChange={(e) => setDelayMax(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qb-cap">Máx leads</Label>
              <Input
                id="qb-cap"
                type="number"
                min={1}
                placeholder="teto"
                value={maxLeads}
                onChange={(e) => setMaxLeads(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Imagem (opcional)</Label>
            {imageUrl ? (
              <div className="flex items-center gap-3 rounded-md border border-border p-2">
                <img src={imageUrl} alt="anexo" className="h-12 w-12 rounded object-cover" />
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  Imagem anexada — a mensagem vira legenda
                </span>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setImageUrl(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-primary">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                {uploading ? "Enviando…" : "Anexar imagem"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImageUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qb-schedule">Agendar (opcional)</Label>
            <Input
              id="qb-schedule"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {scheduledFor
                ? "Será disparado na data/hora escolhida."
                : "Vazio = dispara agora, de supetão."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={blast.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleFire} disabled={!canFire}>
            {blast.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            {scheduledFor ? "Agendar" : "Disparar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
