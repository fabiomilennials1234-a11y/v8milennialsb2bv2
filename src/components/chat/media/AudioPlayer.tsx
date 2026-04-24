/**
 * AudioPlayer — reproduz mensagens de áudio do WhatsApp.
 *
 * Lida com:
 * - URLs do bucket Storage que passam pelo proxy stream-media (requer Authorization)
 * - Fallback de conversão WebM/OGG → MP3 para compatibilidade Safari
 * - Gerenciamento de blob URLs com cleanup no unmount
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { convertAudioBlobToMp3 } from "@/lib/audioToMp3";

// Edge Function exige Authorization; <audio src="..."> não envia header → 401. Resolvemos via fetch com token e blob.
const STREAM_MEDIA_PATH = "/functions/v1/stream-media";

/**
 * Para áudios no bucket "media" do Supabase, usa a Edge Function stream-media como proxy.
 * Evita CORS: o navegador recebe o áudio da mesma origem (Supabase Functions com CORS),
 * em vez de pedir direto ao Storage (que pode bloquear por CORS).
 */
export function getAudioPlaybackUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl?.trim()) return mediaUrl;
  // Remover query e fragment para não enviar lixo ao stream-media
  const urlWithoutQuery = mediaUrl.split("?")[0].split("#")[0];
  const match = urlWithoutQuery.match(/\/object\/public\/media\/(.+)$/);
  if (!match) return mediaUrl;
  const path = match[1].replace(/\/$/, "");
  if (!path.startsWith("whatsapp-media/")) return mediaUrl;
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/stream-media?path=${encodeURIComponent(path)}`;
}

interface AudioPlayerProps {
  src: string;
  isOutgoing: boolean;
}

export function AudioPlayer({ src, isOutgoing: _isOutgoing }: AudioPlayerProps) {
  const [error, setError] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const conversionAttemptedRef = useRef(false);
  const retryWithNewBlobUrlRef = useRef(false);
  const rawBlobRef = useRef<Blob | null>(null);

  const isStreamMediaUrl = src.includes(STREAM_MEDIA_PATH);
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  const isValidSrc = src && (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:"));

  /**
   * Inferir tipo de áudio pela extensão da URL (funciona com stream-media?path=...file.mp3)
   */
  const inferAudioType = useCallback((url: string): string => {
    const ext = url.split(".").pop()?.split("?")[0]?.toLowerCase() || "";
    const typeMap: Record<string, string> = {
      mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg",
      webm: "audio/webm", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav",
    };
    return typeMap[ext] || "audio/ogg";
  }, []);

  /**
   * Garantir que o blob tenha um Content-Type de áudio correto.
   * Se o tipo for genérico (application/octet-stream ou vazio), infere pela URL.
   */
  const ensureBlobType = useCallback(async (blob: Blob, url: string): Promise<Blob> => {
    const type = (blob.type || "").toLowerCase();
    if (!type || type === "application/octet-stream") {
      const inferred = inferAudioType(url);
      return new Blob([await blob.arrayBuffer()], { type: inferred });
    }
    return blob;
  }, [inferAudioType]);

  // Etapa 1: Baixar o blob do stream-media com Authorization e servir com tipo correto
  // NÃO tenta converter — deixa o navegador reproduzir o formato original primeiro.
  useEffect(() => {
    if (!isStreamMediaUrl || !anonKey?.trim() || !src) return;
    let cancelled = false;
    conversionAttemptedRef.current = false;
    retryWithNewBlobUrlRef.current = false;
    rawBlobRef.current = null;
    setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setError(false);
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(src, {
          method: "GET",
          headers: { Authorization: `Bearer ${anonKey}` },
          credentials: "omit",
        });
        if (!res.ok) {
          let detail = "";
          try {
            const json = await res.json() as { error?: string; code?: string };
            detail = json?.code ? ` code=${json.code}` : "";
            if (json?.error) detail += ` ${json.error}`;
          } catch {
            detail = await res.text().then((t) => t.slice(0, 200)).catch(() => "");
          }
          throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
        }
        let blob = await res.blob();
        if (cancelled) return;

        // Corrigir tipo genérico para que o navegador saiba decodificar; MP3 deve ser audio/mpeg
        blob = await ensureBlobType(blob, src);
        if (cancelled) return;
        if (blob.size === 0) {
          setLoading(false);
          setError(true);
          return;
        }
        rawBlobRef.current = blob;

        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setLoading(false);
        setError(true);
      }
    })();

    return () => {
      cancelled = true;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [src, isStreamMediaUrl, anonKey, ensureBlobType]);

  // Resetar ao trocar de src (não-stream-media)
  useEffect(() => {
    if (isStreamMediaUrl) return;
    setError(false);
    setLoading(false);
    conversionAttemptedRef.current = false;
    retryWithNewBlobUrlRef.current = false;
    rawBlobRef.current = null;
    setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, [src, isStreamMediaUrl]);

  // Etapa 2 (fallback): Se o <audio> disparar erro, tentar novo blob URL (Safari) ou converter para MP3
  const handleError = useCallback(async () => {
    if (!isValidSrc) {
      setError(true);
      return;
    }

    const blob = rawBlobRef.current;
    const isMp3 = blob && (blob.type || "").toLowerCase().includes("mpeg") && blob.size > 0;

    // Se o blob já é MP3, tentar uma vez com novo blob URL (Safari às vezes falha no primeiro)
    if (isMp3 && !retryWithNewBlobUrlRef.current) {
      retryWithNewBlobUrlRef.current = true;
      try {
        const buf = await blob.arrayBuffer();
        const newBlob = new Blob([buf], { type: "audio/mpeg" });
        const newUrl = URL.createObjectURL(newBlob);
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return newUrl;
        });
        if (audioRef.current) {
          audioRef.current.src = newUrl;
          audioRef.current.load();
        }
        return;
      } catch {
        // Segue para conversão
      }
    }

    if (conversionAttemptedRef.current) {
      setError(true);
      return;
    }
    conversionAttemptedRef.current = true;

    let blobToConvert = rawBlobRef.current;
    if (!blobToConvert) {
      setLoading(true);
      try {
        const headers: HeadersInit = {};
        if (isStreamMediaUrl && anonKey?.trim()) headers["Authorization"] = `Bearer ${anonKey}`;
        const res = await fetch(src, { mode: "cors", credentials: "omit", headers });
        if (!res.ok) {
          setLoading(false);
          setError(true);
          return;
        }
        blobToConvert = await ensureBlobType(await res.blob(), src);
      } catch {
        setLoading(false);
        setError(true);
        return;
      }
    }

    setLoading(true);
    try {
      const converted = await convertAudioBlobToMp3(blobToConvert);
      if (converted !== blobToConvert && converted.type.includes("mpeg")) {
        setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
        const url = URL.createObjectURL(converted);
        setBlobUrl(url);
        setLoading(false);
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
        }
        return;
      }
    } catch {
      // Conversão falhou
    }

    setLoading(false);
    setError(true);
  }, [src, isValidSrc, isStreamMediaUrl, anonKey, ensureBlobType]);

  // Cleanup de blobUrl no unmount
  useEffect(() => {
    return () => {
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, []);

  if (!isValidSrc) {
    return (
      <div className="flex flex-col gap-1 min-w-[200px]">
        <p className="text-xs text-muted-foreground">URL do áudio inválida.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-1 min-w-[200px]">
        <p className="text-xs text-muted-foreground">Não foi possível reproduzir o áudio.</p>
      </div>
    );
  }

  if (loading || (isStreamMediaUrl && !blobUrl)) {
    return (
      <div className="flex items-center gap-2 min-w-[200px]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">Carregando áudio…</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio
        ref={audioRef}
        controls
        controlsList="nodownload"
        src={blobUrl || src}
        className="h-10 max-w-[280px] flex-1"
        preload="auto"
        onError={handleError}
        playsInline
      />
    </div>
  );
}
