import { createRoot } from "react-dom/client";
import { installClientErrorCapture, recordClientError } from "./core/observability/client-error-buffer";
import { getSessionId } from "./core/trace/request-trace";
import { addErrorReporter, ringBufferEntry } from "@/shared/errors";
import { loadSentry, sentryOptionsFromEnv } from "@/shared/errors/sentry-loader";
import {
  handleStaleChunk,
  isStaleAssetLoadError,
  missingStylesheets,
  recoverFromStaleBuild,
} from "@/core/stale-build-recovery";
import App from "./App.tsx";
import "./index.css";

// Captura os erros que ninguem tratou. Sao a metade da observabilidade que
// `runtime_logs` nao ve: RLS, constraint, render. Anexados a um Chamado
// quando o usuario abre um. Ver docs/adr/0017.
installClientErrorCapture();

// Todo erro que passa pelo contrato (`notifyError`, caches do React Query,
// boundary) vai para o mesmo anel, com a referência que o usuário viu no toast.
// Registrado aqui porque `shared` não pode importar `core` (ADR-0038).
addErrorReporter(({ error }) => recordClientError(ringBufferEntry(error), "handled"));

// Sentry (ADR-0038, S6): só quando o build traz DSN. Sem ele, nenhum byte do
// SDK chega ao navegador. Com ele, o SDK carrega fora do caminho crítico e uma
// fila segura o que for relatado enquanto isso.
const sentryOptions = sentryOptionsFromEnv(import.meta.env, __APP_VERSION__, getSessionId());
if (sentryOptions) void loadSentry(sentryOptions);

// Build velho após deploy: um único caminho de recuperação (desregistra o SW,
// limpa caches, recarrega; throttle por timestamp). Ver src/core/stale-build-recovery.ts.
window.addEventListener("error", (e) => handleStaleChunk(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => handleStaleChunk(e.reason));
// CSS/JS do build que falha no <link>/<script> não vira exceção: só aparece
// como evento de recurso, que não borbulha — daí a fase de captura.
window.addEventListener("error", (e) => {
  if (isStaleAssetLoadError(e)) void recoverFromStaleBuild();
}, true);
// O CSS principal falha antes deste script rodar: confere no boot.
if (missingStylesheets().length > 0) void recoverFromStaleBuild();

createRoot(document.getElementById("root")!).render(<App />);
