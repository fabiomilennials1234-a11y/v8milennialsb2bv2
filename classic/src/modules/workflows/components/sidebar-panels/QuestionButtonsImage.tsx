import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePlus, Loader2 } from "lucide-react";
import { isQuestionImageAsset, QUESTION_IMAGE_MAX_BYTES, type QuestionImageAsset } from "@/contracts/workflows/question-image";

interface Props {
  workflowId?: string;
  image?: QuestionImageAsset | null;
  onChange: (image: QuestionImageAsset | undefined) => void;
}

export function QuestionButtonsImage({ workflowId, image, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const loadedPath = useRef<string>();
  const currentPath = useRef(image?.path);
  currentPath.current = image?.path;
  const renewed = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadPreview = useCallback(async () => {
    const path = image?.path;
    if (!workflowId || !path) return;
    const result = await supabase.functions.invoke("workflow-question-image", { body: { action: "preview", workflowId, path } });
    if (!alive.current || currentPath.current !== path) return;
    if (result.error || typeof result.data?.previewUrl !== "string") {
      setError("Não foi possível carregar a prévia da imagem."); return;
    }
    loadedPath.current = path;
    setPreviewUrl(result.data.previewUrl);
  }, [workflowId, image?.path]);
  useEffect(() => {
    renewed.current = false;
    if (!image?.path) { loadedPath.current = undefined; setPreviewUrl(undefined); return; }
    if (loadedPath.current !== image.path) void loadPreview();
  }, [image?.path, loadPreview]);
  const upload = async (file: File) => {
    if (!workflowId || uploading) return;
    setError(undefined);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Escolha uma imagem PNG, JPEG ou WebP."); return;
    }
    if (file.size === 0 || file.size > QUESTION_IMAGE_MAX_BYTES) {
      setError("A imagem deve ter conteúdo e no máximo 5 MiB."); return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.set("workflowId", workflowId ?? "");
      body.set("file", file);
      const result = await supabase.functions.invoke("workflow-question-image", { body });
      if (result.error) {
        const detail = result.error.context instanceof Response ? await result.error.context.json().catch(() => null) : null;
        throw new Error(typeof detail?.error === "string" ? detail.error : "Não foi possível enviar a imagem. Tente novamente.");
      }
      if (!isQuestionImageAsset(result.data?.image) || typeof result.data?.previewUrl !== "string") throw new Error("Não foi possível enviar a imagem. Tente novamente.");
      if (!alive.current) return;
      loadedPath.current = result.data.image.path;
      setPreviewUrl(result.data.previewUrl);
      onChange(result.data.image);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Não foi possível enviar a imagem.");
    } finally { if (alive.current) setUploading(false); }
  };
  return <section className="space-y-3">
    <div className="flex items-baseline justify-between"><Label htmlFor="question-image">Imagem fixa</Label><span className="text-xs text-muted-foreground">Opcional</span></div>
    <input ref={input} id="question-image" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={!workflowId || uploading} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file);
    }} />
    {previewUrl && <img src={previewUrl} alt="Imagem da pergunta" className="max-h-48 w-full rounded-lg border bg-muted/20 object-contain" onError={() => {
      if (!renewed.current) { renewed.current = true; void loadPreview(); }
      else setError("Prévia indisponível. Feche e reabra a configuração para tentar novamente.");
    }} />}
    <Button type="button" variant="outline" className="w-full" disabled={!workflowId || uploading} onClick={() => input.current?.click()}>
      {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ImagePlus className="mr-2 h-4 w-4" />}{image ? "Substituir imagem" : "Adicionar imagem"}
    </Button>
    {image !== undefined && <Button type="button" variant="ghost" className="w-full" disabled={uploading} onClick={() => { setPreviewUrl(undefined); onChange(undefined); }}>{image === null ? "Continuar sem imagem" : "Remover imagem"}</Button>}
    {!workflowId && <p className="text-xs text-muted-foreground">Salve o rascunho para adicionar uma imagem.</p>}
    <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP, até 5 MiB. A mesma imagem será usada em cada envio deste node.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
