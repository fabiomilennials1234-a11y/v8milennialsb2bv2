/**
 * SimulatorPanel — Slice 9 dry-run chat (Copilot v2). The operator types as a
 * lead; the agent runs the REAL base prompt + the config (DRAFT in create / SAVED
 * in edit) with tools rendered as "IRIA executar" and a trace. Zero writes.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSimulateTurn } from "../../hooks/useCopilotV2Simulator";
import { TracePanel } from "./TracePanel";
import { EvalSuitePanel } from "./EvalSuitePanel";
import type { Archetype, CopilotV2Config, RubricRule } from "../../lib/copilot-v2-config";
import type { DryRunTrace } from "../../lib/copilot-v2-sim";

export interface SimulatorPanelProps {
  archetype: Archetype;
  mode: "create" | "edit";
  /** CREATE: in-flight draft. EDIT: omit, pass agentId. */
  draftConfig?: CopilotV2Config;
  draftRubric?: RubricRule[];
  agentId?: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  trace?: DryRunTrace;
}

export function SimulatorPanel({ archetype, mode, draftConfig, draftRubric, agentId }: SimulatorPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const simulate = useSimulateTurn();

  const send = async () => {
    const text = input.trim();
    if (!text || simulate.isPending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const res = await simulate.mutateAsync(
        mode === "edit"
          ? { archetype, message: text, agentId }
          : { archetype, message: text, config: draftConfig, rubricRules: draftRubric },
      );
      setMessages((m) => [...m, { role: "assistant", content: res.reply ?? "(sem resposta)", trace: res.trace }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "(erro ao simular)" }]);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Simulação dry-run: o agente usa o prompt-base real + a config {mode === "edit" ? "salva" : "deste rascunho"}. Toda
        ação é exibida como “IRIA executar” — nada é gravado.
      </p>

      <div className="max-h-[320px] space-y-3 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={cn("space-y-2", m.role === "user" ? "text-right" : "text-left")}>
            <div
              className={cn(
                "inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "bg-primary/15 text-foreground" : "bg-muted text-foreground",
              )}
            >
              {m.content}
            </div>
            {m.trace && <TracePanel trace={m.trace} />}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          placeholder="Digite como se fosse o lead…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button onClick={() => void send()} disabled={simulate.isPending}>
          {simulate.isPending ? "…" : "Enviar"}
        </Button>
      </div>

      <EvalSuitePanel archetype={archetype} />
    </div>
  );
}
