import React, { useState, useCallback, useEffect, useRef } from 'react';
// 确保 fabric 类型已安装: npm install fabric @types/fabric
//import './fabric';
import type { Layer, PartType, ImageObject } from './types';
import { ToolType, PrintingMethod } from './types';
import { PART_LIBRARY, BASIC_SHAPES } from './constants';

// 导入子组件
import Toolbar from './components/Toolbar';
import FabricBoard from './components/FabricBoard';
import ParameterEditor from './components/ParameterEditor';
import CategoryPicker from './components/CategoryPicker';
import LayerPanel from './components/LayerPanel';

// 导入资源
import SelectIcon from './assets/选择.svg';
import EraserIcon from './assets/橡皮擦.svg';
import ShapeIcon from './assets/形状.svg';
import LayerIcon from './assets/图层.svg';
import DoodleIcon from './assets/涂鸦.svg';
import ImageIcon from './assets/图片.svg';
import ImportIcon from './assets/导入.svg';
import PartLibraryIcon from './assets/零件库.svg';
import PropertyIcon from './assets/属性.svg';

// 1. 定义 FabricBoard 将要暴露的 API 类型
export interface FabricBoardHandle {
  addShape: (type: PartType, options?: fabric.IObjectOptions) => void;
  addImage: (url: string) => void;
  addText: () => void;
  deleteSelected: () => void;
  removeObjectsByLayerId: (layerId: string) => void; // 新增接口
  updateProperty: (prop: string, value: any) => void;
  undo: () => void;
  redo: () => void;
  setDrawingMode: (isDrawing: boolean, options?: { brushWidth?: number, brushColor?: string }) => void;
  setEraserMode: (isErasing: boolean, brushWidth?: number) => void;
  importSVG: (svgString: string) => void;
}

const ALL_PARTS = [...BASIC_SHAPES, ...PART_LIBRARY];

const App: React.FC = () => {
  const firstLayerId = `layer_${Date.now()}`;

  // --- 应用级状态 ---
  const [layers, setLayers] = useState<Layer[]>([{ id: firstLayerId, name: '图层 1', isVisible: true, printingMethod: PrintingMethod.SCAN }]);
  const [activeLayerId, setActiveLayerId] = useState<string>(firstLayerId);
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'property' | 'layer' | 'toolbar' | null>(null);
  const [eraserRadius, setEraserRadius] = useState(16);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [canvasHeight, setCanvasHeight] = useState(600);

  // --- Fabric.js 相关状态 ---
  const fabricBoardRef = useRef<FabricBoardHandle>(null);
  //const [selectedObject, setSelectedObject] = useState<fabric.Object | null>(null);
  const [selectedObjectState, setSelectedObjectState] = useState<{ obj: fabric.Object | null; key: number }>({ obj: null, key: 0 });
  const selectedObject = selectedObjectState.obj; // 为了方便，我们保留一个对对象的直接引用
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  // --- Ref for file inputs ---
  const imageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // --- 切换工具时的副作用 ---
  useEffect(() => {
    const board = fabricBoardRef.current;
    if (!board) return;

    switch (activeTool) {
      case ToolType.PEN:
        board.setDrawingMode(true, { brushWidth: 4, brushColor: '#f472b6' });
        break;
      case ToolType.ERASER:
        board.setEraserMode(true, eraserRadius);
        break;
      case ToolType.SELECT:
      case ToolType.TEXT:
      default:
        board.setDrawingMode(false);
        break;
    }
  }, [activeTool, eraserRadius]);

  // // --- 回调：从FabricBoard接收更新 ---
  // const handleObjectSelected = useCallback((object: fabric.Object | null) => {
  //   if (object && object.type === 'activeSelection') {
  //       setSelectedObject(null); 
  //   } else {
  //       setSelectedObject(object);
  //   }
  // }, []);
  // 4. 将其替换为以下代码
  const handleObjectSelected = useCallback((object: fabric.Object | null) => {
    // 当选择变化时，我们更新对象并增加 key 来触发刷新
    setSelectedObjectState(prev => ({ obj: object, key: prev.key + 1 }));
  }, []);

  const handleHistoryUpdate = useCallback((hist: { canUndo: boolean; canRedo: boolean }) => {
    setCanUndo(hist.canUndo);
    setCanRedo(hist.canRedo);
  }, []);

  // --- 命令：向FabricBoard发送指令 ---
  const addPart = useCallback((partType: PartType) => {
    fabricBoardRef.current?.addShape(partType, { data: { layerId: activeLayerId } });
    setOpenCategory(null);
  }, [activeLayerId]);

  const addText = useCallback(() => {
    fabricBoardRef.current?.addText();
    setActiveTool(ToolType.SELECT);
  }, []);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        fabricBoardRef.current?.addImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
    event.currentTarget.value = '';
  };

  const handleImportFile = (file: { name: string; ext: string; content: string }) => {
    if (file.ext === 'svg') {
      fabricBoardRef.current?.importSVG(file.content);
    } else {
      alert('此文件类型导入暂未适配新的Fabric.js架构。');
    }
  };

  const deleteSelectedItem = useCallback(() => {
    fabricBoardRef.current?.deleteSelected();
  }, []);

  // const updateSelectedProperty = useCallback((prop: string, value: any) => {
  //   fabricBoardRef.current?.updateProperty(prop, value);
  // }, []);
  // 6. 将其替换为以下代码
  const updateSelectedProperty = useCallback((prop: string, value: any) => {
    fabricBoardRef.current?.updateProperty(prop, value);
    // 核心修复: 在属性更新后，增加 key 来强制刷新依赖该状态的组件
    setSelectedObjectState(prev => ({ ...prev, key: prev.key + 1 }));
  }, []);

  const undo = useCallback(() => {
    fabricBoardRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    fabricBoardRef.current?.redo();
  }, []);

  // --- 图层管理 ---
  const addLayer = useCallback(() => {
    const newLayer: Layer = { id: `layer_${Date.now()}`, name: `图层 ${layers.length + 1}`, isVisible: true, printingMethod: PrintingMethod.SCAN };
    setLayers(prev => [newLayer, ...prev]);
    setActiveLayerId(newLayer.id);
  }, [layers.length]);

  // const deleteLayer = useCallback((layerId: string) => {
  //   if (layers.length <= 1) return;

  //   // --- 修改: 核心修复逻辑 ---
  //   // 1. 命令 FabricBoard 删除该图层上的所有对象
  //   fabricBoardRef.current?.removeObjectsByLayerId(layerId);

  //   // 2. 更新 React 状态，并安全地设置新的 activeLayerId
  //   setLayers(prevLayers => {
  //     const newLayers = prevLayers.filter(l => l.id !== layerId);
  //     if (activeLayerId === layerId) {
  //       // 如果删除的是当前激活的图层，则将激活图层设置为新列表的第一个
  //       setActiveLayerId(newLayers[0]?.id || '');
  //     }
  //     return newLayers;
  //   });
  // }, [layers, activeLayerId]);
  // 8. 将其替换为以下代码 (与上一个回答中一致，确保它是最新的)
const deleteLayer = useCallback((layerId: string) => {
  if (layers.length <= 1) return;

  // 1. 命令 FabricBoard 删除该图层上的所有对象
  // 这也会触发 selection:cleared 事件，从而调用 handleObjectSelected(null)
  fabricBoardRef.current?.removeObjectsByLayerId(layerId);

  // 2. 更新 React 状态
  setLayers(prevLayers => {
    const newLayers = prevLayers.filter(l => l.id !== layerId);
    if (activeLayerId === layerId) {
      setActiveLayerId(newLayers[0]?.id || '');
    }
    return newLayers;
  });
}, [layers, activeLayerId]); // 依赖项现在正确了

  // --- 修改: 添加依赖项以修复属性不更新的问题 ---
  const updateLayer = useCallback((layerId: string, updates: Partial<Omit<Layer, 'id'>>) => {
    setLayers(prev => prev.map(l => (l.id === layerId ? { ...l, ...updates } as Layer : l)));
  }, []); // 依赖项为空是正确的，因为我们使用了函数式更新 `prev => ...`

  const moveLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    setLayers(prevLayers => {
      const index = prevLayers.findIndex(l => l.id === layerId);
      if (index === -1) return prevLayers;
      if (direction === 'down' && index === prevLayers.length - 1) return prevLayers;
      if (direction === 'up' && index === 0) return prevLayers;

      const newLayers = [...prevLayers];
      const [layer] = newLayers.splice(index, 1);
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      newLayers.splice(newIndex, 0, layer);
      return newLayers;
    });
  }, []);

  const handleNext = async () => {
    alert("“下一步”功能需要适配Fabric.js的导出逻辑。");
  };

  return (
    // ... JSX 部分保持不变 ...
    <div className="h-screen w-screen flex flex-row font-sans text-gray-800 bg-gray-100 overflow-hidden" style={{ width: '100vw', height: '100vh', minHeight: '100vh', minWidth: '100vw' }}>
      {/* 页面顶部布局保持不变 */}
      <div className="w-full flex flex-row items-center justify-between px-4 py-2 bg-white border-b border-gray-200 fixed top-0 left-0 z-40 md:static md:justify-end md:py-0 md:px-0">
        <div className="flex flex-row gap-2">
          <button
            className="px-4 py-2 rounded bg-gray-200 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-300 disabled:opacity-50"
            onClick={undo}
            disabled={!canUndo}
          >撤销</button>
        </div>
        <div className="flex-1 flex justify-center">
          <span style={{ color: '#888', fontSize: 13 }}>
            画布大小：{canvasWidth} × {canvasHeight}
          </span>
        </div>
        <div className="flex flex-row gap-2">
          <button
            className="px-4 py-2 rounded bg-blue-500 text-white text-sm font-medium shadow-sm hover:bg-blue-600"
            onClick={handleNext}
          >下一步</button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 pt-14 md:pt-0">
        <div className="hidden md:block h-16 bg-white border-b border-gray-200">
          <Toolbar
            onOpenCategoryPicker={setOpenCategory}
            onAddImage={() => imageInputRef.current?.click()}
            activeTool={activeTool}
            onSetTool={setActiveTool}
            onUndo={undo}
            canUndo={canUndo}
            onImportFile={handleImportFile}
            onNext={handleNext}
          />
        </div>
        <main className="flex-1 flex flex-col min-h-0 min-w-0 bg-white relative">
          <FabricBoard
            ref={fabricBoardRef}
            width={canvasWidth}
            height={canvasHeight}
            layers={layers}
            activeLayerId={activeLayerId}
            onObjectSelected={handleObjectSelected}
            onHistoryUpdate={handleHistoryUpdate}
          />
        </main>
        <button
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-6 py-2 rounded-full bg-gray-800 text-white text-base shadow-lg md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}
          onClick={() => setDrawer('toolbar')}
        >工具栏</button>
      </div>

      <aside className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0 min-w-0 hidden md:flex">
        {selectedObject ? (
          <ParameterEditor
            // @ts-ignore
            selectedObject={selectedObject}
            onUpdateProperty={updateSelectedProperty}
            onDeleteItem={deleteSelectedItem}
            layers={layers}
          />
        ) : (
          <div className="p-4 h-full flex flex-col">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex-shrink-0">图层管理</h3>
            <LayerPanel
              layers={layers}
              activeLayerId={activeLayerId}
              onAddLayer={addLayer}
              onDeleteLayer={deleteLayer}
              onUpdateLayer={updateLayer}
              onSetActiveLayerId={setActiveLayerId}
              onMoveLayer={moveLayer}
            />
          </div>
        )}
      </aside>

      {openCategory && (
        <CategoryPicker
          category={openCategory}
          onAddPart={addPart}
          onClose={() => setOpenCategory(null)}
        />
      )}

      {drawer === 'toolbar' && (
        <div className="fixed left-0 right-0 bottom-0 z-50 flex justify-center items-end" style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}>
          <div className="bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full">
            <div className="w-full flex justify-between items-center mb-2">
              <span className="font-semibold">工具栏</span>
              <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
            </div>
            <div className="grid grid-cols-3 grid-rows-3 gap-3 w-full">
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${activeTool === ToolType.SELECT ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-800'}`}
                onClick={() => setActiveTool(ToolType.SELECT)}
              >
                <img src={SelectIcon} alt="选择" className="w-6 h-6 mb-1" />
                <span className="text-xs">选择</span>
              </button>
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${activeTool === ToolType.PEN ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-800'}`}
                onClick={() => setActiveTool(ToolType.PEN)}
              >
                <img src={DoodleIcon} alt="涂鸦" className="w-6 h-6 mb-1" />
                <span className="text-xs">涂鸦</span>
              </button>
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${activeTool === ToolType.ERASER ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-800'}`}
                onClick={() => setActiveTool(ToolType.ERASER)}
              >
                <img src={EraserIcon} alt="橡皮擦" className="w-6 h-6 mb-1" />
                <span className="text-xs">橡皮擦</span>
              </button>

              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${!selectedObject ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
                onClick={() => { if (selectedObject) setDrawer('property'); }}
                disabled={!selectedObject}
              >
                <img src={PropertyIcon} alt="属性" className="w-6 h-6 mb-1" />
                <span className="text-xs">属性</span>
              </button>
              <button
                className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800"
                onClick={() => setDrawer('layer')}
              >
                <img src={LayerIcon} alt="图层" className="w-6 h-6 mb-1" />
                <span className="text-xs">图层</span>
              </button>

              <div className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800 cursor-pointer" onClick={() => { setOpenCategory('BASIC_SHAPES'); setDrawer(null); }}>
                <img src={ShapeIcon} alt="形状" className="w-6 h-6 mb-1" />
                <span className="text-xs">形状</span>
              </div>

              <div className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800 cursor-pointer" onClick={() => { setOpenCategory('PART_LIBRARY'); setDrawer(null); }}>
                <img src={PartLibraryIcon} alt="零件库" className="w-6 h-6 mb-1" />
                <span className="text-xs">零件库</span>
              </div>

              <button className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800" onClick={() => imageInputRef.current?.click()}>
                <img src={ImageIcon} alt="图片" className="w-6 h-6 mb-1" />
                <span className="text-xs">图片</span>
              </button>

              <button className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800" onClick={() => importInputRef.current?.click()}>
                <img src={ImportIcon} alt="导入" className="w-6 h-6 mb-1" />
                <span className="text-xs">导入</span>
              </button>
            </div>

            {activeTool === ToolType.ERASER && (
              <div className="mt-4 flex flex-col items-center">
                <label className="text-xs text-gray-600 mb-1">擦除范围：{eraserRadius}px</label>
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={eraserRadius}
                  onChange={e => setEraserRadius(Number(e.target.value))}
                  className="w-40"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {drawer === 'property' && selectedObject && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full"
          style={{
            maxHeight: '80vh',
            paddingBottom: 'env(safe-area-inset-bottom, 16px)'
          }}
        >
          <div className="w-full flex justify-between items-center mb-2 flex-shrink-0">
            <span className="font-semibold">属性编辑</span>
            <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
          </div>
          <div className="w-full overflow-y-auto">
            <ParameterEditor
              selectedObject={selectedObject}
              layers={layers}
              onUpdateProperty={updateSelectedProperty}
              onDeleteItem={deleteSelectedItem}
            />
          </div>
        </div>
      )}

      {drawer === 'layer' && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full"
          style={{
            maxHeight: '80vh',
            paddingBottom: 'env(safe-area-inset-bottom,16px)'
          }}
        >
          <div className="w-full flex justify-between items-center mb-2 flex-shrink-0">
            <span className="font-semibold">图层管理</span>
            <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
          </div>
          <div className="w-full overflow-y-auto">
            <LayerPanel
              layers={layers}
              activeLayerId={activeLayerId}
              onAddLayer={addLayer}
              onDeleteLayer={deleteLayer}
              onUpdateLayer={updateLayer}
              onSetActiveLayerId={setActiveLayerId}
              onMoveLayer={moveLayer}
            />
          </div>
        </div>
      )}

      <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
      <input type="file" ref={importInputRef} className="hidden" accept=".svg" onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (typeof ev.target?.result === 'string') {
            handleImportFile({ name: file.name, ext: 'svg', content: ev.target.result });
          }
        };
        reader.readAsText(file);
        e.currentTarget.value = '';
      }} />
    </div>
  );
};

declare global {
  interface Window {
    Android?: {
      onNextStep?: (data: string) => void;
      saveTempFile?: (base64: string, fileName: string) => string;
      getPlatformSize?: () => string | { width: number | string; height: number | string };
    };
  }
}

export default App;