/**
 * Sub-conceito auth — API interna privada do módulo identity.
 * Re-exportado pelo barrel raiz identity/index.ts. Não importar de fora via path interno
 * (exceto App.tsx/pages — code-splitting). Slice 9.2 arch-deepening.
 */
export { AuthProvider, useAuth } from "./contexts/AuthContext";
export { useIdentity } from "./hooks/useIdentity";
export type { Identity } from "./hooks/useIdentity";
export { ProtectedRoute } from "./components/ProtectedRoute";
