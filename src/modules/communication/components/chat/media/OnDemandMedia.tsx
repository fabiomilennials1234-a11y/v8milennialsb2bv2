/**
 * OnDemandMedia — carrega sob clique a mídia que o navegador não abre sozinho.
 *
 * Mídia de grupo e documento 1:1 com download falho ficam com o link
 * criptografado da CDN do WhatsApp (Chamado 6dfcae6d). O servidor não baixa
 * mídia de grupo (gate de custo de 10/08), então o download acontece aqui, no
 * clique, pelo mesmo `downloadMedia` que o áudio e o botão Baixar já usam.
 *
 * Qualquer outra URL (Storage, blob, http comum) passa direto para o filho.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Download, FileImage, FileText, FileVideo, Loader2, type LucideIcon } from "lucide-react";
import { downloadMedia } from "@/modules/communication/lib/whatsappApi";
import { base64ToBlob, isWhatsAppCdnUrl } from "@/modules/communication/lib/whatsappMediaUrl";

export type OnDemandMediaKind = "image" | "video" | "document";

const KIND_UI: Record<OnDemandMediaKind, { label: string; Icon: LucideIcon }> = {
  image: { label: "Carregar imagem", Icon: FileImage },
  video: { label: "Carregar vídeo", Icon: FileVideo },
  document: { label: "Carregar documento", Icon: FileText },
};

interface OnDemandMediaProps {
  kind: OnDemandMediaKind;
  src: string;
  instanceId?: string | null;
  messageId?: string | null;
  /** Recebe a URL utilizável: `src` original, ou o blob depois do clique. */
  children: (url: string) => ReactNode;
}

type Status = "idle" | "loading" | "error";

export function OnDemandMedia({ kind, src, instanceId, messageId, children }: OnDemandMediaProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    if (!instanceId || !messageId) return;
    setStatus("loading");
    try {
      const { base64, mimetype } = await downloadMedia(instanceId, messageId);
      if (!base64) throw new Error("empty_media");
      const url = URL.createObjectURL(base64ToBlob(base64, mimetype));
      if (!mountedRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      blobRef.current = url;
      setBlobUrl(url);
      setStatus("idle");
    } catch (err) {
      console.warn("[OnDemandMedia] download failed:", err);
      if (mountedRef.current) setStatus("error");
    }
  }, [instanceId, messageId]);

  if (blobUrl) return <>{children(blobUrl)}</>;
  if (!isWhatsAppCdnUrl(src) || !instanceId || !messageId) return <>{children(src)}</>;

  const { label, Icon } = KIND_UI[kind];
  const loading = status === "loading";

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-muted/40 hover:bg-muted/60 text-foreground transition-colors disabled:opacity-60 max-w-[240px]"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <Icon className="w-5 h-5 shrink-0 opacity-70" />}
        <span className="text-xs font-medium">{status === "error" ? "Tentar de novo" : label}</span>
        {!loading && <Download className="w-3.5 h-3.5 shrink-0 opacity-60" />}
      </button>
      {status === "error" && (
        <p role="alert" className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Não foi possível carregar.
        </p>
      )}
    </div>
  );
}
