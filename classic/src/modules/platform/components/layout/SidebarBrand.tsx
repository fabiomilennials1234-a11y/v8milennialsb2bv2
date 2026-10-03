/**
 * A marca na cabeça da lateral.
 *
 * Recolhida mostra só o hexágono; expandida, hexágono + logotipo. O logotipo é
 * a arte oficial recortada do logo horizontal — nada redesenhado.
 *
 * O logotipo colapsa por `grid-template-columns: 1fr → 0fr` (ver
 * `.sidebar-brand-wordmark` em `index.css`) em vez de um `max-width` fixo:
 * assim a animação mede a largura real da arte, e trocar o PNG amanhã não
 * obriga a recalibrar CSS.
 *
 * Uma arte só, e de propósito: a lateral é escura nos dois temas
 * (`--sidebar-background` fica em 18% de luminosidade no claro e 7% no
 * escuro), então o logotipo de nome branco serve os dois.
 */

import { NavLink } from "react-router-dom";

import torqueMark from "@/assets/torque-mark.png";
import torqueWordmark from "@/assets/torque-wordmark.png";

interface SidebarBrandProps {
  collapsed: boolean;
}

export function SidebarBrand({ collapsed }: SidebarBrandProps) {
  return (
    <NavLink
      to="/dashboard"
      className="flex min-w-0 flex-1 items-center px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* O nome acessível do link inteiro vem deste alt. Não colocar
          aria-label com "Central de Comando" no NavLink: colide com o item de
          menu "Comando" para quem navega por nome. */}
      <img
        src={torqueMark}
        alt="Torque"
        className="h-[26px] w-[26px] shrink-0 object-contain"
      />
      {/* O nome é decorativo: quem usa leitor de tela já ouviu a marca no alt
          do hexágono, e ouvir "Torque" duas vezes seguidas é ruído. */}
      <span
        aria-hidden
        data-collapsed={collapsed}
        data-testid="sidebar-wordmark"
        className="sidebar-brand-wordmark"
      >
        <span className="min-w-0 overflow-hidden">
          <img src={torqueWordmark} alt="" className="h-[15px] w-auto max-w-none" />
        </span>
      </span>
    </NavLink>
  );
}
