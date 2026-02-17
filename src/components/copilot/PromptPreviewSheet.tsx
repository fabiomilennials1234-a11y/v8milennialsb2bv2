/**
 * PromptPreviewSheet - Painel lateral deslizante para visualizar o prompt
 *
 * Usa framer-motion para animação (mesmo engine das transições do wizard).
 * Não depende do Sheet/Radix — é um painel custom com overlay.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Copy, Check, X } from "lucide-react";
import { useState } from "react";

interface PromptPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptText: string;
}

export function PromptPreviewSheet({
  open,
  onOpenChange,
  promptText,
}: PromptPreviewSheetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
          />

          {/* Painel lateral */}
          <motion.div
            className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-background border-l shadow-xl flex flex-col"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold">Preview do Prompt</h3>
                <p className="text-sm text-muted-foreground">
                  System prompt gerado a partir dos campos preenchidos.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copiar
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Conteúdo scrollável */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {promptText ? (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
                  {promptText}
                </pre>
              ) : (
                <p className="text-muted-foreground text-center py-12">
                  Preencha os campos do wizard para gerar o preview.
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
