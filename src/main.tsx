import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true }),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// Usuários com index.html cacheado de um deploy anterior apontam para chunks
// hashados que não existem mais (nginx agora devolve 404 nesses assets).
// Ao detectar chunk/import falhando, fazemos um hard reload único para pegar
// o novo index.html e seus chunks atuais. A flag em sessionStorage evita loops.
const RELOAD_FLAG = "v8:stale-chunk-reload";
function isStaleChunkError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message)
  );
}
function handleStaleChunk(reason: unknown): void {
  if (!isStaleChunkError(reason)) return;
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, "1");
  window.location.reload();
}
window.addEventListener("error", (e) => handleStaleChunk(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => handleStaleChunk(e.reason));

createRoot(document.getElementById("root")!).render(<App />);
