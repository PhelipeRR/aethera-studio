import { useEffect, useMemo, useState, type DragEvent } from 'react';
import dagre from '@dagrejs/dagre';
import { Background, Controls, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Check, CircleDot, LoaderCircle } from 'lucide-react';
import type { WorkflowDefinitionV2, WorkflowIssue } from '@neuralbridge/shared/workflows';
import { Button } from '@/components/ui/button';
import { addDependency, duplicateStep, NODE_CATALOG, NODE_DRAG_TYPE, removeDependency, removeSteps, type NodeKind } from './model';

export type StepPosition = { id: string; x: number; y: number };
type StepNodeData = { title: string; label: string; state: string | undefined; issue: string | undefined; edits: boolean };

const WIDTH = 220;
const HEIGHT = 84;
export const STATE_LABEL: Record<string, string> = { pending: 'Aguardando', awaiting_approval: 'Aguardando aprovação', approved: 'Aprovada', running: 'Executando', completed: 'Concluída', failed: 'Falhou', skipped: 'Pulada', needs_decision: 'Precisa de decisão', retry_wait: 'Nova tentativa', cancelled: 'Cancelada' };

function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const tone = data.issue || data.state === 'failed' ? 'border-destructive' : data.state === 'running' ? 'border-primary' : data.state === 'awaiting_approval' || data.state === 'needs_decision' ? 'border-warning' : 'border-border';
  const finished = data.state === 'completed';
  return (
    <div className={`w-[220px] sg-panel rounded-xl px-3 py-3 text-card-foreground transition-[border-color,box-shadow] motion-reduce:transition-none ${tone} ${selected ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`} title={data.issue} aria-label={`${data.title}, ${data.state ? (STATE_LABEL[data.state] ?? data.state) : data.label}${data.issue ? `, problema: ${data.issue}` : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-start gap-2"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><CircleDot className="size-3.5" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-[13px] font-semibold">{data.title}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{data.label}</p></div></div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {data.issue ? <AlertTriangle className="size-3 shrink-0 text-destructive" aria-hidden="true" /> : data.state === 'running' ? <LoaderCircle className="size-3 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /> : finished ? <Check className="size-3 text-primary" aria-hidden="true" /> : <CircleDot className="size-3" aria-hidden="true" />}
        <span className="truncate">{data.issue ?? (data.state ? (STATE_LABEL[data.state] ?? data.state) : 'Não executada')}</span>
        {data.edits && <span className="ml-auto shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">edita</span>}
      </p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function EdgeNode({ data }: NodeProps<Node<{ label: string; side: 'start' | 'end' }>>) {
  return (
    <div className="rounded-full border bg-muted px-4 py-1.5 text-xs text-muted-foreground">
      {data.side === 'end' && <Handle type="target" position={Position.Left} isConnectable={false} />}
      {data.label}
      {data.side === 'start' && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>
  );
}

const nodeTypes = { step: StepNode, edge: EdgeNode };
const START = '__start';
const END = '__end';

/** Left to right by dependency; only the steps, since Start and End follow them. */
export function layoutSteps(definition: WorkflowDefinitionV2): StepPosition[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 72 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of definition.steps) graph.setNode(step.id, { width: WIDTH, height: HEIGHT });
  for (const step of definition.steps) for (const dependency of step.dependsOn) if (definition.steps.some((item) => item.id === dependency)) graph.setEdge(dependency, step.id);
  dagre.layout(graph);
  return definition.steps.map((step) => {
    const node = graph.node(step.id);
    return { id: step.id, x: Math.round(node.x - WIDTH / 2), y: Math.round(node.y - HEIGHT / 2) };
  });
}

interface CanvasProps {
  definition: WorkflowDefinitionV2;
  positions: StepPosition[];
  issues: WorkflowIssue[];
  states: Record<string, string>;
  onChange: (definition: WorkflowDefinitionV2) => void;
  onPositions: (positions: StepPosition[]) => void;
  onSelect: (id: string | null) => void;
  onAdd: (kind: NodeKind, position?: { x: number; y: number }) => void;
}

function Canvas({ definition, positions, issues, states, onChange, onPositions, onSelect, onAdd }: CanvasProps) {
  const flow = useReactFlow();
  const [arranged, setArranged] = useState(0);
  const stepIds = definition.steps.map((step) => step.id).join();
  // Added, removed, loaded or rearranged steps must come back into view; a dragged one stays where it was left.
  useEffect(() => {
    const frame = requestAnimationFrame(() => void flow.fitView({ maxZoom: 1, duration: 150 }));
    return () => cancelAnimationFrame(frame);
  }, [flow, stepIds, arranged]);
  const place = useMemo(() => {
    const saved = new Map(positions.map((item) => [item.id, item]));
    const fallback = new Map(layoutSteps(definition).map((item) => [item.id, item]));
    return (id: string) => saved.get(id) ?? fallback.get(id) ?? { x: 0, y: 0 };
  }, [definition, positions]);

  const stepNodes = useMemo<Node[]>(() => {
    const placed = definition.steps.map((step) => place(step.id));
    const left = Math.min(0, ...placed.map((item) => item.x));
    const right = Math.max(0, ...placed.map((item) => item.x));
    const middle = placed.length ? placed.reduce((sum, item) => sum + item.y, 0) / placed.length : 0;
    const steps: Node[] = definition.steps.map((step) => {
      const catalog = NODE_CATALOG.find((entry) => entry.matches(step));
      const issue = issues.find((item) => item.stepId === step.id)?.message;
      return { id: step.id, type: 'step', position: place(step.id), deletable: definition.steps.length > 1, data: { title: step.title, label: catalog?.label ?? step.kind, state: states[step.id], issue, edits: step.kind === 'agent' && step.access === 'edit' } satisfies StepNodeData };
    });
    return [
      { id: START, type: 'edge', position: { x: left - 140, y: middle + 24 }, data: { label: 'Início', side: 'start' }, deletable: false, selectable: false, draggable: false },
      ...steps,
      { id: END, type: 'edge', position: { x: right + WIDTH + 80, y: middle + 24 }, data: { label: 'Fim', side: 'end' }, deletable: false, selectable: false, draggable: false },
    ];
  }, [definition, issues, place, states]);

  const stepEdges = useMemo<Edge[]>(() => {
    const dependedOn = new Set(definition.steps.flatMap((step) => step.dependsOn));
    return [
      ...definition.steps.flatMap((step) => step.dependsOn.map((source) => ({ id: `${source}->${step.id}`, source, target: step.id, animated: states[source] === 'running' }))),
      ...definition.steps.filter((step) => step.dependsOn.length === 0).map((step) => ({ id: `${START}->${step.id}`, source: START, target: step.id, deletable: false, style: { strokeDasharray: 4 } })),
      ...definition.steps.filter((step) => !dependedOn.has(step.id)).map((step) => ({ id: `${step.id}->${END}`, source: step.id, target: END, deletable: false, style: { strokeDasharray: 4 } })),
    ];
  }, [definition, states]);

  // React Flow keeps measurements and selection on the nodes it is given, so they survive each new definition.
  const [nodes, setNodes, onNodesChange] = useNodesState(stepNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(stepEdges);
  useEffect(() => {
    setNodes((current) => {
      const known = new Map(current.map((node) => [node.id, node]));
      return stepNodes.map((node) => {
        const previous = known.get(node.id);
        return previous ? { ...node, ...(previous.measured ? { measured: previous.measured } : {}), selected: previous.selected ?? false } : node;
      });
    });
  }, [setNodes, stepNodes]);
  useEffect(() => {
    setEdges((current) => {
      const selected = new Set(current.filter((edge) => edge.selected).map((edge) => edge.id));
      return stepEdges.map((edge) => ({ ...edge, selected: selected.has(edge.id) }));
    });
  }, [setEdges, stepEdges]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(NODE_DRAG_TYPE) as NodeKind;
    if (NODE_CATALOG.some((entry) => entry.kind === kind)) onAdd(kind, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const onConnect = (connection: Connection) => {
    if (connection.source === START || connection.target === END || !connection.source || !connection.target) return;
    onChange(addDependency(definition, connection.source, connection.target));
  };

  const duplicate = () => {
    const selected = flow.getNodes().filter((node) => node.selected && node.type === 'step');
    let next = definition;
    for (const node of selected) next = duplicateStep(next, node.id);
    if (next !== definition) onChange(next);
  };

  return (
    <div role="application" aria-label="Canvas do workflow" className="h-full min-h-0 w-full" onDrop={onDrop} onDragOver={(event) => event.preventDefault()} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'd') { event.preventDefault(); duplicate(); } }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="system"
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        onConnect={onConnect}
        onNodeClick={(_event, node) => onSelect(node.type === 'step' ? node.id : null)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_event, _node, moved) => {
          const steps = moved.filter((node) => node.type === 'step');
          const ids = new Set(steps.map((node) => node.id));
          onPositions([...positions.filter((item) => !ids.has(item.id)), ...steps.map((node) => ({ id: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }))]);
        }}
        onNodesDelete={(removed) => onChange(removeSteps(definition, removed.map((node) => node.id)))}
        onEdgesDelete={(removed) => { let next = definition; for (const edge of removed) next = removeDependency(next, edge.source, edge.target); onChange(next); }}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Control']}
        snapToGrid
        snapGrid={[16, 16]}
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
        <Panel position="top-right" className="flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => { onPositions(layoutSteps(definition)); setArranged((count) => count + 1); }}>Organizar</Button>
          <Button type="button" size="sm" variant="outline" onClick={duplicate}>Duplicar</Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
