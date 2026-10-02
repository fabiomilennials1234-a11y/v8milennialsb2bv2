import { useMemo, useState } from "react";
import { BookOpen, LifeBuoy, PlayCircle, Search, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, InkPanel } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useHelpArticles, type HelpArticleWithCategory } from "@/modules/platform/hooks/useHelpCenter";
import { HelpArticleDialog } from "@/modules/platform/components/settings/help/HelpArticleDialog";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Aba Artigos da Central de Ajuda: os artigos do CMS (com vídeo e feedback),
 * que antes só apareciam dentro do painel de suporte. Mesma fonte
 * (`useHelpArticles`), mesmo leitor (`HelpArticleDialog`).
 */
export function AjudaArtigos({
  primeiroNome,
  onAbrirChamado,
  onVerFaq,
}: {
  primeiroNome?: string | null;
  onAbrirChamado: () => void;
  onVerFaq: () => void;
}) {
  const { data: articles = [], isLoading } = useHelpArticles();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [aberto, setAberto] = useState<HelpArticleWithCategory | null>(null);

  const publicados = useMemo(() => articles.filter((a) => a.is_published), [articles]);
  const categorias = useMemo(() => {
    const m = new Map<string, { id: string; nome: string; n: number }>();
    for (const a of publicados) {
      const id = a.category?.id ?? a.category_id;
      const nome = a.category?.name ?? "Geral";
      const atual = m.get(id);
      m.set(id, { id, nome, n: (atual?.n ?? 0) + 1 });
    }
    return [...m.values()];
  }, [publicados]);
  const q = normalize(busca.trim());
  const visiveis = publicados.filter(
    (a) =>
      (!categoria || (a.category?.id ?? a.category_id) === categoria) &&
      (!q || normalize([a.title, a.summary ?? "", ...(a.tags ?? [])].join(" ")).includes(q)),
  );
  const comVideo = publicados.filter((a) => a.video_url).length;
  const destaque = publicados.find((a) => a.video_url) ?? publicados[0];

  return (
    <div className="space-y-5">
      <InkPanel>
        <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <div className="flex min-w-0 flex-col gap-4 p-2 sm:p-4">
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-tinta-muted">Central de Ajuda</p>
            <h2 className="text-[clamp(1.6rem,3vw,2.1rem)] font-extrabold leading-tight tracking-[-0.04em]">
              Como podemos ajudar{primeiroNome ? `, ${primeiroNome}` : ""}?
            </h2>
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" aria-hidden />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar nos artigos…"
                aria-label="Buscar nos artigos"
                className="h-12 w-full rounded-full border-0 bg-white pl-11 pr-4 text-[14px] text-neutral-900 shadow-relevo placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            {categorias.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {categorias.map((c) => {
                  const ativo = categoria === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => setCategoria(ativo ? null : c.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                        ativo ? "bg-primary text-primary-foreground" : "bg-white/10 text-tinta-foreground hover:bg-white/15",
                      )}
                    >
                      {c.nome}
                      <span className="tabular-nums opacity-70">{c.n}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-auto text-[12px] text-tinta-muted tabular-nums">
              {publicados.length} {publicados.length === 1 ? "artigo" : "artigos"} · {comVideo}{" "}
              {comVideo === 1 ? "vídeo" : "vídeos"}
            </p>
          </div>

          {isLoading ? (
            <Skeleton className="min-h-[240px] rounded-card bg-white/[.07]" />
          ) : destaque ? (
            <FocusCard>
              <div className="grid aspect-video place-items-center rounded-2xl bg-tinta text-tinta-foreground">
                {destaque.video_url ? <PlayCircle className="h-10 w-10" aria-hidden /> : <BookOpen className="h-9 w-9" aria-hidden />}
              </div>
              <Badge variant="ink" className="w-fit">Comece por aqui</Badge>
              <div>
                <p className="text-[1.2rem] font-extrabold leading-tight tracking-[-0.03em]">{destaque.title}</p>
                {destaque.summary && (
                  <p className="mt-1 line-clamp-2 text-[13px] text-primary-foreground/75">{destaque.summary}</p>
                )}
              </div>
              <div className="mt-auto">
                <Button
                  variant="outline"
                  onClick={() => setAberto(destaque)}
                  className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
                >
                  {destaque.video_url ? <PlayCircle /> : <BookOpen />}
                  {destaque.video_url ? "Assistir" : "Ler o passo a passo"}
                </Button>
              </div>
            </FocusCard>
          ) : (
            <FocusCard>
              <Badge variant="ink" className="w-fit">Ainda sem artigos</Badge>
              <p className="text-[1.2rem] font-extrabold leading-tight tracking-[-0.03em]">
                Os artigos da sua organização aparecem aqui assim que forem publicados.
              </p>
              <p className="text-[13px] text-primary-foreground/75">
                Enquanto isso, as perguntas frequentes cobrem as dúvidas mais comuns.
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={onVerFaq}
                  className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
                >
                  <LifeBuoy />
                  Ver perguntas frequentes
                </Button>
              </div>
            </FocusCard>
          )}
        </div>
      </InkPanel>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] tracking-[-0.02em]">Artigos</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : visiveis.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                {publicados.length === 0 ? "Nenhum artigo publicado ainda." : "Nenhum artigo para essa busca."}
              </p>
            ) : (
              <ul>
                {visiveis.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setAberto(a)}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-[10px]",
                          a.video_url ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-foreground/70",
                        )}
                        aria-hidden
                      >
                        {a.video_url ? <PlayCircle className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{a.title}</span>
                        {a.summary && <span className="block truncate text-[12.5px] text-muted-foreground">{a.summary}</span>}
                        <span className="block text-[11.5px] text-muted-foreground">
                          {a.category?.name ?? "Geral"}
                          {a.video_url ? " · vídeo" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] tracking-[-0.02em]">Fale com a gente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Não achou a resposta? Abra um chamado e o suporte responde no painel de ajuda.
            </p>
            <Button variant="ink" onClick={onAbrirChamado}>
              <Send />
              Abrir chamado
            </Button>
          </CardContent>
        </Card>
      </div>

      <HelpArticleDialog
        article={aberto}
        articles={publicados}
        open={!!aberto}
        onOpenChange={(open) => !open && setAberto(null)}
        onNavigate={setAberto}
      />
    </div>
  );
}
