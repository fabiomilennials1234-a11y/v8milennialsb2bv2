/**
 * InteractiveQualificationStep — configuração opcional de mensagem
 * interativa no wizard do Copilot.
 *
 * Salva em `agent.config.interactive_flow` (JSONB):
 *   {
 *     enabled: boolean,
 *     type: "button" | "list",
 *     text: string,
 *     choices: string[],
 *     footer?: string
 *   }
 *
 * Executado como primeira mensagem ao lead no lugar do prompt LLM
 * inicial. Resposta do lead (choice selecionado) vira input do fluxo
 * normal do Copilot. Uazapi only — se provider=evolution, step é
 * invisível.
 */
import { useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MenuNodeConfig } from "@/components/automacoes/action-configs/MenuNodeConfig";

type InteractiveFlow = {
  enabled?: boolean;
  type?: "button" | "list" | "poll" | "carousel";
  text?: string;
  choices?: string[];
  footer?: string;
};

interface Props {
  interactiveFlow: InteractiveFlow;
  onChange: (flow: InteractiveFlow) => void;
  /** Se true, o step fica oculto (provider=evolution) */
  hidden?: boolean;
}

export function InteractiveQualificationStep({
  interactiveFlow,
  onChange,
  hidden,
}: Props) {
  if (hidden) {
    return (
      <div className="text-sm text-muted-foreground">
        Mensagens interativas estão disponíveis apenas em instâncias Uazapi.
        Alterne o provider da instância para habilitar.
      </div>
    );
  }

  useEffect(() => {
    if (!interactiveFlow) onChange({ enabled: false });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between rounded-md border border-border/40 p-3">
        <div>
          <Label className="text-sm font-medium">Qualificação interativa</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Primeira mensagem do Copilot vira botões/lista em vez de texto
            aberto. Acelera qualificação via tap-to-answer.
          </p>
        </div>
        <Switch
          checked={!!interactiveFlow.enabled}
          onCheckedChange={(enabled) => onChange({ ...interactiveFlow, enabled })}
        />
      </div>

      {interactiveFlow.enabled && (
        <MenuNodeConfig
          data={{
            type: "action",
            actionType: "send_whatsapp_menu",
            label: "Qualificação interativa",
            menuType: interactiveFlow.type ?? "button",
            menuText: interactiveFlow.text ?? "",
            menuChoices: interactiveFlow.choices ?? [""],
            menuFooter: interactiveFlow.footer,
          }}
          onUpdate={(updates) => {
            onChange({
              ...interactiveFlow,
              type: updates.menuType ?? interactiveFlow.type,
              text: updates.menuText ?? interactiveFlow.text,
              choices: updates.menuChoices ?? interactiveFlow.choices,
              footer: updates.menuFooter ?? interactiveFlow.footer,
            });
          }}
        />
      )}
    </div>
  );
}
