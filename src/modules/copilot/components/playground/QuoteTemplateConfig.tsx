import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DOCX_MIME, DERIVED_FIELDS, QUOTE_MAX_BYTES } from "@/contracts/copilot/quote-document";
import { toast } from "sonner";

interface Props { agentId?: string; config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }
export function QuoteTemplateConfig({ agentId, config, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const pdf = config.convertToPdf === true || config.convertToPdf === "true";
  async function invoke(body: Record<string, unknown>) {
    const result = await supabase.functions.invoke("copilot-quote-template", { body: { ...body, agent_id: agentId } });
    if (result.error || result.data?.error) throw new Error(result.data?.error || "Serviço de documentos indisponível.");
    return result.data;
  }
  async function upload(file?: File) {
    if (!file || !agentId) return;
    if (!/\.docx$/i.test(file.name) || file.size > QUOTE_MAX_BYTES || (file.type && file.type !== DOCX_MIME)) {
      toast.error("Escolha um arquivo Word .docx de até 5 MiB."); return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let raw = "";
      for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const model = await invoke({ action: "upload", name: file.name, file: btoa(raw) });
      onChange({ templateDocumentId: model.id, templateName: model.name, fields: model.fields,
        requiredFields: model.fields.filter((f: string) => !DERIVED_FIELDS.includes(f)).join(", ") });
      toast.success("Modelo importado. Salve o agente para usar a nova versão.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao importar."); }
    finally { setBusy(false); }
  }
  async function changePdf(enabled: boolean) {
    if (!enabled) { onChange({ convertToPdf: false }); return; }
    setBusy(true);
    try {
      const health = await invoke({ action: "health" });
      if (health.pdf !== true) throw new Error("Conversor PDF indisponível.");
      onChange({ convertToPdf: true });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Conversor indisponível."); }
    finally { setBusy(false); }
  }
  async function preview() {
    setBusy(true);
    try {
      const result = await invoke({ action: "test", template_id: config.templateDocumentId, convert_to_pdf: pdf });
      const bytes = Uint8Array.from(atob(result.file), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: pdf ? "application/pdf" : DOCX_MIME }));
      const link = document.createElement("a"); link.href = url; link.download = `orcamento-teste.${pdf ? "pdf" : "docx"}`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Prévia indisponível."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    {!agentId && <p className="text-sm text-muted-foreground">Salve o agente antes de importar o modelo Word.</p>}
    <Label htmlFor="quote-template">Importar modelo Word</Label>
    <Input id="quote-template" type="file" accept=".docx" disabled={!agentId || busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
    <p className="text-xs text-muted-foreground">Use marcadores como {"{{customer}}"} e uma linha de produtos com {"{{items.description}}, {{items.quantity}}, {{items.unit_price}} e {{items.total}}"}.</p>
    {typeof config.templateName === "string" && <p className="text-sm">Modelo: {config.templateName}</p>}
    <Label htmlFor="quote-required">Campos obrigatórios (separados por vírgula)</Label>
    <Input id="quote-required" value={String(config.requiredFields ?? "")} onChange={e => onChange({ requiredFields: e.target.value })} />
    <div className="flex items-center gap-2">
      <Switch id="quote-pdf" checked={pdf} disabled={busy || !agentId} onCheckedChange={v => void changePdf(v)} />
      <Label htmlFor="quote-pdf">Converter para PDF após preenchimento</Label>
    </div>
    <p className="text-xs text-muted-foreground">Desligado: envia Word. Ligado: envia PDF; falhas de conversão impedem o envio.</p>
    <Button type="button" variant="outline" disabled={busy || !config.templateDocumentId} onClick={() => void preview()}>{busy ? "Processando…" : "Baixar teste com dados fictícios"}</Button>
  </div>;
}
