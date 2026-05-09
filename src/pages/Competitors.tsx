/**
 * Competitors — CRUD page for competitive intelligence.
 * Consumes useCompetitors, useCreateCompetitor, useUpdateCompetitor, useCompetitorStats.
 */

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Swords,
  Plus,
  Search,
  Loader2,
  Globe,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useCompetitors,
  useCreateCompetitor,
  useUpdateCompetitor,
  useCompetitorStats,
  type Competitor,
} from "@/hooks/useCompetitors";
import { CompetitorCard } from "@/components/competitors/CompetitorCard";
import { CompetitorMentions } from "@/components/competitors/CompetitorMentions";
import { toast } from "sonner";

// ── Form state ────────────────────────────────────────────────

interface CompetitorForm {
  name: string;
  aliases: string;
  website: string;
  strengths: string;
  weaknesses: string;
  battlecard_md: string;
}

const EMPTY_FORM: CompetitorForm = {
  name: "",
  aliases: "",
  website: "",
  strengths: "",
  weaknesses: "",
  battlecard_md: "",
};

// ── Component ─────────────────────────────────────────────────

export default function Competitors() {
  const { data: competitors = [], isLoading } = useCompetitors();
  const { data: stats = [] } = useCompetitorStats();
  const createCompetitor = useCreateCompetitor();
  const updateCompetitor = useUpdateCompetitor();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompetitorForm>(EMPTY_FORM);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);

  const statsMap = useMemo(() => {
    const map: Record<string, number> = {};
    stats.forEach((s) => {
      map[s.competitor_id] = s.win_rate;
    });
    return map;
  }, [stats]);

  const filtered = useMemo(() => {
    if (!search.trim()) return competitors;
    const q = search.toLowerCase();
    return competitors.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q))
    );
  }, [competitors, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (comp: Competitor) => {
    setEditingId(comp.id);
    setForm({
      name: comp.name,
      aliases: comp.aliases.join(", "),
      website: comp.website || "",
      strengths: comp.strengths.join("\n"),
      weaknesses: comp.weaknesses.join("\n"),
      battlecard_md: comp.battlecard_md || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Nome obrigatorio");
      return;
    }

    const parsed = {
      name: form.name.trim(),
      aliases: form.aliases ? form.aliases.split(",").map((a) => a.trim()).filter(Boolean) : [],
      website: form.website.trim() || undefined,
      strengths: form.strengths ? form.strengths.split("\n").map((s) => s.trim()).filter(Boolean) : [],
      weaknesses: form.weaknesses ? form.weaknesses.split("\n").map((w) => w.trim()).filter(Boolean) : [],
      battlecard_md: form.battlecard_md.trim() || undefined,
    };

    try {
      if (editingId) {
        await updateCompetitor.mutateAsync({ id: editingId, ...parsed });
      } else {
        await createCompetitor.mutateAsync(parsed);
      }
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch {
      // handled by hook
    }
  };

  const updateField = (field: keyof CompetitorForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Swords className="w-6 h-6 text-primary" />
            Inteligencia Competitiva
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Monitore concorrentes, battlecards e win rates
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" />
          Novo concorrente
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar concorrente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Competitors grid */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 border border-dashed rounded-lg">
              <Swords className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {search ? "Nenhum concorrente encontrado" : "Nenhum concorrente cadastrado"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((comp, idx) => (
                <motion.div
                  key={comp.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => setSelectedCompetitor(comp.id)}
                  className="cursor-pointer"
                >
                  <CompetitorCard
                    competitor={comp}
                    onEdit={openEdit}
                    winRate={statsMap[comp.id]}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Mentions sidebar */}
        <div>
          <CompetitorMentions
            competitorId={selectedCompetitor}
            competitorName={competitors.find((c) => c.id === selectedCompetitor)?.name}
          />
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="w-4 h-4 text-primary" />
              {editingId ? "Editar concorrente" : "Novo concorrente"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label className="text-xs">Nome *</Label>
              <Input
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Ex: Empresa XYZ"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-xs">Aliases (separados por virgula)</Label>
              <Input
                value={form.aliases}
                onChange={(e) => updateField("aliases", e.target.value)}
                placeholder="Ex: XYZ, Xyz Corp, xyz.com"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-xs">Website</Label>
              <Input
                value={form.website}
                onChange={(e) => updateField("website", e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-xs text-emerald-600">Pontos fortes (1 por linha)</Label>
                <Textarea
                  value={form.strengths}
                  onChange={(e) => updateField("strengths", e.target.value)}
                  placeholder="Preco competitivo\nSuporte 24h"
                  rows={4}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs text-red-600">Fraquezas (1 por linha)</Label>
                <Textarea
                  value={form.weaknesses}
                  onChange={(e) => updateField("weaknesses", e.target.value)}
                  placeholder="Sem integracao\nUI ruim"
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-xs">Battlecard (Markdown)</Label>
              <Textarea
                value={form.battlecard_md}
                onChange={(e) => updateField("battlecard_md", e.target.value)}
                placeholder="## Como vencer esse concorrente\n\n- Argumento 1\n- Argumento 2"
                rows={6}
                className="resize-none font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createCompetitor.isPending || updateCompetitor.isPending}
            >
              {(createCompetitor.isPending || updateCompetitor.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {editingId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
