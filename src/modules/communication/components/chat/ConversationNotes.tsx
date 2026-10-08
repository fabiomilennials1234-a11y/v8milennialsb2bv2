import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  StickyNote,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/modules/identity";
import {
  useConversationNotes,
  useCreateConversationNote,
  useUpdateConversationNote,
  useDeleteConversationNote,
  type ConversationNote,
} from "@/modules/communication/hooks/useConversationNotes";
import { notifyError } from "@/shared/errors";

interface ConversationNotesProps {
  leadId: string;
}

export default function ConversationNotes({ leadId }: ConversationNotesProps) {
  const { user } = useAuth();
  const { data: notes, isLoading } = useConversationNotes(leadId);
  const createNote = useCreateConversationNote();
  const updateNote = useUpdateConversationNote();
  const deleteNote = useDeleteConversationNote();

  const [isExpanded, setIsExpanded] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const newNoteRef = useRef<HTMLTextAreaElement>(null);
  const editNoteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showNewNote && newNoteRef.current) {
      newNoteRef.current.focus();
    }
  }, [showNewNote]);

  useEffect(() => {
    if (editingId && editNoteRef.current) {
      editNoteRef.current.focus();
    }
  }, [editingId]);

  const handleNewNote = () => {
    if (!isExpanded) setIsExpanded(true);
    setShowNewNote(true);
  };

  const handleCancelNew = () => {
    setShowNewNote(false);
    setNewNoteContent("");
  };

  const handleSaveNew = async () => {
    const trimmed = newNoteContent.trim();
    if (!trimmed) return;
    try {
      await createNote.mutateAsync({ leadId, content: trimmed });
      setNewNoteContent("");
      setShowNewNote(false);
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível salvar nota." });
    }
  };

  const handleStartEdit = (note: ConversationNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleSaveEdit = async () => {
    const trimmed = editContent.trim();
    if (!trimmed || !editingId) return;
    try {
      await updateNote.mutateAsync({ id: editingId, leadId, content: trimmed });
      setEditingId(null);
      setEditContent("");
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível atualizar nota." });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNote.mutateAsync({ id, leadId });
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível excluir nota." });
    }
  };

  const handleNewNoteKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      handleSaveNew();
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    }
  };

  const noteCount = notes?.length ?? 0;
  const sortedNotes = notes ?? [];

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-warning-strong hover:text-warning-strong/80 transition-colors"
        >
          <StickyNote className="h-4 w-4" />
          <span>Notas internas</span>
          {noteCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-warning/20 text-warning-strong border-0 text-xs px-1.5 py-0"
            >
              {noteCount}
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewNote}
          className="h-7 text-xs text-warning-strong hover:bg-warning/15 hover:text-warning-strong"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Nova nota
        </Button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Warning text */}
          <p className="flex items-center gap-1.5 text-[11px] text-warning-strong/80">
            <StickyNote className="h-3 w-3 flex-shrink-0" />
            Visível apenas para a equipe. Nunca enviado ao cliente.
          </p>

          {/* New note input */}
          {showNewNote && (
            <div className="space-y-2">
              <Textarea
                ref={newNoteRef}
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                onKeyDown={handleNewNoteKeyDown}
                placeholder="Escreva uma nota interna sobre esta conversa..."
                className="min-h-[80px] text-sm border-warning/40 bg-card focus-visible:ring-warning/50 resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelNew}
                  className="h-7 text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveNew}
                  disabled={!newNoteContent.trim() || createNote.isPending}
                  className="h-7 text-xs bg-warning text-warning-foreground shadow-none hover:bg-warning/90"
                >
                  {createNote.isPending && (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  )}
                  Salvar
                </Button>
              </div>
            </div>
          )}

          {/* Notes list */}
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-warning-strong" />
            </div>
          ) : sortedNotes.length === 0 ? (
            <p className="text-center text-xs text-warning-strong/70 py-3">
              Nenhuma nota registrada nesta conversa.
            </p>
          ) : (
            <div className="max-h-[250px] overflow-y-auto space-y-2">
              {sortedNotes.map((note) => (
                <div
                  key={note.id}
                  className="group rounded-lg border border-warning/25 bg-card p-2.5"
                >
                  {editingId === note.id ? (
                    <div className="space-y-2">
                      <Textarea
                        ref={editNoteRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        className="min-h-[60px] text-sm border-warning/40 bg-card focus-visible:ring-warning/50 resize-none"
                      />
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                          className="h-6 w-6 p-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={!editContent.trim() || updateNote.isPending}
                          className="h-6 w-6 p-0 text-warning-strong"
                        >
                          {updateNote.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap text-foreground">
                        {note.content}
                      </p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(note.created_at), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                          {note.updated_at !== note.created_at && " (editada)"}
                        </span>
                        {user?.id === note.author_id && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStartEdit(note)}
                              className="h-6 w-6 p-0 text-warning-strong/70 hover:text-warning-strong"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(note.id)}
                              disabled={deleteNote.isPending}
                              className="h-6 w-6 p-0 text-destructive/70 hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
