export { moveStage } from "./move-stage.ts";
export { scheduleMeeting } from "./schedule-meeting.ts";
export { updateLead } from "./update-lead.ts";
export { calculateScore } from "./calculate-score.ts";
export { addTag, removeTag } from "./tag-operations.ts";
export { updateLeadField, updateCustomField, updateRating } from "./lead-field-operations.ts";
export { duplicateToPipe, removeFromPipe, markAsLost } from "./pipe-operations.ts";
export { sendWhatsApp } from "./send-whatsapp.ts";
export { sendWhatsAppAudio, sendWhatsAppImage, sendWhatsAppSticker } from "./send-whatsapp-media.ts";
export { sendWhatsAppTemplate, sendWhatsAppMenu, sendWhatsAppPixButton } from "./send-whatsapp-rich.ts";
export { sendMetaMessage, sendSemiAutomatic } from "./send-meta.ts";
export { addToCampaign, removeFromCampaign, moveCampaignStage, pauseCampaignSequence, resumeCampaignSequence } from "./campaign-operations.ts";
export { createCalendarEvent } from "./calendar-operations.ts";
export { createTinyerpOrder, createTinyerpUpsellOrder } from "./tinyerp-operations.ts";
export { assignResponsible, assignSdr, assignCloser, notifyTeamMember } from "./team-operations.ts";
export { createFollowup } from "./followup-operations.ts";
export { applyChecklist } from "./checklist-operations.ts";
export { sendCampaignMessage } from "./send-campaign-message.ts";
export { generateAiMessage, summarizeConversation, evaluateConversation, queueScheduleMeeting } from "./ai-operations.ts";
export type { ActionInput, ActionResult, ActionHandler } from "./types.ts";

import type { ActionHandler } from "./types.ts";
import { moveStage } from "./move-stage.ts";
import { scheduleMeeting } from "./schedule-meeting.ts";
import { updateLead } from "./update-lead.ts";
import { calculateScore } from "./calculate-score.ts";
import { addTag, removeTag } from "./tag-operations.ts";
import { updateLeadField, updateCustomField, updateRating } from "./lead-field-operations.ts";
import { duplicateToPipe, removeFromPipe, markAsLost } from "./pipe-operations.ts";
import { sendWhatsApp } from "./send-whatsapp.ts";
import { sendWhatsAppAudio, sendWhatsAppImage, sendWhatsAppSticker } from "./send-whatsapp-media.ts";
import { sendWhatsAppTemplate, sendWhatsAppMenu, sendWhatsAppPixButton } from "./send-whatsapp-rich.ts";
import { sendMetaMessage, sendSemiAutomatic } from "./send-meta.ts";
import { addToCampaign, removeFromCampaign, moveCampaignStage, pauseCampaignSequence, resumeCampaignSequence } from "./campaign-operations.ts";
import { createCalendarEvent } from "./calendar-operations.ts";
import { createTinyerpOrder, createTinyerpUpsellOrder } from "./tinyerp-operations.ts";
import { assignResponsible, assignSdr, assignCloser, notifyTeamMember } from "./team-operations.ts";
import { createFollowup } from "./followup-operations.ts";
import { applyChecklist } from "./checklist-operations.ts";
import { sendCampaignMessage } from "./send-campaign-message.ts";
import { generateAiMessage, summarizeConversation, evaluateConversation, queueScheduleMeeting } from "./ai-operations.ts";

export const handlers: Record<string, ActionHandler> = {
  move_stage: moveStage,
  schedule_meeting: scheduleMeeting,
  update_lead: updateLead,
  calculate_score: calculateScore,
  add_tag: addTag,
  remove_tag: removeTag,
  update_lead_field: updateLeadField,
  update_custom_field: updateCustomField,
  update_rating: updateRating,
  duplicate_to_pipe: duplicateToPipe,
  remove_from_pipe: removeFromPipe,
  mark_as_lost: markAsLost,
  send_whatsapp: sendWhatsApp,
  send_whatsapp_audio: sendWhatsAppAudio,
  send_whatsapp_image: sendWhatsAppImage,
  send_whatsapp_sticker: sendWhatsAppSticker,
  send_whatsapp_template: sendWhatsAppTemplate,
  send_whatsapp_menu: sendWhatsAppMenu,
  send_whatsapp_pix_button: sendWhatsAppPixButton,
  send_meta_message: sendMetaMessage,
  send_semi_automatic: sendSemiAutomatic,
  add_to_campaign: addToCampaign,
  remove_from_campaign: removeFromCampaign,
  move_campaign_stage: moveCampaignStage,
  pause_campaign_sequence: pauseCampaignSequence,
  resume_campaign_sequence: resumeCampaignSequence,
  create_calendar_event: createCalendarEvent,
  create_tinyerp_order: createTinyerpOrder,
  create_tinyerp_upsell_order: createTinyerpUpsellOrder,
  assign_responsible: assignResponsible,
  assign_sdr: assignSdr,
  assign_closer: assignCloser,
  notify_team_member: notifyTeamMember,
  create_followup: createFollowup,
  apply_checklist: applyChecklist,
  send_campaign_message: sendCampaignMessage,
  generate_ai_message: generateAiMessage,
  summarize_conversation: summarizeConversation,
  evaluate_conversation: evaluateConversation,
  queue_schedule_meeting: queueScheduleMeeting,
};
