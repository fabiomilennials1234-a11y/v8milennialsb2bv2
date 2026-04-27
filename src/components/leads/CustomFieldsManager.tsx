import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  GripVertical,
  Type,
  Hash,
  Calendar,
  List,
  ToggleLeft,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useLeadCustomFields,
  useCreateCustomField,
  useDeleteCustomField,
  type CustomField,
} from "@/hooks/useLeadCustomFields";

const fieldTypeIcons: Record<string, any> = {
  text: Type,
  number: Hash,
  date: Calendar,
  select: List,
  boolean: ToggleLeft,
};

const fieldTypeLabels: Record<string, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Lista de opções",
  boolean: "Sim/Não",
};

export function CustomFieldsManager() {
  const [isAddingField, setIsAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<string>("text");
  const [newFieldOptions, setNewFieldOptions] = useState<string>("");
  const [fieldToDelete, setFieldToDelete] = useState<CustomField | null>(null);
  
  const { data: fields = [], isLoading } = useLeadCustomFields();
  const createField = useCreateCustomField();
  const deleteField = useDeleteCustomField();
  
  // Criar novo campo
  const handleCreateField = async () => {
    if (!newFieldName.trim()) {
      toast.error("Nome do campo é obrigatório");
      return;
    }
    
    if (newFieldType === "select" && !newFieldOptions.trim()) {
      toast.error("Adicione opções para o campo de lista");
      return;
    }
    
    try {
      const options = newFieldType === "select"
        ? newFieldOptions.split(",").map(o => o.trim()).filter(o => o)
        : undefined;
      
      await createField.mutateAsync({
        field_name: newFieldName.trim(),
        field_type: newFieldType,
        field_options: options,
      });
      
      toast.success("Campo criado com sucesso!");
      setNewFieldName("");
      setNewFieldType("text");
      setNewFieldOptions("");
      setIsAddingField(false);
    } catch (error: any) {
      if (error.message?.includes("duplicate")) {
        toast.error("Já existe um campo com esse nome");
      } else {
        toast.error("Erro ao criar campo: " + error.message);
      }
    }
  };
  
  // Deletar campo
  const handleDeleteField = async () => {
    if (!fieldToDelete) return;
    
    try {
      await deleteField.mutateAsync(fieldToDelete.id);
      toast.success("Campo excluído com sucesso!");
      setFieldToDelete(null);
    } catch (error: any) {
      toast.error("Erro ao excluir campo: " + error.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Lista de campos existentes */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Campos existentes</h4>
        
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : fields.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
            <Type className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum campo personalizado</p>
            <p className="text-xs mt-1">Crie campos para adicionar informações extras aos leads</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {fields.map((field) => {
                const Icon = fieldTypeIcons[field.field_type] || Type;
                
                return (
                  <motion.div
                    key={field.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border group"
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground/30" />
                    
                    <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{field.field_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {fieldTypeLabels[field.field_type]}
                        </Badge>
                        {field.field_type === "select" && field.field_options && (
                          <span className="text-[10px] text-muted-foreground">
                            {(field.field_options as string[]).length} opções
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setFieldToDelete(field)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
      
      {/* Adicionar novo campo */}
      {isAddingField ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="border border-primary/20 rounded-lg p-4 bg-primary/5"
        >
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-sm">Novo Campo</h4>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6"
              onClick={() => {
                setIsAddingField(false);
                setNewFieldName("");
                setNewFieldType("text");
                setNewFieldOptions("");
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Nome do campo</Label>
              <Input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Ex: CPF, Cargo, Interesse..."
              />
            </div>
            
            <div className="grid gap-2">
              <Label>Tipo do campo</Label>
              <Select value={newFieldType} onValueChange={setNewFieldType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(fieldTypeLabels).map(([value, label]) => {
                    const Icon = fieldTypeIcons[value];
                    return (
                      <SelectItem key={value} value={value}>
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4" />
                          {label}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            {newFieldType === "select" && (
              <div className="grid gap-2">
                <Label>Opções (separadas por vírgula)</Label>
                <Input
                  value={newFieldOptions}
                  onChange={(e) => setNewFieldOptions(e.target.value)}
                  placeholder="Ex: Opção 1, Opção 2, Opção 3"
                />
              </div>
            )}
            
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsAddingField(false);
                  setNewFieldName("");
                  setNewFieldType("text");
                  setNewFieldOptions("");
                }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleCreateField}
                disabled={createField.isPending}
              >
                {createField.isPending ? "Criando..." : "Criar Campo"}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => setIsAddingField(true)}
        >
          <Plus className="w-4 h-4" />
          Adicionar Campo Personalizado
        </Button>
      )}
      
      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={!!fieldToDelete} onOpenChange={() => setFieldToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campo?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o campo "{fieldToDelete?.field_name}"? 
              Todos os valores preenchidos neste campo serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteField}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
