import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useAutoAdminAssignment() {
  const { user } = useAuth();

  useEffect(() => {
    const checkAndAssignAdmin = async () => {
      if (!user?.id) return;

      try {
        // Check if there are any user roles at all
        const { count, error: countError } = await supabase
          .from("user_roles")
          .select("*", { count: "exact", head: true });

        if (countError) {
          console.error("Error checking user roles:", countError);
          return;
        }

        // If no roles exist, this is the first user - make them admin
        if (count === 0) {
          // Check if current user already has a role
          const { data: existingRole, error: roleError } = await supabase
            .from("user_roles")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

          if (roleError) {
            console.error("Error checking existing role:", roleError);
            return;
          }

          if (!existingRole) {
            const { error: insertError } = await supabase
              .from("user_roles")
              .insert({
                user_id: user.id,
                role: "admin",
              });

            if (insertError) {
              console.error("Error assigning admin role:", insertError);
            } else {
              console.log("First user assigned as admin");
              // Also create a team_member entry for the admin
              const { data: profile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", user.id)
                .single();

              await supabase.from("team_members").insert({
                user_id: user.id,
                name: profile?.full_name || user.email || "Admin",
                role: "closer", // Admins are typically closers too
                is_active: true,
              });
            }
          }
        }
      } catch (error) {
        console.error("Error in auto admin assignment:", error);
      }
    };

    checkAndAssignAdmin();
  }, [user?.id]);
}
