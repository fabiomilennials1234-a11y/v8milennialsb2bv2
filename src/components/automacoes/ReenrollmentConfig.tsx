import { RefreshCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export interface ReenrollmentData {
  enabled: boolean;
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
            <CardTitle className="text-sm">Re-inscricao</CardTitle>
          </div>
          <Switch
            checked={value.enabled}
            onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
          />
        </div>
        <CardDescription className="text-xs">
          Permitir que leads sejam inscritos neste workflow mais de uma vez
        </CardDescription>
      </CardHeader>

      {value.enabled && (
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Maximo de inscricoes por lead</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={value.max_times}
                onChange={(e) =>
                  onChange({ ...value, max_times: parseInt(e.target.value) || 1 })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Quantas vezes o mesmo lead pode passar
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cooldown entre inscricoes (dias)</Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={value.cooldown_days}
                onChange={(e) =>
                  onChange({ ...value, cooldown_days: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Dias minimos entre cada inscricao
              </p>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
