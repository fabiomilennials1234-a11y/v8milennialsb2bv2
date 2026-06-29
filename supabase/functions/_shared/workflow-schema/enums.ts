/**
 * Workflow vocabulary — PORTED verbatim from `src/types/workflow.ts` (the frontend source of
 * truth). Deno can't import that file, so this is a deliberate copy; a parity test
 * (tests/unit/workflow-schema-parity.test.ts) guards against drift. Zero imports on purpose.
 * docs/adr/0013.
 */

export const NODE_TYPES = [
  "trigger",
  "action",
  "condition",
  "delay",
  "copilot",
  "end",
  "wait_response",
  "split_ab",
  "webhook_call",
  "goto",
  "wait_business_window",
  "assign_responsible",
] as const;

export const TRIGGER_TYPES = [
  "lead_created",
  "stage_changed",
  "tag_added",
  "score_reached",
  "cron",
  "lead_replied",
  "lead_no_reply",
  "meeting_confirmed",
  "meeting_not_confirmed",
  "proposal_accepted",
  "proposal_lost",
  "followup_overdue",
  "webhook_received",
  "lead_assigned",
  "campaign_status_changed",
  "lead_added_to_campaign",
  "lead_removed_from_campaign",
  "campaign_lead_replied",
  "campaign_lead_no_reply",
  "campaign_completed",
  "field_changed",
  "scheduled_date",
] as const;

export const ACTION_TYPES = [
  "send_whatsapp",
  "send_whatsapp_message",
  "send_whatsapp_audio",
  "send_whatsapp_image",
  "send_whatsapp_sticker",
  "send_whatsapp_template",
  "send_whatsapp_menu",
  "send_whatsapp_pix_button",
  "send_meta_message",
  "send_semi_automatic",
  "send_to_number",
  "move_stage",
  "add_tag",
  "remove_tag",
  "update_lead_field",
  "update_custom_field",
  "update_rating",
  "calculate_score",
  "duplicate_to_pipe",
  "remove_from_pipe",
  "mark_as_lost",
  "add_to_campaign",
  "remove_from_campaign",
  "move_campaign_stage",
  "send_campaign_message",
  "pause_campaign_sequence",
  "resume_campaign_sequence",
  "create_calendar_event",
  "schedule_meeting",
  "create_tinyerp_order",
  "create_tinyerp_upsell_order",
  "assign_responsible",
  "assign_sdr",
  "assign_closer",
  "notify_team_member",
  "create_followup",
  "apply_checklist",
  "generate_ai_message",
  "summarize_conversation",
  "evaluate_conversation",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

export const NODE_TYPE_SET: ReadonlySet<string> = new Set(NODE_TYPES);
export const TRIGGER_TYPE_SET: ReadonlySet<string> = new Set(TRIGGER_TYPES);
export const ACTION_TYPE_SET: ReadonlySet<string> = new Set(ACTION_TYPES);
