/**
 * Directive Reader - Camada 1
 * 
 * Lê e parseia diretivas Markdown de directives/
 * Valida estrutura antes de execução
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Directive {
  name: string;
  objective: string;
  inputs: DirectiveInput[];
  tools: DirectiveTool[];
  outputs: DirectiveOutput[];
  edgeCases: string[];
  learnings: DirectiveLearning[];
  filePath: string;
}

export interface DirectiveInput {
  field: string;
  type: string;
  description: string;
  required?: boolean;
}

export interface DirectiveTool {
  path: string;
  description: string;
  language: 'typescript' | 'python';
}

export interface DirectiveOutput {
  field: string;
  type: string;
  description: string;
}

export interface DirectiveLearning {
  date: string;
  content: string;
}

export class DirectiveReader {
  private directivesPath: string;

  constructor(directivesPath: string = path.join(process.cwd(), 'directives')) {
    this.directivesPath = directivesPath;
  }

  /**
   * Lê uma diretiva específica por caminho
   */
  async readDirective(filePath: string): Promise<Directive> {
    const fullPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(this.directivesPath, filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directive not found: ${fullPath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    return this.parseDirective(content, fullPath);
  }

  /**
   * Lista todas as diretivas disponíveis
   */
  async listDirectives(): Promise<string[]> {
    const directives: string[] = [];
    
    const categories = ['business', 'integrations', 'data_processing'];
    
    for (const category of categories) {
      const categoryPath = path.join(this.directivesPath, category);
      if (fs.existsSync(categoryPath)) {
        const files = fs.readdirSync(categoryPath);
        for (const file of files) {
          if (file.endsWith('.md')) {
            directives.push(path.join(category, file));
          }
        }
      }
    }
    
    return directives;
  }

  /**
   * Parseia conteúdo Markdown de uma diretiva
   */
  private parseDirective(content: string, filePath: string): Directive {
    const lines = content.split('\n');
    let currentSection = '';
    let name = '';
    let objective = '';
    const inputs: DirectiveInput[] = [];
    const tools: DirectiveTool[] = [];
    const outputs: DirectiveOutput[] = [];
    const edgeCases: string[] = [];
    const learnings: DirectiveLearning[] = [];

    // Extrair nome do título
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detectar seções
      if (line.startsWith('## ')) {
        currentSection = line.substring(3).toLowerCase();
        continue;
      }

      // Processar conteúdo baseado na seção
      switch (currentSection) {
        case 'objetivo':
          if (line && !line.startsWith('#')) {
            objective += (objective ? ' ' : '') + line;
          }
          break;

        case 'entradas':
          if (line.startsWith('- ')) {
            const input = this.parseInput(line);
            if (input) inputs.push(input);
          }
          break;

        case 'ferramentas':
          if (line.startsWith('- ')) {
            const tool = this.parseTool(line);
            if (tool) tools.push(tool);
          }
          break;

        case 'saídas':
          if (line.startsWith('- ')) {
            const output = this.parseOutput(line);
            if (output) outputs.push(output);
          }
          break;

        case 'edge cases':
          if (line.startsWith('- ')) {
            edgeCases.push(line.substring(2).trim());
          }
          break;

        case 'aprendizados':
          if (line.startsWith('- ')) {
            const learning = this.parseLearning(line);
            if (learning) learnings.push(learning);
          }
          break;
      }
    }

    // Validação básica
    if (!name) {
      throw new Error(`Directive missing name: ${filePath}`);
    }
    if (!objective) {
      throw new Error(`Directive missing objective: ${filePath}`);
    }
    if (tools.length === 0) {
      throw new Error(`Directive missing tools: ${filePath}`);
    }

    return {
      name,
      objective,
      inputs,
      tools,
      outputs,
      edgeCases,
      learnings,
      filePath,
    };
  }

  /**
   * Parseia uma entrada da seção "Entradas"
   * Formato: - Campo: Tipo - Descrição
   */
  private parseInput(line: string): DirectiveInput | null {
    const match = line.match(/^-\s+(.+?):\s*(.+?)\s*-\s*(.+)$/);
    if (!match) return null;

    const [, field, type, description] = match;
    return {
      field: field.trim(),
      type: type.trim(),
      description: description.trim(),
      required: !type.includes('?'),
    };
  }

  /**
   * Parseia uma ferramenta da seção "Ferramentas"
   * Formato: - `path/to/script` - Descrição
   */
  private parseTool(line: string): DirectiveTool | null {
    const match = line.match(/^-\s+`(.+?)`\s*-\s*(.+)$/);
    if (!match) return null;

    const [, path, description] = match;
    const language = path.includes('typescript') || path.includes('.ts') 
      ? 'typescript' 
      : 'python';

    return {
      path: path.trim(),
      description: description.trim(),
      language,
    };
  }

  /**
   * Parseia uma saída da seção "Saídas"
   * Formato: - Campo: Tipo - Descrição
   */
  private parseOutput(line: string): DirectiveOutput | null {
    const match = line.match(/^-\s+(.+?):\s*(.+?)\s*-\s*(.+)$/);
    if (!match) return null;

    const [, field, type, description] = match;
    return {
      field: field.trim(),
      type: type.trim(),
      description: description.trim(),
    };
  }

  /**
   * Parseia um aprendizado da seção "Aprendizados"
   * Formato: - Data: Conteúdo
   */
  private parseLearning(line: string): DirectiveLearning | null {
    const match = line.match(/^-\s+(.+?):\s*(.+)$/);
    if (!match) return null;

    const [, date, content] = match;
    return {
      date: date.trim(),
      content: content.trim(),
    };
  }

  /**
   * Adiciona um aprendizado a uma diretiva
   */
  async addLearning(directivePath: string, learning: string): Promise<void> {
    const fullPath = path.isAbsolute(directivePath)
      ? directivePath
      : path.join(this.directivesPath, directivePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directive not found: ${fullPath}`);
    }

    let content = fs.readFileSync(fullPath, 'utf-8');
    const today = new Date().toISOString().split('T')[0];
    const newLearning = `- ${today}: ${learning}`;

    // Adicionar seção de Aprendizados se não existir
    if (!content.includes('## Aprendizados')) {
      content += '\n\n## Aprendizados\n';
    }

    // Adicionar aprendizado
    const aprendizadosIndex = content.indexOf('## Aprendizados');
    const nextSectionIndex = content.indexOf('\n## ', aprendizadosIndex + 1);
    
    if (nextSectionIndex === -1) {
      // Última seção, adicionar no final
      content += `\n${newLearning}\n`;
    } else {
      // Inserir antes da próxima seção
      content = content.slice(0, nextSectionIndex) + 
                `\n${newLearning}\n` + 
                content.slice(nextSectionIndex);
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}
