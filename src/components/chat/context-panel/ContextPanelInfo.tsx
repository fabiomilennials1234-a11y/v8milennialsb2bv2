/**
 * ContextPanelInfo — stub para Onda 2b.
 * Em Onda 2b: renderizará LeadDetailContent redesenhado inline no painel.
 * Por ora: placeholder informativo.
 */

export interface ContextPanelInfoProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
}

export function ContextPanelInfo({ leadId, phoneNumber }: ContextPanelInfoProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        Em breve (Onda 2b): informações do lead
      </p>
      {leadId && (
        <p className="text-xs text-muted-foreground/60 font-mono">{leadId}</p>
      )}
      {phoneNumber && (
        <p className="text-xs text-muted-foreground/60">{phoneNumber}</p>
      )}
    </div>
  );
}
