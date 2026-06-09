/**
 * Per-Organization Follow-up Situations page (ADR-0006).
 *
 * Reached from the Copilot page header. Hosts the FollowupSituationsTab control
 * surface in a constrained, settings-style column.
 */

import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FollowupSituationsTab } from "@/modules/copilot/components/FollowupSituationsTab";

export default function CopilotFollowup() {
  const navigate = useNavigate();

  return (
    <div className="p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/copilot")}
            className="-ml-2 mb-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Copilot
          </Button>
        </motion.div>

        <FollowupSituationsTab />
      </div>
    </div>
  );
}
