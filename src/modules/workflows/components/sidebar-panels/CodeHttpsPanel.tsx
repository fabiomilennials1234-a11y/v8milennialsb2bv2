import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CodeErrorPolicy, CodeHttpsNodeData } from "@/types/workflow";
import { VariableInserter } from "@/modules/workflows/components/VariableInserter";
import {
  CodeField,
  type CodeFieldHandle,
} from "@/modules/workflows/components/CodeField";

interface CodeHttpsPanelProps {
  data: CodeHttpsNodeData;
  onUpdate: (updates: Partial<CodeHttpsNodeData>) => void;
}

/**
 * A requisição inteira é UM JSON — não há campo separado de método, URL ou
 * cabeçalho. O placeholder é a documentação que o operador lê primeiro, então
 * ele mostra as cinco chaves de uma vez.
 */
const CODE_PLACEHOLDER = `{
  "method": "POST",
  "url": "https://api.exemplo.com/pedidos",
  "headers": { "Authorization": "Bearer {{token}}" },
  "body": { "lead": "{{nome}}", "total": "{{payload.total}}" },
  "timeoutMs": 10000
}`;

export function CodeHttpsPanel({ data, onUpdate }: CodeHttpsPanelProps) {
  const codeRef = useRef<CodeFieldHandle>(null);
  const outputVariable = (data.outputVariable || "").trim();
  const outVar = outputVariable || "resposta";

  return (
    <div className="space-y-4">
      {/* 1. Nome */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Criar pedido no ERP"
        />
      </div>

      {/* 2. Código */}
      <div className="space-y-2">
        <Label>Requisição (JSON)</Label>
        <VariableInserter onInsert={(v) => codeRef.current?.insertAtCursor(v)} />
        {/* `https` e não `json`: o conteúdo é JSON, mas o CodeField usa a
            linguagem no nome acessível do campo — "Código JSON" num nó HTTPS
            confunde quem navega por leitor de tela. */}
        <CodeField
          ref={codeRef}
          language="https"
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
          placeholder="resposta"
        />
        <p className="text-xs text-muted-foreground">
          A resposta fica em {`{{${outVar}}}`} para os nós seguintes.
        </p>
      </div>

      {/* 4. Sem campos específicos — a requisição inteira vive no JSON acima. */}

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

      {/* 6. Explicação — aqui ela também é a documentação do formato, porque não
          existe campo de formulário para consultar. */}
      <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950 border border-violet-200 dark:border-violet-800 space-y-2">
        <p className="text-xs text-violet-700 dark:text-violet-300">
          Dispara uma chamada HTTPS e guarda a resposta em {`{{${outVar}}}`}. A
          requisição inteira é escrita como um JSON, com estas chaves:
        </p>
        <ul className="text-xs text-violet-700 dark:text-violet-300 space-y-1 pl-1">
          <li>
            <code className="font-mono">url</code> — obrigatória, e precisa começar com{" "}
            <code className="font-mono">https://</code>. Endereço{" "}
            <code className="font-mono">http://</code> é recusado.
          </li>
          <li>
            <code className="font-mono">method</code> — opcional, padrão{" "}
            <code className="font-mono">GET</code>. Aceita GET, POST, PUT, PATCH, DELETE
            e HEAD.
          </li>
          <li>
            <code className="font-mono">headers</code> — opcional, um objeto de textos.
            Ex.: <code className="font-mono">{'{ "Authorization": "Bearer …" }'}</code>.
          </li>
          <li>
            <code className="font-mono">body</code> — opcional. Objeto ou lista vira
            JSON; texto vai como está. Ignorado em GET e HEAD.
          </li>
          <li>
            <code className="font-mono">timeoutMs</code> — opcional, padrão 15000, teto
            30000.
          </li>
        </ul>
        <p className="text-xs text-violet-700 dark:text-violet-300">
          As {"{{variáveis}}"} são substituídas antes do envio, em qualquer lugar do
          JSON — inclusive dentro da URL e dos cabeçalhos.
        </p>
        <p className="text-xs text-violet-700 dark:text-violet-300">
          No histórico de execuções ficam o método, o host, o caminho, o tamanho e um
          trecho da resposta. Os cabeçalhos, a query da URL e o corpo enviado não são
          gravados — assim um token no{" "}
          <code className="font-mono">Authorization</code> não vira leitura de qualquer
          membro da organização.
        </p>
      </div>
    </div>
  );
}
