import { memo, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CalendarClock } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { WaitBusinessWindowNodeData, WorkflowBehaviorWindow } from "@/types/workflow";

const DAY_SHORT: Record<string, string> = {
  // PT (legacy)
  seg: "S", ter: "T", qua: "Q", qui: "Q", sex: "S", sab: "S", dom: "D",
  // EN (Onda 5)
  mon: "S", tue: "T", wed: "Q", thu: "Q", fri: "S", sat: "S", sun: "D",
};

function pickRouteHandles(windows: WorkflowBehaviorWindow[]): Array<{ key: string; windowName: string }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; windowName: string }> = [];
  for (const w of windows) {
    const action = typeof w?.action === "string" ? w.action.trim() : "";
    if (action.startsWith("route:")) {
      const key = action.slice("route:".length);
      if (key.trim() && !seen.has(key)) {
        seen.add(key);
        out.push({ key, windowName: w.name });
      }
    }
  }
  return out;
}

function WaitBusinessWindowNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WaitBusinessWindowNodeData;
  const windows = (nodeData.windows ?? []) as WorkflowBehaviorWindow[];

  // Subtítulo: novo schema vs legacy. `mode` saiu — era decorativo (nunca lido
  // em runtime) e anunciava um comportamento que o executor não consultava.
  let subtitle: string;
  if (windows.length > 0) {
    subtitle = `${windows.length} janela(s)`;
  } else {
    const days = nodeData.days || [];
    const daysLabel = days.length === 7
      ? "Todos os dias"
      : days.length === 5 && !days.includes("sab") && !days.includes("dom")
        ? "Seg–Sex"
        : days.map(d => DAY_SHORT[d] || d).join(" ");
    const timeLabel = nodeData.startTime && nodeData.endTime
      ? `${nodeData.startTime}–${nodeData.endTime}`
      : "Configure horários";
    subtitle = days.length > 0 ? `${daysLabel} · ${timeLabel}` : "Configure a janela";
  }

  const routeHandles = pickRouteHandles(windows);
  // Quando há rotas, suprime handle default da BaseNode e renderiza custom abaixo.
  const hasRoutes = routeHandles.length > 0;
  const hasDefault = windows.length === 0 || windows.some(w => {
    const action = typeof w.action === "string" ? w.action.trim() : "";
    if (action.startsWith("route:") && action.slice(6).trim()) return false;
    return !(action.startsWith("hold_until:") && action.slice(11).trim());
  });
  const updateNodeInternals = useUpdateNodeInternals();
  const handleSignature = JSON.stringify([hasDefault, routeHandles]);
  useEffect(() => { updateNodeInternals(id); }, [id, handleSignature, updateNodeInternals]);

  return (
    <div className="relative">
      <BaseNode
        nodeId={id}
        nodeType="wait_business_window"
        icon={<CalendarClock className="w-5 h-5 text-amber-500" />}
        title={nodeData.label || "Janela Comercial"}
        subtitle={subtitle}
        selected={selected}
        warning={typeof data.__configIssue === "string" ? data.__configIssue : undefined}
        showSourceHandle={!hasRoutes && hasDefault}
      >
        {hasRoutes && (
          <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Saídas por janela</div>
            {routeHandles.map((rh) => (
              <div key={rh.key} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate">{rh.windowName}</span>
                <span className="text-[10px] text-muted-foreground">Saída</span>
              </div>
            ))}
            {/* Janelas de passagem usam a saída padrão; bloqueios não liberam o fluxo. */}
            {hasDefault && (
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/30">
                <span className="text-muted-foreground">Saída padrão</span>
              </div>
            )}
          </div>
        )}
      </BaseNode>

      {hasRoutes && (
        <>
          {routeHandles.map((rh, idx) => {
            const total = routeHandles.length + (hasDefault ? 1 : 0);
            const left = ((idx + 1) / (total + 1)) * 100;
            return (
              <Handle
                key={rh.key}
                type="source"
                position={Position.Bottom}
                id={rh.key}
                aria-label={`Saída ${rh.windowName}`}
                style={{ left: `${left}%` }}
                className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background"
              />
            );
          })}
          {hasDefault && <Handle
            type="source"
            position={Position.Bottom}
            id="default"
            aria-label="Saída padrão"
            style={{ left: `${((routeHandles.length + 1) / (routeHandles.length + 2)) * 100}%` }}
            className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
          />}
        </>
      )}
    </div>
  );
}

export const WaitBusinessWindowNode = memo(WaitBusinessWindowNodeComponent);
