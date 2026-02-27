import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, ChevronDown, ChevronRight } from "lucide-react";

interface ActionExample {
  action: string;
  description: string;
  dataFields: string;
  example: Record<string, unknown>;
}

const actions: ActionExample[] = [
  {
    action: "process_lead",
    description: "Cria ou atualiza lead com deduplicação automática (email e nome+mesmo dia). Inclui roteamento para pipes.",
    dataFields: "name, email, phone, company, origin, segment, faturamento, urgency, notes, rating, sdr_id, compromisso_date, utm_*",
    example: {
      action: "process_lead",
      api_key: "sua-api-key",
      tenant_id: "uuid-da-org",
      data: {
        name: "Maria Santos",
        email: "maria@empresa.com",
        phone: "+5521988887777",
        origin: "meta_ads",
      },
    },
  },
  {
    action: "SCHEDULE_MEETING",
    description: "Agenda uma reunião para um lead existente. Cria ou atualiza a entrada no pipe de confirmação.",
    dataFields: "lead_id (obrigatório), preferred_date (obrigatório), preferred_time",
    example: {
      action: "SCHEDULE_MEETING",
      api_key: "sua-api-key",
      tenant_id: "uuid-da-org",
      data: {
        lead_id: "uuid-do-lead",
        preferred_date: "2026-03-15",
        preferred_time: "14:00",
      },
    },
  },
  {
    action: "CREATE_LEAD",
    description: "Criação simples de lead sem deduplicação. Para criar leads rapidamente.",
    dataFields: "name (obrigatório), email, phone, company",
    example: {
      action: "CREATE_LEAD",
      api_key: "sua-api-key",
      tenant_id: "uuid-da-org",
      data: {
        name: "Pedro Alves",
        email: "pedro@tech.com",
        phone: "+5511977776666",
      },
    },
  },
  {
    action: "UPDATE_LEAD",
    description: "Atualiza dados de um lead existente. Aceita campos padrão, campos personalizados, e campos desconhecidos (salvos nas notas).",
    dataFields: "lead_id (obrigatório), updates: { company, segment, urgency, faturamento, rating, [campos_personalizados], [outros] }",
    example: {
      action: "UPDATE_LEAD",
      api_key: "sua-api-key",
      tenant_id: "uuid-da-org",
      data: {
        lead_id: "uuid-do-lead",
        updates: {
          company: "Nova Empresa LTDA",
          segment: "tecnologia",
          rating: 8,
        },
      },
    },
  },
  {
    action: "TRANSFER_HUMAN",
    description: "Transfere a conversa para atendimento humano. Desativa a IA no lead e muda o estado para WAITING_HUMAN.",
    dataFields: "lead_id (obrigatório), reason",
    example: {
      action: "TRANSFER_HUMAN",
      api_key: "sua-api-key",
      tenant_id: "uuid-da-org",
      data: {
        lead_id: "uuid-do-lead",
        reason: "Cliente solicitou falar com humano",
      },
    },
  },
];

export function OrchestratorActions() {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">
        Actions Disponíveis
      </h4>
      <p className="text-xs text-muted-foreground">
        O endpoint orchestrator suporta múltiplas ações. Clique em cada uma para ver o exemplo completo.
      </p>
      <div className="space-y-2">
        {actions.map((action) => (
          <ActionCard key={action.action} action={action} />
        ))}
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: ActionExample }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const jsonString = JSON.stringify(action.example, null, 2);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [jsonString]);

  return (
    <Card className="border-border">
      <CardContent className="p-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <Badge variant="outline" className="font-mono text-[10px] shrink-0">
            {action.action}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {action.description}
          </span>
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Campos do data: </span>
              {action.dataFields}
            </div>
            <div className="relative rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between bg-muted/70 px-3 py-1.5 border-b border-border">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  exemplo de body
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-6 px-2 text-[10px] text-muted-foreground"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
              <pre className="p-3 overflow-x-auto bg-[hsl(var(--muted)/0.3)]">
                <code className="text-xs font-mono text-foreground/90 whitespace-pre">
                  {jsonString}
                </code>
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
