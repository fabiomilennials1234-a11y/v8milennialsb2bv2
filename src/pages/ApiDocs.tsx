import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Search,
  Webhook,
  ChevronRight,
  Menu,
  X,
  ExternalLink,
} from "lucide-react";
import { apiCategories } from "@/lib/api-docs/endpoints";
import { GettingStarted } from "@/components/api-docs/GettingStarted";
import { EndpointSection } from "@/components/api-docs/EndpointSection";
import { OrchestratorActions } from "@/components/api-docs/OrchestratorActions";
import type { ApiEndpoint } from "@/lib/api-docs/types";

const BASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://seu-projeto.supabase.co";

type ActiveView = "getting-started" | string; // endpoint id

export default function ApiDocs() {
  const [activeView, setActiveView] = useState<ActiveView>("getting-started");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const allEndpoints = apiCategories.flatMap((cat) => cat.endpoints);

  const filteredEndpoints = searchQuery
    ? allEndpoints.filter(
        (ep) =>
          ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ep.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ep.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allEndpoints;

  const activeEndpoint = allEndpoints.find((ep) => ep.id === activeView);

  const handleNavClick = (view: ActiveView) => {
    setActiveView(view);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 lg:px-6 h-14">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <h1 className="font-bold text-foreground">API v8 CRM</h1>
              <Badge variant="secondary" className="text-[10px]">v1</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Voltar ao app
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`
            fixed lg:sticky top-14 z-40 h-[calc(100vh-3.5rem)] w-64 shrink-0
            border-r border-border bg-background
            transition-transform duration-200
            ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
        >
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar endpoint..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>

              {/* Getting Started */}
              <button
                onClick={() => handleNavClick("getting-started")}
                className={`
                  w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2
                  ${activeView === "getting-started"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }
                `}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Primeiros Passos
              </button>

              {/* Categories */}
              {apiCategories.map((category) => (
                <div key={category.id} className="space-y-1">
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <Webhook className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {category.name}
                    </span>
                  </div>
                  {(searchQuery ? filteredEndpoints : category.endpoints).map((endpoint) => (
                    <button
                      key={endpoint.id}
                      onClick={() => handleNavClick(endpoint.id)}
                      className={`
                        w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2
                        ${activeView === endpoint.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }
                      `}
                    >
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <span className="truncate">{endpoint.name}</span>
                      <Badge
                        className={`ml-auto text-[8px] px-1 py-0 shrink-0 ${
                          endpoint.method === "POST"
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                            : "bg-blue-500/15 text-blue-600 border-blue-500/30"
                        }`}
                      >
                        {endpoint.method}
                      </Badge>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="max-w-4xl mx-auto p-6 lg:p-8">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {activeView === "getting-started" ? (
                <GettingStarted baseUrl={BASE_URL} />
              ) : activeEndpoint ? (
                <div className="space-y-6">
                  <EndpointSection endpoint={activeEndpoint} baseUrl={BASE_URL} />
                  {activeEndpoint.id === "webhook-orchestrator" && (
                    <OrchestratorActions />
                  )}
                </div>
              ) : null}
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  );
}
