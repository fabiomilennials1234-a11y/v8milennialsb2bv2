import { renderHook, waitFor } from "@testing-library/react";
import { useMfaRequired } from "./useMfaRequired";

type AalResult = { data: { currentLevel: string | null; nextLevel: string | null } | null; error: { message: string } | null };

const getAal = vi.fn<() => Promise<AalResult>>();
const onAuthStateChange = vi.fn((_cb: () => void) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: { getAuthenticatorAssuranceLevel: () => getAal() },
      onAuthStateChange: (cb: () => void) => onAuthStateChange(cb),
    },
  },
}));

beforeEach(() => {
  getAal.mockReset();
  onAuthStateChange.mockClear();
});

/** Resposta do supabase-js: a chamada é assíncrona por contrato. */
const aal = (currentLevel: string | null, nextLevel: string | null) =>
  Promise.resolve({ data: { currentLevel, nextLevel }, error: null });

describe("useMfaRequired", () => {
  it("não exige nada de quem não é master", async () => {
    const { result } = renderHook(() => useMfaRequired(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.required).toBe(false);
    // Nem chega a consultar o AAL — não é assunto dele.
    expect(getAal).not.toHaveBeenCalled();
  });

  it("libera master que já está em aal2", async () => {
    getAal.mockReturnValue(aal("aal2", "aal2"));
    const { result } = renderHook(() => useMfaRequired(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.required).toBe(false);
  });

  it("exige segundo fator de master em aal1 que já tem fator cadastrado", async () => {
    getAal.mockReturnValue(aal("aal1", "aal2"));
    const { result } = renderHook(() => useMfaRequired(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.required).toBe(true);
  });

  it("exige segundo fator de master que NUNCA cadastrou fator", async () => {
    // Este é o caso que um check por `nextLevel === 'aal2'` deixaria passar:
    // sem fator cadastrado o Supabase devolve nextLevel 'aal1', e o master
    // entraria no sistema inteiro sem nunca ativar o segundo fator.
    getAal.mockReturnValue(aal("aal1", "aal1"));
    const { result } = renderHook(() => useMfaRequired(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.required).toBe(true);
  });

  it("falha fechado: erro ao ler o AAL exige o segundo fator", async () => {
    getAal.mockReturnValue(
      Promise.resolve({ data: null, error: { message: "boom" } }),
    );
    const { result } = renderHook(() => useMfaRequired(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.required).toBe(true);
  });

  it("fica desligado na própria rota de MFA, senão o redirect vira loop", async () => {
    getAal.mockReturnValue(aal("aal1", "aal2"));
    const { result } = renderHook(() => useMfaRequired(true, false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.required).toBe(false);
    expect(getAal).not.toHaveBeenCalled();
  });

  it("reavalia quando a sessão muda — é o que libera o gate após verificar", async () => {
    getAal.mockReturnValue(aal("aal1", "aal2"));
    const { result } = renderHook(() => useMfaRequired(true));
    await waitFor(() => expect(result.current.required).toBe(true));

    // O refreshSession() da tela de MFA dispara onAuthStateChange.
    getAal.mockReturnValue(aal("aal2", "aal2"));
    const callback = onAuthStateChange.mock.calls[0]?.[0];
    callback?.();

    await waitFor(() => expect(result.current.required).toBe(false));
  });
});
