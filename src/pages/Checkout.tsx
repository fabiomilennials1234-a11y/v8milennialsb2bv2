import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { CheckoutWizard } from "@/components/checkout/CheckoutWizard";

export default function Checkout() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    // Not logged in -> redirect to signup
    if (!user) {
      navigate("/signup", { replace: true });
      return;
    }

    // Check if user already has an active org -> redirect to dashboard
    async function checkOrg() {
      try {
        const { data } = await supabase
          .from("team_members")
          .select("organization_id, is_active")
          .eq("user_id", user!.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (data?.organization_id) {
          navigate("/dashboard", { replace: true });
          return;
        }
      } catch {
        // Fail open: let them proceed to checkout
      }
      setChecking(false);
    }

    checkOrg();
  }, [user, authLoading, navigate]);

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Preparando checkout...</p>
        </div>
      </div>
    );
  }

  return <CheckoutWizard />;
}
