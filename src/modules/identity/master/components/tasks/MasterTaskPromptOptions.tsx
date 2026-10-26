import { useState } from "react";
import { ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { executionPrompt, PROMPT_RECOMMENDATIONS, TARGET_LABELS, type PromptTarget } from "../../lib/master-task-prompts";
import type { MasterTaskInput } from "../../lib/master-tasks";

export function MasterTaskPromptOptions({ input, disabled }: { input: MasterTaskInput; disabled: boolean }) {
  const [target, setTarget] = useState<PromptTarget>("codex");
  const recommendations = PROMPT_RECOMMENDATIONS[input.prompt_complexity];
  const route = recommendations[target];
  async function copy(text: string, message: string) {
    try { await navigator.clipboard.writeText(text); toast.success(message); }
    catch { toast.error("Não foi possível copiar. Selecione e copie o texto da descrição."); }
  }
  return <div className="space-y-3">
    <p className="text-xs font-medium">Onde você vai executar o prompt?</p>
    <div role="group" aria-label="Destino do prompt" className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
      {(["codex", "claude"] as const).map(option => <button key={option} type="button" disabled={disabled}
        aria-pressed={target === option} onClick={() => setTarget(option)}
        className={cn("rounded-lg border p-3 text-left text-xs disabled:opacity-50", target === option ? "border-primary bg-primary/5" : "border-border bg-background")}>
        <span className="block text-sm font-semibold">{TARGET_LABELS[option]}</span>
        <span className="mt-1 block">{recommendations[option].label}</span>
        <span className="mt-1 block text-muted-foreground">Esforço: {recommendations[option].effort}</span>
      </button>)}
    </div>
    {target === "claude" ? <div className="space-y-2 text-xs text-muted-foreground">
      <p>No Claude Code, configure um comando por vez antes de colar o prompt:</p>
      {[`/model ${route.model}`, `/effort ${route.effort}`].map(command => <div key={command} className="flex items-center justify-between gap-2">
        <code>{command}</code><Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`Copiar ${command}`} onClick={() => void copy(command, "Comando copiado.")}><ClipboardCopy className="h-3.5 w-3.5" />Copiar</Button>
      </div>)}
    </div> : <p className="text-xs text-muted-foreground">No Codex, selecione {route.label} e esforço {route.effort} antes de colar. Copiar o prompt não altera o modelo da sessão.</p>}
    <Button type="button" variant="outline" className="w-full" disabled={disabled || !input.description.trim()}
      onClick={() => void copy(executionPrompt(input, target), `Prompt para ${TARGET_LABELS[target]} copiado.`)}>
      <ClipboardCopy className="h-4 w-4" />Copiar prompt para {TARGET_LABELS[target]}
    </Button>
  </div>;
}
