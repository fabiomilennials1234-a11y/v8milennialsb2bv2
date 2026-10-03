/**
 * Navegação de página de Disparos — Painel · Novo disparo. As duas são rotas
 * (`/disparos`, `/disparos/novo`); a pílula só troca de rota.
 */
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DisparosTab = "painel" | "novo";

const ROUTE: Record<DisparosTab, string> = { painel: "/disparos", novo: "/disparos/novo" };

export function DisparosTabs({ active }: { active: DisparosTab }) {
  const navigate = useNavigate();
  return (
    <Tabs value={active} onValueChange={(v) => v !== active && navigate(ROUTE[v as DisparosTab])}>
      <TabsList variant="pill" aria-label="Seções de Disparos">
        <TabsTrigger value="painel">Painel</TabsTrigger>
        <TabsTrigger value="novo">Novo disparo</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
