/**
 * AiEmailWriter — dialog to generate AI email drafts.
 * Consumes useGenerateEmailDraft + useAcceptEmailDraft.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGenerateEmailDraft,
  useAcceptEmailDraft,
  type EmailStyle,
  type AiEmailDraft,
} from "@/modules/communication/hooks/useAiEmailDrafts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────

interface AiEmailWriterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string;
  dealId?: string;
  leadName?: string;
}

// ── Style config ──────────────────────────────────────────────

const STYLE_OPTIONS: { value: EmailStyle; label: string; description: string }[] = [
  { value: "formal", label: "Formal", description: "Tom profissional e objetivo" },
  { value: "casual", label: "Casual", description: "Tom amigavel e descontraido" },
  { value: "follow_up", label: "Follow-up", description: "Retomada de contato" },
  { value: "proposal", label: "Proposta", description: "Apresentacao comercial" },
  { value: "intro", label: "Introducao", description: "Primeiro contato" },
];

// ── Component ─────────────────────────────────────────────────

export function AiEmailWriter({
  open,
  onOpenChange,
  leadId,
  dealId,
  leadName,
}: AiEmailWriterProps) {
  const [style, setStyle] = useState<EmailStyle>("formal");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<AiEmailDraft | null>(null);
  const [copied, setCopied] = useState(false);

  const generateDraft = useGenerateEmailDraft();
  const acceptDraft = useAcceptEmailDraft();

  const handleGenerate = async () => {
    setDraft(null);
    try {
      const result = await generateDraft.mutateAsync({
        lead_id: leadId,
        deal_id: dealId,
        style,
        prompt: prompt.trim() || undefined,
      });
      setDraft(result);
    } catch {
      // toast handled in hook
    }
  };

  const handleAccept = async () => {
    if (!draft) return;
    await acceptDraft.mutateAsync(draft.id);
    toast.success("Rascunho aceito");
    onOpenChange(false);
    resetState();
  };

  const handleCopy = async () => {
    if (!draft) return;
    const text = `${draft.generated_subject ? `Assunto: ${draft.generated_subject}\n\n` : ""}${draft.generated_body || ""}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetState = () => {
    setDraft(null);
    setPrompt("");
    setStyle("formal");
    setCopied(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) resetState();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Mail className="w-4 h-4 text-primary" />
            </div>
            Redigir email com IA
            {leadName && (
              <Badge variant="outline" className="text-xs ml-2 font-normal">
                {leadName}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Style selector */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Estilo
            </Label>
            <Select value={style} onValueChange={(v) => setStyle(v as EmailStyle)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Context prompt */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Contexto / instrucoes (opcional)
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: Mencionar o produto X, propor reuniao na proxima semana..."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={generateDraft.isPending}
            className="w-full gap-2"
          >
            {generateDraft.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {generateDraft.isPending ? "Gerando..." : draft ? "Regenerar" : "Gerar rascunho"}
          </Button>

          {/* Draft result */}
          <AnimatePresence mode="wait">
            {draft && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="space-y-3"
              >
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  {/* Subject */}
                  {draft.generated_subject && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                        Assunto
                      </p>
                      <p className="text-sm font-medium">{draft.generated_subject}</p>
                    </div>
                  )}

                  {/* Body */}
                  {draft.generated_body && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                        Corpo
                      </p>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {draft.generated_body}
                      </p>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    {draft.model_used && (
                      <Badge variant="outline" className="text-[10px]">
                        {draft.model_used}
                      </Badge>
                    )}
                    {draft.tokens_used && (
                      <span className="text-[10px] text-muted-foreground">
                        {draft.tokens_used} tokens
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button onClick={handleAccept} className="flex-1 gap-2">
                    <Check className="w-4 h-4" />
                    Usar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={generateDraft.isPending}
                    className="gap-2"
                  >
                    <RefreshCw className={cn("w-4 h-4", generateDraft.isPending && "animate-spin")} />
                    Regenerar
                  </Button>
                  <Button variant="outline" size="icon" onClick={handleCopy}>
                    {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
