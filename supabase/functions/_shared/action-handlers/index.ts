export { moveStage } from "./move-stage.ts";
export { scheduleMeeting } from "./schedule-meeting.ts";
export { updateLead } from "./update-lead.ts";
export { calculateScore } from "./calculate-score.ts";
export type { ActionInput, ActionResult, ActionHandler } from "./types.ts";

import type { ActionHandler } from "./types.ts";
import { moveStage } from "./move-stage.ts";
import { scheduleMeeting } from "./schedule-meeting.ts";
import { updateLead } from "./update-lead.ts";
import { calculateScore } from "./calculate-score.ts";

export const handlers: Record<string, ActionHandler> = {
  move_stage: moveStage,
  schedule_meeting: scheduleMeeting,
  update_lead: updateLead,
  calculate_score: calculateScore,
};
