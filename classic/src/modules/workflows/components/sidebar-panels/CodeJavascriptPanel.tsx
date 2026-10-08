import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CodeErrorPolicy, CodeJavascriptNodeData } from "@/types/workflow";
import { VariableInserter } from "@/modules/workflows/components/VariableInserter";
import {
  CodeField,
  type CodeFieldHandle,
} from "@/modules/workflows/components/CodeField";
import { CodeJavascriptTestRunner } from "./CodeJavascriptTestRunner";

interface CodeJavascriptPanelProps {
  data: CodeJavascriptNodeData;
  onUpdate: (updates: Partial<CodeJavascriptNodeData>) => void;
}

const CODE_PLACEHOLDER = `const nome = "{{nome}}";
return { saudacao: "Olá, " + nome };`;

export function CodeJavascriptPanel({ data, onUpdate }: CodeJavascriptPanelProps) {
  const codeRef = useRef<CodeFieldHandle>(null);
  const code = data.code || "";
  const outputVariable = (data.outputVariable || "").trim();

  return (
    <div className="space-y-4">
      {/* 1. Nome */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Calcular desconto"
        />
      </div>

      {/* 2. Código */}
      <div className="space-y-2">
        <Label>Código JavaScript</Label>
        <VariableInserter onInsert={(v) => codeRef.current?.insertAtCursor(v)} />
        <CodeField
          ref={codeRef}
          language="javascript"
          value={code}
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
          placeholder="resultado"
        />
        <p className="text-xs text-muted-foreground">
          Onde o retorno do código vai ficar quando a execução no servidor entrar no ar:{" "}
          {`{{${outputVariable || "resultado"}}}`}.
        </p>
      </div>

      {/* 4. Específico do JavaScript */}
      <div className="space-y-2">
        <Label>Tempo máximo (ms)</Label>
        {/* Desabilitado enquanto o nó não executa; o handler já fica pronto para a
            versão que roda o código no servidor. O <span> existe porque input
            desabilitado não dispara os eventos que o Tooltip escuta. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <Input
                type="number"
                min={100}
                max={2000}
                step={100}
                disabled
                value={data.timeoutMs ?? 500}
                onChange={(e) =>
                  onUpdate({
                    timeoutMs: Math.min(2000, Math.max(100, Number(e.target.value) || 500)),
                  })
                }
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>Vale a partir da próxima versão</TooltipContent>
        </Tooltip>
        <p className="text-xs text-muted-foreground">
          Quanto o código pode demorar na execução do servidor. Entre 100 e 2000 ms.
        </p>
      </div>

      {/* Aviso de fase 1 — o nó é autorável, mas o executor pula (SPEC §4.3) */}
      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
        <div className="flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <strong>Este nó ainda não executa no servidor.</strong> Nesta versão você
            escreve o código e o Torque guarda tudo junto do workflow. Na execução, o nó
            é registrado como "pulado" e o fluxo segue para o próximo nó. A execução
            isolada (sandbox) chega numa próxima entrega.
          </p>
        </div>
      </div>

      <CodeJavascriptTestRunner code={code} />

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
        <p className="text-xs text-muted-foreground">
          Vale a partir da versão que executa o código. Hoje o nó é sempre pulado e o
          fluxo segue.
        </p>
      </div>

      {/* 6. Explicação */}
      <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800">
        <p className="text-xs text-sky-700 dark:text-sky-300">
          Guarda um JavaScript junto da automação. Quando a execução isolada entrar no
          ar, o retorno do código vai para a variável de saída e fica disponível nos nós
          seguintes. Até lá, use o teste no navegador para conferir a lógica.
        </p>
      </div>
    </div>
  );
}
