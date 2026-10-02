import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Anéis concêntricos em shader — o `ShaderAnimation` do 21st.dev, em WebGL puro.
 *
 * ── Por que sem `three` ────────────────────────────────────────────────────
 * O original usa three.js para uma única coisa: desenhar um quad de tela cheia
 * com um fragment shader. Isso são ~60 linhas de WebGL, e o `three` custaria
 * ~600 KB de bundle para elas. O fragment shader abaixo é o MESMO do original;
 * o que mudou é quem o desenha, mais duas coisas que o card precisa:
 *
 *   - `tint`: sem ele, o shader pinta os três canais defasados (o arco-íris do
 *     original). Com ele, a intensidade vira a cor dada — verde no ganho,
 *     vermelho na perda — com núcleo claro onde o anel é mais forte.
 *   - alfa: fora dos anéis o pixel é transparente, então a camada vai POR CIMA
 *     do card sem apagá-lo. O original pintava fundo preto.
 *
 * Tamanho vem do contêiner (ResizeObserver), não da janela: o uso aqui é uma
 * camada do tamanho de um card, não a tela inteira.
 *
 * Sem WebGL (jsdom, GPU bloqueada), não desenha nada e chama `onUnsupported`.
 */

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec3 tint;
uniform float useTint;
uniform float intensity;

void main(void) {
  vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
  float t = time * 0.05;
  float lineWidth = 0.002;

  vec3 color = vec3(0.0);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 5; i++) {
      color[j] += lineWidth * float(i * i) / abs(fract(t - 0.01 * float(j) + float(i) * 0.01) * 5.0 - length(uv) + mod(uv.x + uv.y, 0.2));
    }
  }

  if (useTint > 0.5) {
    float mono = (color.r + color.g + color.b) / 3.0;
    // Cor dominante; o branco só aparece no centro do anel, e contido.
    vec3 rgb = tint * min(mono, 1.4) + vec3(smoothstep(1.4, 3.0, mono)) * 0.35;
    float alpha = clamp(mono * 0.9, 0.0, 0.9) * intensity;
    gl_FragColor = vec4(min(rgb, vec3(1.0)), alpha);
  } else {
    float alpha = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0) * intensity;
    gl_FragColor = vec4(min(color, vec3(1.0)), alpha);
  }
}
`;

export interface ShaderAnimationProps {
  className?: string;
  /** Cor dos anéis em RGB 0–1. Ausente: o arco-íris do original. */
  tint?: readonly [number, number, number];
  /** Multiplica a velocidade dos anéis. 1 = o ritmo do original. */
  speed?: number;
  /** 0–1: opacidade dos anéis. */
  intensity?: number;
  /** Sem contexto WebGL. Quem usa decide o que mostrar no lugar. */
  onUnsupported?: () => void;
}

function compilar(gl: WebGLRenderingContext, tipo: number, fonte: string): WebGLShader | null {
  const shader = gl.createShader(tipo);
  if (!shader) return null;
  gl.shaderSource(shader, fonte);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function ShaderAnimation({ className, tint, speed = 1, intensity = 1, onUnsupported }: ShaderAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Props que mudam sem recriar o contexto GL: lidas a cada quadro.
  const live = useRef({ tint, speed, intensity });
  live.current = { tint, speed, intensity };
  const onUnsupportedRef = useRef(onUnsupported);
  onUnsupportedRef.current = onUnsupported;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) {
      onUnsupportedRef.current?.();
      return;
    }

    const vs = compilar(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compilar(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      onUnsupportedRef.current?.();
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      onUnsupportedRef.current?.();
      return;
    }
    gl.useProgram(program);

    // Dois triângulos cobrindo o clip space — o PlaneGeometry(2, 2) do original.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "resolution");
    const uTime = gl.getUniformLocation(program, "time");
    const uTint = gl.getUniformLocation(program, "tint");
    const uUseTint = gl.getUniformLocation(program, "useTint");
    const uIntensity = gl.getUniformLocation(program, "intensity");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    container.appendChild(canvas);

    const resize = () => {
      // DPR limitado a 2: acima disso o custo cresce e o olho não vê.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(container.clientWidth * dpr));
      const height = Math.max(1, Math.round(container.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // O original soma 0.05 por quadro (60 fps → 3/s). Aqui o tempo é real,
    // para o ritmo não depender da taxa de quadros do monitor.
    let time = 1;
    let last = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { tint: cor, speed: velocidade, intensity: forca } = live.current;
      time += dt * 3 * velocidade;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform3f(uTint, cor?.[0] ?? 0, cor?.[1] ?? 0, cor?.[2] ?? 0);
      gl.uniform1f(uUseTint, cor ? 1 : 0);
      gl.uniform1f(uIntensity, forca);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Contextos WebGL são poucos por página (~16). Um card que anima e sai
      // devolve o dele na hora, em vez de esperar o GC.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  return <div ref={containerRef} aria-hidden className={cn("h-full w-full overflow-hidden", className)} />;
}
