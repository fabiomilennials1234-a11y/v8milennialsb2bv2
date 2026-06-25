/**
 * StepMessage — "Mensagem" (#904 shell).
 *
 * One decision: what the blast says (+ an optional single attachment). The
 * attachment is validated live with the real `validateBlastMedia` pure guard
 * (size/type ceilings) so the wizard rejects oversized files at pick time.
 * The rich composer (templates, variable preview) is TODO(#907).
 */
import { useRef } from "react";
import { Paperclip, X, AlertTriangle } from "lucide-react";
import {
  validateBlastMedia,
  BLAST_MEDIA_LIMITS_MB,
  type BlastMediaType,
} from "@/modules/communication";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { StepHeader } from "./StepHeader";
import type { DisparoDraft } from "./wizard-machine";

const VARIABLES = ["{{nome}}", "{{empresa}}", "{{saudacao}}"];

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

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    patch({
      media: { type, sizeBytes: file.size, name: file.name },
      mediaError: null,
    });
  };

  const insertVar = (token: string) =>
    patch({ message: `${draft.message}${draft.message.endsWith(" ") || draft.message === "" ? "" : " "}${token} ` });

  return (
    <div className="space-y-7">
      <StepHeader
        kicker="Passo 2 de 5"
        title="O que você quer dizer?"
        subtitle="Escreva a mensagem. Use variáveis para personalizar cada contato pelo nome ou empresa."
      />

      <div className="space-y-3">
        <Textarea
          value={draft.message}
          onChange={(e) => patch({ message: e.target.value })}
          placeholder="Olá {{nome}}, tudo bem? Passando para..."
          rows={6}
          className="resize-none rounded-xl border-border/70 bg-card text-sm leading-relaxed focus-visible:ring-primary/30"
        />

        <div className="flex flex-wrap items-center gap-1.5">
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
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {draft.media.type} · {(draft.media.sizeBytes / (1024 * 1024)).toFixed(1)} MB
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
        ) : (
          <p className="text-[11px] text-muted-foreground/70">
            Limites: imagem {BLAST_MEDIA_LIMITS_MB.image} MB · áudio {BLAST_MEDIA_LIMITS_MB.audio} MB ·
            vídeo {BLAST_MEDIA_LIMITS_MB.video} MB · PDF {BLAST_MEDIA_LIMITS_MB.pdf} MB
          </p>
        )}
      </div>
    </div>
  );
}
