/**
 * useLeadActionGates — central permission gates for the lead detail modal.
 *
 * Encapsulates the translation from product-level action names
 * (canEditField, canDelete, canReassign, …) to the underlying AppAction
 * cascade defined in src/lib/permissions.ts.
 *
 * Fail-closed contract: while any dependency is loading, every gate
 * returns `{ allowed: false, isLoading: true }`. UI consumers may show
 * disabled+tooltip until the resolver settles.
 *
 * Granular AppAction keys (manage_meeting, manage_proposal, manage_lead_tags,
 * etc) are deferred to follow-up issues — for now the cotidiano gates are
 * routed through a single generic check based on role (admin/master allow
 * everything; membro allows cotidianos and denies destrutivos), and the
 * destructive gates route through the existing `delete_lead` /
 * `move_pipe_record` AppAction entries.
 */

import { useIdentity } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
export interface Gate {
  allowed: boolean;
  reason?: string;
  isLoading: boolean;
}

export interface LeadActionGates {
  canEditField: Gate;
  canMoveMeeting: Gate;
  canEditProposal: Gate;
  canDelete: Gate;
  canReassign: Gate;
  canRemoveFromPipe: Gate;
  canAddToPipe: Gate;
  canManageTags: Gate;
  canToggleAi: Gate;
  canMention: Gate;
}

const deny = (reason: string, isLoading = false): Gate => ({
  allowed: false,
  reason,
  isLoading,
});
const allow = (reason = "ok"): Gate => ({ allowed: true, reason, isLoading: false });

export function useLeadActionGates(leadId: string | null | undefined): LeadActionGates {
  const identity = useIdentity();

  // Underlying AppAction checks — these encapsulate feature_permissions +
  // role matrix + master + admin cascade.
  const deleteCheck = useCanDo("delete_lead");
  const movePipeCheck = useCanDo("move_pipe_record");
  const createLeadCheck = useCanDo("create_lead");
  const sendMessageCheck = useCanDo("send_message");
  const reassignCheck = useCanDo("reassign_lead");
  const removeFromPipeCheck = useCanDo("remove_lead_from_pipe");

  const anyLoading =
    identity.isLoading ||
    deleteCheck.isLoading ||
    movePipeCheck.isLoading ||
    createLeadCheck.isLoading ||
    sendMessageCheck.isLoading ||
    reassignCheck.isLoading ||
    removeFromPipeCheck.isLoading;

  // Fail-closed during loading.
  if (anyLoading) {
    const loadingGate: Gate = { allowed: false, reason: "loading", isLoading: true };
    return {
      canEditField: loadingGate,
      canMoveMeeting: loadingGate,
      canEditProposal: loadingGate,
      canDelete: loadingGate,
      canReassign: loadingGate,
      canRemoveFromPipe: loadingGate,
      canAddToPipe: loadingGate,
      canManageTags: loadingGate,
      canToggleAi: loadingGate,
      canMention: loadingGate,
    };
  }

  // No target → nothing to allow.
  if (!leadId) {
    const noTarget = deny("no_lead");
    return {
      canEditField: noTarget,
      canMoveMeeting: noTarget,
      canEditProposal: noTarget,
      canDelete: noTarget,
      canReassign: noTarget,
      canRemoveFromPipe: noTarget,
      canAddToPipe: noTarget,
      canManageTags: noTarget,
      canToggleAi: noTarget,
      canMention: noTarget,
    };
  }

  // Single canonical source: identity.effectiveRole already normalizes
  // team_members.role (admin | sdr | closer | member) → "admin" | "member",
  // and isMaster → admin. The typed union forbids a "membro" literal at
  // compile time — the original bug was `role === "membro"`, which never
  // matched the real DB value "member", silently denying every non-admin.
  const isAdmin = identity.isAdmin;
  const isMember = identity.effectiveRole === "member";

  // Destrutivos — route through existing AppAction gates.
  const canDelete: Gate = deleteCheck.allowed
    ? allow("delete_lead")
    : deny("Sem permissão para excluir leads");
  const canReassign: Gate = reassignCheck.allowed
    ? allow(reassignCheck.reason ?? "reassign_lead")
    : deny("Sem permissão para atribuir responsáveis");
  const canRemoveFromPipe: Gate = removeFromPipeCheck.allowed
    ? allow(removeFromPipeCheck.reason ?? "remove_lead_from_pipe")
    : deny("Sem permissão para remover de pipe");

  // Cotidianos — admin/master sempre OK; membro OK por padrão.
  const cotidianoOk = isAdmin || isMember;
  const cotidianoReason = isAdmin ? "admin" : isMember ? "member" : "no_role";
  const cotidianoGate: Gate = cotidianoOk
    ? allow(cotidianoReason)
    : deny("Sem permissão");

  // Move stage / meeting / proposal usa o gate explícito existente.
  const canMoveMeeting: Gate = movePipeCheck.allowed
    ? allow("move_pipe_record")
    : deny("Sem permissão para mover no pipe");
  const canEditProposal: Gate = movePipeCheck.allowed
    ? allow("move_pipe_record")
    : deny("Sem permissão para editar propostas");

  // Add to pipe — gate de criação genérico.
  const canAddToPipe: Gate = createLeadCheck.allowed
    ? allow("create_lead")
    : deny("Sem permissão para adicionar a pipes");

  return {
    canEditField: cotidianoGate,
    canMoveMeeting,
    canEditProposal,
    canDelete,
    canReassign,
    canRemoveFromPipe,
    canAddToPipe,
    canManageTags: cotidianoGate,
    canToggleAi: cotidianoGate,
    canMention: cotidianoGate,
  };
}
