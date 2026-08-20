/**
 * SendLocationDialog — mandar um ponto no mapa.
 *
 * O caso real é o vendedor mandando o endereço da fábrica ou do ponto de
 * retirada. Hoje ele cola um link do Google Maps no texto, que o cliente abre no
 * navegador; a localização nativa abre o app de mapas com rota, e fica no
 * histórico da conversa como um cartão.
 *
 * ⚠️ Só DENTRO da janela de 24 horas. Fora dela a Meta recusa qualquer mensagem
 * livre, e o composer já desabilita a entrada por lá.
 */
import { useState } from "react";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SendLocationDialog({
  open,
  onOpenChange,
  enviar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enviar: (l: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [localizando, setLocalizando] = useState(false);

  const usarMinhaLocalizacao = () => {
    if (!navigator.geolocation) {
      toast.error("Este navegador não informa a localização");
      return;
    }
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
        setLocalizando(false);
      },
      () => {
        // Negar a permissão é uma escolha do usuário, não um defeito: o
        // formulário continua servindo com as coordenadas digitadas.
        toast.error("Não foi possível obter a localização — digite as coordenadas");
        setLocalizando(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submeter = async () => {
    const latitude = Number(lat.replace(",", "."));
    const longitude = Number(lng.replace(",", "."));
    // `0` é coordenada válida — a checagem é de finitude, não de verdade.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      toast.error("Informe latitude e longitude");
      return;
    }

    setEnviando(true);
    try {
      await enviar({
        latitude,
        longitude,
        name: nome.trim() || undefined,
        address: endereco.trim() || undefined,
      });
      toast.success("Localização enviada");
      onOpenChange(false);
      setNome("");
      setEndereco("");
      setLat("");
      setLng("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Enviar localização
          </DialogTitle>
          <DialogDescription>
            O cliente recebe um cartão que abre direto no app de mapas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome do lugar (opcional)</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Fábrica — Portão 2"
            />
          </div>

          <div className="space-y-2">
            <Label>Endereço (opcional)</Label>
            <Input
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Rod. BR-277, km 12 — Maringá/PR"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Coordenadas</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={usarMinhaLocalizacao}
                disabled={localizando}
              >
                {localizando
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <LocateFixed className="h-3.5 w-3.5" />}
                Usar minha localização
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-25.510785"
                inputMode="decimal"
              />
              <Input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-48.310882"
                inputMode="decimal"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submeter} disabled={enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
