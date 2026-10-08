import { memo, useCallback } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const { setEdges } = useReactFlow();

  const handleDisconnect = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEdges((eds) => eds.filter((edge) => edge.id !== id));
    },
    [id, setEdges]
  );

  const loopLimit = (data as any)?.loopLimit;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          strokeWidth: 2,
          stroke: selected
            ? "hsl(var(--primary))"
            : "hsl(var(--muted-foreground) / 0.4)",
          ...style,
        }}
        id={id}
      />
      {/* Animated dot */}
      <circle r="3" fill="hsl(var(--primary))">
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
      {/* Disconnect button */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <button
            onClick={handleDisconnect}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-relevo transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
            title="Desconectar"
            aria-label="Desconectar"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
      {/* Loop limit badge */}
      {loopLimit && (
        <text>
          <textPath
            href={`#${id}`}
            startOffset="50%"
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            max: {loopLimit}x
          </textPath>
        </text>
      )}
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);
