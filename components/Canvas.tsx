import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { CanvasItem, CanvasItemData, Layer, Drawing, TextObject } from '../types';
import { ToolType, CanvasItemType } from '../types';
import CanvasItemRenderer from './renderers/CanvasItemRenderer';
import pointicon from '../assets/回零.svg'

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
  setItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>; // 新增
  eraserRadius: number;
}



// 辅助函数：计算点到线段的最小距离
function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    // 退化为点
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}
// 新增：在一条线段上用二分法找到与圆交点
function findCircleSegmentIntersection(
  px: number, py: number, r: number,
  x1: number, y1: number, x2: number, y2: number,
  tol: number = 0.5
): { x: number; y: number } | null {
  let t0 = 0, t1 = 1;
  let found = false;
  let mid = 0.5;

  // 只在距离小于r的区间内细分
  for (let i = 0; i < 20; i++) {
    mid = (t0 + t1) / 2;
    const x = x1 + (x2 - x1) * mid;
    const y = y1 + (y2 - y1) * mid;
    const d = Math.hypot(x - px, y - py);
    if (Math.abs(d - r) < tol) {
      found = true;
      return { x, y };
    }
    if (d > r) {
      t1 = mid;
    } else {
      t0 = mid;
    }
  }
  if (found) return { x: x1 + (x2 - x1) * mid, y: y1 + (y2 - y1) * mid };
  return null;
}

const Canvas: React.FC<CanvasProps> = ({ items, layers, selectedItemId, onSelectItem, onUpdateItem, onAddItem, onCommitUpdate, activeTool, canvasWidth, canvasHeight, setItems, eraserRadius }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  
  const [dragState, setDragState] = useState<{ id: string; initialItem: CanvasItem; startPos: { x: number; y: number } } | null>(null);
  const [drawingState, setDrawingState] = useState<{ points: {x:number, y:number}[] } | null>(null);
  const [panState, setPanState] = useState<{ startClient: { x: number, y: number }, startViewBox: { x: number, y: number } } | null>(null);
  const [eraserState, setEraserState] = useState<{ lastPos: { x: number; y: number } | null } | null>(null);
  // 新增：记录橡皮擦指针位置
  const [eraserPos, setEraserPos] = useState<{x:number, y:number} | null>(null);
  const [pinchState, setPinchState] = useState<null | {
    startDistance: number;
    startViewBox: { x: number; y: number; width: number; height: number };
    isPinching: boolean;
    centerPoint: { x: number; y: number }; // 缩放中心点
  }>(null);
  
  // 新增：缩放结束后的冷却期状态
  const [pinchCooldown, setPinchCooldown] = useState<boolean>(false);
  const cooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [viewBox, setViewBox] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: canvasWidth, height: canvasHeight });

  // 缩放控制状态
  const [zoomLevel, setZoomLevel] = useState(1); // 缩放级别，1为100%

   useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
        // 保持画布尺寸不变，只更新容器尺寸用于缩放计算
        setCanvasSize({ width: canvasWidth, height: canvasHeight });
    });
    if (svgContainerRef.current) {
        resizeObserver.observe(svgContainerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    if (activeTool !== ToolType.ERASER) {
      setEraserPos(null);
      setEraserState(null);
    }
  }, [activeTool]);

  // 清理冷却期超时
  useEffect(() => {
    return () => {
      if (cooldownTimeoutRef.current) {
        clearTimeout(cooldownTimeoutRef.current);
      }
    };
  }, []);

  // 缩放控制函数
  const handleZoomChange = useCallback((newZoomLevel: number) => {
    const clampedZoom = Math.max(0.1, Math.min(5, newZoomLevel));
    setZoomLevel(clampedZoom);

    // 计算新的画布尺寸（缩放是相对于原始尺寸）
    const newWidth = canvasWidth / clampedZoom;
    const newHeight = canvasHeight / clampedZoom;

    // 保持视图中心不变
    const currentCenterX = viewBox.x + canvasSize.width / 2;
    const currentCenterY = viewBox.y + canvasSize.height / 2;

    setViewBox({
      x: currentCenterX - newWidth / 2,
      y: currentCenterY - newHeight / 2,
    });
    setCanvasSize({ width: newWidth, height: newHeight });
  }, [canvasWidth, canvasHeight, viewBox, canvasSize]);

  // 禁用双指缩放，改用滑动标尺控制
  // useEffect(() => {
  //   // 双指缩放功能已禁用
  // }, []);

  const getPointerPosition = (event: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    const pt = new DOMPoint(event.clientX, event.clientY);
    const svgPoint = pt.matrixTransform(CTM.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  };
  
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (pinchState?.isPinching) return;
    if (pinchCooldown) return; // 在缩放冷却期内阻止所有指针操作
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

      case ToolType.ERASER:
        setEraserState({ lastPos: pos });
        setEraserPos(pos); // 记录橡皮擦位置
        break;
    }
  }, [activeTool, onSelectItem, items, layers, onAddItem, viewBox, selectedItemId, pinchState, pinchCooldown]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (pinchState?.isPinching) return;
    if (pinchCooldown) return; // 在缩放冷却期内阻止移动操作
    if (event.buttons !== 1) {
      setDragState(null);
      setDrawingState(null);
      setPanState(null);
      setEraserState(null);
      setEraserPos(null); // 松开时隐藏橡皮擦圈
      return;
    };
    
    const pos = getPointerPosition(event);

    if (dragState) {
      const dx = pos.x - dragState.startPos.x;
      const dy = pos.y - dragState.startPos.y;
      const { initialItem } = dragState;

      if ('x' in initialItem && 'y' in initialItem) {
         // 直接使用SVG坐标系统，不需要额外的转换
         const newX = initialItem.x + dx;
         const newY = initialItem.y + dy;
         
         // 添加调试信息
         console.log('拖拽坐标:', {
           startPos: dragState.startPos,
           currentPos: pos,
           delta: { dx, dy },
           initialItem: { x: initialItem.x, y: initialItem.y },
           newPosition: { x: newX, y: newY },
           viewBox: viewBox
         });
         
         onUpdateItem(dragState.id, { x: newX, y: newY });
      }
    } else if (drawingState) {
      setDrawingState(prev => (prev ? { ...prev, points: [...prev.points, pos] } : null));
    } else if (eraserState) {
      setEraserPos(pos); // 跟随橡皮擦
      let changed = false;
      let newItems: CanvasItem[] = items;
      items.forEach(item => {
        if (item.type === CanvasItemType.DRAWING) {
          const globalPoints = item.points.map(p => ({ x: (item.x ?? 0) + p.x, y: (item.y ?? 0) + p.y }));
          let seg: typeof globalPoints = [globalPoints[0]];
          const segments: typeof globalPoints[] = [];
          for (let i = 0; i < globalPoints.length - 1; i++) {
            const p1 = globalPoints[i];
            const p2 = globalPoints[i + 1];
            const dist = pointToSegmentDistance(pos.x, pos.y, p1.x, p1.y, p2.x, p2.y);
            if (dist < eraserRadius) {
              // 细腻断开：在交点插入新点
              const inter = findCircleSegmentIntersection(pos.x, pos.y, eraserRadius, p1.x, p1.y, p2.x, p2.y);
              if (inter) {
                seg.push(inter);
              }
              if (seg.length > 1) segments.push(seg);
              seg = [p2];
              changed = true;
            } else {
              seg.push(p2);
            }
          }
          if (seg.length > 1) segments.push(seg);
          if (changed) {
            newItems = newItems.filter(it => it.id !== item.id);
            segments.forEach(segPoints => {
              if (segPoints.length > 1) {
                const minX = Math.min(...segPoints.map(p => p.x));
                const maxX = Math.max(...segPoints.map(p => p.x));
                const minY = Math.min(...segPoints.map(p => p.y));
                const maxY = Math.max(...segPoints.map(p => p.y));
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                newItems.push({
                  ...item,
                  id: `item_${Date.now()}_${Math.random()}`,
                  x: centerX,
                  y: centerY,
                  points: segPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY })),
                  rotation: item.rotation || 0,
                });
              }
            });
          }
        }
      });
      if (changed) {
        setEraserState({ lastPos: pos });
        setItems(newItems); // 直接更新items
      }
    } else if (panState) {
        // 修复缩放后平移的问题：使用正确的缩放比例计算平移距离
        const dx = event.clientX - panState.startClient.x;
        const dy = event.clientY - panState.startClient.y;
        
        // 根据当前缩放比例调整平移距离
        const scaleX = canvasSize.width / (svgContainerRef.current?.clientWidth || 1);
        const scaleY = canvasSize.height / (svgContainerRef.current?.clientHeight || 1);
        
        setViewBox({
            x: panState.startViewBox.x - dx * scaleX,
            y: panState.startViewBox.y - dy * scaleY
        });
    }
  }, [dragState, drawingState, panState, eraserState, items, onUpdateItem, setItems, eraserRadius, pinchState, pinchCooldown, canvasSize, viewBox]);

  const handlePointerUp = useCallback(() => {
    if (pinchState?.isPinching) return;
    if (dragState) {
      onCommitUpdate();
      setDragState(null);
    }
    if (drawingState && drawingState.points.length > 1) {
      const { points } = drawingState;
      const minX = Math.min(...points.map(p => p.x));
      const maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxY = Math.max(...points.map(p => p.y));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      onAddItem({
        type: CanvasItemType.DRAWING,
        x: centerX,
        y: centerY,
        points: points.map(p => ({ x: p.x - centerX, y: p.y - centerY })),
        color: '#f472b6', // pink-400
        strokeWidth: 4,
        rotation: 0,
      } as Omit<Drawing, 'id' | 'layerId'>);
    }
    if (eraserState) {
      onCommitUpdate();
      setEraserState(null);
    }
    setDrawingState(null);
    setPanState(null);
    setEraserPos(null); // 松开时隐藏橡皮擦圈
  }, [dragState, drawingState, eraserState, onAddItem, onCommitUpdate, pinchState]);
  
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
    <div className="flex-1 bg-white overflow-hidden">
        <div 
            ref={svgContainerRef}
            className={`relative w-full h-full overflow-hidden ${cursorClass}`}
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
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(209, 213, 219, 0.7)" strokeWidth="0.5"/>
              </pattern>
            </defs>
            {/* 背景格子 - 覆盖整个可视区域 */}
            <rect
              x={viewBox.x - 1000}
              y={viewBox.y - 1000}
              width={canvasSize.width + 2000}
              height={canvasSize.height + 2000}
              fill="url(#grid)"
            />
            
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
                                transform={`translate(${'x' in item ? item.x : 0}, ${'y' in item ? item.y : 0}) rotate(${'rotation' in item ? item.rotation || 0 : 0})`}
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
            {activeTool === ToolType.ERASER && eraserPos && (
              <circle
                cx={eraserPos.x}
                cy={eraserPos.y}
                r={eraserRadius}
                fill="rgba(0,0,0,0.08)"
                stroke="#16a34a"
                strokeWidth={2}
                pointerEvents="none"
              />
            )}
          </svg>
          <button
              onClick={() => {
                setViewBox({ x: 0, y: 0 });
                setZoomLevel(1);
                setCanvasSize({ width: canvasWidth, height: canvasHeight });
              }}
              className="absolute bottom-4 left-4 z-10 bg-white p-2 rounded-full shadow-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              title="回到原点并重置缩放"
          >
            <img src={pointicon} alt="回零" className="h-5 w-5" />
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 10l-4.95-4.95z" clipRule="evenodd" />
                  <path d="M5.75 3a.75.75 0 00-1.5 0v3.5A.75.75 0 005 7.25H8.5a.75.75 0 000-1.5H5.75V3z" />
          </button>

          {/* 缩放控制标尺 - 垂直布局 */}
          <div className="absolute bottom-4 right-4 z-10 bg-white p-3 rounded-lg shadow-md">
            <div className="flex flex-col items-center space-y-3">
              <button
                onClick={() => handleZoomChange(zoomLevel + 0.1)}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded text-gray-600 text-lg font-bold"
                title="放大"
              >
                +
              </button>
              <div className="relative flex flex-col items-center">
                <input
                  type="range"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={zoomLevel}
                  onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                  className="h-32 w-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-vertical"
                  style={{
                    writingMode: 'bt-lr',
                    WebkitAppearance: 'slider-vertical',
                    background: `linear-gradient(to top, #3b82f6 0%, #3b82f6 ${((zoomLevel - 0.1) / (5 - 0.1)) * 100}%, #e5e7eb ${((zoomLevel - 0.1) / (5 - 0.1)) * 100}%, #e5e7eb 100%)`
                  }}
                />
                <style jsx>{`
                  .slider-vertical::-webkit-slider-thumb {
                    appearance: none;
                    height: 16px;
                    width: 16px;
                    border-radius: 50%;
                    background: #3b82f6;
                    cursor: pointer;
                    border: 2px solid #ffffff;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                  }
                  .slider-vertical::-moz-range-thumb {
                    height: 16px;
                    width: 16px;
                    border-radius: 50%;
                    background: #3b82f6;
                    cursor: pointer;
                    border: 2px solid #ffffff;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                  }
                `}</style>
              </div>
              <button
                onClick={() => handleZoomChange(zoomLevel - 0.1)}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded text-gray-600 text-lg font-bold"
                title="缩小"
              >
                −
              </button>
              <span className="text-xs text-gray-500 font-medium">{Math.round(zoomLevel * 100)}%</span>
            </div>
          </div>
        </div>
    </div>
  );
};

export default Canvas;