import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArticleFeedback } from "./ArticleFeedback";

const submit = vi.fn();
const state = { myVote: null as boolean | null, isPending: false };

vi.mock("@/modules/platform/hooks/useArticleFeedback", () => ({
  useArticleFeedback: () => ({
    myVote: state.myVote,
    submit,
    isPending: state.isPending,
  }),
}));

beforeEach(() => {
  submit.mockClear();
  state.myVote = null;
  state.isPending = false;
});

describe("ArticleFeedback — motivo do 👎 (B2)", () => {
  it("sem voto, o campo de motivo está escondido", () => {
    render(<ArticleFeedback articleId="a1" />);
    expect(screen.queryByLabelText("O que faltou?")).not.toBeInTheDocument();
  });

  it("👎 conta o voto na hora e revela o campo de motivo", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ArticleFeedback articleId="a1" />);

    await user.click(screen.getByLabelText("Não foi útil"));
    expect(submit).toHaveBeenCalledWith({ helpful: false });

    // O hook confirma o voto; o campo então aparece.
    state.myVote = false;
    rerender(<ArticleFeedback articleId="a1" />);
    expect(screen.getByLabelText("O que faltou?")).toBeInTheDocument();
  });

  it("enviar o motivo chama submit com helpful=false e o texto", async () => {
    const user = userEvent.setup();
    state.myVote = false;
    render(<ArticleFeedback articleId="a1" />);

    await user.type(screen.getByLabelText("O que faltou?"), "faltou exemplo");
    await user.click(screen.getByRole("button", { name: /enviar/i }));

    expect(submit).toHaveBeenCalledWith({ helpful: false, reason: "faltou exemplo" });
  });

  it("enviar sem texto manda reason null (não obriga)", async () => {
    const user = userEvent.setup();
    state.myVote = false;
    render(<ArticleFeedback articleId="a1" />);

    await user.click(screen.getByRole("button", { name: /enviar/i }));
    expect(submit).toHaveBeenCalledWith({ helpful: false, reason: null });
  });

  it("trocar pra 👍 esconde o campo de motivo", async () => {
    const user = userEvent.setup();
    state.myVote = false;
    const { rerender } = render(<ArticleFeedback articleId="a1" />);
    expect(screen.getByLabelText("O que faltou?")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Foi útil"));
    expect(submit).toHaveBeenCalledWith({ helpful: true });

    state.myVote = true;
    rerender(<ArticleFeedback articleId="a1" />);
    expect(screen.queryByLabelText("O que faltou?")).not.toBeInTheDocument();
  });
});
