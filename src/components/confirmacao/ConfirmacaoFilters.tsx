import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, 
  Filter, 
  X, 
  Calendar,
  Tag,
  ChevronDown,
  RotateCcw,
  Flame,
  UserCheck
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type OriginFilter = "all" | "whatsapp" | "meta_ads" | "instagram" | "tiktok" | "google_ads" | "site" | "landing_page" | "remarketing" | "indicacao" | "evento" | "prospeccao_ativa" | "cal" | "outro";
export type TimeFilter = "all" | "today" | "tomorrow" | "week" | "overdue";
export type UrgencyFilter = "all" | "imediato" | "1-mes" | "2-3-meses" | "6-meses";

interface TeamMemberOption {
  id: string;
  name: string;
  role: "sdr" | "closer" | "admin";
}

interface ConfirmacaoFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  originFilter: OriginFilter;
  onOriginFilterChange: (value: OriginFilter) => void;
  timeFilter: TimeFilter;
  onTimeFilterChange: (value: TimeFilter) => void;
  urgencyFilter: UrgencyFilter;
  onUrgencyFilterChange: (value: UrgencyFilter) => void;
  selectedStatuses: string[];
  onStatusesChange: (statuses: string[]) => void;
  statusOptions: { id: string; title: string; color: string }[];
  // New props for team member filtering
  teamMembers?: TeamMemberOption[];
  selectedResponsibleId?: string;
  onResponsibleFilterChange?: (value: string) => void;
}

const originOptions: { value: OriginFilter; label: string; icon: string }[] = [
  { value: "all", label: "Todas origens", icon: "🌐" },
  { value: "whatsapp", label: "WhatsApp", icon: "💬" },
  { value: "meta_ads", label: "Meta Ads", icon: "📱" },
  { value: "instagram", label: "Instagram", icon: "📸" },
  { value: "tiktok", label: "Tiktok", icon: "🎵" },
  { value: "google_ads", label: "Google Ads", icon: "🔍" },
  { value: "site", label: "Site", icon: "🌐" },
  { value: "landing_page", label: "Landing Page", icon: "📄" },
  { value: "remarketing", label: "Remarketing", icon: "🔄" },
  { value: "indicacao", label: "Indicação", icon: "🤝" },
  { value: "evento", label: "Evento", icon: "🎪" },
  { value: "prospeccao_ativa", label: "Prospecção Ativa", icon: "📞" },
  { value: "cal", label: "Cal.com", icon: "📅" },
  { value: "outro", label: "Outros", icon: "📋" },
];

const timeOptions: { value: TimeFilter; label: string; shortLabel: string }[] = [
  { value: "all", label: "Qualquer data", shortLabel: "Todos" },
  { value: "today", label: "Hoje", shortLabel: "Hoje" },
  { value: "tomorrow", label: "Amanhã", shortLabel: "Amanhã" },
  { value: "week", label: "Esta semana", shortLabel: "Semana" },
  { value: "overdue", label: "Atrasadas", shortLabel: "Atrasadas" },
];

const urgencyOptions: { value: UrgencyFilter; label: string; icon: string; color: string }[] = [
  { value: "all", label: "Todas", icon: "🎯", color: "" },
  { value: "imediato", label: "Imediato", icon: "🔥", color: "text-red-500" },
  { value: "1-mes", label: "1 mês", icon: "⚡", color: "text-orange-500" },
  { value: "2-3-meses", label: "2-3 meses", icon: "📅", color: "text-yellow-500" },
  { value: "6-meses", label: "6+ meses", icon: "🕐", color: "text-muted-foreground" },
];

export function ConfirmacaoFilters({
  searchQuery,
  onSearchChange,
  originFilter,
  onOriginFilterChange,
  timeFilter,
  onTimeFilterChange,
  urgencyFilter,
  onUrgencyFilterChange,
  selectedStatuses,
  onStatusesChange,
  statusOptions,
  teamMembers = [],
  selectedResponsibleId = "all",
  onResponsibleFilterChange,
}: ConfirmacaoFiltersProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const activeFiltersCount =
    (originFilter !== "all" ? 1 : 0) +
    (timeFilter !== "all" ? 1 : 0) +
    (urgencyFilter !== "all" ? 1 : 0) +
    (selectedStatuses.length > 0 && selectedStatuses.length < statusOptions.length ? 1 : 0) +
    (selectedResponsibleId !== "all" ? 1 : 0);

  const handleStatusToggle = (statusId: string) => {
    if (selectedStatuses.includes(statusId)) {
      onStatusesChange(selectedStatuses.filter(s => s !== statusId));
    } else {
      onStatusesChange([...selectedStatuses, statusId]);
    }
  };

  const handleClearFilters = () => {
    onOriginFilterChange("all");
    onTimeFilterChange("all");
    onUrgencyFilterChange("all");
    onStatusesChange([]);
    onSearchChange("");
    onResponsibleFilterChange?.("all");
  };

  return (
    <div className="space-y-4">
      {/* Main Search & Quick Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar lead, empresa..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => onSearchChange("")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Time Filters */}
        <div className="flex gap-2 flex-wrap">
          {timeOptions.map((option) => (
            <Button
              key={option.value}
              variant={timeFilter === option.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onTimeFilterChange(option.value)}
              className={cn(
                "transition-all",
                timeFilter === option.value && "ring-1 ring-primary/30"
              )}
            >
              {option.value === "overdue" && timeFilter === option.value && (
                <span className="w-2 h-2 rounded-full bg-destructive mr-1.5 animate-pulse" />
              )}
              {option.shortLabel}
            </Button>
          ))}
        </div>

        {/* Advanced Filters Button */}
        <Popover open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="relative">
              <Filter className="w-4 h-4 mr-2" />
              Filtros
              {activeFiltersCount > 0 && (
                <Badge 
                  variant="default" 
                  className="ml-2 h-5 w-5 p-0 flex items-center justify-center rounded-full text-xs"
                >
                  {activeFiltersCount}
                </Badge>
              )}
              <ChevronDown className={cn(
                "w-4 h-4 ml-1 transition-transform",
                isAdvancedOpen && "rotate-180"
              )} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Filtros Avançados</h4>
                {activeFiltersCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Limpar
                  </Button>
                )}
              </div>

              <Separator />

              {/* Origin Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Origem
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {originOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={originFilter === option.value ? "secondary" : "outline"}
                      size="sm"
                      className="justify-start"
                      onClick={() => onOriginFilterChange(option.value)}
                    >
                      <span className="mr-2">{option.icon}</span>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Urgency Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Flame className="w-4 h-4" />
                  Urgência
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {urgencyOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={urgencyFilter === option.value ? "secondary" : "outline"}
                      size="sm"
                      className={cn("justify-start", option.color)}
                      onClick={() => onUrgencyFilterChange(option.value)}
                    >
                      <span className="mr-2">{option.icon}</span>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Responsible Filter */}
              {teamMembers.length > 0 && (
                <>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4" />
                      Responsável
                    </Label>
                    <Select value={selectedResponsibleId} onValueChange={(value) => onResponsibleFilterChange?.(value)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Todos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {teamMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />
                </>
              )}

              {/* Status Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Status
                </Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {statusOptions.map((status) => (
                    <div key={status.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={status.id}
                        checked={selectedStatuses.length === 0 || selectedStatuses.includes(status.id)}
                        onCheckedChange={() => handleStatusToggle(status.id)}
                      />
                      <label
                        htmlFor={status.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: status.color }}
                        />
                        {status.title}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Active Filters Display */}
      <AnimatePresence>
        {(activeFiltersCount > 0 || searchQuery) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2"
          >
            {searchQuery && (
              <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1">
                Busca: "{searchQuery}"
                <button
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => onSearchChange("")}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {originFilter !== "all" && (
              <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1">
                {originOptions.find(o => o.value === originFilter)?.icon}{" "}
                {originOptions.find(o => o.value === originFilter)?.label}
                <button
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => onOriginFilterChange("all")}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {urgencyFilter !== "all" && (
              <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1">
                {urgencyOptions.find(u => u.value === urgencyFilter)?.icon}{" "}
                {urgencyOptions.find(u => u.value === urgencyFilter)?.label}
                <button
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => onUrgencyFilterChange("all")}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {timeFilter !== "all" && (
              <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1">
                {timeOptions.find(t => t.value === timeFilter)?.label}
                <button
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => onTimeFilterChange("all")}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {selectedStatuses.length > 0 && selectedStatuses.length < statusOptions.length && (
              <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1">
                {selectedStatuses.length} status selecionados
                <button
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => onStatusesChange([])}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {selectedResponsibleId !== "all" && (
              <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1">
                Responsável: {teamMembers.find(m => m.id === selectedResponsibleId)?.name}
                <button
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => onResponsibleFilterChange?.("all")}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={handleClearFilters}
            >
              Limpar tudo
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
