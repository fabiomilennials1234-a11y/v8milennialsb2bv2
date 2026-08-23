import { NavLink } from "react-router-dom";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import torqueIcon from "@/assets/torque-icon.png";
import torqueLogo from "@/assets/torque-logo.png";
import torqueLogoDark from "@/assets/torque-logo-dark.png";

/**
 * A marca no topo da barra lateral — o hexágono, com o efeito de sempre.
 *
 * ── O QUE SE PERDEU E ESTÁ VOLTANDO ───────────────────────────────────────
 * Até a top bar virar navegação lateral (`dd18bd1e`), a marca era o símbolo
 * real com dois comportamentos no hover: o hexágono **gira 360°** e ganha um
 * halo dourado, e o nome "TORQUE" **aparece na fonte do logo**. A lateral
 * nasceu com um quadradinho dourado escrito "T" e texto comum — nem o símbolo,
 * nem a fonte, nem o efeito.
 *
 * ── POR QUE O NOME É IMAGEM, E NÃO TEXTO ──────────────────────────────────
 * A fonte do wordmark não está no projeto; ela existe só dentro do PNG do logo.
 * Escrever "Torque" com a fonte da interface dá uma palavra parecida e ERRADA.
 * O truque, herdado do componente antigo: renderiza o logo INTEIRO
 * (`torque-logo.png`, 2095×331) e empurra o hexágono dele para fora do recorte
 * com margem negativa — sobra o wordmark, na fonte original.
 *
 * ── A CONTA DO RECORTE ────────────────────────────────────────────────────
 * Na top bar o logo ia a `h-8` (32px) com deslocamento de −36px. Aqui o ícone
 * tem 26px, para não mudar a altura do cabeçalho da barra, então tudo escala
 * por 26/32: deslocamento −29px e largura revelada 140px
 * (26 × 2095/331 = 164,6 de largura total, menos os 29 do hexágono ≈ 135).
 *
 * ⚠️ **O wordmark NÃO se revela com o menu recolhido.** A barra recolhida tem
 * ~72px; 140px de wordmark transbordariam por cima do conteúdo — que é
 * exatamente o defeito que acabou de ser corrigido nos atalhos de master. No
 * recolhido fica o símbolo, que continua girando no hover.
 */
export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <NavLink
      to="/dashboard"
      title="Central de Comando"
      /**
       * Nome acessível é só "Torque".
       *
       * O rótulo herdado da top bar era "Torque — Central de Comando", e na
       * lateral isso colide: existe um item de menu chamado "Comando" apontando
       * para a MESMA rota. Dois links para `/dashboard` cujos nomes casam com
       * "Comando" confundem quem navega por leitor de tela — e o teste da
       * lateral pegou exatamente isso. O destino continua no `title`.
       */
      aria-label="Torque"
      className={cn(
        "group flex min-w-0 flex-1 items-center px-1 no-underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <img
        src={torqueIcon}
        alt="Torque"
        className={cn(
          "h-[26px] w-[26px] shrink-0 object-contain",
          "transition-all duration-700 ease-out",
          "group-hover:rotate-[360deg] group-hover:drop-shadow-[0_0_12px_hsl(var(--primary)/0.6)]",
        )}
      />

      {!collapsed && (
        <div
          className={cn(
            "overflow-hidden transition-[max-width,margin] duration-500 ease-out",
            "max-w-0 group-hover:ml-2 group-hover:max-w-[140px]",
          )}
        >
          <img
            src={isDark ? torqueLogo : torqueLogoDark}
            alt=""
            aria-hidden
            style={{ marginLeft: "-29px" }}
            className="h-[26px] max-w-none object-contain object-left"
          />
        </div>
      )}
    </NavLink>
  );
}
