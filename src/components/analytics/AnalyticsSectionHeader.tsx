import { type LucideIcon } from "lucide-react";
import { AT } from "./analytics-tokens";

interface AnalyticsSectionHeaderProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

export function AnalyticsSectionHeader({ title, description, icon: Icon }: AnalyticsSectionHeaderProps) {
  return (
    <div className="border-t border-border/30 pt-8 mt-8 mb-5">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-muted-foreground/60" />
        <h3 className={AT.sectionHeading}>{title}</h3>
      </div>
      <p className={`${AT.sectionDesc} mt-1`}>{description}</p>
    </div>
  );
}
