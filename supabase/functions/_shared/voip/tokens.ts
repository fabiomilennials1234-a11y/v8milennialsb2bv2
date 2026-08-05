/**
 * Porta pública dos minters de credencial do TorqueCalls.
 *
 * `internal/sign.ts` é privado do pacote `_shared/voip/` — nada de fora importa
 * de lá. Este arquivo reexporta apenas o que uma edge function tem direito de
 * cunhar por conta própria:
 *
 *   - `tc-admin`  (30s, server-to-server, ciclo de vida de sessão)
 *   - `tc-stream` (60s, browser, leitura do stream de eventos)
 *
 * O que ele deliberadamente NÃO reexporta é `signCallToken`. Escopo `call` é o
 * que disca, consome minuto e carrega risco de ban — e só sai por
 * `call-plane.ts`, depois do governor. Se este arquivo passar a exportar o
 * minter de chamada, o choke deixa de existir e `scripts/test-voip-choke.sh`
 * reprova o build.
 */

export {
  ADMIN_TTL_SECONDS,
  type AdminAction,
  type AdminTokenArgs,
  publicKeyBase64,
  signAdminToken,
  signStreamToken,
  STREAM_TTL_SECONDS,
  type StreamTokenArgs,
  type VoipScope,
} from "./internal/sign.ts";
