import { useState, useMemo, useEffect } from "react";
import { Search, User, Building2, Star, DollarSign, Clock, Calendar, Package, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeads } from "@/hooks/useLeads";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useActiveProducts } from "@/hooks/useProducts";
import { useCreateManyPipePropostaItems } from "@/hooks/usePipePropostaItems";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ProductItem {
  id: string;
  product_id: string;
  sale_value: string;
}

interface CreateProposalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  preselectedLeadId?: string;
}

export function CreateProposalModal({ 
  open, 
  onOpenChange, 
  onSuccess,
  preselectedLeadId 
}: CreateProposalModalProps) {
  const [step, setStep] = useState<"select-lead" | "proposal-details">(
    preselectedLeadId ? "proposal-details" : "select-lead"
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(preselectedLeadId || null);
  
  const [formData, setFormData] = useState({
    closer_id: "",
    contract_duration: "",
    commitment_date: "",
    notes: "",
  });

  const [productItems, setProductItems] = useState<ProductItem[]>([
    { id: crypto.randomUUID(), product_id: "", sale_value: "" }
  ]);

  const { data: leads = [], isLoading: leadsLoading } = useLeads();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: products = [] } = useActiveProducts();
  const createProposta = useCreatePipeProposta();
  const createManyItems = useCreateManyPipePropostaItems();

  const closers = teamMembers.filter(m => m.role === "closer" && m.is_active);

  // Filter leads
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      const matchesSearch = searchTerm === "" || 
        lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.email?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [leads, searchTerm]);

  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(preselectedLeadId ? "proposal-details" : "select-lead");
        setSearchTerm("");
        if (!preselectedLeadId) setSelectedLeadId(null);
        setFormData({
          closer_id: "",
          contract_duration: "",
          commitment_date: "",
          notes: "",
        });
        setProductItems([{ id: crypto.randomUUID(), product_id: "", sale_value: "" }]);
      }, 200);
    }
  }, [open, preselectedLeadId]);

  // Auto-fill closer from lead
  useEffect(() => {
    if (selectedLead?.closer_id && !formData.closer_id) {
      setFormData(prev => ({ ...prev, closer_id: selectedLead.closer_id || "" }));
    }
  }, [selectedLead]);

  const handleSelectLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    setStep("proposal-details");
  };

  const handleAddProduct = () => {
    setProductItems([...productItems, { id: crypto.randomUUID(), product_id: "", sale_value: "" }]);
  };

  const handleRemoveProduct = (id: string) => {
    if (productItems.length === 1) return;
    setProductItems(productItems.filter(item => item.id !== id));
  };

  const handleProductChange = (id: string, field: "product_id" | "sale_value", value: string) => {
    setProductItems(productItems.map(item => {
      if (item.id !== id) return item;
      
      // Auto-fill value when product is selected
      if (field === "product_id") {
        const selectedProduct = products.find(p => p.id === value);
        return {
          ...item,
          product_id: value,
          sale_value: selectedProduct?.ticket?.toString() || item.sale_value,
        };
      }
      
      return { ...item, [field]: value };
    }));
  };

  const handleSubmit = async () => {
    if (!selectedLeadId) {
      toast.error("Selecione um lead");
      return;
    }

    const validProducts = productItems.filter(item => item.product_id && item.sale_value);
    if (validProducts.length === 0) {
      toast.error("Adicione pelo menos um produto com valor");
      return;
    }

    if (!formData.closer_id) {
      toast.error("Closer responsável é obrigatório");
      return;
    }

    try {
      // Calculate total value and determine product type
      const totalValue = validProducts.reduce((sum, item) => sum + Number(item.sale_value), 0);
      const productTypes = validProducts.map(item => {
        const product = products.find(p => p.id === item.product_id);
        return product?.type;
      }).filter(Boolean);
      
      const hasOnlyMrr = productTypes.every(t => t === "mrr");
      const hasOnlyProjeto = productTypes.every(t => t === "projeto");
      const mainProductType = hasOnlyMrr ? "mrr" : hasOnlyProjeto ? "projeto" : null;

      // Create the proposal
      const proposta = await createProposta.mutateAsync({
        lead_id: selectedLeadId,
        status: "marcar_compromisso",
        product_type: mainProductType,
        product_id: validProducts.length === 1 ? validProducts[0].product_id : null,
        sale_value: totalValue,
        contract_duration: formData.contract_duration ? Number(formData.contract_duration) : null,
        closer_id: formData.closer_id,
        commitment_date: formData.commitment_date ? new Date(formData.commitment_date).toISOString() : null,
        notes: formData.notes || null,
      });

      // Create the product items
      await createManyItems.mutateAsync(
        validProducts.map(item => ({
          pipe_proposta_id: proposta.id,
          product_id: item.product_id,
          sale_value: Number(item.sale_value),
        }))
      );

      toast.success("🎉 Proposta criada com sucesso!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar proposta");
      console.error(error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const totalValue = productItems.reduce((sum, item) => sum + (Number(item.sale_value) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            {step === "select-lead" ? "Selecionar Lead" : "Nova Proposta"}
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "select-lead" ? (
            <motion.div
              key="select-lead"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar lead por nome, empresa ou email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Lead List */}
              <ScrollArea className="flex-1 -mx-6 px-6">
                <div className="space-y-2 pb-4">
                  {leadsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Carregando leads...
                    </div>
                  ) : filteredLeads.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Nenhum lead encontrado
                    </div>
                  ) : (
                    filteredLeads.map((lead) => (
                      <motion.button
                        key={lead.id}
                        onClick={() => handleSelectLead(lead.id)}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className={cn(
                          "w-full p-4 rounded-lg border text-left transition-all",
                          "hover:border-primary/50 hover:bg-primary/5",
                          selectedLeadId === lead.id && "border-primary bg-primary/10"
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-primary" />
                              <span className="font-medium truncate">{lead.name}</span>
                            </div>
                            {lead.company && (
                              <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                                <Building2 className="w-3.5 h-3.5" />
                                <span className="text-sm truncate">{lead.company}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-2">
                              {lead.faturamento && (
                                <Badge variant="outline" className="text-xs">
                                  {lead.faturamento}
                                </Badge>
                              )}
                              {lead.segment && (
                                <Badge variant="secondary" className="text-xs">
                                  {lead.segment}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star
                                key={i}
                                className={cn(
                                  "w-3 h-3",
                                  i < Math.ceil((lead.rating || 0) / 2)
                                    ? "text-chart-5 fill-chart-5"
                                    : "text-muted-foreground/30"
                                )}
                              />
                            ))}
                          </div>
                        </div>
                      </motion.button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          ) : (
            <motion.div
              key="proposal-details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 overflow-y-auto"
            >
              {/* Selected Lead Info */}
              {selectedLead && (
                <div className="p-4 bg-muted/50 rounded-lg mb-6 border">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-primary" />
                        <span className="font-medium">{selectedLead.name}</span>
                      </div>
                      {selectedLead.company && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedLead.company}
                        </p>
                      )}
                    </div>
                    {!preselectedLeadId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStep("select-lead")}
                      >
                        Trocar Lead
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Products Section */}
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Produtos *</Label>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={handleAddProduct}
                    className="gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Produto
                  </Button>
                </div>
                
                <div className="space-y-3">
                  {productItems.map((item, index) => {
                    const selectedProduct = products.find(p => p.id === item.product_id);
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex gap-3 items-start p-3 border rounded-lg bg-muted/30"
                      >
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Produto</Label>
                            <Select
                              value={item.product_id}
                              onValueChange={(v) => handleProductChange(item.id, "product_id", v)}
                            >
                              <SelectTrigger className={!item.product_id ? "border-destructive/50" : ""}>
                                <SelectValue placeholder="Selecionar produto" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map(p => (
                                  <SelectItem key={p.id} value={p.id}>
                                    <div className="flex items-center gap-2">
                                      <Badge 
                                        variant={p.type === "mrr" ? "default" : "secondary"} 
                                        className="text-xs"
                                      >
                                        {p.type === "mrr" ? "MRR" : "Projeto"}
                                      </Badge>
                                      {p.name}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Valor (R$)</Label>
                            <div className="relative">
                              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                type="number"
                                value={item.sale_value}
                                onChange={(e) => handleProductChange(item.id, "sale_value", e.target.value)}
                                placeholder="10000"
                                className={cn("pl-9", !item.sale_value && "border-destructive/50")}
                              />
                            </div>
                          </div>
                        </div>
                        {productItems.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10 mt-5"
                            onClick={() => handleRemoveProduct(item.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Total Value Summary */}
                {totalValue > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-success/10 border border-success/20 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {productItems.filter(i => i.product_id && i.sale_value).length} produto(s)
                      </span>
                      <div className="flex items-center gap-2 text-success">
                        <DollarSign className="w-5 h-5" />
                        <span className="font-semibold text-lg">
                          {formatCurrency(totalValue)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Other Form Fields */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Closer Responsável *</Label>
                    <Select
                      value={formData.closer_id}
                      onValueChange={(v) => setFormData({ ...formData, closer_id: v })}
                    >
                      <SelectTrigger className={!formData.closer_id ? "border-destructive/50" : ""}>
                        <SelectValue placeholder="Selecionar closer" />
                      </SelectTrigger>
                      <SelectContent>
                        {closers.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="duration">Duração do Contrato (meses)</Label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="duration"
                        type="number"
                        value={formData.contract_duration}
                        onChange={(e) => setFormData({ ...formData, contract_duration: e.target.value })}
                        placeholder="12"
                        className="pl-9"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="commitment_date">Data do Compromisso</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="commitment_date"
                      type="datetime-local"
                      value={formData.commitment_date}
                      onChange={(e) => setFormData({ ...formData, commitment_date: e.target.value })}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes">Observações</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Detalhes sobre a proposta, condições especiais..."
                    rows={3}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="flex justify-between gap-2 pt-4 border-t mt-4">
          {step === "proposal-details" && !preselectedLeadId && (
            <Button variant="outline" onClick={() => setStep("select-lead")}>
              Voltar
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {step === "proposal-details" && (
              <Button 
                onClick={handleSubmit}
                disabled={createProposta.isPending || createManyItems.isPending}
              >
                {createProposta.isPending || createManyItems.isPending ? "Criando..." : "Criar Proposta"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
