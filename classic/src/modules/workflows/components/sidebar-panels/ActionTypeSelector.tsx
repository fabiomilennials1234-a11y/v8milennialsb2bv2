import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getActionCategories, ACTION_LABELS, UNIFIED_MESSAGE_NODE_FLAG, QUESTION_BUTTONS_FLAG, type WorkflowActionType } from "@/types/workflow";
import { useFeatureFlag } from "@/modules/platform";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";

export function ActionTypeSelector({ value, onChange }: { value: WorkflowActionType; onChange: (value: WorkflowActionType) => void }) {
  const { enabled: unifiedEnabled } = useFeatureFlag(UNIFIED_MESSAGE_NODE_FLAG);
  const { enabled: buttonsEnabled } = useFeatureFlag(QUESTION_BUTTONS_FLAG);
  const { hasFeature } = useOrgFeatures();
  const categories = getActionCategories(unifiedEnabled)
    .filter(category => category.label !== "Negócios" || hasFeature("deals"))
    .map(category => category.label === "Comunicação" && (buttonsEnabled || value === "send_whatsapp_menu") && !category.actions.includes("send_whatsapp_menu")
      ? { ...category, actions: [...category.actions, "send_whatsapp_menu" as const] } : category);
  return <div className="space-y-2">
    <Label htmlFor="workflow-action-type">Tipo de Ação</Label>
    <Select value={value} onValueChange={next => onChange(next as WorkflowActionType)}>
      <SelectTrigger id="workflow-action-type"><SelectValue placeholder="Selecione a ação" /></SelectTrigger>
      <SelectContent className="max-h-80">{categories.map(category => <SelectGroup key={category.label}>
        <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">{category.label}</SelectLabel>
        {category.actions.map(action => <SelectItem key={action} value={action}>{ACTION_LABELS[action]}</SelectItem>)}
      </SelectGroup>)}</SelectContent>
    </Select>
  </div>;
}
