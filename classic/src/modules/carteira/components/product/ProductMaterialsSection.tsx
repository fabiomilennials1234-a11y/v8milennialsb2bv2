import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Image,
  Upload,
  Trash2,
  Loader2,
  Bot,
  ExternalLink,
} from "lucide-react";
import {
  useProductMaterials,
  useUploadProductMaterial,
  useDeleteProductMaterial,
  getProductMaterialUrl,
  MATERIAL_TYPE_LABELS,
  type MaterialType,
  type ProductMaterial,
} from "@/modules/carteira/hooks/useProductMaterials";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
}

const ACCEPTED_TYPES = "application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif";

const MATERIAL_ICON_MAP: Record<string, typeof FileText> = {
  pdf_comercial: FileText,
  apresentacao: FileText,
  catalogo: FileText,
  imagem: Image,
  flyer: Image,
  documento: FileText,
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProductMaterialsSection({ productId }: Props) {
  const { data: materials = [], isLoading } = useProductMaterials(productId);
  const uploadMutation = useUploadProductMaterial();
  const deleteMutation = useDeleteProductMaterial();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<MaterialType>("documento");
  const [description, setDescription] = useState("");

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo 50MB.");
      return;
    }

    try {
      await uploadMutation.mutateAsync({
        productId,
        file,
        materialType: selectedType,
        description: description.trim() || undefined,
      });
      toast.success(`"${file.name}" enviado com sucesso`);
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar arquivo");
    }
  };

  const handleDelete = async (material: ProductMaterial) => {
    try {
      await deleteMutation.mutateAsync({
        id: material.id,
        productId: material.product_id,
        filePath: material.file_path,
      });
      toast.success(`"${material.file_name}" removido`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao remover arquivo");
    }
  };

  const handleOpenFile = async (material: ProductMaterial) => {
    try {
      const url = await getProductMaterialUrl(material.file_path);
      window.open(url, "_blank");
    } catch {
      toast.error("Erro ao abrir arquivo");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Materiais do Produto
        </Label>
        <div className="flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] text-muted-foreground">Acessível pelo Copilot</span>
        </div>
      </div>

      {/* Upload area */}
      <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Tipo do material</Label>
            <Select value={selectedType} onValueChange={(v: MaterialType) => setSelectedType(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Descrição (opcional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Catálogo completo 2026"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileSelect}
          className="hidden"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {uploadMutation.isPending ? "Enviando..." : "Enviar PDF ou Imagem"}
        </Button>
      </div>

      {/* Materials list */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : materials.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">
          Nenhum material cadastrado. Envie PDFs ou imagens para o Copilot usar.
        </p>
      ) : (
        <div className="space-y-2">
          {materials.map((material) => {
            const Icon = MATERIAL_ICON_MAP[material.material_type] || FileText;
            const isImage = material.mime_type.startsWith("image/");

            return (
              <div
                key={material.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50 bg-muted/30 group"
              >
                <div className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                  isImage ? "bg-purple-500/10" : "bg-blue-500/10"
                )}>
                  <Icon className={cn("w-4 h-4", isImage ? "text-purple-500" : "text-blue-500")} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium truncate">{material.file_name}</p>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
                      {MATERIAL_TYPE_LABELS[material.material_type]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {formatFileSize(material.file_size)}
                    </span>
                    {material.summary && (
                      <span className="text-[10px] text-primary flex items-center gap-0.5">
                        <Bot className="w-3 h-3" />
                        Copilot ready
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleOpenFile(material)}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(material)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
