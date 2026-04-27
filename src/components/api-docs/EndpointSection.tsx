import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Info } from "lucide-react";
import { ParamsTable } from "./ParamsTable";
import { CodeExamples } from "./CodeExamples";
import { ResponseBlock } from "./ResponseBlock";
import type { ApiEndpoint } from "@/lib/api-docs/types";

interface EndpointSectionProps {
  endpoint: ApiEndpoint;
  baseUrl: string;
}

const methodColors: Record<string, string> = {
  GET: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  POST: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

export function EndpointSection({ endpoint, baseUrl }: EndpointSectionProps) {
  return (
    <div id={endpoint.id} className="scroll-mt-6">
      <Card className="border-border shadow-sm">
        <CardContent className="p-6 space-y-6">
          {/* Header */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={`font-mono text-xs px-2.5 py-1 border ${methodColors[endpoint.method]}`}>
                {endpoint.method}
              </Badge>
              <code className="text-sm font-mono text-foreground/80 bg-muted px-3 py-1 rounded-md">
                {endpoint.path}
              </code>
              <Badge variant="outline" className="text-[10px]">
                {endpoint.version}
              </Badge>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{endpoint.name}</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {endpoint.description}
              </p>
            </div>
          </div>

          {/* Auth */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Autenticação: </span>
              {endpoint.auth.description}
            </div>
          </div>

          {/* Parameters */}
          <ParamsTable params={endpoint.parameters} title="Parâmetros do Request" />

          {/* Code Examples */}
          <CodeExamples endpoint={endpoint} baseUrl={baseUrl} />

          {/* Response */}
          <ResponseBlock example={endpoint.responseExample} fields={endpoint.responseFields} />

          {/* Notes */}
          {endpoint.notes && endpoint.notes.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Observações Importantes
              </h4>
              <ul className="space-y-1.5 pl-4">
                {endpoint.notes.map((note, i) => (
                  <li key={i} className="text-xs text-muted-foreground leading-relaxed list-disc">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
