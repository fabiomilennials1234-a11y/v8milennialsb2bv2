import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/index.css";
import { Preview } from "./Preview";

/**
 * Entrada da rota de visualização do Card do Lead — `/preview.html`.
 *
 * ── POR QUE É UMA ENTRADA SEPARADA, E NÃO UMA ROTA DO APP ─────────────────
 * Não importa `App.tsx`, nem o `AuthProvider`, nem `@/integrations/supabase`.
 * Nenhum client é construído, então **não existe caminho por onde esta tela
 * fale com banco nenhum** — nem prod, nem branch. É isso que torna seguro
 * abrir sem autenticação: não é auth desligada num app que lê dado de cliente;
 * é uma tela que não tem de onde ler.
 *
 * Os dados vêm de `fixtures.ts`. Descartável: sai junto com a aprovação do
 * desenho.
 */

createRoot(document.getElementById("preview")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
