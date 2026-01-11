import { useMemo, useCallback, useEffect, useState, useRef, forwardRef, useImperativeHandle } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  MarkerType,
  Position,
  Handle,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useTheme } from './ThemeProvider';
import { EditableStageCard } from './EditableStageCard';
import { getStageIcon, getStageColor } from './TransformationStages';
import type { TransformationStage } from './types';

interface StageNode {
  id: string;
  stage: TransformationStage;
  inputs: string[];
  level: number;
}

interface Props {
  stages: TransformationStage[];
  tables: Array<{ id: string; name: string; schema?: any[] }>;
  onStageEdit: (stage: TransformationStage) => Promise<void> | void;
  onStageStartEdit: (stageId: string) => void;
  onStageDelete: (stageId: string) => void;
  onStageAdd: () => void;
  editingStageId: string | null;
  newStage: TransformationStage | null;
  stageToTableMap?: Map<string, string>; // Maps stage ID to result table ID
  onShowTable?: (tableId: string) => void; // Callback to show a table
  onExportJSON?: () => void;
  onExportImage?: () => void;
  onClearFlow?: () => void;
}

// Build dependency graph
function buildStageGraph(stages: TransformationStage[]): Map<string, StageNode> {
  const nodes = new Map<string, StageNode>();
  const tableMap = new Map<string, string>();
  
  stages.forEach((stage) => {
    const node: StageNode = {
      id: stage.id,
      stage,
      inputs: [],
      level: 0
    };
    nodes.set(stage.id, node);
    
    if (stage.type === 'LOAD' && stage.data?.tableName) {
      tableMap.set(stage.data.tableName, stage.id);
    }
  });
  
  stages.forEach((stage) => {
    const node = nodes.get(stage.id);
    if (!node) return;
    
    switch (stage.type) {
      case 'JOIN':
        if (stage.data?.leftTable) {
          const leftInput = tableMap.get(stage.data.leftTable);
          if (leftInput) node.inputs.push(leftInput);
        }
        if (stage.data?.rightTable) {
          const rightInput = tableMap.get(stage.data.rightTable);
          if (rightInput) node.inputs.push(rightInput);
        }
        if (stage.data?.leftTable && stage.data?.rightTable) {
          const outputTable = `joined_${stage.data.leftTable}_${stage.data.rightTable}`;
          tableMap.set(outputTable, stage.id);
        }
        break;
      case 'UNION':
        if (stage.data?.tables) {
          stage.data.tables.forEach((tableName: string) => {
            const input = tableMap.get(tableName);
            if (input) node.inputs.push(input);
          });
        }
        break;
      case 'FILTER':
      case 'GROUP':
      case 'SELECT':
      case 'SORT':
        if (stage.data?.table) {
          const input = tableMap.get(stage.data.table);
          if (input) node.inputs.push(input);
        }
        break;
    }
    
    if (node.inputs.length > 0) {
      const maxInputLevel = Math.max(...node.inputs.map(id => nodes.get(id)?.level || 0));
      node.level = maxInputLevel + 1;
    }
  });
  
  return nodes;
}

// Custom node component
function StageNodeComponent({ data }: { data: any }) {
  const { themeConfig } = useTheme();
  const { stage, isEditing, hasMultipleInputs, onEdit, onDelete, inputCount, stageIndex, stageToTableMap, onShowTable, tables } = data;
  const editButtonRef = useRef<HTMLDivElement>(null);
  
  // Use native event listener in capture phase to fire before ReactFlow
  useEffect(() => {
    const button = editButtonRef.current;
    if (!button || !onEdit || !stage?.id || isEditing) return;
    
    const handleMouseDown = (e: MouseEvent) => {
      // Stop ALL propagation immediately in capture phase
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      
      // Call edit function immediately
      if (onEdit && stage?.id) {
        onEdit(stage.id);
      }
    };
    
    // Attach in capture phase (true) to fire BEFORE ReactFlow's handlers
    button.addEventListener('mousedown', handleMouseDown, { capture: true, passive: false });
    
    return () => {
      button.removeEventListener('mousedown', handleMouseDown, { capture: true } as any);
    };
  }, [onEdit, stage?.id, isEditing]);
  
  // Determine number of source handles needed (for nodes with multiple outputs)
  const sourceHandleCount = 1; // Most nodes have one output
  // Determine number of target handles needed (for nodes with multiple inputs like JOIN/UNION)
  const targetHandleCount = hasMultipleInputs && inputCount > 1 ? inputCount : 1;
  
  if (isEditing) {
    return (
      <div style={{ width: '280px', position: 'relative' }}>
        {/* Target handles - same structure as view mode to maintain edge connections */}
        {targetHandleCount > 1 ? (
          Array.from({ length: targetHandleCount }).map((_, idx) => (
            <>
              <Handle
                key={`target-top-${idx}`}
                type="target"
                position={Position.Top}
                id={`target-top-${idx}`}
                style={{
                  left: `${50 + (idx - (targetHandleCount - 1) / 2) * 15}%`,
                  visibility: 'hidden'
                }}
              />
              <Handle
                key={`target-left-${idx}`}
                type="target"
                position={Position.Left}
                id={`target-left-${idx}`}
                style={{
                  top: `${30 + idx * 20}%`,
                  visibility: 'hidden'
                }}
              />
            </>
          ))
        ) : (
          <>
            <Handle type="target" position={Position.Top} id="target-top" style={{ visibility: 'hidden' }} />
            <Handle type="target" position={Position.Left} id="target-left" style={{ top: '50%', visibility: 'hidden' }} />
          </>
        )}
        
        <EditableStageCard
          stage={stage}
          tables={data.tables}
          onSave={data.onSave}
          onCancel={data.onCancel}
          onDelete={onDelete}
        />
        
        {/* Source handles - same structure as view mode */}
        {sourceHandleCount > 1 ? (
          Array.from({ length: sourceHandleCount }).map((_, idx) => (
            <>
              <Handle
                key={`source-bottom-${idx}`}
                type="source"
                position={Position.Bottom}
                id={`source-bottom-${idx}`}
                style={{
                  left: `${50 + (idx - (sourceHandleCount - 1) / 2) * 15}%`,
                  visibility: 'hidden'
                }}
              />
              <Handle
                key={`source-right-${idx}`}
                type="source"
                position={Position.Right}
                id={`source-right-${idx}`}
                style={{
                  top: `${50 + (idx - (sourceHandleCount - 1) / 2) * 20}%`,
                  visibility: 'hidden'
                }}
              />
            </>
          ))
        ) : (
          <>
            <Handle type="source" position={Position.Bottom} id="source-bottom" style={{ visibility: 'hidden' }} />
            <Handle type="source" position={Position.Right} id="source-right" style={{ top: '50%', visibility: 'hidden' }} />
          </>
        )}
      </div>
    );
  }
  
  return (
    <div style={{
      background: themeConfig.colors.surfaceElevated,
      border: `2px solid ${getStageColor(stage.type)}`,
      borderRadius: '8px',
      padding: '12px',
      boxShadow: themeConfig.shadows.sm,
      width: '280px',
      minWidth: '280px',
      position: 'relative'
    }}>
      {/* Target handles - top and left for flexible connections */}
      {targetHandleCount > 1 ? (
        Array.from({ length: targetHandleCount }).map((_, idx) => (
          <>
            <Handle
              key={`target-top-${idx}`}
              type="target"
              position={Position.Top}
              id={`target-top-${idx}`}
              style={{
                left: `${50 + (idx - (targetHandleCount - 1) / 2) * 15}%`,
                visibility: 'hidden'
              }}
            />
            <Handle
              key={`target-left-${idx}`}
              type="target"
              position={Position.Left}
              id={`target-left-${idx}`}
              style={{
                top: `${30 + idx * 20}%`,
                visibility: 'hidden'
              }}
            />
          </>
        ))
      ) : (
        <>
          <Handle type="target" position={Position.Top} id="target-top" style={{ visibility: 'hidden' }} />
          <Handle type="target" position={Position.Left} id="target-left" style={{ top: '50%', visibility: 'hidden' }} />
        </>
      )}
      
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: getStageColor(stage.type),
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          {getStageIcon(stage.type)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            marginBottom: '4px'
          }}>
            <span style={{
              fontSize: '11px',
              color: themeConfig.colors.textTertiary,
              background: themeConfig.colors.surface,
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: '600',
              minWidth: '24px',
              textAlign: 'center'
            }}>
              #{stageIndex}
            </span>
            <strong style={{ 
              color: getStageColor(stage.type),
              fontSize: '13px'
            }}>
              {stage.type}
            </strong>
            {stage.type === 'LOAD' && stage.data?.tableName && (
              (() => {
                const loadTable = tables?.find((t: { id: string; name: string }) => t.name === stage.data.tableName);
                const canShowTable = loadTable && onShowTable;
                return canShowTable ? (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onShowTable(loadTable.id);
                    }}
                    style={{
                      fontSize: '11px',
                      color: themeConfig.colors.primary,
                      marginLeft: '6px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      textDecoration: 'underline',
                      textDecorationColor: 'transparent',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.textDecorationColor = themeConfig.colors.primary;
                      e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.textDecorationColor = 'transparent';
                      e.currentTarget.style.background = 'transparent';
                    }}
                    title="Show table"
                  >
                    {stage.data.tableName}
                  </button>
                ) : (
                  <span style={{
                    fontSize: '11px',
                    color: themeConfig.colors.textSecondary,
                    marginLeft: '6px'
                  }}>
                    {stage.data.tableName}
                  </span>
                );
              })()
            )}
            {hasMultipleInputs && (
              <span style={{
                fontSize: '10px',
                color: themeConfig.colors.textTertiary,
                background: themeConfig.colors.surface,
                padding: '2px 6px',
                borderRadius: '4px'
              }}>
                {inputCount} inputs
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
              {/* Show table button only for non-LOAD stages that have result tables */}
              {stageToTableMap && onShowTable && stageToTableMap.has(stage.id) && stage.type !== 'LOAD' && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const tableId = stageToTableMap.get(stage.id);
                    if (tableId) {
                      onShowTable(tableId);
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    background: 'transparent',
                    border: `1px solid ${themeConfig.colors.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: themeConfig.colors.textSecondary,
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                    e.currentTarget.style.borderColor = themeConfig.colors.primary;
                    e.currentTarget.style.color = themeConfig.colors.primary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = themeConfig.colors.border;
                    e.currentTarget.style.color = themeConfig.colors.textSecondary;
                  }}
                  title="Show result table"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
                    <path d="M9 3v18" />
                    <path d="M21 3v18" />
                    <path d="M3 9h18" />
                  </svg>
                  Table
                </button>
              )}
              {stage.type !== 'LOAD' && onEdit && (
                <div
                  ref={editButtonRef}
                  data-edit-button="true"
                  onMouseDown={(e) => {
                    // Also handle in React to ensure it works
                    e.stopPropagation();
                    if (e.nativeEvent) {
                      e.nativeEvent.stopImmediatePropagation();
                    }
                    e.preventDefault();
                    // Call edit function immediately
                    if (onEdit && stage?.id) {
                      onEdit(stage.id);
                    }
                  }}
                  style={{
                    padding: '4px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: themeConfig.colors.textSecondary,
                    display: 'flex',
                    alignItems: 'center',
                    pointerEvents: 'auto',
                    zIndex: 1000,
                    position: 'relative',
                    // Prevent drag on this element
                    userSelect: 'none',
                    WebkitUserSelect: 'none'
                  }}
                  title="Edit stage"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      if (onEdit && stage?.id) {
                        onEdit(stage.id);
                      }
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" pointerEvents="none">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
          <div style={{ 
            fontSize: '12px', 
            color: themeConfig.colors.textSecondary,
            wordBreak: 'break-word'
          }}>
            {stage.description}
          </div>
        </div>
      </div>
      
      {/* Source handles - bottom and right for flexible connections */}
      {sourceHandleCount > 1 ? (
        Array.from({ length: sourceHandleCount }).map((_, idx) => (
          <>
            <Handle
              key={`source-bottom-${idx}`}
              type="source"
              position={Position.Bottom}
              id={`source-bottom-${idx}`}
              style={{
                left: `${50 + (idx - (sourceHandleCount - 1) / 2) * 15}%`,
                visibility: 'hidden'
              }}
            />
            <Handle
              key={`source-right-${idx}`}
              type="source"
              position={Position.Right}
              id={`source-right-${idx}`}
              style={{
                top: `${50 + (idx - (sourceHandleCount - 1) / 2) * 20}%`,
                visibility: 'hidden'
              }}
            />
          </>
        ))
      ) : (
        <>
          <Handle type="source" position={Position.Bottom} id="source-bottom" style={{ visibility: 'hidden' }} />
          <Handle type="source" position={Position.Right} id="source-right" style={{ top: '50%', visibility: 'hidden' }} />
        </>
      )}
    </div>
  );
}

const nodeTypes = {
  stage: StageNodeComponent,
};

// Component to auto-fit view when stages change
function AutoFitView({ stagesCount, editingStageId }: { stagesCount: number; editingStageId: string | null }) {
  const { fitView } = useReactFlow();
  
  useEffect(() => {
    // Small delay to ensure nodes are rendered
    const timer = setTimeout(() => {
      fitView({ padding: 0.2, maxZoom: 1.5, duration: 300 });
    }, 100);
    
    return () => clearTimeout(timer);
  }, [stagesCount, editingStageId, fitView]);
  
  return null;
}

// Inner component that uses useReactFlow hook (must be inside ReactFlowProvider)
function StageGraphFlowInner({
  stages,
  tables,
  onStageEdit,
  onStageStartEdit,
  onStageDelete,
  onStageAdd,
  editingStageId,
  newStage,
  stageToTableMap,
  onShowTable,
  onExportJSON,
  onExportImage,
  onClearFlow,
  onRefReady
}: Props & { onRefReady: (instance: any) => void }) {
  const { themeConfig } = useTheme();
  const reactFlowInstance = useReactFlow();
  
  // Expose ReactFlow instance via callback
  useEffect(() => {
    onRefReady(reactFlowInstance);
  }, [reactFlowInstance, onRefReady]);
  
  // Canvas height resizing state
  const [canvasHeight, setCanvasHeight] = useState(() => {
    const saved = localStorage.getItem('stage_graph_canvas_height');
    if (saved) {
      return parseInt(saved, 10);
    }
    // Calculate initial height to fit within 100vh left panel
    // Account for: padding (40px), header (~60px), button (~50px), resize handle (4px)
    // Use ~90vh for canvas to leave some room
    return Math.min(800, Math.floor(window.innerHeight * 0.9));
  });
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  
  // Calculate max canvas height based on viewport (100vh left panel minus header/button space)
  const maxCanvasHeight = useMemo(() => {
    // Account for: container padding (40px), header (~60px), button (~50px), resize handle (4px)
    // Total overhead ~154px, use ~90vh for canvas to ensure it fits
    return Math.floor(window.innerHeight * 0.9);
  }, []);
  
  // Ensure canvas height doesn't exceed max on mount
  useEffect(() => {
    if (canvasHeight > maxCanvasHeight) {
      setCanvasHeight(maxCanvasHeight);
    }
  }, [maxCanvasHeight]);
  
  const graph = useMemo(() => buildStageGraph(stages), [stages]);
  
  // Convert stages to react-flow nodes and edges
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    const baseVerticalGap = 140; // Base spacing between node positions (same as original)
    const expandedCardExtraHeight = 380; // Extra height when expanded (to push down nodes below)
    const horizontalCenter = 200;
    
    // Calculate cumulative Y positions accounting for expanded nodes
    let cumulativeY = 0;
    
    // Create nodes
    stages.forEach((stage, index) => {
      const node = graph.get(stage.id);
      if (!node) return;
      
      const isEditing = editingStageId === stage.id;
      const hasMultipleInputs = node.inputs.length > 1;
      
      // Get horizontal offset from stage data if present (for side-by-side flows)
      const horizontalOffset = (stage.data as any)?.horizontalOffset || 0;
      
      // Calculate Y position: use base spacing like original, but add extra if previous node was expanded
      const currentY = cumulativeY;
      
      // Update cumulative position for next node
      // Base spacing is 140px (same as original)
      // If current node is expanded, add extra height so next node is pushed down
      if (isEditing) {
        cumulativeY += baseVerticalGap + expandedCardExtraHeight;
      } else {
        cumulativeY += baseVerticalGap;
      }
      
      nodes.push({
        id: stage.id,
        type: 'stage',
        position: { 
          x: horizontalCenter - 140 + horizontalOffset, // Center the 280px wide node, add offset for side-by-side
          y: currentY 
        },
        data: {
          stage,
          isEditing,
          hasMultipleInputs,
          inputCount: node.inputs.length,
          stageIndex: index + 1,
          stageToTableMap,
          onShowTable,
          tables,
          onSave: async (updatedStage: TransformationStage) => {
            await onStageEdit(updatedStage);
          },
          onCancel: () => {
            onStageStartEdit('');
          },
          onEdit: onStageStartEdit,
          onDelete: onStageDelete,
        },
        draggable: true, // All cards are draggable, even when editing
      });
    });
    
    // Create edges
    stages.forEach((stage, index) => {
      const node = graph.get(stage.id);
      if (!node) return;
      
      // Skip LOAD stages - they should not be linked to each other
      if (stage.type === 'LOAD') {
        return;
      }
      
      if (node.inputs.length > 0) {
        // Has explicit dependencies (JOIN/UNION) - connect to all inputs
        node.inputs.forEach((inputId, inputIndex) => {
          const totalInputs = node.inputs.length;
          
          // Determine connection points based on relative positions
          // If source is above, use bottom-to-top
          // If source is to the side or far away, use side connections
          const sourceIndex = stages.findIndex(s => s.id === inputId);
          const targetIndex = index;
          const isSourceAbove = sourceIndex < targetIndex;
          const verticalDistance = Math.abs(targetIndex - sourceIndex);
          
          let sourceHandle: string;
          let targetHandle: string;
          
          if (totalInputs > 1) {
            // Multiple inputs - use side connections to avoid crowding
            sourceHandle = isSourceAbove ? 'source-bottom' : 'source-right';
            targetHandle = `target-left-${inputIndex}`;
          } else {
            // Single input - use side connection if far, otherwise bottom-to-top
            if (verticalDistance > 1 || !isSourceAbove) {
              sourceHandle = isSourceAbove ? 'source-bottom' : 'source-right';
              targetHandle = 'target-left';
            } else {
              sourceHandle = 'source-bottom';
              targetHandle = 'target-top';
            }
          }
          
          edges.push({
            id: `${inputId}-${stage.id}-${inputIndex}`,
            source: inputId,
            target: stage.id,
            sourceHandle,
            targetHandle,
            type: 'default',
            animated: false,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
            style: {
              stroke: themeConfig.colors.border,
              strokeWidth: 2,
            },
          });
        });
      } else if (index > 0) {
        // General case: connect to previous stage, but skip if previous is LOAD
        const prevStage = stages[index - 1];
        if (prevStage.type !== 'LOAD') {
          // For sequential stages, choose connection style based on context
          const prevIndex = index - 1;
          // Check if stages are directly adjacent (no LOAD stages in between)
          const isDirectlySequential = index === prevIndex + 1;
          
          let sourceHandle: string;
          let targetHandle: string;
          
          // Choose connection style:
          // 1. Directly sequential -> bottom-to-top for natural vertical flow
          // 2. Not directly sequential -> side-to-top for flexible routing around gaps
          // 3. Alternate with side-to-side for visual variety when appropriate
          if (isDirectlySequential) {
            // Directly sequential - use bottom-to-top for natural vertical flow
            sourceHandle = 'source-bottom';
            targetHandle = 'target-top';
          } else if (index % 3 === 0) {
            // Every third stage - use side-to-side for clean routing
            sourceHandle = 'source-right';
            targetHandle = 'target-left';
          } else {
            // Default - use side-to-top for flexible routing
            sourceHandle = 'source-right';
            targetHandle = 'target-top';
          }
          
          edges.push({
            id: `${prevStage.id}-${stage.id}`,
            source: prevStage.id,
            target: stage.id,
            sourceHandle,
            targetHandle,
            type: 'default',
            animated: false,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
            style: {
              stroke: themeConfig.colors.border,
              strokeWidth: 2,
            },
          });
        }
      }
    });
    
    return { initialNodes: nodes, initialEdges: edges };
  }, [stages, graph, editingStageId, tables, onStageEdit, onStageStartEdit, onStageDelete, stageToTableMap, onShowTable, themeConfig.colors.border]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  
  // Handle node drag start - prevent drag if clicking on edit button (backup)
  const onNodeDragStart = useCallback((event: React.MouseEvent, node: Node) => {
    const target = event.target as HTMLElement;
    // If drag started from edit button, prevent it
    if (target.closest('[data-edit-button="true"]')) {
      event.preventDefault();
      event.stopPropagation();
      // Trigger edit instead
      const stage = node.data?.stage;
      if (stage && stage.type !== 'LOAD' && onStageStartEdit) {
        onStageStartEdit(stage.id);
      }
    }
  }, [onStageStartEdit]);

  // Handle node click to trigger edit mode (only for non-LOAD stages)
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // Only trigger edit if:
    // 1. The stage is not LOAD type
    // 2. The stage is not already being edited
    // 3. The click is not on an interactive element (button, etc.)
    const stage = node.data?.stage;
    if (stage && stage.type !== 'LOAD' && editingStageId !== stage.id) {
      // Check if click target is an interactive element
      const target = event.target as HTMLElement;
      // Check if clicked element or any parent is a button, div with role="button", input, select, or textarea
      const isInteractiveElement = target.closest('button') !== null || 
                                    target.closest('[role="button"]') !== null ||
                                    target.closest('[data-edit-button="true"]') !== null ||
                                    target.closest('input') !== null || 
                                    target.closest('select') !== null || 
                                    target.closest('textarea') !== null;
      // Also check if the click was on an SVG inside a button or div with role="button"
      const isSVG = target.tagName === 'svg' || target.closest('svg');
      const isButtonSVG = isSVG && (target.closest('button') !== null || target.closest('[role="button"]') !== null || target.closest('[data-edit-button="true"]') !== null);
      
      // Don't trigger edit if clicking on any interactive element
      if (!isInteractiveElement && !isButtonSVG) {
        // Prevent ReactFlow from selecting the node
        event.preventDefault();
        event.stopPropagation();
        onStageStartEdit(stage.id);
      }
    }
  }, [editingStageId, onStageStartEdit]);
  
  // Track previous editingStageId to detect when editing state changes
  const prevEditingStageIdRef = useRef<string | null>(null);
  
  // Update nodes when stages change
  useEffect(() => {
    const editingChanged = prevEditingStageIdRef.current !== editingStageId;
    prevEditingStageIdRef.current = editingStageId;
    
    setNodes(prevNodes => {
      return initialNodes.map(node => {
        const existingNode = prevNodes.find(n => n.id === node.id);
        const isEditing = editingStageId === node.id;
        
        if (existingNode) {
          // When editing state changes, recalculate all positions to push down nodes
          // This ensures expanded nodes push down nodes below them
          // Otherwise, preserve manually dragged positions
          if (editingChanged) {
            // Recalculate position from initialNodes to account for expanded nodes
            return {
              ...node,
              position: node.position, // Use calculated position from initialNodes
              draggable: true,
              data: {
                ...node.data,
                isEditing,
              },
            };
          } else {
            // Preserve position if editing didn't change (user might have dragged)
            return {
              ...node,
              position: existingNode.position,
              draggable: true,
              data: {
                ...node.data,
                isEditing,
              },
            };
          }
        }
        // For new nodes, use calculated position
        return {
          ...node,
          draggable: true,
        };
      });
    });
  }, [initialNodes, editingStageId, setNodes]);
  
  // Update edges when stages change
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);
  
  // Prevent edge connection/editing
  const onConnect = useCallback(() => {
    // Disable edge creation
  }, []);

  const onEdgeUpdate = useCallback(() => {
    // Disable edge editing
    return false;
  }, []);

  // Height resizing handlers
  const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingHeight(true);
  }, []);

  const handleHeightResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingHeight || !canvasContainerRef.current) return;
    
    // The canvas div is the first child div inside the container
    const canvasDiv = canvasContainerRef.current.querySelector('div > div') as HTMLElement;
    if (!canvasDiv) return;
    
    // Calculate canvas height: from canvas div top to mouse Y position
    const canvasTop = canvasDiv.getBoundingClientRect().top;
    const newHeight = e.clientY - canvasTop;
    
    // Min height: 300px, Max height: based on viewport
    const minHeight = 300;
    const maxHeight = maxCanvasHeight;
    if (newHeight >= minHeight && newHeight <= maxHeight) {
      setCanvasHeight(newHeight);
    }
  }, [isResizingHeight, maxCanvasHeight]);

  const handleHeightResizeEnd = useCallback(() => {
    setIsResizingHeight(false);
  }, []);

  useEffect(() => {
    if (isResizingHeight) {
      document.addEventListener('mousemove', handleHeightResizeMove);
      document.addEventListener('mouseup', handleHeightResizeEnd);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleHeightResizeMove);
        document.removeEventListener('mouseup', handleHeightResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizingHeight, handleHeightResizeMove, handleHeightResizeEnd]);

  // Save height to localStorage
  useEffect(() => {
    localStorage.setItem('stage_graph_canvas_height', String(canvasHeight));
  }, [canvasHeight]);
  
  return (
    <div style={{
      padding: '20px 20px 0px 20px',
      background: themeConfig.colors.surface,
      borderRadius: '8px',
      border: `1px solid ${themeConfig.colors.border}`,
      height: 'fit-content',
      minHeight: '400px',
      position: 'relative'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px' 
      }}>
        <h3 style={{ 
          margin: 0, 
          fontSize: '16px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          color: themeConfig.colors.text
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          Transformation Pipeline ({stages.length} stages)
        </h3>
        {stages.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {onClearFlow && (
              <button
                onClick={onClearFlow}
                style={{
                  padding: '6px 12px',
                  background: themeConfig.colors.surfaceElevated,
                  border: `1px solid ${themeConfig.colors.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: themeConfig.colors.text,
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#ef4444';
                  e.currentTarget.style.color = 'white';
                  e.currentTarget.style.borderColor = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                  e.currentTarget.style.color = themeConfig.colors.text;
                  e.currentTarget.style.borderColor = themeConfig.colors.border;
                }}
                title="Clear all stages"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Clear Flow
              </button>
            )}
            {onExportJSON && (
              <button
                onClick={onExportJSON}
                style={{
                  padding: '6px 12px',
                  background: themeConfig.colors.surfaceElevated,
                  border: `1px solid ${themeConfig.colors.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: themeConfig.colors.text,
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.primary;
                  e.currentTarget.style.color = 'white';
                  e.currentTarget.style.borderColor = themeConfig.colors.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                  e.currentTarget.style.color = themeConfig.colors.text;
                  e.currentTarget.style.borderColor = themeConfig.colors.border;
                }}
                title="Export to JSON"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export JSON
              </button>
            )}
            {onExportImage && (
              <button
                onClick={onExportImage}
                style={{
                  padding: '6px 12px',
                  background: themeConfig.colors.surfaceElevated,
                  border: `1px solid ${themeConfig.colors.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: themeConfig.colors.text,
                  fontSize: '13px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.primary;
                  e.currentTarget.style.color = 'white';
                  e.currentTarget.style.borderColor = themeConfig.colors.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                  e.currentTarget.style.color = themeConfig.colors.text;
                  e.currentTarget.style.borderColor = themeConfig.colors.border;
                }}
                title="Export to Image"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Export Image
              </button>
            )}
          </div>
        )}
      </div>
      
      {stages.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px', 
          color: themeConfig.colors.textSecondary 
        }}>
          No transformation stages yet. Add a stage to get started.
        </div>
      ) : (
        <div 
          ref={canvasContainerRef}
          style={{ 
            width: '100%', 
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div style={{ 
            width: '100%', 
            height: `${Math.min(canvasHeight, maxCanvasHeight)}px`, 
            minHeight: '300px',
            maxHeight: `${maxCanvasHeight}px`,
            position: 'relative',
            flexShrink: 0
          }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeUpdate={onEdgeUpdate}
              onNodeClick={onNodeClick}
              onNodeDragStart={onNodeDragStart}
              nodeTypes={nodeTypes}
              connectionMode={ConnectionMode.Loose}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1.5 }}
              nodesDraggable={true} // Individual node draggable state is controlled per node
              nodeDragThreshold={5} // Require 5px movement before starting drag - helps prevent accidental drags
              nodesConnectable={false}
              edgesUpdatable={false}
              edgesFocusable={false}
              elementsSelectable={false} // Disable selection to prevent interference with edit
              panOnDrag={true} // Allow panning with left mouse button (when not dragging nodes)
              panOnScroll={true} // Allow panning with scroll wheel + modifier key
              zoomOnScroll={true}
              zoomOnPinch={true}
              preventScrolling={false}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              style={{
                background: themeConfig.colors.surface,
              }}
            >
              <Background color={themeConfig.colors.border} gap={16} />
              <Controls 
                showInteractive={false}
                style={{
                  background: themeConfig.colors.surfaceElevated,
                  border: `1px solid ${themeConfig.colors.border}`,
                }}
              />
              <AutoFitView stagesCount={stages.length} editingStageId={editingStageId} />
              
              {/* Add Stage button - positioned at bottom right inside canvas */}
              <div style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                zIndex: 1000,
                pointerEvents: 'auto'
              }}>
                <button
                  onClick={onStageAdd}
                  style={{
                    padding: '14px 24px',
                    background: themeConfig.colors.surfaceElevated,
                    color: themeConfig.colors.primary,
                    border: `1px solid ${themeConfig.colors.border}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    transition: 'all 0.2s',
                    boxShadow: themeConfig.shadows.md
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.primary;
                    e.currentTarget.style.color = 'white';
                    e.currentTarget.style.borderColor = themeConfig.colors.primary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                    e.currentTarget.style.color = themeConfig.colors.primary;
                    e.currentTarget.style.borderColor = themeConfig.colors.border;
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Stage
                </button>
              </div>
            </ReactFlow>
          </div>
          
        </div>
      )}
      
      {/* Height resize handle - sticky at bottom, below all content */}
      {stages.length > 0 && (
        <div
          onMouseDown={handleHeightResizeStart}
          style={{
            position: 'sticky',
            bottom: '0px',
            left: '0',
            right: '0',
            marginLeft: '-20px',
            marginRight: '-20px',
            marginTop: '16px',
            height: '32px', // Interactive area for easy dragging
            cursor: 'row-resize',
            background: themeConfig.colors.surface,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto'
          }}
          title="Drag to resize canvas height"
        >
          {/* Thin grey line as visual indicator */}
          <div style={{
            position: 'absolute',
            top: '0',
            left: '20px',
            right: '20px',
            height: '1px',
            background: themeConfig.colors.border,
            transition: 'background 0.2s'
          }} />
          
          {/* Small drag handle indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            padding: '4px 8px',
            background: isResizingHeight ? themeConfig.colors.primary + '20' : themeConfig.colors.surface,
            border: `1px solid ${isResizingHeight ? themeConfig.colors.primary : themeConfig.colors.border}`,
            borderRadius: '4px',
            transition: 'all 0.2s',
            position: 'relative',
            zIndex: 1
          }}>
            <svg width="16" height="6" viewBox="0 0 16 6" fill="none" stroke={themeConfig.colors.textTertiary} strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="14" y2="2" />
              <line x1="2" y1="4" x2="14" y2="4" />
            </svg>
          </div>
        </div>
      )}
      
      {stages.length === 0 && (
        <>
          {newStage && (
            <div style={{ marginTop: '12px' }}>
              <EditableStageCard
                stage={null}
                tables={tables}
                onSave={async (stage) => {
                  await onStageEdit(stage);
                }}
                onCancel={() => {
                  onStageAdd();
                }}
              />
            </div>
          )}
          
          <button
            onClick={onStageAdd}
            style={{
              width: '100%',
              padding: '10px',
              marginTop: '12px',
              background: themeConfig.colors.surface,
              color: themeConfig.colors.primary,
              border: `1px dashed ${themeConfig.colors.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: '500',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
              e.currentTarget.style.borderColor = themeConfig.colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = themeConfig.colors.surface;
              e.currentTarget.style.borderColor = themeConfig.colors.border;
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Stage
          </button>
        </>
      )}
    </div>
  );
}

// Outer component that wraps with ReactFlowProvider
export const StageGraphFlow = forwardRef<{ getReactFlowInstance: () => any }, Props>((props, ref) => {
  const reactFlowInstanceRef = useRef<any>(null);
  
  const handleRefReady = useCallback((instance: any) => {
    reactFlowInstanceRef.current = instance;
  }, []);
  
  // Expose ReactFlow instance via ref
  useImperativeHandle(ref, () => ({
    getReactFlowInstance: () => reactFlowInstanceRef.current
  }), []);
  
  return (
    <ReactFlowProvider>
      <StageGraphFlowInner {...props} onRefReady={handleRefReady} />
    </ReactFlowProvider>
  );
});

