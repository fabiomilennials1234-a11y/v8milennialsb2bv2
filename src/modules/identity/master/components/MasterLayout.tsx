/**
 * Layout da área Master.
 *
 * V5 (onda "mais perto do mockup", 02/10): mora DENTRO do shell normal do app
 * (trilho de ícones + barra superior — `App.tsx` monta `MainLayout` em volta),
 * sem lateral própria.
 *
 * A moldura master (pílula dos grupos na barra superior, selo "Modo master",
 * sub-páginas e faixa vermelha) NÃO mora aqui: ela é do `MasterPageHeader`,
 * que cada página renderiza no lugar do `PageHeader`. Aqui ela vinha antes do
 * título e com a pílula dentro da página — divergia de todas as outras telas.
 *
 * O padding da página mora no <main> do `MainLayout`; as páginas não somam o
 * próprio.
 */

import { Outlet } from "react-router-dom";

export function MasterLayout() {
  return (
    <div className="min-w-0">
      <Outlet />
    </div>
  );
}
