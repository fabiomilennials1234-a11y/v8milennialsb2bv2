/**
 * Busca de cliente para agendar (Comando e modal de reunião): as regras vivem
 * aqui porque os dois modais — analytics e engagement — precisam das mesmas.
 */
import { termoDeBusca } from "@/shared/format/termo-de-busca";

/**
 * Busca de cliente na "Nova agenda": só nome, empresa e código do ERP. Telefone
 * fica de fora de propósito (pedido da Café) — número digitado não acha cliente.
 */
export function filtrosDaBuscaCliente(termo: string): string[] {
  const limpo = termoDeBusca(termo);
  return [`name.ilike.%${limpo}%`, `company.ilike.%${limpo}%`, `erp_code.ilike.%${limpo}%`];
}

/** Colunas da busca; cidade, representante e telefones só alimentam o hover. */
export const SELECT_BUSCA_CLIENTE =
  "id, name, company, phone, erp_code, uf, upsell_clients(erp_city, erp_uf, erp_owner_name, updated_at), lead_phones(phone, is_primary, created_at)";

export interface ClienteParaAgenda {
  id: string;
  name: string | null;
  company: string | null;
  erp_code: string | null;
  uf: string | null;
  /** Cidade do cadastro do ERP. */
  cidade: string | null;
  /** Representante do cliente no ERP — não é o dono da agenda. */
  representante: string | null;
  /** Principal primeiro, sem repetição. */
  telefones: string[];
}

type Um<T> = T | T[] | null | undefined;

export interface LinhaBuscaCliente {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  erp_code: string | null;
  uf: string | null;
  upsell_clients?: Um<{ erp_city: string | null; erp_uf: string | null; erp_owner_name: string | null; updated_at: string | null }>;
  lead_phones?: Um<{ phone: string | null; is_primary: boolean | null; created_at: string | null }>;
}

const lista = <T>(v: Um<T>): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const texto = (v: string | null | undefined): string | null => v?.trim() || null;

/**
 * Linha do PostgREST → cliente do modal. Mesmas regras do `get_agenda_contatos`:
 * cidade e representante vêm do cadastro do ERP, UF cai no UF do lead, e os
 * telefones são os de `lead_phones` com o principal primeiro.
 */
export function paraClienteAgenda(l: LinhaBuscaCliente): ClienteParaAgenda {
  const erp = [...lista(l.upsell_clients)].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
  const fones = [...lista(l.lead_phones)]
    .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    .map((p) => texto(p.phone));
  const vistos = new Set<string>();
  const telefones = [...fones, texto(l.phone)].filter((p): p is string => {
    if (!p) return false;
    const chave = p.replace(/\D/g, "") || p;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    erp_code: texto(l.erp_code),
    uf: texto(erp?.erp_uf) ?? texto(l.uf),
    cidade: texto(erp?.erp_city),
    representante: texto(erp?.erp_owner_name),
    telefones,
  };
}
