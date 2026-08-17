import { memo, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { DrawerVariant } from "./legacy/drawer-variant";

const WhatsAppContext = lazy(() =>
  import("../leads/funnel-contexts/WhatsAppContext").then((m) => ({ default: m.WhatsAppContext }))
);
const ConfirmacaoContext = lazy(() =>
  import("../leads/funnel-contexts/ConfirmacaoContext").then((m) => ({ default: m.ConfirmacaoContext }))
);
const PropostasContext = lazy(() =>
  import("../leads/funnel-contexts/PropostasContext").then((m) => ({ default: m.PropostasContext }))
);
const UpsellContext = lazy(() =>
  import("../leads/funnel-contexts/UpsellContext").then((m) => ({ default: m.UpsellClientContext }))
);

/**
 * Este componente só encaminha — mas era aqui que a tipagem morria.
 *
 * `any` é atribuível a qualquer tipo, então enquanto estas props fossem `any`
 * o compilador aceitaria qualquer coisa nos filhos, por mais bem tipados que
 * eles estivessem. Tipar a folha e deixar o encaminhador `any` não protege
 * nada — o buraco fica na fronteira, não no destino.
 *
 * O tipo já existia na origem: `useLeadDetail` infere de `supabase.from("leads")`.
 */
interface FunnelContextLead {
  id: string;
  phone: string | null;
}

interface FunnelContextPipeData {
  id: string;
  lead_id: string;
  sdr_id: string | null;
  status: string | null;
  responsible?: { name: string | null } | null;
  sdr?: { name: string | null } | null;
}

interface LeadDetailFunnelContextProps {
  lead: FunnelContextLead | null;
  variant: DrawerVariant;
  pipeData: FunnelContextPipeData | null;
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
