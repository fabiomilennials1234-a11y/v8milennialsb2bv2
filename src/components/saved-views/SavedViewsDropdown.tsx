import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bookmark, ChevronDown, MoreHorizontal, Pencil, Trash2, Share2, Plus, Eye } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSavedViews, useDeleteSavedView } from "@/hooks/useSavedViews";
import { useOrganization } from "@/hooks/useOrganization";
import { resolveFilters } from "@/types/saved-views";
import { SaveViewDialog } from "./SaveViewDialog";
import type { SavedView } from "@/types/saved-views";
import { toast } from "sonner";

interface SavedViewsDropdownProps<T extends Record<string, unknown>> {
  entityType: string;
  currentFilters: T;
  defaultFilters: T;
  onApplyFilters: (filters: T) => void;
  activeViewId: string | null;
  onActiveViewChange: (viewId: string | null) => void;
}

export function SavedViewsDropdown<T extends Record<string, unknown>>({
  entityType,
  currentFilters,
  defaultFilters,
  onApplyFilters,
  activeViewId,
  onActiveViewChange,
}: SavedViewsDropdownProps<T>) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);

  const { data: views = [] } = useSavedViews(entityType);
  const deleteView = useDeleteSavedView();
  const { teamMemberId } = useOrganization();

  const activeView = activeViewId
    ? views.find((v) => v.id === activeViewId) ?? null
    : null;

  const filtersChanged =
    JSON.stringify(currentFilters) !== JSON.stringify(defaultFilters);

  const handleSelectView = (view: SavedView) => {
    const resolved = resolveFilters(
      view.filters as T,
      teamMemberId ?? null
    );
    const merged = { ...defaultFilters, ...resolved };
    onApplyFilters(merged);
    onActiveViewChange(view.id);
    setPopoverOpen(false);
  };

  const handleClearView = () => {
    onApplyFilters(defaultFilters);
    onActiveViewChange(null);
    setPopoverOpen(false);
  };

  const handleDelete = async (view: SavedView) => {
    try {
      await deleteView.mutateAsync({ id: view.id, entityType });
      if (activeViewId === view.id) {
        onApplyFilters(defaultFilters);
        onActiveViewChange(null);
      }
      toast.success("View excluída");
    } catch {
      toast.error("Erro ao excluir view");
    }
  };

  const handleEdit = (view: SavedView) => {
    setEditingView(view);
    setSaveDialogOpen(true);
    setPopoverOpen(false);
  };

  const systemViews = views.filter((v) => v.is_system);
  const userViews = views.filter((v) => !v.is_system);

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-1.5",
              activeView && "border-primary/50 bg-primary/5 text-primary"
            )}
          >
            <Bookmark className="w-4 h-4" />
            {activeView ? activeView.name : "Views"}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          {filtersChanged && !activeView && (
            <>
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-primary"
                  onClick={() => {
                    setSaveDialogOpen(true);
                    setPopoverOpen(false);
                  }}
                >
                  <Plus className="w-4 h-4" />
                  Salvar filtros atuais como view
                </Button>
              </div>
              <Separator />
            </>
          )}

          {activeView && (
            <>
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-muted-foreground"
                  onClick={handleClearView}
                >
                  <Eye className="w-4 h-4" />
                  Limpar view ativa
                </Button>
              </div>
              <Separator />
            </>
          )}

          {systemViews.length > 0 && (
            <div className="p-1">
              <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Padrão
              </p>
              {systemViews.map((view) => (
                <ViewItem
                  key={view.id}
                  view={view}
                  isActive={activeViewId === view.id}
                  onSelect={handleSelectView}
                  onEdit={null}
                  onDelete={null}
                />
              ))}
            </div>
          )}

          {userViews.length > 0 && (
            <>
              {systemViews.length > 0 && <Separator />}
              <div className="p-1">
                <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Minhas Views
                </p>
                {userViews.map((view) => (
                  <ViewItem
                    key={view.id}
                    view={view}
                    isActive={activeViewId === view.id}
                    onSelect={handleSelectView}
                    onEdit={() => handleEdit(view)}
                    onDelete={() => handleDelete(view)}
                  />
                ))}
              </div>
            </>
          )}

          {views.length === 0 && !filtersChanged && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma view salva.
              <br />
              Aplique filtros e salve como view.
            </div>
          )}

          <Separator />
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                setSaveDialogOpen(true);
                setPopoverOpen(false);
              }}
            >
              <Plus className="w-4 h-4" />
              Nova view
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) setEditingView(null);
        }}
        entityType={entityType}
        currentFilters={currentFilters}
        editingView={editingView}
      />
    </>
  );
}

function ViewItem({
  view,
  isActive,
  onSelect,
  onEdit,
  onDelete,
}: {
  view: SavedView;
  isActive: boolean;
  onSelect: (view: SavedView) => void;
  onEdit: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors group",
        "hover:bg-muted/50",
        isActive && "bg-primary/10 text-primary"
      )}
      onClick={() => onSelect(view)}
    >
      <Bookmark
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="text-sm flex-1 truncate">{view.name}</span>
      {view.is_shared && (
        <Share2 className="w-3 h-3 text-muted-foreground shrink-0" />
      )}
      {(onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <button className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Editar
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Excluir
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
