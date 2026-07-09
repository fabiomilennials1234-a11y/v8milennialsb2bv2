/**
 * FloatingDock — um lugar só para os botões flutuantes.
 *
 * Antes disto, três componentes de três módulos diferentes renderizavam em
 * `fixed bottom-6 right-6`, cada um com o seu z-index:
 *
 *   ChatBubbleFab (communication)      z-40
 *   OraculoFloatingButton (analytics)  z-50   ← cobria o chat no Dashboard
 *   QuickBlastProgressPanel (leads)    z-40
 *
 * Nenhum deles sabia dos outros. O bug já existia; adicionar um quarto botão
 * para o Suporte só o pioraria (ADR-0018, decisão 6).
 *
 * O dock não mantém um registro de itens em estado — isso obrigaria cada FAB a
 * se registrar e desregistrar, e um `useEffect` mal escrito viraria loop de
 * render. Ele expõe um container, e cada item se **portaliza** para dentro dele.
 * A ordem visual vem do `order` do flexbox, não da ordem de montagem: o Oráculo
 * só existe no Dashboard, e o dock não pode depender de quem montou primeiro.
 */

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Mais perto do canto = mais perto do polegar. O chat é o mais usado; o
 * suporte, o mais raro.
 */
export const DockOrder = {
  chat: 1,
  oraculo: 2,
  support: 3,
} as const;

const DockContainerContext = createContext<HTMLDivElement | null | undefined>(undefined);

export function FloatingDockProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  return (
    <DockContainerContext.Provider value={container}>
      <DockSetterContext.Provider value={setContainer}>{children}</DockSetterContext.Provider>
    </DockContainerContext.Provider>
  );
}

const DockSetterContext = createContext<((el: HTMLDivElement | null) => void) | null>(null);

/**
 * O container. Renderizado uma vez, perto da raiz autenticada.
 *
 * `pointer-events-none` no container e `auto` em cada item: a coluna vazia não
 * pode roubar cliques do conteúdo por baixo dela.
 *
 * `z-40`, não `z-50`: os painéis que estes botões abrem (chat, oráculo) sobem a
 * partir de `bottom-24` e precisam cobrir os botões que ficaram acima do dock.
 */
export function FloatingDock() {
  const setContainer = useContext(DockSetterContext);

  return (
    <div
      ref={setContainer ?? undefined}
      data-floating-dock
      className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col-reverse items-end gap-3"
    />
  );
}

/**
 * Um botão do dock. Fora do provider, lança — um FAB invisível seria pior que
 * um erro.
 */
export function DockItem({ order, children }: { order: number; children: ReactNode }) {
  const container = useContext(DockContainerContext);

  if (container === undefined) {
    throw new Error("<DockItem> precisa estar dentro de <FloatingDockProvider>");
  }
  if (!container) return null;

  return createPortal(
    <div data-dock-item style={{ order }} className="pointer-events-auto">
      {children}
    </div>,
    container,
  );
}
