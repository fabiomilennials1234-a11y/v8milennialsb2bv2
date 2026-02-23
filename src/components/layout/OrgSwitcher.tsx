import { Building2, ChevronDown, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useOrgSwitcher } from "@/hooks/useOrgSwitcher";
import { useOrganization } from "@/hooks/useOrganization";
import { useMasterAuth } from "@/hooks/useMasterAuth";

export function OrgSwitcher() {
  const { orgs, hasMultipleOrgs, isSwitching, switchOrg } = useOrgSwitcher();
  const { organizationId } = useOrganization();
  const { isMaster } = useMasterAuth();

  // Só renderiza se o user tem mais de 1 org (master sempre vê)
  if (!hasMultipleOrgs) return null;

  const currentOrg = orgs.find((o) => o.id === organizationId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 max-w-[240px]"
          disabled={isSwitching}
        >
          {isSwitching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Building2 className="w-4 h-4 shrink-0" />
          )}
          <span className="truncate text-sm font-medium">
            {currentOrg?.name ?? "Selecionar org..."}
          </span>
          {isMaster && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 border-yellow-500/50 text-yellow-600">
              SHADOW
            </Badge>
          )}
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] max-h-[400px] overflow-y-auto">
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => {
              if (org.id !== organizationId) {
                switchOrg(org.id);
              }
            }}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{org.name}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {org.org_type === "outbound" && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  OUT
                </Badge>
              )}
              {org.id === organizationId && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
