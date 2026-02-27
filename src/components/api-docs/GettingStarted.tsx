import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Globe, Zap, AlertCircle } from "lucide-react";

interface GettingStartedProps {
  baseUrl: string;
}

export function GettingStarted({ baseUrl }: GettingStartedProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Primeiros Passos</h2>
        <p className="text-muted-foreground mt-2 leading-relaxed">
          Guia rápido para começar a integrar com a API do v8 CRM. Envie leads de qualquer
          fonte — Meta Ads, Google Ads, Landing Pages, n8n, Zapier, Make, ou sistemas próprios.
        </p>
      </div>

      {/* Base URL */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground text-sm">Base URL</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Todos os endpoints da API utilizam a seguinte URL base:
          </p>
          <code className="block bg-muted px-4 py-2.5 rounded-lg text-sm font-mono text-foreground/90">
            {baseUrl}
          </code>
        </CardContent>
      </Card>

      {/* Authentication */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground text-sm">Autenticação</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A maioria dos endpoints requer uma chave de API (API Key) para autenticação.
            A chave é fornecida pelo administrador do sistema.
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] mt-0.5 shrink-0">
                lead-webhook
              </Badge>
              <div className="text-xs text-muted-foreground">
                Envie no header: <code className="bg-muted px-1.5 py-0.5 rounded">X-Webhook-Key: SUA_API_KEY</code>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] mt-0.5 shrink-0">
                orchestrator
              </Badge>
              <div className="text-xs text-muted-foreground">
                Header <code className="bg-muted px-1.5 py-0.5 rounded">X-API-Key</code> ou campo{" "}
                <code className="bg-muted px-1.5 py-0.5 rounded">api_key</code> no body
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-[10px] mt-0.5 shrink-0">
                webhook-new-lead
              </Badge>
              <div className="text-xs text-muted-foreground">
                Sem autenticação (endpoint legado, CORS aberto)
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick comparison */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground text-sm">Qual endpoint usar?</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Cenário</th>
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Endpoint Recomendado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-2.5 pr-4 text-foreground">Integração nova (Meta Ads, Google Ads, etc.)</td>
                  <td className="py-2.5 pr-4">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-primary">lead-webhook</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-foreground">Múltiplas ações via agente IA / n8n</td>
                  <td className="py-2.5 pr-4">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-primary">webhook-orchestrator</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-foreground">Fluxo n8n legado simples</td>
                  <td className="py-2.5 pr-4">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-primary">webhook-new-lead</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-foreground">Campos personalizados + tags + campanhas</td>
                  <td className="py-2.5 pr-4">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-primary">lead-webhook</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-foreground">Agendar reunião ou atualizar lead existente</td>
                  <td className="py-2.5 pr-4">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-primary">webhook-orchestrator</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Errors */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground text-sm">Formato de Erros</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Em caso de erro, a API retorna um JSON com os campos:
          </p>
          <pre className="p-3 bg-muted/50 rounded-lg overflow-x-auto">
            <code className="text-xs font-mono text-foreground/90">{`{
  "error": "Descrição do erro",
  "details": "Detalhes adicionais (quando disponível)",
  "success": false
}`}</code>
          </pre>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="destructive" className="text-[10px] px-1.5">400</Badge>
              <span className="text-muted-foreground">Dados inválidos ou campos obrigatórios ausentes</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="destructive" className="text-[10px] px-1.5">401</Badge>
              <span className="text-muted-foreground">API Key inválida ou ausente</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="destructive" className="text-[10px] px-1.5">500</Badge>
              <span className="text-muted-foreground">Erro interno do servidor</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
