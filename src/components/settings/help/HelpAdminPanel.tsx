import { useState } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  ChevronLeft,
  Upload,
  Image,
  GripVertical,
  Eye,
  EyeOff,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useHelpCategories,
  useHelpArticles,
  useCreateHelpCategory,
  useUpdateHelpCategory,
  useDeleteHelpCategory,
  useCreateHelpArticle,
  useUpdateHelpArticle,
  useDeleteHelpArticle,
  useUploadHelpMedia,
  type HelpCategory,
  type HelpArticle,
  type HelpArticleMedia,
} from "@/hooks/useHelpCenter";
import { toast } from "sonner";

const iconOptions = [
  "Rocket", "LayoutGrid", "MessageSquare", "Bot", "Calendar",
  "BarChart3", "Settings", "HelpCircle", "BookOpen", "Users",
  "Zap", "Shield", "Globe", "Tag", "FileText",
];

// ---- Category Form ----

interface CategoryFormProps {
  category?: HelpCategory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CategoryForm({ category, open, onOpenChange }: CategoryFormProps) {
  const [form, setForm] = useState({
    name: category?.name || "",
    slug: category?.slug || "",
    icon: category?.icon || "HelpCircle",
    description: category?.description || "",
    sort_order: category?.sort_order || 0,
  });

  const createCategory = useCreateHelpCategory();
  const updateCategory = useUpdateHelpCategory();

  const handleSlugFromName = (name: string) => {
    const slug = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    setForm((f) => ({ ...f, name, slug }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    try {
      if (category) {
        await updateCategory.mutateAsync({ id: category.id, ...form });
        toast.success("Categoria atualizada!");
      } else {
        await createCategory.mutateAsync(form);
        toast.success("Categoria criada!");
      }
      onOpenChange(false);
    } catch {
      toast.error("Erro ao salvar categoria");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {category ? "Editar Categoria" : "Nova Categoria"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Nome</Label>
            <Input
              value={form.name}
              onChange={(e) => handleSlugFromName(e.target.value)}
              placeholder="Ex: Leads & Kanban"
            />
          </div>
          <div className="grid gap-2">
            <Label>Slug</Label>
            <Input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="leads-kanban"
            />
          </div>
          <div className="grid gap-2">
            <Label>Ícone</Label>
            <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {iconOptions.map((icon) => (
                  <SelectItem key={icon} value={icon}>
                    {icon}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Descrição</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Descrição curta da categoria"
            />
          </div>
          <div className="grid gap-2">
            <Label>Ordem</Label>
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
              className="w-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createCategory.isPending || updateCategory.isPending}
          >
            {category ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Article Form ----

interface ArticleFormProps {
  article?: HelpArticle | null;
  categories: HelpCategory[];
  defaultCategoryId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ArticleForm({ article, categories, defaultCategoryId, open, onOpenChange }: ArticleFormProps) {
  const [form, setForm] = useState({
    category_id: article?.category_id || defaultCategoryId || "",
    title: article?.title || "",
    summary: article?.summary || "",
    content: article?.content || "",
    tags: (article?.tags || []).join(", "),
    sort_order: article?.sort_order || 0,
    is_published: article?.is_published ?? true,
    media: (article?.media || []) as HelpArticleMedia[],
  });

  const createArticle = useCreateHelpArticle();
  const updateArticle = useUpdateHelpArticle();
  const uploadMedia = useUploadHelpMedia();

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadMedia.mutateAsync(file);
      const isGif = file.type === "image/gif" || file.name.endsWith(".gif");
      setForm((f) => ({
        ...f,
        media: [...f.media, { url, type: isGif ? "gif" : "image", caption: "" }],
      }));
      toast.success("Mídia enviada!");
    } catch {
      toast.error("Erro ao enviar mídia");
    }
  };

  const removeMedia = (index: number) => {
    setForm((f) => ({
      ...f,
      media: f.media.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.category_id) {
      toast.error("Título e categoria são obrigatórios");
      return;
    }
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const payload = {
        category_id: form.category_id,
        title: form.title,
        summary: form.summary || null,
        content: form.content,
        tags,
        sort_order: form.sort_order,
        is_published: form.is_published,
        media: form.media,
      };

      if (article) {
        await updateArticle.mutateAsync({ id: article.id, ...payload });
        toast.success("Artigo atualizado!");
      } else {
        await createArticle.mutateAsync(payload);
        toast.success("Artigo criado!");
      }
      onOpenChange(false);
    } catch {
      toast.error("Erro ao salvar artigo");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {article ? "Editar Artigo" : "Novo Artigo"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Categoria</Label>
            <Select
              value={form.category_id}
              onValueChange={(v) => setForm({ ...form, category_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar categoria" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Título</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: Como criar um funil de vendas"
            />
          </div>

          <div className="grid gap-2">
            <Label>Resumo</Label>
            <Input
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="Descrição curta exibida no card"
            />
          </div>

          <div className="grid gap-2">
            <Label>Conteúdo (Markdown)</Label>
            <Textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="# Título&#10;&#10;Escreva o conteúdo em Markdown..."
              rows={12}
              className="font-mono text-sm"
            />
          </div>

          <div className="grid gap-2">
            <Label>Tags (separadas por vírgula)</Label>
            <Input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="guia, kanban, leads"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="grid gap-2">
              <Label>Ordem</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className="w-24"
              />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <Switch
                checked={form.is_published}
                onCheckedChange={(v) => setForm({ ...form, is_published: v })}
              />
              <Label>{form.is_published ? "Publicado" : "Rascunho"}</Label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Mídias (Screenshots / GIFs)</Label>
            <div className="flex flex-wrap gap-3">
              {form.media.map((m, i) => (
                <div key={i} className="relative group w-24 h-24 rounded-lg overflow-hidden border border-border">
                  <img src={m.url} alt={m.caption || ""} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeMedia(i)}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <label className="w-24 h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground mt-1">Upload</span>
                <input
                  type="file"
                  accept="image/*,.gif"
                  className="hidden"
                  onChange={handleMediaUpload}
                />
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createArticle.isPending || updateArticle.isPending}
          >
            {article ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main Admin Panel ----

export function HelpAdminPanel() {
  const { data: categories = [] } = useHelpCategories();
  const { data: articles = [] } = useHelpArticles();
  const deleteCategory = useDeleteHelpCategory();
  const deleteArticle = useDeleteHelpArticle();

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<HelpCategory | null>(null);
  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<HelpArticle | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<{ type: "category" | "article"; id: string; name: string } | null>(null);

  const handleEditCategory = (cat: HelpCategory) => {
    setEditingCategory(cat);
    setCategoryDialogOpen(true);
  };

  const handleNewCategory = () => {
    setEditingCategory(null);
    setCategoryDialogOpen(true);
  };

  const handleEditArticle = (art: HelpArticle) => {
    setEditingArticle(art);
    setArticleDialogOpen(true);
  };

  const handleNewArticle = (categoryId?: string) => {
    setEditingArticle(null);
    setDefaultCategoryId(categoryId || "");
    setArticleDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "category") {
        await deleteCategory.mutateAsync(deleteTarget.id);
        toast.success("Categoria removida!");
      } else {
        await deleteArticle.mutateAsync(deleteTarget.id);
        toast.success("Artigo removido!");
      }
      setDeleteTarget(null);
    } catch {
      toast.error("Erro ao remover");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Gerenciar Central de Ajuda</h3>
          <p className="text-sm text-muted-foreground">
            Crie e edite categorias e artigos de ajuda
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleNewCategory} className="gap-1">
            <FolderPlus className="w-4 h-4" />
            Nova Categoria
          </Button>
          <Button size="sm" onClick={() => handleNewArticle()} className="gap-1">
            <Plus className="w-4 h-4" />
            Novo Artigo
          </Button>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <p>Nenhuma categoria criada.</p>
          <p className="text-sm mt-1">Crie categorias para organizar seus artigos de ajuda.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => {
            const catArticles = articles.filter((a) => a.category_id === category.id);
            return (
              <div key={category.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{category.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {catArticles.length} artigos
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleNewArticle(category.id)}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleEditCategory(category)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() =>
                        setDeleteTarget({ type: "category", id: category.id, name: category.name })
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {catArticles.length > 0 && (
                  <div className="space-y-1">
                    {catArticles.map((art) => (
                      <div
                        key={art.id}
                        className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {art.is_published ? (
                            <Eye className="w-3.5 h-3.5 text-success" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <span className="text-sm">{art.title}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleEditArticle(art)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() =>
                              setDeleteTarget({ type: "article", id: art.id, name: art.title })
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Category Dialog */}
      <CategoryForm
        category={editingCategory}
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          setCategoryDialogOpen(open);
          if (!open) setEditingCategory(null);
        }}
      />

      {/* Article Dialog */}
      <ArticleForm
        article={editingArticle}
        categories={categories}
        defaultCategoryId={defaultCategoryId}
        open={articleDialogOpen}
        onOpenChange={(open) => {
          setArticleDialogOpen(open);
          if (!open) {
            setEditingArticle(null);
            setDefaultCategoryId("");
          }
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover {deleteTarget?.type === "category" ? "categoria" : "artigo"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "category"
                ? `A categoria "${deleteTarget?.name}" e todos os seus artigos serão removidos permanentemente.`
                : `O artigo "${deleteTarget?.name}" será removido permanentemente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
