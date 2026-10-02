import type { Preview } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
// HERDADO: o caminho antigo (`src/contexts/AuthContext`) morreu na
// modularização — o contexto vive em `identity/auth` desde a slice 3, e o
// Storybook inteiro estava sem subir por causa desta linha.
import { AuthContext } from "../src/modules/identity/auth/contexts/AuthContext";
import "../src/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
    },
  },
});

// Auth fake p/ stories — sem rede/Supabase. Só pra componentes que chamam useAuth().
const mockAuth = {
  user: { id: "sb-preview-user", email: "preview@torque.dev" } as any,
  session: null,
  loading: false,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
};

const preview: Preview = {
  parameters: {
    // V5: bancada clara quente e preto puro — os mesmos fundos do app.
    backgrounds: {
      default: "bancada",
      values: [
        { name: "bancada", value: "hsl(42 18% 94%)" },
        { name: "preto", value: "hsl(0 0% 0%)" },
      ],
    },
    layout: "padded",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      config: {
        rules: [
          {
            id: "color-contrast",
            enabled: true,
          },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={mockAuth}>
          <MemoryRouter>
            <div className="dark">
              <Story />
            </div>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  ],
};

export default preview;
