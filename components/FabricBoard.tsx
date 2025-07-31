import React, {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
//import '../fabric';
import type { FabricBoardHandle } from '../App';
import type { Layer, PartType } from '../types';
import { BASIC_SHAPES, PART_LIBRARY } from '../constants';

//declare const fabric: any;

const ALL_PARTS = [...BASIC_SHAPES, ...PART_LIBRARY];
const MAX_HISTORY_LENGTH = 50;

interface FabricBoardProps {
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: string;
  onObjectSelected: (object: fabric.Object | null) => void;
  onHistoryUpdate: (history: { canUndo: boolean; canRedo: boolean }) => void;
}

const FabricBoard = forwardRef<FabricBoardHandle, FabricBoardProps>(
  ({ width, height, layers, activeLayerId, onObjectSelected, onHistoryUpdate }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
    
    const history = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const isUpdatingFromHistory = useRef(false);
    const isEraserActive = useRef(false);

    // 1. Initialize Fabric Canvas
    useEffect(() => {
      if (!canvasRef.current) return;
      const newCanvas = new fabric.Canvas(canvasRef.current, {
        width,
        height,
        backgroundColor: '#fff',
        preserveObjectStacking: true,
      });
      setCanvas(newCanvas);
      saveHistory(newCanvas);
      return () => {
        newCanvas.dispose();
      };
    }, [width, height]);

    // 2. Bind Events
    useEffect(() => {
      if (!canvas) return;

      const handleSelection = () => {
        onObjectSelected(canvas.getActiveObject());
      };

      const handleModification = () => {
        if (!isUpdatingFromHistory.current) {
          saveHistory(canvas);
        }
      };

      const handlePathCreated = (e: fabric.IEvent & { path?: fabric.Path }) => {
        if (!e.path) return;
        
        if (isEraserActive.current) {
          e.path.selectable = false;
          e.path.evented = false;
          e.path.set('erasable', false); 
        } else {
          (e.path as any).layerId = activeLayerId;
        }
        
        setTimeout(() => saveHistory(canvas), 50);
      };

      canvas.on('selection:created', handleSelection);
      canvas.on('selection:updated', handleSelection);
      canvas.on('selection:cleared', handleSelection);
      canvas.on('object:modified', handleModification);
      canvas.on('object:added', handleModification);
      canvas.on('object:removed', handleModification);
      canvas.on('path:created', handlePathCreated);

      return () => {
        canvas.off('selection:created', handleSelection);
        canvas.off('selection:updated', handleSelection);
        canvas.off('selection:cleared', handleSelection);
        canvas.off('object:modified', handleModification);
        canvas.off('object:added', handleModification);
        canvas.off('object:removed', handleModification);
        canvas.off('path:created', handlePathCreated);
      };
    }, [canvas, onObjectSelected, activeLayerId]);

    // 3. Respond to Layer Changes (Visibility and Order)
    useEffect(() => {
      if (!canvas) return;
      
      const allObjects = canvas.getObjects();

      // Set stacking order based on reversed layers array (bottom layer first)
      layers.slice().reverse().forEach(layer => {
        allObjects.forEach(obj => {
          if ((obj as any).layerId === layer.id) {
            canvas.bringToFront(obj);
          }
        });
      });

      // Set visibility
      allObjects.forEach(obj => {
        const objLayerId = (obj as any).layerId;
        if (objLayerId) {
          const layer = layers.find(l => l.id === objLayerId);
          // 修改: 如果找不到图层，则对象不可见
          obj.set('visible', layer ? layer.isVisible : false);
        }
      });

      canvas.requestRenderAll();
    }, [layers, canvas]);

    // 4. History Management
    const saveHistory = (c: fabric.Canvas) => {
      const json = JSON.stringify(c.toJSON(['layerId', 'erasable', 'clipPath']));
      if (history.current[history.current.length - 1] === json) return;

      history.current.push(json);
      if (history.current.length > MAX_HISTORY_LENGTH) {
        history.current.shift();
      }
      redoStack.current = [];
      onHistoryUpdate({ canUndo: history.current.length > 1, canRedo: false });
    };

    // 5. Expose Imperative API to Parent Component
    useImperativeHandle(ref, () => ({
      addShape(type: PartType) {
        if (!canvas) return;
        const partDef = ALL_PARTS.find(p => p.type === type);
        if (!partDef) return;

        let shape: fabric.Object | null = null;
        const commonOptions = {
          left: canvas.getCenter().left,
          top: canvas.getCenter().top,
          originX: 'center',
          originY: 'center',
          fill: '#16a34a',
          layerId: activeLayerId,
        };

        switch (type) {
          case 'RECTANGLE':
            shape = new fabric.Rect({ ...commonOptions, ...partDef.defaultParameters });
            break;
          case 'CIRCLE':
            shape = new fabric.Circle({ ...commonOptions, ...partDef.defaultParameters });
            break;
          default:
            shape = new fabric.Rect({ ...commonOptions, width: 100, height: 100 });
        }
        if (shape) canvas.add(shape).setActiveObject(shape);
      },

      addImage(url: string) {
        if (!canvas) return;
        fabric.Image.fromURL(url, (img) => {
          img.set({
            left: canvas.getCenter().left,
            top: canvas.getCenter().top,
            originX: 'center',
            originY: 'center',
            layerId: activeLayerId,
          });
          img.scaleToWidth(canvas.getWidth() / 2);
          canvas.add(img).setActiveObject(img);
        });
      },

      addText() {
        if (!canvas) return;
        const text = new fabric.Textbox('新文本', {
          left: canvas.getCenter().left,
          top: canvas.getCenter().top,
          originX: 'center',
          originY: 'center',
          width: 200,
          fontSize: 28,
          fill: '#333',
          layerId: activeLayerId,
        });
        canvas.add(text).setActiveObject(text);
      },

      deleteSelected() {
        if (!canvas) return;
        canvas.getActiveObjects().forEach(obj => canvas.remove(obj));
        canvas.discardActiveObject().requestRenderAll();
      },
      
      // --- 新增功能: 根据图层ID删除对象 ---
      removeObjectsByLayerId(layerId: string) {
        if (!canvas) return;
        const objectsToRemove = canvas.getObjects().filter(obj => (obj as any).layerId === layerId);
        if (objectsToRemove.length === 0) return;

        const activeObject = canvas.getActiveObject();

        // 使用 '...' 展开操作符来一次性移除所有匹配的对象
        canvas.remove(...objectsToRemove);

        // 如果当前激活的对象（或多选中的某个对象）在被删除的列表中，
        // 则取消选择。这将触发 selection:cleared 事件。
        if (activeObject) {
            const activeObjects = activeObject.isType('activeSelection') ? (activeObject as fabric.ActiveSelection).getObjects() : [activeObject];
            const selectionHasBeenRemoved = activeObjects.some(obj => objectsToRemove.includes(obj));
            if (selectionHasBeenRemoved) {
                canvas.discardActiveObject();
            }
        }
        
        // 立即渲染一次以反映取消选择的状态
        canvas.requestRenderAll();
        // 记录这次删除操作到历史记录
        saveHistory(canvas);
      },

      updateProperty(prop: string, value: any) {
        if (!canvas) return;
        const activeObj = canvas.getActiveObject();
        if (activeObj) {
          activeObj.set(prop as keyof fabric.Object, value);
          if (prop === 'layerId') (activeObj as any).layerId = value;

          activeObj.setCoords();
          canvas.requestRenderAll();
          saveHistory(canvas); // 确保属性修改被记录
        }
      },
      
      setDrawingMode(isDrawing, options) {
        if (!canvas) return;
        isEraserActive.current = false;
        canvas.isDrawingMode = isDrawing;
        if (isDrawing) {
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
          canvas.freeDrawingBrush.color = options?.brushColor || '#000';
          canvas.freeDrawingBrush.width = options?.brushWidth || 1;
        }
      },

      setEraserMode(isErasing, brushWidth = 10) {
        if (!canvas) return;
        isEraserActive.current = isErasing;
        canvas.isDrawingMode = isErasing;
        if (isErasing) {
          canvas.freeDrawingBrush = new fabric.EraserBrush(canvas);
          canvas.freeDrawingBrush.width = brushWidth;
        }
      },

      importSVG(svgString: string) {
        if(!canvas) return;
        fabric.loadSVGFromString(svgString, (objects, options) => {
            const group = fabric.util.groupSVGElements(objects, options);
            group.set({
                left: canvas.getCenter().left,
                top: canvas.getCenter().top,
                originX: 'center',
                originY: 'center',
                layerId: activeLayerId
            });
            canvas.add(group);
            canvas.requestRenderAll();
        });
      },

      undo() {
        if (history.current.length <= 1 || !canvas) return;
        isUpdatingFromHistory.current = true;
        
        const loadCallback = () => {
          canvas.renderAll();
          isUpdatingFromHistory.current = false;
          onObjectSelected(canvas.getActiveObject());
        };

        const lastState = history.current.pop()!;
        redoStack.current.push(lastState);
        const prevState = history.current[history.current.length - 1];
        
        canvas.loadFromJSON(prevState, loadCallback);
        onHistoryUpdate({ canUndo: history.current.length > 1, canRedo: true });
      },

      redo() {
        if (redoStack.current.length === 0 || !canvas) return;
        isUpdatingFromHistory.current = true;

        const loadCallback = () => {
          canvas.renderAll();
          isUpdatingFromHistory.current = false;
          onObjectSelected(canvas.getActiveObject());
        };

        const nextState = redoStack.current.pop()!;
        history.current.push(nextState);

        canvas.loadFromJSON(nextState, loadCallback);
        onHistoryUpdate({ canUndo: true, canRedo: redoStack.current.length > 0 });
      },
    }));

    return (
      <div className="w-full h-full border border-gray-300">
        <canvas ref={canvasRef} />
      </div>
    );
  }
);

export default FabricBoard;