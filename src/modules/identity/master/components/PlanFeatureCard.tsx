/**
 * PlanFeatureCard — card de toggle de feature dentro do editor de plano.
 * Usado por PlanEditor para cada feature individual.
 */

import { Switch } from "@/components/ui/switch";
import {
  Zap, GitBranch, Wrench, Fuel, DollarSign, Trophy, BarChart2, Package,
  Tv, Bot, MousePointer, Sparkles, Send, Code, Palette,
} from "lucide-react";
import type { FeatureMeta } from "@/modules/platform/lib/feature-registry";

const ICON_MAP: Record<string, React.ElementType> = {
  Zap, GitBranch, Wrench, Fuel, DollarSign, Trophy, BarChart2, Package,
  Tv, Bot, MousePointer, Sparkles, Send, Code, Palette,
};

interface PlanFeatureCardProps {
  feature: FeatureMeta;
  enabled: boolean;
  onToggle: (key: string, value: boolean) => void;
}

export function PlanFeatureCard({ feature, enabled, onToggle }: PlanFeatureCardProps) {
  const Icon = ICON_MAP[feature.icon] ?? Zap;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ${
          enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{feature.label}</p>
          <p className="text-xs text-muted-foreground truncate">{feature.description}</p>
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => onToggle(feature.key, checked)}
      />
    </div>
  );
}
