import { useEffect, useRef, useState } from "react";
import { ehTokenVencido } from "../lib/sessao-resiliente";
import { renovarSessao } from "../lib/sessao-runtime";

/** Tentativas de renovar por tela montada — depois disso, a tela de erro é honesta. */
const MAX_TENTATIVAS = 2;

export type EstadoRecuperacao = "nada" | "renovando" | "falhou";

/**
 * Na abertura do app: se a consulta falhou só porque o token de ACESSO venceu,
 * renova a sessão e refaz a consulta antes de mostrar "Sua sessão expirou".
 * A tela de erro só aparece se a renovação falhar (sessão de fato perdida) ou
 * se o erro não for de token vencido.
 */
export function useRecuperacaoDeSessao(erro: unknown, refazer: () => void): EstadoRecuperacao {
  const [estado, setEstado] = useState<EstadoRecuperacao>("nada");
  const tentativas = useRef(0);
  const vencido = ehTokenVencido(erro);

  useEffect(() => {
    if (!vencido) {
      setEstado("nada");
      return;
    }
    if (tentativas.current >= MAX_TENTATIVAS) {
      setEstado("falhou");
      return;
    }
    tentativas.current += 1;
    setEstado("renovando");
    let vivo = true;
    void renovarSessao().then((ok) => {
      if (!vivo) return;
      if (ok) refazer();
      else setEstado("falhou");
    });
    return () => {
      vivo = false;
    };
    // `erro` muda de identidade a cada falha: é ele que dispara uma nova tentativa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erro, vencido]);

  return vencido ? estado : "nada";
}
