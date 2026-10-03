import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OptimisticLockConflictError } from "@/modules/platform/lib/optimistic-lock";

/**
 * Standard handler for `OptimisticLockConflictError` (#307).
 *
 * Two users tried to edit the same lead within the same second. The
 * UI shows a toast explaining the conflict, then invalidates the
 * lead-detail / pipeline caches so a fresh fetch wins. Callers wrap
 * their mutation's onError with this — non-conflict errors are
 * re-thrown so the existing error path runs.
 */
export function useOptimisticConflictHandler() {
  const queryClient = useQueryClient();

  return (
    error: unknown,
    options?: { leadId?: string; onConflict?: () => void; rethrow?: boolean },
  ) => {
    if (error instanceof OptimisticLockConflictError) {
      toast.info(error.message);
      if (options?.leadId) {
        queryClient.invalidateQueries({ queryKey: ["lead-detail", options.leadId] });
        queryClient.invalidateQueries({ queryKey: ["lead-pipes", options.leadId] });
        queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
        queryClient.invalidateQueries({ queryKey: ["leads"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["leads"] });
        queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      }
      options?.onConflict?.();
      return true; // handled
    }
    if (options?.rethrow) throw error;
    return false; // not a conflict — caller may still want to show a generic toast
  };
}
