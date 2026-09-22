import { RefreshCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export interface ReenrollmentData {
  enabled: boolean;
  /** Compatibility fields; enabled reenrollment ignores these limits. */
  cooldown_days: number;
  max_times: number;
}

interface ReenrollmentConfigProps {
  value: ReenrollmentData;
  onChange: (value: ReenrollmentData) => void;
}

export const DEFAULT_REENROLLMENT: ReenrollmentData = {
  enabled: false,
  cooldown_days: 30,
  max_times: 1,
};

export function ReenrollmentConfig({ value, onChange }: ReenrollmentConfigProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCcw className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Reinscrição</CardTitle>
          </div>
          <Switch
            aria-label="Permitir reinscrição"
            checked={value.enabled}
            onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
          />
        </div>
        <CardDescription className="text-xs">
          Permitir novas participações nesta automação
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0 text-xs text-muted-foreground">
        {value.enabled
          ? "Permite reinscrições sem limite de quantidade nem intervalo de dias, após o término da execução anterior."
          : "Cada negócio pode participar uma única vez desta automação."}
      </CardContent>
    </Card>
  );
}
