import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WebhookCallNodeData } from "@/types/workflow";

interface WebhookCallPanelProps {
  data: WebhookCallNodeData;
  onUpdate: (updates: Partial<WebhookCallNodeData>) => void;
}

export function WebhookCallPanel({ data, onUpdate }: WebhookCallPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Notificar sistema externo"
        />
      </div>

      <div className="space-y-2">
        <Label>Método HTTP</Label>
        <Select
          value={data.method || "POST"}
          onValueChange={(v) => onUpdate({ method: v as "GET" | "POST" | "PUT" | "PATCH" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
            <SelectItem value="PATCH">PATCH</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>URL</Label>
        <Input
          value={data.url || ""}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://api.exemplo.com/webhook"
        />
      </div>

      <div className="space-y-2">
        <Label>Body (JSON com variáveis)</Label>
        <Textarea
          value={data.bodyTemplate || ""}
          onChange={(e) => onUpdate({ bodyTemplate: e.target.value })}
          placeholder={'{\n  "lead_name": "{{nome}}",\n  "lead_email": "{{email}}"\n}'}
          rows={5}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Variáveis: {"{{nome}}"}, {"{{empresa}}"}, {"{{email}}"}, {"{{telefone}}"}, etc.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Salvar resposta em variável (opcional)</Label>
        <Input
          value={data.outputVariable || ""}
          onChange={(e) => onUpdate({ outputVariable: e.target.value })}
          placeholder="webhook_response"
        />
        <p className="text-xs text-muted-foreground">
          A resposta JSON do webhook fica disponível como variável nos nós seguintes.
        </p>
      </div>

      <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800">
        <p className="text-xs text-indigo-700 dark:text-indigo-300">
          Envia uma requisição HTTP para um endpoint externo. Útil para integrar com
          sistemas de pagamento, ERPs, CRMs externos, etc.
        </p>
      </div>
    </div>
  );
}
