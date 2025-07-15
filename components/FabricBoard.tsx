import React, { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';

interface FabricBoardProps {
  width?: number;
  height?: number;
}

const defaultWidth = 1000;
const defaultHeight = 700;

const FabricBoard: React.FC<FabricBoardProps> = ({ width = defaultWidth, height = defaultHeight }) => {
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
      setSelected(e.selected?.[0] || null);
    };
    const onDeselect = () => setSelected(null);
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onDeselect);
    // 撤销记录
    const saveHistory = () => {
      setHistory(prev => [...prev, JSON.stringify(canvas.toJSON())].slice(-50));
      setRedoStack([]);
    };
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
  }, [canvas]);

  // 工具栏操作
  const addRect = () => {
    if (!canvas) return;
    const rect = new fabric.Rect({
      left: 100, top: 100, width: 120, height: 80, fill: '#16a34a', stroke: '#2563eb', strokeWidth: 2,
    });
    canvas.add(rect);
    (canvas as fabric.Canvas).setActiveObject(rect);
  };
  const addCircle = () => {
    if (!canvas) return;
    const circle = new fabric.Circle({
      left: 200, top: 200, radius: 50, fill: '#00AE3D', stroke: '#2563eb', strokeWidth: 2,
    });
    canvas.add(circle);
    (canvas as fabric.Canvas).setActiveObject(circle);
  };
  const addLine = () => {
    if (!canvas) return;
    const line = new fabric.Line([300, 300, 400, 400], {
      stroke: '#2563eb', strokeWidth: 3
    });
    canvas.add(line);
    (canvas as fabric.Canvas).setActiveObject(line);
  };
  const addText = () => {
    if (!canvas) return;
    const text = new fabric.Textbox('文本', {
      left: 150, top: 300, fontSize: 28, fill: '#333', fontFamily: 'sans-serif', width: 120
    });
    canvas.add(text);
    (canvas as fabric.Canvas).setActiveObject(text);
  };
  const addImage = (url: string) => {
    if (!canvas) return;
    fabric.Image.fromURL(url, (img: fabric.Image) => {
      img.set({ left: 250, top: 250, scaleX: 0.5, scaleY: 0.5 });
      canvas.add(img);
      (canvas as fabric.Canvas).setActiveObject(img);
    });
  };
  const importSVG = (svgContent: string) => {
    if (!canvas) return;
    fabric.loadSVGFromString(svgContent, (objects: fabric.Object[], options: fabric.IGroupOptions) => {
      const group = fabric.util.groupSVGElements(objects, options);
      canvas.add(group);
      (canvas as fabric.Canvas).setActiveObject(group);
      canvas.requestRenderAll();
    });
  };
  const removeSelected = () => {
    if (!canvas || !selected) return;
    canvas.remove(selected);
    setSelected(null);
  };
  const groupSelected = () => {
    if (!canvas) return;
    if (!canvas.getActiveObject()) return;
    if (canvas.getActiveObject()?.type === 'activeSelection') {
      (canvas.getActiveObject() as fabric.ActiveSelection).toGroup();
      canvas.requestRenderAll();
    }
  };
  const ungroupSelected = () => {
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj && obj.type === 'group') {
      (obj as fabric.Group).toActiveSelection();
      canvas.requestRenderAll();
    }
  };
  const undo = () => {
    if (!canvas || history.length === 0) return;
    const prev = history[history.length - 2];
    if (prev) {
      setRedoStack(r => [JSON.stringify(canvas.toJSON()), ...r]);
      canvas.loadFromJSON(prev, () => {
        canvas.renderAll();
      });
      setHistory(h => h.slice(0, -1));
    }
  };
  const redo = () => {
    if (!canvas || redoStack.length === 0) return;
    const next = redoStack[0];
    if (next) {
      setHistory(h => [...h, JSON.stringify(canvas.toJSON())]);
      canvas.loadFromJSON(next, () => {
        canvas.renderAll();
      });
      setRedoStack(r => r.slice(1));
    }
  };

  // 属性面板
  const handlePropChange = (prop: string, value: any) => {
    if (!selected || !canvas) return;
    selected.set(prop as keyof fabric.Object, value);
    selected.setCoords();
    canvas.requestRenderAll();
  };

  // 文件导入
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        if (ext === 'svg') {
          importSVG(ev.target.result);
        } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
          addImage(ev.target.result);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* 工具栏 */}
      <div className="flex gap-2 p-2 bg-gray-100 border-b">
        <button onClick={addRect}>矩形</button>
        <button onClick={addCircle}>圆</button>
        <button onClick={addLine}>直线</button>
        <button onClick={addText}>文本</button>
        <button onClick={() => fileInputRef.current?.click()}>导入SVG/图片</button>
        <button onClick={removeSelected} disabled={!selected}>删除</button>
        <button onClick={groupSelected}>分组</button>
        <button onClick={ungroupSelected}>解组</button>
        <button onClick={undo}>撤销</button>
        <button onClick={redo}>重做</button>
      </div>
      {/* 属性面板 */}
      {selected && (
        <div className="p-2 bg-gray-50 border-b flex gap-4 items-center">
          <span>属性：</span>
          <label>左 <input type="number" value={selected.left ?? 0} onChange={e => handlePropChange('left', parseFloat(e.target.value))} /></label>
          <label>上 <input type="number" value={selected.top ?? 0} onChange={e => handlePropChange('top', parseFloat(e.target.value))} /></label>
          <label>宽 <input type="number" value={selected.width ?? 0} onChange={e => handlePropChange('width', parseFloat(e.target.value))} /></label>
          <label>高 <input type="number" value={selected.height ?? 0} onChange={e => handlePropChange('height', parseFloat(e.target.value))} /></label>
          <label>角度 <input type="number" value={selected.angle ?? 0} onChange={e => handlePropChange('angle', parseFloat(e.target.value))} /></label>
          {selected.type === 'textbox' && (
            <label>内容 <input type="text" value={(selected as any).text} onChange={e => handlePropChange('text', e.target.value)} /></label>
          )}
        </div>
      )}
      {/* 画布区 */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef} width={width} height={height} className="border w-full h-full" />
        <input ref={fileInputRef} type="file" accept=".svg,.png,.jpg,.jpeg" className="hidden" onChange={handleFileChange} />
      </div>
    </div>
  );
};

export default FabricBoard; 