import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiParam } from "@/lib/api-docs/types";

interface ApiParamsTableProps {
  params: ApiParam[];
  title?: string;
}

export function ApiParamsTable({ params, title }: ApiParamsTableProps) {
  if (!params.length) return null;

  return (
    <div className="space-y-3">
      {title && (
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      )}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Nome
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tipo
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider w-24">
                Obrigatorio
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Descricao
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {params.map((param) => (
              <ParamRow key={param.name} param={param} depth={0} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParamRow({ param, depth }: { param: ApiParam; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = param.children && param.children.length > 0;

  return (
    <>
      <tr
        className={cn(
          "hover:bg-muted/20 transition-colors",
          hasChildren && "cursor-pointer",
        )}
        onClick={hasChildren ? () => setExpanded(!expanded) : undefined}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
            {hasChildren && (
              <span className="text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            )}
            <code className="text-[13px] font-mono text-foreground">{param.name}</code>
          </div>
        </td>
        <td className="px-4 py-3">
          <code className="text-[12px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
            {param.type}
          </code>
        </td>
        <td className="px-4 py-3">
          {param.required ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-red-500/15 text-red-400 border border-red-500/25">
              required
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase bg-zinc-500/15 text-zinc-400 border border-zinc-500/25">
              optional
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-[13px] text-muted-foreground leading-relaxed">
          {param.description}
          {param.defaultValue && (
            <span className="ml-1 text-xs text-muted-foreground/60">
              (default: <code className="font-mono">{param.defaultValue}</code>)
            </span>
          )}
        </td>
      </tr>
      {hasChildren && expanded &&
        param.children!.map((child) => (
          <ParamRow key={`${param.name}.${child.name}`} param={child} depth={depth + 1} />
        ))}
    </>
  );
}
