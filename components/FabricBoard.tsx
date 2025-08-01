import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { fabric } from 'fabric';
import type { Layer, PartType } from '../types';
import { CanvasItemType } from '../types';

interface FabricBoardProps {
  width?: number;
  height?: number;
  layers?: Layer[];
  activeLayerId?: string;
  onObjectSelected?: (object: fabric.Object | null) => void;
  onHistoryUpdate?: (history: { canUndo: boolean; canRedo: boolean }) => void;
}

export interface FabricBoardHandle {
  addShape: (type: PartType, options?: fabric.IObjectOptions) => void;
  addImage: (url: string) => void;
  addText: () => void;
  deleteSelected: () => void;
  removeObjectsByLayerId: (layerId: string) => void;
  updateProperty: (prop: string, value: any) => void;
  undo: () => void;
  redo: () => void;
  setDrawingMode: (isDrawing: boolean, options?: { brushWidth?: number, brushColor?: string }) => void;
  setEraserMode: (isErasing: boolean, brushWidth?: number) => void;
  importSVG: (svgString: string) => void;
}

const defaultWidth = 1000;
const defaultHeight = 700;

const FabricBoard = forwardRef<FabricBoardHandle, FabricBoardProps>(({ 
  width = defaultWidth, 
  height = defaultHeight,
  activeLayerId,
  onObjectSelected,
  onHistoryUpdate
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [selected, setSelected] = useState<fabric.Object | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  // 初始化fabric画布
  useEffect(() => {
    if (!canvasRef.current) return;
    const c = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: '#fff',
      preserveObjectStacking: true,
      selection: true,
    });
    setCanvas(c);
    // 销毁时清理
    return () => {
      c.dispose();
    };
  }, [width, height]);

  // 事件监听
  useEffect(() => {
    if (!canvas) return;
    
    const onSelect = (e: fabric.IEvent) => {
      const selectedObj = e.selected?.[0] || null;
      setSelected(selectedObj);
      onObjectSelected?.(selectedObj);
    };
    
    const onDeselect = () => {
      setSelected(null);
      onObjectSelected?.(null);
    };
    
    // 撤销记录
    const saveHistory = () => {
      const newHistory = [...history, JSON.stringify(canvas.toJSON())].slice(-50);
      setHistory(newHistory);
      setRedoStack([]);
      onHistoryUpdate?.({ canUndo: newHistory.length > 1, canRedo: false });
    };
    
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onDeselect);
    canvas.on('object:added', saveHistory);
    canvas.on('object:modified', saveHistory);
    canvas.on('object:removed', saveHistory);
    
    return () => {
      canvas.off('selection:created', onSelect);
      canvas.off('selection:updated', onSelect);
      canvas.off('selection:cleared', onDeselect);
      canvas.off('object:added', saveHistory);
      canvas.off('object:modified', saveHistory);
      canvas.off('object:removed', saveHistory);
    };
  }, [canvas, onObjectSelected, onHistoryUpdate, history]);

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    addShape: (type: PartType, options?: fabric.IObjectOptions) => {
      if (!canvas) return;
      
      const defaultOptions = {
        left: 100,
        top: 100,
        fill: '#16a34a',
        stroke: '#2563eb',
        strokeWidth: 2,
        data: { layerId: activeLayerId },
        ...options
      };

      let shape: fabric.Object;

      switch (type) {
        case CanvasItemType.RECTANGLE:
          shape = new fabric.Rect({
            ...defaultOptions,
            width: 120,
            height: 80,
          });
          break;
        case CanvasItemType.CIRCLE:
          shape = new fabric.Circle({
            ...defaultOptions,
            radius: 50,
          });
          break;
        case CanvasItemType.LINE:
          shape = new fabric.Line([0, 0, 100, 0], {
            ...defaultOptions,
            stroke: '#2563eb',
            strokeWidth: 3,
          });
          break;
        case CanvasItemType.POLYLINE:
          shape = new fabric.Polyline([
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 50 },
            { x: 90, y: 50 }
          ], {
            ...defaultOptions,
            stroke: '#2563eb',
            strokeWidth: 3,
            fill: 'transparent',
          });
          break;
        default:
          // 默认矩形
          shape = new fabric.Rect({
            ...defaultOptions,
            width: 120,
            height: 80,
          });
      }

      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.requestRenderAll();
    },

    addImage: (url: string) => {
      if (!canvas) return;
      fabric.Image.fromURL(url, (img: fabric.Image) => {
        img.set({ 
          left: 250, 
          top: 250, 
          scaleX: 0.5, 
          scaleY: 0.5,
          data: { layerId: activeLayerId }
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
      });
    },

    addText: () => {
      if (!canvas) return;
      const text = new fabric.Textbox('文本', {
        left: 150,
        top: 300,
        fontSize: 28,
        fill: '#333',
        fontFamily: 'sans-serif',
        width: 120,
        data: { layerId: activeLayerId }
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.requestRenderAll();
    },

    deleteSelected: () => {
      if (!canvas || !selected) return;
      canvas.remove(selected);
      setSelected(null);
      onObjectSelected?.(null);
    },

    removeObjectsByLayerId: (layerId: string) => {
      if (!canvas) return;
      const objectsToRemove = canvas.getObjects().filter(obj => 
        obj.data?.layerId === layerId
      );
      objectsToRemove.forEach(obj => canvas.remove(obj));
      canvas.requestRenderAll();
    },

    updateProperty: (prop: string, value: any) => {
      if (!selected || !canvas) return;
      selected.set(prop as keyof fabric.Object, value);
      selected.setCoords();
      canvas.requestRenderAll();
    },

    undo: () => {
      if (!canvas || history.length === 0) return;
      const prev = history[history.length - 2];
      if (prev) {
        setRedoStack(r => [JSON.stringify(canvas.toJSON()), ...r]);
        canvas.loadFromJSON(prev, () => {
          canvas.renderAll();
        });
        setHistory(h => h.slice(0, -1));
        onHistoryUpdate?.({ canUndo: history.length > 2, canRedo: true });
      }
    },

    redo: () => {
      if (!canvas || redoStack.length === 0) return;
      const next = redoStack[0];
      if (next) {
        setHistory(h => [...h, JSON.stringify(canvas.toJSON())]);
        canvas.loadFromJSON(next, () => {
          canvas.renderAll();
        });
        setRedoStack(r => r.slice(1));
        onHistoryUpdate?.({ canUndo: true, canRedo: redoStack.length > 1 });
      }
    },

    setDrawingMode: (isDrawing: boolean, options?: { brushWidth?: number, brushColor?: string }) => {
      if (!canvas) return;
      
      if (isDrawing) {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.width = options?.brushWidth || 4;
        canvas.freeDrawingBrush.color = options?.brushColor || '#f472b6';
      } else {
        canvas.isDrawingMode = false;
      }
    },

    setEraserMode: (isErasing: boolean, brushWidth?: number) => {
      if (!canvas) return;
      
      if (isErasing) {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.width = brushWidth || 16;
        canvas.freeDrawingBrush.color = 'rgba(255,255,255,1)';
        // 使用类型断言来解决 globalCompositeOperation 的类型问题
        (canvas.freeDrawingBrush as any).globalCompositeOperation = 'destination-out';
      } else {
        canvas.isDrawingMode = false;
        (canvas.freeDrawingBrush as any).globalCompositeOperation = 'source-over';
      }
    },

    importSVG: (svgString: string) => {
      if (!canvas) return;
      fabric.loadSVGFromString(svgString, (objects: fabric.Object[], options: fabric.IGroupOptions) => {
        const group = fabric.util.groupSVGElements(objects, options);
        group.set({ data: { layerId: activeLayerId } });
        canvas.add(group);
        canvas.setActiveObject(group);
        canvas.requestRenderAll();
      });
    },
  }), [canvas, selected, history, redoStack, activeLayerId, onObjectSelected, onHistoryUpdate]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* 画布区 */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef} width={width} height={height} className="border w-full h-full" />
      </div>
    </div>
  );
});

FabricBoard.displayName = 'FabricBoard';

export default FabricBoard; 