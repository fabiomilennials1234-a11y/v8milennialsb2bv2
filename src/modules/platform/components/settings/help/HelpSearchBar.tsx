import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface HelpSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function HelpSearchBar({ value, onChange }: HelpSearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder="Buscar na documentação..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10 pr-10"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => onChange("")}
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
