import { memo, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { DrawerVariant } from "./legacy/drawer-variant";

const WhatsAppContext = lazy(() =>
  import("@/components/leads/funnel-contexts/WhatsAppContext").then((m) => ({ default: m.WhatsAppContext }))
);
const ConfirmacaoContext = lazy(() =>
  import("@/components/leads/funnel-contexts/ConfirmacaoContext").then((m) => ({ default: m.ConfirmacaoContext }))
);
const PropostasContext = lazy(() =>
  import("@/components/leads/funnel-contexts/PropostasContext").then((m) => ({ default: m.PropostasContext }))
);
const UpsellContext = lazy(() =>
  import("@/components/leads/funnel-contexts/UpsellContext").then((m) => ({ default: m.UpsellClientContext }))
);

interface LeadDetailFunnelContextProps {
  lead: any;
  variant: DrawerVariant;
  pipeData: any;
  onSuccess?: () => void;
}

export const LeadDetailFunnelContext = memo(function LeadDetailFunnelContext({
  lead, variant, pipeData, onSuccess,
}: LeadDetailFunnelContextProps) {
  const contextMap: Partial<Record<DrawerVariant, JSX.Element>> = {
    whatsapp: <WhatsAppContext lead={lead} pipeData={pipeData} onSuccess={onSuccess} />,
    confirmacao: <ConfirmacaoContext lead={lead} pipeData={pipeData} onSuccess={onSuccess} />,
    propostas: <PropostasContext lead={lead} pipeData={pipeData} onSuccess={onSuccess} />,
    upsell_client: <UpsellContext lead={lead} pipeData={pipeData} onSuccess={onSuccess} />,
    upsell_campanha: <UpsellContext lead={lead} pipeData={pipeData} onSuccess={onSuccess} />,
  };

  const context = contextMap[variant];
  if (!context) return null;

  return (
    <Suspense fallback={<div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}>
      <div className="mb-4 border border-border/30 rounded-xl p-4 bg-muted/20">
        {context}
      </div>
    </Suspense>
  );
});
