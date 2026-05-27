/* eslint-disable */
import { readFileSync, writeFileSync } from "node:fs";

const fixes = [
  ["src/modules/engagement/hooks/useActivities.ts", "./useRealtimeSubscription", "@/hooks/useRealtimeSubscription"],
  ["src/modules/engagement/hooks/useChecklists.ts", "./useRealtimeSubscription", "@/hooks/useRealtimeSubscription"],
  ["src/modules/engagement/hooks/useChecklistTemplates.ts", "./useRealtimeSubscription", "@/hooks/useRealtimeSubscription"],
  ["src/modules/engagement/hooks/useChecklistTemplates.ts", "./useChecklists", "@/modules/engagement/hooks/useChecklists"],
  ["src/modules/engagement/hooks/useCloserPerformance.ts", "./useAvatarMap", "@/hooks/useAvatarMap"],
  ["src/modules/engagement/hooks/useFollowUps.ts", "./useRealtimeSubscription", "@/hooks/useRealtimeSubscription"],
  ["src/modules/engagement/hooks/useGoals.ts", "./useRealtimeSubscription", "@/hooks/useRealtimeSubscription"],
  ["src/modules/engagement/hooks/useMilestoneAutoUnlock.ts", "./useBadges", "@/modules/engagement/hooks/useBadges"],
  ["src/modules/engagement/hooks/useMilestoneAutoUnlock.ts", "./useOutboundMetrics", "@/hooks/useOutboundMetrics"],
  ["src/modules/engagement/hooks/useSDRPerformance.ts", "./useAvatarMap", "@/hooks/useAvatarMap"],
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [f, from, to] of fixes) {
  const src = readFileSync(f, "utf8");
  const re = new RegExp('"' + esc(from) + '"', "g");
  const out = src.replace(re, '"' + to + '"');
  if (out !== src) {
    writeFileSync(f, out);
    console.log("FIXED", f, from, "->", to);
  } else {
    console.log("NOOP ", f, from);
  }
}
