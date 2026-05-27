import { WifiOff, RefreshCw } from "lucide-react";

interface LeadDetailBannersProps {
  isOnline: boolean;
  isFetching: boolean;
  failureCount: number;
}

/**
 * Top-strip banners (#305) — offline state and retry indicator.
 * Both render inline so the user understands why mutations might fail
 * or why the modal is still spinning.
 */
export function LeadDetailBanners({ isOnline, isFetching, failureCount }: LeadDetailBannersProps) {
  if (!isOnline) {
    return (
      <div className="bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-xs text-destructive flex items-center gap-2">
        <WifiOff className="w-3.5 h-3.5" />
        Sem conexão. Ações estão desabilitadas até reconectar.
      </div>
    );
  }
  if (isFetching && failureCount > 0) {
    return (
      <div className="bg-muted/40 border-b border-border/40 px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        Reconectando… (tentativa {failureCount + 1}/3)
      </div>
    );
  }
  return null;
}
