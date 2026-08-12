/**
 * Teste do nó JavaScript — roda NO NAVEGADOR de quem está editando.
 *
 * Isto NÃO é (nem pretende ser) o sandbox do executor: a execução no servidor segue
 * pendente da fase 2 (QuickJS em WASM). Aqui o objetivo é só conferir a lógica.
 *
 * Por que um iframe `sandbox="allow-scripts"` e não um Worker (não "simplifique" de volta):
 *
 * 1. **Origem opaca.** Sem `allow-same-origin`, o iframe roda numa origem nula: o código
 *    não alcança `localStorage`/IndexedDB (onde mora a sessão do Supabase), não manda
 *    `fetch` com os cookies da aplicação e não enxerga o DOM do editor. Um Worker de Blob
 *    é **same-origin** e teria tudo isso. A diferença não é teórica: o workflow é
 *    compartilhado, então o JS que um admin salva é aberto por OUTRO membro da org — que
 *    clica em "Testar" com a sessão dele. Same-origin ali é escalonamento entre usuários.
 * 2. **CSP.** A página declara `default-src 'self'` sem `worker-src`, então `new Worker`
 *    a partir de `blob:` é recusado. O `srcdoc` herda a política do documento — e
 *    `script-src` já traz `'unsafe-inline'`, que é o que o script embutido precisa.
 *
 * O código do usuário NUNCA é interpolado no HTML do `srcdoc` (um `</script>` no meio de
 * uma string quebraria o documento e viraria injeção): ele viaja por `postMessage`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Entrada de exemplo exposta ao código do usuário como `lead`. */
const SAMPLE_LEAD = {
  nome: "João Silva",
  empresa: "Tech Corp",
  email: "joao@techcorp.com",
  telefone: "(11) 99999-9999",
};

/** Teto duro de wall-clock. Estourou, o iframe morre com o código dentro. */
const TIMEOUT_MS = 2000;

const BLOCKED_MESSAGE =
  "Não consegui abrir o ambiente de teste neste navegador — a política de segurança da página bloqueou o quadro isolado.";

/**
 * O retorno é serializado DENTRO do iframe: mandar o valor vivo pelo postMessage
 * estoura o structured clone em função/símbolo/DOM.
 */
const SANDBOX_DOC = `<!doctype html><meta charset="utf-8"><script>
window.addEventListener("message", async function (event) {
  var reply = function (msg) { parent.postMessage(msg, "*"); };
  try {
    var run = new Function("lead", "return (async () => {\\n" + event.data.code + "\\n})();");
    var value = await run(event.data.lead);
    if (value === undefined) {
      reply({ ok: true, output: "undefined — o código não devolveu nada (falta um return?)" });
      return;
    }
    var output;
    try {
      output = JSON.stringify(value, null, 2);
    } catch (err) {
      reply({ ok: false, error: "O retorno não é serializável em JSON: " + String((err && err.message) || err) });
      return;
    }
    reply({ ok: true, output: output === undefined ? String(value) : output });
  } catch (err) {
    reply({ ok: false, error: String((err && err.message) || err) });
  }
});
</${"script"}>`;

interface CodeJavascriptTestRunnerProps {
  /** Fonte escrito no nó. */
  code: string;
}

interface RunResult {
  ok: boolean;
  text: string;
}

export function CodeJavascriptTestRunner({ code }: CodeJavascriptTestRunnerProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (listenerRef.current) {
      window.removeEventListener("message", listenerRef.current);
      listenerRef.current = null;
    }
    // Remover o iframe mata o script que estiver rodando dentro dele — é o
    // equivalente ao `terminate()` do Worker, e é o que faz o timeout valer.
    frameRef.current?.remove();
    frameRef.current = null;
  }, []);

  // Sair do painel (ou trocar de nó) mata o iframe e o listener.
  useEffect(() => cleanup, [cleanup]);

  const handleRun = () => {
    cleanup();
    const source = code.trim();
    if (!source) {
      setResult({ ok: false, text: "Escreva algum código antes de testar." });
      return;
    }

    setResult(null);
    setRunning(true);

    let frame: HTMLIFrameElement;
    try {
      frame = document.createElement("iframe");
      // Só `allow-scripts`: sem `allow-same-origin` a origem é nula. As duas juntas
      // anulariam o sandbox — o conteúdo poderia remover o próprio atributo.
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.style.display = "none";
      frame.srcdoc = SANDBOX_DOC;
      document.body.appendChild(frame);
    } catch {
      setRunning(false);
      setResult({ ok: false, text: BLOCKED_MESSAGE });
      cleanup();
      return;
    }
    frameRef.current = frame;

    const finish = (next: RunResult) => {
      setRunning(false);
      setResult(next);
      cleanup();
    };

    const onMessage = (event: MessageEvent) => {
      // A origem é nula (sandbox sem allow-same-origin), então o que identifica o
      // remetente é a janela, não o `event.origin`.
      if (event.source !== frame.contentWindow) return;
      const payload = event.data as { ok?: boolean; output?: string; error?: string };
      finish(
        payload?.ok
          ? { ok: true, text: payload.output ?? "" }
          : { ok: false, text: payload?.error || "Erro desconhecido ao rodar o código." },
      );
    };
    listenerRef.current = onMessage;
    window.addEventListener("message", onMessage);

    frame.onload = () => {
      // `srcdoc` dispara onload depois de executar o script embutido, então o
      // listener lá dentro já existe quando mandamos o payload.
      frame.contentWindow?.postMessage({ code: source, lead: SAMPLE_LEAD }, "*");
    };

    timerRef.current = window.setTimeout(() => {
      finish({
        ok: false,
        text: `O código passou de ${TIMEOUT_MS} ms e foi interrompido. Procure laço infinito ou espera que nunca resolve.`,
      });
    }, TIMEOUT_MS);
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 pr-2">
          <Label className="text-sm">Testar no navegador</Label>
          <p className="text-xs text-muted-foreground">
            Roda aqui, no seu navegador, num quadro isolado e com um lead de exemplo — só
            para conferir a lógica. O nó ainda não roda no servidor.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={handleRun}
          disabled={running}
        >
          {running ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 mr-1.5" />
          )}
          Testar
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        O código roda dentro de uma função <code>async</code> e recebe{" "}
        <code>lead</code>. Use <code>return</code> para devolver o resultado.
      </p>
      <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
        {JSON.stringify(SAMPLE_LEAD)}
      </pre>

      {result && (
        <pre
          className={cn(
            "max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 font-mono text-xs",
            result.ok
              ? "bg-muted/40"
              : "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          {result.text}
        </pre>
      )}
    </div>
  );
}
