import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import {
  MessageSquare,
  ArrowRightLeft,
  Tag,
  CalendarPlus,
  UserPlus,
  Play,
  Mic,
  Image,
  FileText,
  Instagram,
  Send,
  Edit3,
  Settings2,
  Star,
  TrendingUp,
  Copy,
  Trash2,
  XCircle,
  Target,
  MinusCircle,
  ArrowRight,
  Calendar,
  CalendarCheck,
  ShoppingCart,
  ShoppingBag,
  Bell,
  Brain,
  FileSearch,
  CheckCircle,
  Briefcase,
} from "lucide-react";
import { BaseNode } from "./BaseNode";
import { ACTION_LABELS } from "@/types/workflow";
import type { ActionNodeData } from "@/types/workflow";

const MESSAGE_TYPE_ICONS: Record<string, React.ElementType> = {
  texto: MessageSquare,
  imagem: Image,
  audio: Mic,
  sticker: Image,
  menu: FileText,
  pix: FileText,
};

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  texto: "Texto",
  imagem: "Imagem",
  audio: "Áudio",
  sticker: "Sticker",
  menu: "Menu",
  pix: "Botão PIX",
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  // Comunicação
  send_whatsapp_message: MessageSquare,
  send_whatsapp: MessageSquare,
  send_whatsapp_audio: Mic,
  send_whatsapp_image: Image,
  send_whatsapp_template: FileText,
  send_meta_message: Instagram,
  send_semi_automatic: Send,
  // Lead Management
  move_stage: ArrowRightLeft,
  add_tag: Tag,
  remove_tag: Tag,
  update_lead_field: Edit3,
  update_custom_field: Settings2,
  update_rating: Star,
  calculate_score: TrendingUp,
  duplicate_to_pipe: Copy,
  remove_from_pipe: Trash2,
  mark_as_lost: XCircle,
  // Campanhas
  add_to_campaign: Target,
  remove_from_campaign: MinusCircle,
  move_campaign_stage: ArrowRight,
  // Agenda
  create_calendar_event: Calendar,
  schedule_meeting: CalendarCheck,
  // TinyERP
  create_deal: Briefcase,
  create_tinyerp_order: ShoppingCart,
  create_tinyerp_upsell_order: ShoppingBag,
  // Equipe
  assign_responsible: UserPlus,
  assign_sdr: UserPlus,
  assign_closer: UserPlus,
  notify_team_member: Bell,
  // Follow-up
  create_followup: CalendarPlus,
  // IA
  generate_ai_message: Brain,
  summarize_conversation: FileSearch,
  evaluate_conversation: CheckCircle,
};

function ActionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ActionNodeData;
  const isUnified = nodeData.actionType === "send_whatsapp_message";
  const mt = nodeData.messageType || "texto";
  const Icon = isUnified
    ? MESSAGE_TYPE_ICONS[mt] || MessageSquare
    : ACTION_ICONS[nodeData.actionType] || Play;
  const subtitle = isUnified
    ? `WhatsApp · ${MESSAGE_TYPE_LABELS[mt] || "Texto"}`
    : ACTION_LABELS[nodeData.actionType] || "Selecione a ação";

  return (
    <BaseNode
      nodeId={id}
      nodeType="action"
      icon={<Icon className="w-5 h-5 text-green-500" />}
      title={nodeData.label || "Ação"}
      subtitle={subtitle}
      selected={selected}
      warning={(data as Record<string, unknown>).__configIssue as string | undefined}
    />
  );
}

export const ActionNode = memo(ActionNodeComponent);
