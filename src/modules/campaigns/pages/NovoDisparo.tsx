/**
 * /disparos/novo — the Disparos creation flow (Wizard Linear, #904).
 *
 * Thin route wrapper around `DisparoWizard`. Open to any member (no feature
 * gate — the porta canônica is universal). Closing or finishing returns to the
 * /disparos home where live plans are monitored.
 */
import { useNavigate } from "react-router-dom";
import { DisparoWizard } from "@/modules/campaigns/components/disparo-wizard/DisparoWizard";

export default function NovoDisparo() {
  const navigate = useNavigate();
  const toHome = () => navigate("/disparos");

  return <DisparoWizard onClose={toHome} onFinish={toHome} />;
}
