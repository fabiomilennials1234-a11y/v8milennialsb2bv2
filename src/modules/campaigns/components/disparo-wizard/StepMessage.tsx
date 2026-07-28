/**
 * StepMessage — "Mensagem" (#907).
 *
 * Decisions: what the blast says, an optional single attachment, and whether
 * anti-ban protection is on (default yes). The attachment is validated live with
 * the real `validateBlastMedia` pure guard. The right-hand preview renders the
 * message as a real sample Lead will receive it (WhatsApp bubble), resolved by
 * the pure `resolvePreview`; the operator cycles the sample to spot-check
 * personalization. Video attachments surface a ban-risk note (decision Q13).
 */
import { useRef, useState } from "react";
import {
  Paperclip,
  X,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Check,
  CheckCheck,
} from "lucide-react";
import {
  validateBlastMedia,
  BLAST_MEDIA_LIMITS_MB,
  type BlastMediaType,
} from "@/modules/communication";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { StepHeader } from "./StepHeader";
import type { DisparoDraft } from "./wizard-machine";
import { resolvePreview } from "./message-preview";
import { MOCK_PREVIEW_SAMPLES } from "./mock-disparo-data";

const VARIABLES = ["{{primeiro_nome}}", "{{nome}}", "{{empresa}}", "{{segmento}}"];

/** Map a File's MIME type onto a blast media kind, or null if unsupported. */
function mediaTypeOf(file: File): BlastMediaType | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf") return "pdf";
  return null;
}

interface StepMessageProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

export function StepMessage({ draft, patch }: StepMessageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const sample = MOCK_PREVIEW_SAMPLES[sampleIdx % MOCK_PREVIEW_SAMPLES.length];

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    const type = mediaTypeOf(file);
    if (!type) {
      patch({ media: null, mediaError: "Tipo de mídia não suportado." });
      return;
    }
    const result = validateBlastMedia(type, file.size);
    if (!result.ok) {
      patch({ media: null, mediaError: result.error });
      return;
    }

    // The backend dispatch (blast-plan-create) sends an `image_url`, so images
    // are uploaded to storage now and the public URL travels on the draft. Other
    // media kinds keep their metadata (their transport lands with #901 backend).
    if (type !== "image") {
      patch({ media: { type, sizeBytes: file.size, name: file.name, url: null }, mediaError: null });
      return;
    }

    setUploading(true);
    patch({ media: { type, sizeBytes: file.size, name: file.name, url: null }, mediaError: null });
    try {
      const path = `disparo/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      patch({
        media: { type, sizeBytes: file.size, name: file.name, url: data.publicUrl },
        mediaError: null,
      });
    } catch (err) {
      patch({ media: null, mediaError: (err as Error).message ?? "Falha ao enviar a imagem." });
    } finally {
      setUploading(false);
    }
  };

  const insertVar = (token: string) =>
    patch({
      message: `${draft.message}${draft.message.endsWith(" ") || draft.message === "" ? "" : " "}${token} `,
    });

  const preview = resolvePreview(draft.message, sample);

  return (
    <div className="space-y-7">
      <StepHeader
        kicker="Passo 2 de 6"
        title="O que você quer dizer?"
        subtitle="Escreva a mensagem. Use variáveis para personalizar cada contato pelo nome ou empresa."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Composer */}
        <div className="space-y-5">
          <div className="space-y-3">
            <Textarea
              value={draft.message}
              onChange={(e) => patch({ message: e.target.value })}
              placeholder="Olá {{primeiro_nome}}, tudo bem? Passando para..."
              rows={6}
              className="resize-none rounded-xl border-border/70 bg-card text-sm leading-relaxed focus-visible:ring-primary/30"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Inserir:</span>
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Attachment */}
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,audio/*,video/*,application/pdf"
              className="hidden"
              onChange={onPickFile}
            />
            {draft.media ? (
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Paperclip className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{draft.media.name}</p>
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {draft.media.type} · {(draft.media.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                    {uploading && (
                      <span className="flex items-center gap-1 normal-case text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" /> enviando…
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => patch({ media: null, mediaError: null })}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Paperclip className="h-4 w-4" />
                Anexar imagem, áudio, vídeo ou PDF
              </button>
            )}

            {draft.mediaError ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {draft.mediaError}
              </p>
            ) : draft.media?.type === "video" ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                Vídeo em massa aumenta o risco de bloqueio — prefira imagem ou link quando der.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground/70">
                Limites: imagem {BLAST_MEDIA_LIMITS_MB.image} MB · áudio {BLAST_MEDIA_LIMITS_MB.audio} MB ·
                vídeo {BLAST_MEDIA_LIMITS_MB.video} MB · PDF {BLAST_MEDIA_LIMITS_MB.pdf} MB
              </p>
            )}
          </div>

          {/* Anti-ban */}
          <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-4">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Proteção anti-bloqueio</p>
              <p className="text-xs text-muted-foreground">
                Varia palavras e o tempo entre envios automaticamente, pra proteger seus números.
              </p>
            </div>
            <Switch
              checked={draft.antiBan}
              onCheckedChange={(v) => patch({ antiBan: v })}
            />
          </div>
        </div>

        {/* Live WhatsApp preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Como o cliente vai ver
            </p>
            <button
              type="button"
              onClick={() => setSampleIdx((i) => i + 1)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              outro cliente
            </button>
          </div>

          <div className="rounded-2xl border border-border/70 bg-[hsl(140_8%_12%)] p-4">
            <p className="mb-3 text-xs font-medium text-foreground">
              {sample.nome}
              <span className="text-muted-foreground"> · {sample.empresa}</span>
            </p>
            <div className="flex justify-end">
              <div className="relative max-w-[85%] rounded-xl rounded-tr-sm bg-[hsl(110_45%_28%)] px-3 py-2 text-sm text-white shadow-sm">
                {draft.media && (
                  <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-1 text-[11px] text-white/80">
                    <Paperclip className="h-3 w-3" />
                    {draft.media.type}
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words leading-snug">
                  {preview || (
                    <span className="text-white/50">sua mensagem aparece aqui…</span>
                  )}
                </p>
                <span className="mt-1 flex items-center justify-end gap-0.5 text-[10px] text-white/60">
                  10:32
                  <CheckCheck className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <Check className="h-3 w-3" />
            Pré-visualizando com um cliente real do seu público.
          </p>
        </div>
      </div>
    </div>
  );
}
