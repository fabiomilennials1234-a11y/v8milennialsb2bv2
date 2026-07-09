/**
 * MessageMedia — componentes de mídia inline dentro de um MessageBubble.
 *
 * Exporta:
 * - MessageImage: imagem lazy-load com preview on-click
 * - MessageVideo: vídeo com fallback de download
 * - MessageDocument: link de download com ícone por extensão
 *
 * Extraído de WhatsAppChat.tsx (C4).
 */
import { useState } from "react";
import { Loader2, FileImage, FileVideo, FileText, File, FileAudio, Download, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── ExpiredMedia ─────────────────────────────────────────────────────────────

export type ExpiredMediaKind = "image" | "video" | "audio" | "document" | "file";

/**
 * Maps a whatsapp_messages.message_type to the icon bucket used by the expired
 * media placeholder. Pure — unit-tested.
 */
export function resolveExpiredMediaKind(messageType: string | null | undefined): ExpiredMediaKind {
  switch (messageType) {
    case "image":
    case "album":
    case "motion_photo":
    case "sticker":
    case "1p_sticker":
    case "user_created_sticker":
    case "avatar_sticker":
      return "image";
    case "video":
    case "ptv":
    case "gif":
    case "motion_video":
      return "video";
    case "audio":
    case "ptt":
      return "audio";
    case "document":
      return "document";
    default:
      return "file";
  }
}

const EXPIRED_KIND_ICON: Record<ExpiredMediaKind, typeof FileImage> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  file: File,
};

const EXPIRED_KIND_LABEL: Record<ExpiredMediaKind, string> = {
  image: "Imagem expirada",
  video: "Vídeo expirado",
  audio: "Áudio expirado",
  document: "Documento expirado",
  file: "Mídia expirada",
};

/**
 * Graceful placeholder for media purged by the 30-day retention job. Renders a
 * type-specific icon + label and NEVER issues a broken <img>/<video>/<audio>
 * request (the underlying media_url is already NULL by the time this shows).
 */
export function ExpiredMedia({ kind }: { kind: ExpiredMediaKind }) {
  const Icon = EXPIRED_KIND_ICON[kind];
  return (
    <div
      className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-muted/40 text-muted-foreground max-w-[240px]"
      role="note"
      aria-label={EXPIRED_KIND_LABEL[kind]}
    >
      <div className="relative shrink-0">
        <Icon className="w-6 h-6 opacity-70" />
        <Clock className="w-3 h-3 absolute -bottom-0.5 -right-0.5 bg-background rounded-full" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium leading-tight">{EXPIRED_KIND_LABEL[kind]}</p>
        <p className="text-[10px] text-muted-foreground/70 leading-tight">
          Retida por 30 dias
        </p>
      </div>
    </div>
  );
}

// ─── MessageImage ─────────────────────────────────────────────────────────────

interface MessageImageProps {
  src: string;
  onPreview: () => void;
}

export function MessageImage({ src, onPreview }: MessageImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-full max-w-[192px] h-32 bg-muted/50 rounded flex items-center justify-center">
        <FileImage className="w-8 h-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="relative cursor-pointer max-w-full"
      onClick={onPreview}
      role="button"
      tabIndex={0}
      aria-label="Ver imagem em tamanho completo"
      onKeyDown={(e) => e.key === "Enter" && onPreview()}
    >
      {!loaded && (
        <div className="w-full max-w-[192px] h-32 bg-muted/50 rounded flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt="Imagem da conversa"
        className={cn(
          "max-w-full sm:max-w-[240px] max-h-[300px] rounded object-cover",
          !loaded && "hidden",
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
}

// ─── MessageVideo ─────────────────────────────────────────────────────────────

interface MessageVideoProps {
  src: string;
}

export function MessageVideo({ src }: MessageVideoProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="w-full max-w-[192px] h-32 bg-muted/50 rounded flex flex-col items-center justify-center gap-2">
        <FileVideo className="w-8 h-8 text-muted-foreground" />
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Download className="w-3 h-3" />
          Baixar vídeo
        </a>
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      className="max-w-full sm:max-w-[240px] max-h-[300px] rounded"
      onError={() => setError(true)}
    >
      Seu navegador não suporta vídeos.
    </video>
  );
}

// ─── MessageDocument ──────────────────────────────────────────────────────────

interface MessageDocumentProps {
  src: string;
  fileName?: string;
  isOutgoing: boolean;
}

function getFileIcon(displayName: string) {
  const ext = displayName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
    case "doc":
    case "docx":
    case "xls":
    case "xlsx":
      return <FileText className="w-8 h-8" />;
    default:
      return <File className="w-8 h-8" />;
  }
}

export function MessageDocument({ src, fileName, isOutgoing }: MessageDocumentProps) {
  // Tentar extrair nome do arquivo da URL se não fornecido
  const displayName = fileName || src.split("/").pop() || "Documento";

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-colors w-full max-w-full min-w-0 overflow-hidden",
        isOutgoing
          ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
          : "bg-primary/10 hover:bg-primary/20",
      )}
    >
      <div
        className={cn(
          "p-2 rounded shrink-0",
          isOutgoing ? "bg-primary-foreground/20" : "bg-primary/20",
        )}
      >
        {getFileIcon(displayName)}
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
          <Download className="w-3 h-3 shrink-0" />
          <span className="truncate">Clique para baixar</span>
        </p>
      </div>
    </a>
  );
}
