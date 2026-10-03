import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CodeErrorPolicy, CodeJsonNodeData } from "@/types/workflow";
import { VariableInserter } from "@/modules/workflows/components/VariableInserter";
import {
  CodeField,
  type CodeFieldHandle,
} from "@/modules/workflows/components/CodeField";

interface CodeJsonPanelProps {
  data: CodeJsonNodeData;
  onUpdate: (updates: Partial<CodeJsonNodeData>) => void;
}

const CODE_PLACEHOLDER = `{
  "lead": "{{nome}}",
  "empresa": "{{empresa}}",
  "total_centavos": 19900
}`;

/** Uma chave por linha, sem linha vazia. */
function parseRequiredKeys(raw: string): string[] {
  return raw
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function CodeJsonPanel({ data, onUpdate }: CodeJsonPanelProps) {
  const codeRef = useRef<CodeFieldHandle>(null);
  const outputVariable = (data.outputVariable || "").trim();

  // O Textarea de chaves precisa de rascunho local: filtrar linha vazia a cada
  // tecla apagaria o Enter que o usuário acabou de digitar.
  const persistedKeys = (data.requiredKeys || []).join("\n");
  const [keysDraft, setKeysDraft] = useState(persistedKeys);
  useEffect(() => {
    setKeysDraft((prev) =>
      parseRequiredKeys(prev).join("\n") === persistedKeys ? prev : persistedKeys,
    );
  }, [persistedKeys]);

  return (
    <div className="space-y-4">
      {/* 1. Nome */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Montar payload do pedido"
        />
      </div>

      {/* 2. Código */}
      <div className="space-y-2">
        <Label>Código JSON</Label>
        <VariableInserter onInsert={(v) => codeRef.current?.insertAtCursor(v)} />
        <CodeField
          ref={codeRef}
          language="json"
          value={data.code || ""}
          onChange={(v) => onUpdate({ code: v })}
          placeholder={CODE_PLACEHOLDER}
        />
      </div>

      {/* 3. Variável de saída */}
      <div className="space-y-2">
        <Label>Variável de saída</Label>
        <Input
          value={data.outputVariable || ""}
          onChange={(e) => onUpdate({ outputVariable: e.target.value })}
          placeholder="payload"
        />
        <p className="text-xs text-muted-foreground">
          Use {`{{${outputVariable || "payload"}}}`} nos nós seguintes. As chaves de
          primeiro nível também ficam disponíveis, ex.{" "}
          {`{{${outputVariable || "payload"}.total}}`}.
        </p>
      </div>

      {/* 4. Específico do JSON */}
      <div className="space-y-2">
        <Label>Chaves obrigatórias (opcional)</Label>
        <Textarea
          value={keysDraft}
          onChange={(e) => {
            setKeysDraft(e.target.value);
            onUpdate({ requiredKeys: parseRequiredKeys(e.target.value) });
          }}
          placeholder={"total\ncliente"}
          rows={3}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Uma por linha. Se alguma faltar no JSON montado, o nó falha em vez de mandar
          um payload incompleto adiante.
        </p>
      </div>

      {/* 5. Se der erro */}
      <div className="space-y-2">
        <Label>Se der erro</Label>
        <Select
          value={data.onError || "fail"}
          onValueChange={(v) => onUpdate({ onError: v as CodeErrorPolicy })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fail">Parar a automação</SelectItem>
            <SelectItem value="continue">Seguir para o próximo nó</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 6. Explicação */}
      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          Monta um JSON com os dados do lead e guarda numa variável. Use a variável no
          corpo de um Webhook Externo, ou em qualquer campo de texto dos nós seguintes.
          Os valores das variáveis são escapados antes de entrar no JSON — um lead com
          aspas no nome não quebra o payload.
        </p>
      </div>
    </div>
  );
}
