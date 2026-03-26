import { ChevronRight } from "lucide-react";
import type { UtmLevel } from "@/hooks/useAnalyticsUtms";

interface BreadcrumbItem {
  label: string;
  level: UtmLevel;
  value?: string;
}

interface Props {
  level: UtmLevel;
  campaign?: string | null;
  adset?: string | null;
  ad?: string | null;
  onNavigate: (level: UtmLevel, campaign?: string | null, adset?: string | null) => void;
}

export function UtmBreadcrumb({ level, campaign, adset, ad, onNavigate }: Props) {
  const items: BreadcrumbItem[] = [
    { label: "Campanhas", level: "campaign" },
  ];

  if (campaign && (level === "adset" || level === "ad" || level === "leads")) {
    items.push({ label: campaign, level: "adset", value: campaign });
  }
  if (adset && (level === "ad" || level === "leads")) {
    items.push({ label: adset, level: "ad", value: adset });
  }
  if (ad && level === "leads") {
    items.push({ label: ad, level: "leads" });
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isClickable = !isLast;

        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
            {isClickable ? (
              <button
                onClick={() => {
                  if (item.level === "campaign") onNavigate("campaign");
                  if (item.level === "adset") onNavigate("adset", campaign);
                  if (item.level === "ad") onNavigate("ad", campaign, adset);
                }}
                className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
              >
                {item.label}
              </button>
            ) : (
              <span className="text-foreground font-medium">{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
