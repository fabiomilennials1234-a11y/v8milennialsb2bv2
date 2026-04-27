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
import { Loader2, FileImage, FileVideo, FileText, File, Download } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <div className="w-48 h-32 bg-muted/50 rounded flex items-center justify-center">
        <FileImage className="w-8 h-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="relative cursor-pointer"
      onClick={onPreview}
      role="button"
      tabIndex={0}
      aria-label="Ver imagem em tamanho completo"
      onKeyDown={(e) => e.key === "Enter" && onPreview()}
    >
      {!loaded && (
        <div className="w-48 h-32 bg-muted/50 rounded flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt="Imagem da conversa"
        className={cn(
          "max-w-[240px] max-h-[300px] rounded object-cover",
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
      <div className="w-48 h-32 bg-muted/50 rounded flex flex-col items-center justify-center gap-2">
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
      className="max-w-[240px] max-h-[300px] rounded"
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
        "flex items-center gap-3 p-3 rounded-lg transition-colors min-w-[200px]",
        isOutgoing
          ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
          : "bg-primary/10 hover:bg-primary/20",
      )}
    >
      <div
        className={cn(
          "p-2 rounded",
          isOutgoing ? "bg-primary-foreground/20" : "bg-primary/20",
        )}
      >
        {getFileIcon(displayName)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Download className="w-3 h-3" />
          Clique para baixar
        </p>
      </div>
    </a>
  );
}
