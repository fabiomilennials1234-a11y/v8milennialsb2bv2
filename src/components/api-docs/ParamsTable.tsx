import { Badge } from "@/components/ui/badge";
import type { ApiParam } from "@/lib/api-docs/types";

interface ParamsTableProps {
  params: ApiParam[];
  title?: string;
  depth?: number;
}

export function ParamsTable({ params, title, depth = 0 }: ParamsTableProps) {
  if (params.length === 0) return null;

  return (
    <div className={depth > 0 ? "ml-6 mt-2" : ""}>
      {title && (
        <h4 className="text-sm font-semibold text-foreground mb-3">{title}</h4>
      )}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Parâmetro</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Tipo</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Obrigatório</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Descrição</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {params.map((param) => (
              <ParamRow key={param.name} param={param} depth={depth} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParamRow({ param, depth }: { param: ApiParam; depth: number }) {
  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3 align-top">
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-primary">
            {depth > 0 && <span className="text-muted-foreground mr-1">└</span>}
            {param.name}
          </code>
        </td>
        <td className="px-4 py-3 align-top">
          <span className="text-xs text-muted-foreground font-mono">{param.type}</span>
        </td>
        <td className="px-4 py-3 align-top hidden sm:table-cell">
          {param.required ? (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              obrigatório
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              opcional
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 align-top text-muted-foreground text-xs leading-relaxed">
          {param.description}
          {param.defaultValue && (
            <span className="block mt-1 text-[10px]">
              Padrão: <code className="bg-muted px-1 py-0.5 rounded">{param.defaultValue}</code>
            </span>
          )}
        </td>
      </tr>
      {param.children?.map((child) => (
        <ParamRow key={`${param.name}.${child.name}`} param={child} depth={depth + 1} />
      ))}
    </>
  );
}
