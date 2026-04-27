import { memo, useState, useMemo } from "react";
import { Link2, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAnalyticsUtms } from "@/hooks/useAnalyticsUtms";

interface CampaignRow {
  campaign: string;
  leads: number;
  vendas: number;
  conversion: number;
}

function MktUtmBreakdownBase() {
  const [open, setOpen] = useState(false);
  const { data } = useAnalyticsUtms("campaign");

  const campaigns = useMemo(() => {
    if (!data?.items?.length) return [];

    return data.items
      .filter((item) => item.totalLeads > 0)
      .map((item): CampaignRow => ({
        campaign: item.name,
        leads: item.totalLeads,
        vendas: item.converted,
        conversion: item.conversionRate,
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [data]);

  if (campaigns.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 text-[11px] font-semibold transition-colors"
      >
        <Link2 className="w-3.5 h-3.5" />
        Ver campanhas UTM
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <table className="w-full mt-2.5">
              <thead>
                <tr>
                  <th className="text-left text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50 pb-1.5 px-1.5">
                    Campanha
                  </th>
                  <th className="text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50 pb-1.5 px-1.5">
                    Leads
                  </th>
                  <th className="text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50 pb-1.5 px-1.5">
                    Vendas
                  </th>
                  <th className="text-right text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50 pb-1.5 px-1.5">
                    Conv.
                  </th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row, i) => (
                  <tr key={row.campaign}>
                    <td
                      className={cn(
                        "text-[11px] font-medium py-1.5 px-1.5 max-w-[140px] truncate",
                        i < campaigns.length - 1 && "border-b border-border/30"
                      )}
                      title={row.campaign}
                    >
                      {row.campaign}
                    </td>
                    <td
                      className={cn(
                        "text-center text-[11px] font-medium tabular-nums py-1.5 px-1.5",
                        i < campaigns.length - 1 && "border-b border-border/30"
                      )}
                    >
                      {row.leads}
                    </td>
                    <td
                      className={cn(
                        "text-center text-[11px] font-medium tabular-nums py-1.5 px-1.5",
                        i < campaigns.length - 1 && "border-b border-border/30"
                      )}
                    >
                      {row.vendas}
                    </td>
                    <td
                      className={cn(
                        "text-right text-[11px] font-bold tabular-nums text-success py-1.5 px-1.5",
                        i < campaigns.length - 1 && "border-b border-border/30"
                      )}
                    >
                      {row.conversion.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const MktUtmBreakdown = memo(MktUtmBreakdownBase);
