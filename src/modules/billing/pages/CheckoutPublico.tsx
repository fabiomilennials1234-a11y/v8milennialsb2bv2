import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  resolveScreen,
  isTerminal,
  type CheckoutScreen,
  type PaymentLinkResponse,
} from "@/modules/billing/lib/checkout-state";

/**
 * Página pública de contratação (SCRUM-289, Fatia 8).
 *
 * PÚBLICA de verdade: não há sessão, não há org no contexto, e o token da URL é
 * a única credencial. Por isso ela NÃO fala com o banco — nem para ler. Toda
 * leitura passa pela edge function `billing-payment-link`, que roda com
 * service_role e devolve uma lista branca de campos.
 *
 * Isso deixou de ser preferência de arquitetura e virou contenção: em 11/08 um
 * SELECT em `leads` como `anon` derrubou o backend do Postgres no PLANEJAMENTO
 * da query. `anon` com alcance de leitura não é só superfície de vazar linha, é
 * superfície de DERRUBAR O BANCO — e esta é a primeira página do produto onde
 * `anon` fala com o servidor de propósito.
 *
 * ESTADO DESTA FATIA: esqueleto da máquina de estados e dos desfechos que não
 * dependem do gateway. Os estados de pagamento (pix, cartão, aprovado) entram
 * quando o shape da Fatia 6 fechar — é ela que grava o pagamento, e portanto ela
 * que define o que a leitura de status pode afirmar.
 */
export default function CheckoutPublico() {
  const { token } = useParams<{ token: string }>();
  const [screen, setScreen] = useState<CheckoutScreen>("carregando");

  useEffect(() => {
    let vivo = true;

    async function resolver() {
      if (!token) {
        setScreen("nao_encontrado");
        return;
      }

      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-payment-link`;
        const resposta = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        // A porta devolve 200 para os QUATRO desfechos conhecidos, inclusive os
        // inválidos: link vencido não é incidente, é desfecho esperado, e a
        // página TEM que renderizar a mensagem. O estado vem sempre no corpo.
        const corpo = (await resposta.json()) as PaymentLinkResponse;
        if (vivo) setScreen(resolveScreen(corpo));
      } catch {
        // Rede caiu ou a porta respondeu algo que não é JSON. Não é desfecho de
        // negócio — é indisponibilidade, e o retry é legítimo.
        if (vivo) setScreen("indisponivel");
      }
    }

    void resolver();
    return () => {
      vivo = false;
    };
  }, [token]);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-lg px-5 py-10" data-state={screen}>
        <CheckoutEstado screen={screen} />
      </div>
    </main>
  );
}

/**
 * A cópia é NOSSA, não da porta pública — ela manda o estado, não a frase.
 * Microcopy em dois lugares vira drift na primeira vez que alguém mexe no tom.
 */
function CheckoutEstado({ screen }: { screen: CheckoutScreen }) {
  if (screen === "carregando") {
    return <p className="text-sm text-muted-foreground">Carregando seu pedido…</p>;
  }

  if (!isTerminal(screen) && screen === "pedido") {
    // A composição do pedido entra junto com os estados de pagamento.
    return <p className="text-sm text-muted-foreground">Pedido carregado.</p>;
  }

  const copy: Record<string, { titulo: string; corpo: string }> = {
    expirado: {
      titulo: "Este link expirou",
      corpo: "Peça um novo link para quem enviou este e a contratação segue normalmente.",
    },
    usado: {
      titulo: "Este link já foi usado",
      corpo: "O pagamento desta proposta já foi concluído. Não é preciso pagar de novo.",
    },
    revogado: {
      titulo: "Este link foi cancelado",
      corpo: "Quem enviou a proposta cancelou este link. Fale com essa pessoa para receber um novo.",
    },
    nao_encontrado: {
      titulo: "Não encontramos esta proposta",
      corpo: "Confira se o endereço veio completo. Se veio de um e-mail, abra pelo link original.",
    },
    indisponivel: {
      titulo: "Não foi possível carregar",
      corpo: "Tente de novo em instantes. Se continuar, fale com quem enviou a proposta.",
    },
  };

  const texto = copy[screen] ?? copy.indisponivel;

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{texto.titulo}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{texto.corpo}</p>
    </section>
  );
}
