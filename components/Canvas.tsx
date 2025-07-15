import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { CanvasItem, CanvasItemData, Layer, Drawing, TextObject } from '../types';
import { ToolType, CanvasItemType } from '../types';
import CanvasItemRenderer from './renderers/CanvasItemRenderer';
import Ruler from './Ruler';

interface CanvasProps {
  items: CanvasItem[];
  layers: Layer[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  onUpdateItem: (id: string, updates: Partial<CanvasItem>) => void;
  onAddItem: (item: CanvasItemData) => void;
  onCommitUpdate: () => void; // For committing changes to history (e.g., after a drag)
  activeTool: ToolType;
  canvasWidth: number;
  canvasHeight: number;
}

const RULER_SIZE = 30; // in pixels

const Canvas: React.FC<CanvasProps> = ({ items, layers, selectedItemId, onSelectItem, onUpdateItem, onAddItem, onCommitUpdate, activeTool, canvasWidth, canvasHeight }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  
  const [dragState, setDragState] = useState<{ id: string; initialItem: CanvasItem; startPos: { x: number; y: number } } | null>(null);
  const [drawingState, setDrawingState] = useState<{ points: {x:number, y:number}[] } | null>(null);
  const [panState, setPanState] = useState<{ startClient: { x: number, y: number }, startViewBox: { x: number, y: number } } | null>(null);

  const [viewBox, setViewBox] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });

   useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
        if (entries[0]) {
            const { width, height } = entries[0].contentRect;
            setCanvasSize({ width, height });
        }
    });
    if (svgContainerRef.current) {
        resizeObserver.observe(svgContainerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, []);

  const getPointerPosition = (event: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    const pt = new DOMPoint(event.clientX, event.clientY);
    const svgPoint = pt.matrixTransform(CTM.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  };
  
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    const pos = getPointerPosition(event);
    const target = event.target as SVGElement;
    const itemId = (event.target as SVGElement).closest('[data-item-id]')?.getAttribute('data-item-id');
    
    (target as Element).setPointerCapture(event.pointerId);

    switch (activeTool) {
      case ToolType.SELECT:
        if (itemId) {
          event.stopPropagation();
          const item = items.find(i => i.id === itemId);
          if (item) {
            const layer = layers.find(l => l.id === item.layerId);
            if (!layer || !layer.isVisible) return; // Don't select items on hidden layers

            // If the clicked item is already selected, start dragging.
            // Otherwise, just select it.
            if (itemId === selectedItemId) {
              setDragState({ id: itemId, initialItem: item, startPos: pos });
            } else {
              onSelectItem(itemId);
              setDragState(null); // Ensure no dragging happens
            }
          }
        } else {
          // Clicked on the background
          onSelectItem(null);
          setPanState({ startClient: { x: event.clientX, y: event.clientY }, startViewBox: { ...viewBox } });
        }
        break;
        
      case ToolType.PEN:
        event.stopPropagation();
        onSelectItem(null);
        setDrawingState({ points: [pos] });
        break;
        
      case ToolType.TEXT:
        event.stopPropagation();
        onAddItem({
          type: CanvasItemType.TEXT,
          x: pos.x,
          y: pos.y,
          text: '新文本',
          fontSize: 24,
          color: '#1f2937', // gray-800
          rotation: 0,
        } as Omit<TextObject, 'id' | 'layerId'>);
        break;
    }
  }, [activeTool, onSelectItem, items, layers, onAddItem, viewBox, selectedItemId]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (event.buttons !== 1) {
      setDragState(null);
      setDrawingState(null);
      setPanState(null);
      return;
    };
    
    const pos = getPointerPosition(event);

    if (dragState) {
      const dx = pos.x - dragState.startPos.x;
      const dy = pos.y - dragState.startPos.y;
      const { initialItem } = dragState;

      if ('x' in initialItem && 'y' in initialItem) {
         onUpdateItem(dragState.id, { x: initialItem.x + dx, y: initialItem.y + dy });
      }
    } else if (drawingState) {
      setDrawingState(prev => (prev ? { ...prev, points: [...prev.points, pos] } : null));
    } else if (panState) {
        const dx = event.clientX - panState.startClient.x;
        const dy = event.clientY - panState.startClient.y;
        setViewBox({
            x: panState.startViewBox.x - dx,
            y: panState.startViewBox.y - dy
        });
    }
  }, [dragState, drawingState, panState, onUpdateItem]);

  const handlePointerUp = useCallback(() => {
    if (dragState) {
      onCommitUpdate();
      setDragState(null);
    }
    if (drawingState && drawingState.points.length > 1) {
      const { points } = drawingState;
      const minX = Math.min(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      onAddItem({
        type: CanvasItemType.DRAWING,
        x: minX,
        y: minY,
        points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
        color: '#f472b6', // pink-400
        strokeWidth: 4,
      } as Omit<Drawing, 'id' | 'layerId'>);
    }
    setDrawingState(null);
    setPanState(null);
  }, [dragState, drawingState, onAddItem, onCommitUpdate]);
  
  const cursorClass = useMemo(() => {
    if (panState) return 'cursor-grabbing';
    switch(activeTool) {
      case ToolType.SELECT: return 'cursor-grab';
      case ToolType.PEN: return 'cursor-crosshair';
      case ToolType.TEXT: return 'cursor-text';
      default: return 'cursor-default';
    }
  }, [activeTool, panState]);

  return (
    <div className="flex-1 bg-white grid grid-cols-[auto_1fr] grid-rows-[auto_1fr] overflow-hidden">
        <div className="bg-gray-50 border-r border-b border-gray-200" style={{width: RULER_SIZE, height: RULER_SIZE}} />
        <div className="overflow-hidden relative bg-gray-50 border-b border-gray-200" style={{height: RULER_SIZE}}>
            <Ruler direction="horizontal" offset={viewBox.x} size={canvasSize.width} />
        </div>
        <div className="overflow-hidden relative bg-gray-50 border-r border-gray-200" style={{width: RULER_SIZE}}>
             <Ruler direction="vertical" offset={viewBox.y} size={canvasSize.height} />
        </div>
        <div 
            ref={svgContainerRef}
            className={`relative col-start-2 row-start-2 overflow-hidden ${cursorClass}`}
            onPointerDown={handlePointerDown} 
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
          <svg 
            ref={svgRef} 
            width="100%" 
            height="100%"
            viewBox={`${viewBox.x} ${viewBox.y} ${canvasSize.width} ${canvasSize.height}`}
            style={{ touchAction: 'none' }}
          >
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse" x={viewBox.x} y={viewBox.y}>
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(209, 213, 219, 0.7)" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect x={viewBox.x} y={viewBox.y} width="100%" height="100%" fill="url(#grid)" />
            
            <rect 
              x="0" 
              y="0" 
              width={canvasWidth} 
              height={canvasHeight} 
              fill="none" 
              stroke="#d1d5db"
              strokeWidth="2" 
              vectorEffect="non-scaling-stroke" 
            />

            {/* Render items based on layer order and visibility */}
            {layers.slice().reverse().map(layer => (
                layer.isVisible && (
                    <g key={layer.id} data-layer-id={layer.id}>
                        {items.filter(item => item.layerId === layer.id).map(item => (
                            <g 
                                key={item.id} 
                                transform={`translate(${'x' in item ? item.x : 0}, ${'y' in item ? item.y : 0})`}
                                data-item-id={item.id}
                                className={activeTool === ToolType.SELECT ? 'cursor-pointer' : ''}
                            >
                                <CanvasItemRenderer item={item} isSelected={item.id === selectedItemId} />
                            </g>
                        ))}
                    </g>
                )
            ))}
            
            {drawingState && drawingState.points.length > 0 && (
              <polyline
                points={drawingState.points.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#f472b6"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
          <button
              onClick={() => setViewBox({ x: 0, y: 0 })}
              className="absolute bottom-4 left-4 z-10 bg-white p-2 rounded-full shadow-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              title="回到原点"
          >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 10l-4.95-4.95z" clipRule="evenodd" />
                  <path d="M5.75 3a.75.75 0 00-1.5 0v3.5A.75.75 0 005 7.25H8.5a.75.75 0 000-1.5H5.75V3z" />
              </svg>
          </button>
        </div>
    </div>
  );
};

export default Canvas;