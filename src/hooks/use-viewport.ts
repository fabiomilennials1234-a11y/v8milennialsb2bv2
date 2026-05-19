import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 768;

export interface Viewport {
  isMobile: boolean;
  isDesktop: boolean;
  width: number | undefined;
}

export function useViewport(): Viewport {
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);

    update();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;

    if (observer) {
      observer.observe(document.documentElement);
    } else {
      window.addEventListener("resize", update);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener("resize", update);
      }
    };
  }, []);

  return {
    width,
    isMobile: width !== undefined ? width < MOBILE_BREAKPOINT : false,
    isDesktop: width !== undefined ? width >= MOBILE_BREAKPOINT : true,
  };
}
