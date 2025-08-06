import React, { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { CanvasItem, CanvasItemData, PartType, Layer, Part, ImageObject } from './types';
import { CanvasItemType, ToolType, PrintingMethod } from './types';
import { PART_LIBRARY, BASIC_SHAPES } from './constants';
import Toolbar from './components/Toolbar';
import Canvas from './components/Canvas';
import ParameterEditor from './components/ParameterEditor';
import CategoryPicker from './components/CategoryPicker';
import LayerPanel from './components/LayerPanel';
import { generatePlatformScanGCode, GCodeScanSettings } from './lib/gcode';
import LayerSettingsPanel from './components/LayerSettingsPanel';
// @ts-ignore
import { Helper, parseString as parseDxf } from 'dxf';
import { parse as parseSvgson } from 'svgson';
import SelectIcon from './assets/选择.svg';
import EraserIcon from './assets/橡皮擦.svg';
import ShapeIcon from './assets/形状.svg';
import LayerIcon from './assets/图层.svg';
import DoodleIcon from './assets/涂鸦.svg';
import ImageIcon from './assets/图片.svg';
import ImportIcon from './assets/导入.svg';
import PartLibraryIcon from './assets/零件库.svg';
import PropertyIcon from './assets/属性.svg';
import { Converter } from 'svg-to-gcode';
import * as svgo from 'svgo';

// 浏览器端简易 HPGL 解析器，仅支持 PU/PD/PA 指令

function simpleParseHPGL(content: string) {
  // 返回 [{type: 'PU'|'PD'|'PA', points: [[x,y], ...]}]
  const cmds: { type: string; points: [number, number][] }[] = [];
  content.replace(/(PU|PD|PA)([^;]*);/gi, (_: any, type: string, pts: string) => {
    const points = pts
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .reduce((arr: [number, number][], val, idx, src) => {
        if (idx % 2 === 0 && src[idx + 1] !== undefined) {
          arr.push([parseFloat(val), parseFloat(src[idx + 1])]);
        }
        return arr;
      }, [] as [number, number][]);
    cmds.push({ type: type.toUpperCase(), points });
    return '';
  });
  return cmds;
}

// 计算包围盒工具函数
function getGroupBoundingBox(items: CanvasItemData[]): { minX: number, minY: number, maxX: number, maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach(item => {
    const itemPoints = 'points' in item && Array.isArray(item.points) ? item.points : [];
    const strokeWidth = (item as any).strokeWidth || 0;
    if (itemPoints.length > 0) {
      const itemMinX = (item.x ?? 0) + Math.min(...itemPoints.map((p: any) => p.x)) - strokeWidth / 2;
      const itemMinY = (item.y ?? 0) + Math.min(...itemPoints.map((p: any) => p.y)) - strokeWidth / 2;
      const itemMaxX = (item.x ?? 0) + Math.max(...itemPoints.map((p: any) => p.x)) + strokeWidth / 2;
      const itemMaxY = (item.y ?? 0) + Math.max(...itemPoints.map((p: any) => p.y)) + strokeWidth / 2;
      minX = Math.min(minX, itemMinX);
      minY = Math.min(minY, itemMinY);
      maxX = Math.max(maxX, itemMaxX);
      maxY = Math.max(maxY, itemMaxY);
    } else if ('width' in item && 'height' in item) {
      minX = Math.min(minX, (item.x ?? 0) - item.width / 2 - strokeWidth / 2);
      minY = Math.min(minY, (item.y ?? 0) - item.height / 2 - strokeWidth / 2);
      maxX = Math.max(maxX, (item.x ?? 0) + item.width / 2 + strokeWidth / 2);
      maxY = Math.max(maxY, (item.y ?? 0) + item.height / 2 + strokeWidth / 2);
    }
  });
  return { minX, minY, maxX, maxY };
}

// ==========================================================
// SVG and G-code Generation Helpers for Engraving
// ==========================================================

/**
 * Converts a single CanvasItem to an SVG element string.
 * @param item The canvas item to convert.
 * @returns An SVG element as a string.
 */
function itemToSvgElement(item: CanvasItem): string {

  // Explicitly ignore images and text, as they cannot be converted to vector paths.
  if (item.type === CanvasItemType.IMAGE || item.type === CanvasItemType.TEXT) {
    return '';
  }

  const stroke = 'stroke="black" stroke-width="1" fill="none"';

  if (item.type === 'GROUP' && Array.isArray(item.children)) {
    const groupTransform = `transform="translate(${item.x || 0}, ${item.y || 0}) rotate(${item.rotation || 0})"`;
    const childrenSvg = item.children.map(child => itemToSvgElement(child as CanvasItem)).join('');
    return `<g ${groupTransform}>${childrenSvg}</g>`;
  }

  const transform = `transform="translate(${item.x || 0}, ${item.y || 0}) rotate(${('rotation' in item ? item.rotation : 0) || 0})"`;

  if ('parameters' in item) {
    switch (item.type) {
      case CanvasItemType.RECTANGLE: {
        const w = item.parameters.width || 40;
        const h = item.parameters.height || 40;
        return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" ${stroke} ${transform} />`;
      }
      case CanvasItemType.CIRCLE: {
        const r = item.parameters.radius || 20;
        return `<circle cx="0" cy="0" r="${r}" ${stroke} ${transform} />`;
      }
      case CanvasItemType.LINE: {
        const l = item.parameters.length || 40;
        return `<line x1="${-l / 2}" y1="0" x2="${l / 2}" y2="0" ${stroke} ${transform} />`;
      }
      // Add more complex shapes as needed, converting them to SVG paths.
      // For now, we support the basic shapes that svg-to-gcode handles well.
    }
  }

  if (item.type === CanvasItemType.DRAWING && 'points' in item && Array.isArray(item.points) && item.points.length > 1) {
    const pointsStr = item.points.map(p => `${p.x},${p.y}`).join(' ');
    const drawingTransform = `transform="translate(${item.x || 0}, ${item.y || 0}) rotate(${('rotation' in item ? item.rotation : 0) || 0})"`;
    return `<polyline points="${pointsStr}" ${stroke} ${drawingTransform} />`;
  }

  return '';
}

/**
 * Generates a complete SVG string from a list of canvas items.
 * @param items The array of canvas items to include.
 * @param canvasWidth The width of the canvas.
 * @param canvasHeight The height of the canvas.
 * @returns A full SVG document as a string.
 */
function generateSvgForEngraving(items: CanvasItem[], canvasWidth: number, canvasHeight: number): string {
  const svgElements = items.map(item => itemToSvgElement(item)).join('\n');
  return `<svg width="${canvasWidth}mm" height="${canvasHeight}mm" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">\n${svgElements}\n</svg>`;
}

const MAX_HISTORY = 50;
const ALL_PARTS = [...BASIC_SHAPES, ...PART_LIBRARY];

// 1. 定义WhiteboardPageProps接口，支持canvasWidth和canvasHeight
interface WhiteboardPageProps {
  canvasWidth?: number;
  canvasHeight?: number;
}

// 2. WhiteboardPage组件支持props传入宽高，默认500
const WhiteboardPage: React.FC<WhiteboardPageProps> = () => {
  const location = useLocation();


  const [layers, setLayers] = useState<Layer[]>([
    { id: `scan_layer_${Date.now()}`, name: '扫描图层', isVisible: true, printingMethod: PrintingMethod.SCAN },
    { id: `engrave_layer_${Date.now()}`, name: '雕刻图层', isVisible: true, printingMethod: PrintingMethod.ENGRAVE }
  ]);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [history, setHistory] = useState<[Layer[], CanvasItem[]][]>([]);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'property' | 'layer' | 'toolbar' | null>(null);
  const [eraserRadius, setEraserRadius] = useState(16);

  const [canvasWidth, setCanvasWidth] = useState(400);
  const [canvasHeight, setCanvasHeight] = useState(400);

  const [step, setStep] = useState(1); // 新增步骤状态
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null); // 图层设置界面选中
  const [processedImage, setProcessedImage] = useState<string | null>(null); // 跟踪已处理的图片

  // 添加G代码生成进度弹窗状态
  const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);
  const [generationProgress, setGenerationProgress] = useState('');

  // 初始化activeLayerId
  useEffect(() => {
    if (!activeLayerId && layers.length > 0) {
      setActiveLayerId(layers[0].id);
    }
  }, [layers, activeLayerId]);

  // 根据对象类型确定图层类型 - 图片默认扫描图层，其他默认雕刻图层
  const getPrintingMethodByItemType = useCallback((itemType: CanvasItemType | 'GROUP') => {
    // 图片类型默认使用扫描图层
    if (itemType === CanvasItemType.IMAGE) {
      return PrintingMethod.SCAN;
    }

    // 其他所有对象类型默认使用雕刻图层
    return PrintingMethod.ENGRAVE;
  }, []);

  // 获取指定类型的图层ID，如果没有对应类型的图层，则创建
  const getLayerIdByType = useCallback((printingMethod: PrintingMethod) => {
    let layer = layers.find(l => l.printingMethod === printingMethod);

    // 如果没有对应类型的图层，创建一个新的
    if (!layer) {
      const newLayer: Layer = {
        id: `layer_${Date.now()}`,
        name: printingMethod === PrintingMethod.SCAN ? '扫描图层' : '雕刻图层',
        isVisible: true,
        printingMethod: printingMethod
      };
      setLayers(prev => [newLayer, ...prev]);
      layer = newLayer;
    }

    return layer.id;
  }, [layers]);

  const pushHistory = useCallback((currentLayers: Layer[], currentItems: CanvasItem[]) => {
    setHistory(prev => [...prev.slice(prev.length - MAX_HISTORY + 1), [currentLayers, currentItems]]);
  }, []);

  const addItem = useCallback((itemData: CanvasItemData) => {
    pushHistory(layers, items);

    // 根据对象类型自动确定图层
    const printingMethod = getPrintingMethodByItemType(itemData.type);
    const targetLayerId = getLayerIdByType(printingMethod);

    const newItem = {
      ...itemData,
      id: `item_${Date.now()}_${Math.random()}`,
      layerId: targetLayerId
    } as CanvasItem;

    setItems(prev => [...prev, newItem]);
    setSelectedItemId(newItem.id);
    setActiveTool(ToolType.SELECT);
  }, [items, layers, pushHistory, getPrintingMethodByItemType, getLayerIdByType]);

  const addItems = useCallback((itemsData: CanvasItemData[]) => {
    pushHistory(layers, items);

    const newItems = itemsData.map(itemData => {
      // 根据对象类型自动确定图层
      const printingMethod = getPrintingMethodByItemType(itemData.type);
      const targetLayerId = getLayerIdByType(printingMethod);

      return {
        ...itemData,
        id: `item_${Date.now()}_${Math.random()}`,
        layerId: targetLayerId,
      } as CanvasItem;
    });

    setItems(prev => [...prev, ...newItems]);
    setSelectedItemId(newItems[newItems.length - 1]?.id || null);
    setActiveTool(ToolType.SELECT);
  }, [items, layers, pushHistory, getPrintingMethodByItemType, getLayerIdByType]);

  const addPart = useCallback((partType: PartType) => {
    const partDefinition = ALL_PARTS.find(p => p.type === partType);
    if (!partDefinition) return;

    addItem({
      type: partType,
      x: 0,
      y: 0,
      parameters: { ...partDefinition.defaultParameters },
      rotation: 0,
    } as Omit<Part, 'id' | 'layerId'>);
    setOpenCategory(null);
  }, [addItem]);

  const addImage = useCallback((href: string, width: number, height: number) => {
    // 根据画布大小动态设定图片最大尺寸（占画布的70%）
    const MAX_IMAGE_WIDTH = canvasWidth * 0.4;
    const MAX_IMAGE_HEIGHT = canvasHeight * 0.4;

    let newWidth = width;
    let newHeight = height;

    // 计算缩放比例，保持原图宽高比
    const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1);
    if (scale < 1) {
      newWidth = width * scale;
      newHeight = height * scale;
    }

    // 如果图片太小，设定一个最小尺寸（至少占画布的20%）
    const MIN_SIZE = Math.min(canvasWidth, canvasHeight) * 0.05;
    if (Math.max(newWidth, newHeight) < MIN_SIZE) {
      const minScale = MIN_SIZE / Math.max(newWidth, newHeight);
      newWidth *= minScale;
      newHeight *= minScale;
    }

    addItem({
      type: CanvasItemType.IMAGE,
      x: canvasWidth / 2 - newWidth / 2, // 图片左上角，使图片中心在画布中心
      y: canvasHeight / 2 - newHeight / 2,
      href,
      width: newWidth,
      height: newHeight,
      rotation: 0,
    } as Omit<ImageObject, 'id' | 'layerId'>);
  }, [addItem, canvasWidth, canvasHeight]);

  // 处理从路由传递的图片数据
  useEffect(() => {
    if (location.state?.image && location.state.image !== processedImage) {
      setProcessedImage(location.state.image);
      const img = new Image();
      img.onload = () => {
        // 根据画布大小动态设定图片最大尺寸（占画布的70%）
        const MAX_IMAGE_WIDTH = canvasWidth * 0.4;
        const MAX_IMAGE_HEIGHT = canvasHeight * 0.4;

        let newWidth = img.width;
        let newHeight = img.height;

        // 计算缩放比例，保持原图宽高比
        const scale = Math.min(MAX_IMAGE_WIDTH / img.width, MAX_IMAGE_HEIGHT / img.height, 1);
        if (scale < 1) {
          newWidth = img.width * scale;
          newHeight = img.height * scale;
        }

        // 如果图片太小，设定一个最小尺寸（至少占画布的20%）
        const MIN_SIZE = Math.min(canvasWidth, canvasHeight) * 0.05;
        if (Math.max(newWidth, newHeight) < MIN_SIZE) {
          const minScale = MIN_SIZE / Math.max(newWidth, newHeight);
          newWidth *= minScale;
          newHeight *= minScale;
        }

        addItem({
          type: CanvasItemType.IMAGE,
          x: canvasWidth / 2 - newWidth / 2, // 图片左上角，使图片中心在画布中心
          y: canvasHeight / 2 - newHeight / 2,
          href: location.state.image,
          width: newWidth,
          height: newHeight,
          rotation: 0,
        } as Omit<ImageObject, 'id' | 'layerId'>);
      };
      img.src = location.state.image;
    }
  }, [location.state?.image, canvasWidth, canvasHeight, addItem, processedImage]);

  const updateItem = useCallback((itemId: string, updates: Partial<CanvasItem>) => {
    setItems(prevItems =>
      prevItems.map(p => (p.id === itemId ? { ...p, ...updates } as CanvasItem : p))
    );
  }, []);

  const commitUpdate = useCallback(() => {
    pushHistory(layers, items);
  }, [items, layers, pushHistory]);

  const deleteItem = useCallback((itemId: string) => {
    pushHistory(layers, items);
    setItems(prevItems => prevItems.filter(p => p.id !== itemId));
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, items, layers, pushHistory]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const [lastLayers, lastItems] = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setLayers(lastLayers);
    setItems(lastItems);
    // Ensure activeLayerId is still valid
    if (!lastLayers.find(l => l.id === activeLayerId)) {
      setActiveLayerId(lastLayers[0]?.id || null);
    }
    setSelectedItemId(null);
  }, [history, activeLayerId]);

  // Layer Management - 修改图层管理逻辑
  const addLayer = useCallback(() => {
    // 创建选择图层属性的对话框
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      padding: 20px;
      border-radius: 8px;
      min-width: 400px;
      max-width: 500px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      max-height: 80vh;
      overflow-y: auto;
    `;

    content.innerHTML = `
      <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: bold;">创建新图层</h3>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">图层名称：</label>
        <input id="layerName" type="text" value="图层 ${layers.length + 1}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" />
      </div>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">打印方式：</label>
        <select id="layerType" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
          <option value="scan">扫描</option>
          <option value="engrave">雕刻</option>
        </select>
      </div>
      
      <div id="scanSettings" style="margin-bottom: 15px;">
        <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 500; color: #666;">扫描参数：</h4>
        
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">线密度 (线/毫米)：</label>
          <input id="lineDensity" type="number" min="1" max="100" value="10" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
        </div>
        
        <div style="margin-bottom: 10px;">
          <label style="display: flex; align-items: center; font-size: 13px;">
            <input id="halftone" type="checkbox" style="margin-right: 6px;" />
            启用半色调
          </label>
        </div>
        
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">反向移动偏移：</label>
          <input id="reverseMovementOffset" type="number" min="0" step="0.1" value="0" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
        </div>
      </div>
      
      <div id="commonSettings" style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 500; color: #666;">通用参数：</h4>
        
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">功率 (%)：</label>
          <input id="power" type="number" min="1" max="100" value="50" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
        </div>
        
        <div style="margin-bottom: 10px;">
          <label style="display: flex; align-items: center; font-size: 13px;">
            <input id="isVisible" type="checkbox" checked style="margin-right: 6px;" />
            图层可见
          </label>
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="cancelBtn" style="padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 14px;">取消</button>
        <button id="confirmBtn" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">创建图层</button>
      </div>
    `;

    dialog.appendChild(content);
    document.body.appendChild(dialog);

    const layerNameInput = content.querySelector('#layerName') as HTMLInputElement;
    const layerTypeSelect = content.querySelector('#layerType') as HTMLSelectElement;
    const lineDensityInput = content.querySelector('#lineDensity') as HTMLInputElement;
    const halftoneInput = content.querySelector('#halftone') as HTMLInputElement;
    const reverseMovementOffsetInput = content.querySelector('#reverseMovementOffset') as HTMLInputElement;
    const powerInput = content.querySelector('#power') as HTMLInputElement;
    const isVisibleInput = content.querySelector('#isVisible') as HTMLInputElement;
    const scanSettings = content.querySelector('#scanSettings') as HTMLDivElement;
    const cancelBtn = content.querySelector('#cancelBtn') as HTMLButtonElement;
    const confirmBtn = content.querySelector('#confirmBtn') as HTMLButtonElement;

    // 根据打印方式显示/隐藏扫描特有设置
    const updateSettingsVisibility = () => {
      scanSettings.style.display = layerTypeSelect.value === 'scan' ? 'block' : 'none';
    };

    layerTypeSelect.addEventListener('change', updateSettingsVisibility);
    updateSettingsVisibility(); // 初始化显示状态

    const cleanup = () => {
      document.body.removeChild(dialog);
    };

    cancelBtn.addEventListener('click', cleanup);

    confirmBtn.addEventListener('click', () => {
      const newLayer: Layer = {
        id: `layer-${Date.now()}`,
        name: layerNameInput.value.trim() || `图层 ${layers.length + 1}`,
        isVisible: isVisibleInput.checked,
        printingMethod: layerTypeSelect.value as PrintingMethod,
        power: parseInt(powerInput.value) || 50,
      };

      // 只有扫描图层才添加扫描特有属性
      if (layerTypeSelect.value === 'scan') {
        newLayer.lineDensity = parseInt(lineDensityInput.value) || 10;
        newLayer.halftone = halftoneInput.checked;
        newLayer.reverseMovementOffset = parseFloat(reverseMovementOffsetInput.value) || 0;
      }

      setLayers(prev => [...prev, newLayer]);
      setActiveLayerId(newLayer.id);
      cleanup();
    });

    // 点击对话框外部关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) cleanup();
    });

    // ESC键关闭
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // 焦点到名称输入框
    setTimeout(() => {
      layerNameInput.focus();
      layerNameInput.select();
    }, 100);
  }, [layers, setLayers, setActiveLayerId]);

  const deleteLayer = useCallback((layerId: string) => {
    if (layers.length <= 1) return; // Can't delete the last layer
    pushHistory(layers, items);
    setLayers(prev => prev.filter(l => l.id !== layerId));
    setItems(prev => prev.filter(i => i.layerId !== layerId));
    if (activeLayerId === layerId) {
      setActiveLayerId(layers.find(l => l.id !== layerId)?.id || null);
    }
  }, [layers, items, activeLayerId, pushHistory]);

  const updateLayer = useCallback((layerId: string, updates: Partial<Omit<Layer, 'id'>>) => {
    // 禁止修改图层属性（打印方式），只允许修改名称和可见性
    const allowedUpdates = { ...updates };
    delete allowedUpdates.printingMethod; // 禁止修改打印方式

    pushHistory(layers, items);
    setLayers(prev => prev.map(l => (l.id === layerId ? { ...l, ...allowedUpdates } : l)));
  }, [layers, items, pushHistory]);

  const moveLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    pushHistory(layers, items);
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
  }, [layers, items, pushHistory]);

  // svgson + svg.js递归解析SVG节点
  const parseSvgWithSvgson = useCallback(async (svgContent: string): Promise<CanvasItemData[]> => {
    const svgJson = await parseSvgson(svgContent);
    // 获取viewBox和缩放
    let viewBox: number[] = [0, 0, 0, 0];
    let scaleX = 1, scaleY = 1;
    if (svgJson.attributes.viewBox) {
      viewBox = svgJson.attributes.viewBox.split(/\s+/).map(Number);
    }
    if (svgJson.attributes.width && svgJson.attributes.height && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
      scaleX = parseFloat(svgJson.attributes.width) / viewBox[2];
      scaleY = parseFloat(svgJson.attributes.height) / viewBox[3];
    }

    // 递归处理
    function walk(node: any, parentTransform: DOMMatrix, items: CanvasItemData[] = []) {
      // 跳过无关元素
      const skipTags = ['defs', 'clipPath', 'mask', 'marker', 'symbol', 'use', 'style', 'title'];
      if (skipTags.includes(node.name)) return items;

      // 合并transform
      let currentTransform = parentTransform.translate(0, 0); // 创建副本
      if (node.attributes.transform) {
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const tempG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        tempG.setAttribute('transform', node.attributes.transform);
        tempSvg.appendChild(tempG);
        const ctm = tempG.getCTM();
        if (ctm) { // FIX: Check for null before using
          currentTransform.multiplySelf(ctm);
        }
      }

      // 处理path
      if (node.name === 'path' && node.attributes.d) {
        // 只采样有填充的 path
        //if (!node.attributes.fill || node.attributes.fill === 'none') return items;
        const d = node.attributes.d;
        try {
          const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          tempPath.setAttribute('d', d);
          tempSvg.appendChild(tempPath);
          const totalLength = tempPath.getTotalLength();
          if (totalLength > 0) {
            const sampleCount = Math.max(Math.floor(totalLength), 128);
            const absPoints: { x: number, y: number }[] = [];
            for (let i = 0; i <= sampleCount; i++) {
              const len = (i / sampleCount) * totalLength;
              const pt = tempPath.getPointAtLength(len);
              const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
              absPoints.push({ x: transformedPt.x * scaleX, y: transformedPt.y * scaleY });
            }
            if (absPoints.length >= 2) {
              const minX = Math.min(...absPoints.map(p => p.x));
              const minY = Math.min(...absPoints.map(p => p.y));
              items.push({
                type: CanvasItemType.DRAWING,
                x: minX,
                y: minY,
                points: absPoints.map(p => ({ x: p.x - minX, y: p.y - minY })),
                fillColor: node.attributes.fill,
                strokeWidth: Number(node.attributes['stroke-width']) || 0,
                color: '',
              });
            }
          }
        } catch (e) { }
      }
      // 处理rect
      else if (node.name === 'rect') {
        const x = Number(node.attributes.x);
        const y = Number(node.attributes.y);
        const w = Number(node.attributes.width);
        const h = Number(node.attributes.height);
        const pts = [
          { x: x, y: y },
          { x: x + w, y: y },
          { x: x + w, y: y + h },
          { x: x, y: y + h },
          { x: x, y: y },
        ].map(pt => {
          const tpt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
          return { x: tpt.x * scaleX, y: tpt.y * scaleY };
        });
        const minX = Math.min(...pts.map((p: { x: number, y: number }) => p.x));
        const minY = Math.min(...pts.map((p: { x: number, y: number }) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: { x: number, y: number }) => ({ x: p.x - minX, y: p.y - minY })),
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
      }
      // 处理circle
      else if (node.name === 'circle') {
        const cx = Number(node.attributes.cx);
        const cy = Number(node.attributes.cy);
        const r = Number(node.attributes.r);
        const segs = 64;
        const pts = Array.from({ length: segs + 1 }, (_, i) => {
          const angle = (i / segs) * 2 * Math.PI;
          const pt = new DOMPoint(cx + r * Math.cos(angle), cy + r * Math.sin(angle)).matrixTransform(currentTransform);
          return { x: pt.x * scaleX, y: pt.y * scaleY };
        });
        const minX = Math.min(...pts.map((p: { x: number, y: number }) => p.x));
        const minY = Math.min(...pts.map((p: { x: number, y: number }) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: { x: number, y: number }) => ({ x: p.x - minX, y: p.y - minY })),
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
      }
      // 处理ellipse
      else if (node.name === 'ellipse') {
        const cx = Number(node.attributes.cx);
        const cy = Number(node.attributes.cy);
        const rx = Number(node.attributes.rx);
        const ry = Number(node.attributes.ry);
        const segs = 64;
        const pts = Array.from({ length: segs + 1 }, (_, i) => {
          const angle = (i / segs) * 2 * Math.PI;
          const pt = new DOMPoint(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)).matrixTransform(currentTransform);
          return { x: pt.x * scaleX, y: pt.y * scaleY };
        });
        const minX = Math.min(...pts.map((p: { x: number, y: number }) => p.x));
        const minY = Math.min(...pts.map((p: { x: number, y: number }) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: { x: number, y: number }) => ({ x: p.x - minX, y: p.y - minY })),
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
      }
      // 处理line
      else if (node.name === 'line') {
        const x1 = Number(node.attributes.x1);
        const y1 = Number(node.attributes.y1);
        const x2 = Number(node.attributes.x2);
        const y2 = Number(node.attributes.y2);
        const pts = [
          new DOMPoint(x1, y1).matrixTransform(currentTransform),
          new DOMPoint(x2, y2).matrixTransform(currentTransform),
        ].map(pt => ({ x: pt.x * scaleX, y: pt.y * scaleY }));
        const minX = Math.min(...pts.map((p: { x: number, y: number }) => p.x));
        const minY = Math.min(...pts.map((p: { x: number, y: number }) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: { x: number, y: number }) => ({ x: p.x - minX, y: p.y - minY })),
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
        });
      }
      // 处理polygon
      else if (node.name === 'polygon' && node.attributes.points) {
        const rawPoints = node.attributes.points.trim().split(/\s+/).map((pair: string) => pair.split(',').map(Number));
        const pts = rawPoints.map(([x, y]: [number, number]) => {
          const pt = new DOMPoint(x, y).matrixTransform(currentTransform);
          return { x: pt.x * scaleX, y: pt.y * scaleY };
        });
        if (pts.length >= 2) {
          // polygon自动闭合
          let points = pts;
          if (pts.length < 2 || pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y) {
            points = [...pts, pts[0]];
          }
          const minX = Math.min(...points.map((p: { x: number, y: number }) => p.x));
          const minY = Math.min(...points.map((p: { x: number, y: number }) => p.y));
          items.push({
            type: CanvasItemType.DRAWING,
            x: minX,
            y: minY,
            points: points.map((p: { x: number, y: number }) => ({ x: p.x - minX, y: p.y - minY })),
            color: node.attributes.stroke || node.attributes.fill || '#2563eb',
            strokeWidth: Number(node.attributes['stroke-width']) || 2,
            fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
          });
        }
      }
      // 处理polyline
      else if (node.name === 'polyline' && node.attributes.points) {
        const rawPoints = node.attributes.points.trim().split(/\s+/).map((pair: string) => pair.split(',').map(Number));
        const pts = rawPoints.map(([x, y]: [number, number]) => {
          const pt = new DOMPoint(x, y).matrixTransform(currentTransform);
          return { x: pt.x * scaleX, y: pt.y * scaleY };
        });
        if (pts.length >= 2) {
          const minX = Math.min(...pts.map((p: { x: number, y: number }) => p.x));
          const minY = Math.min(...pts.map((p: { x: number, y: number }) => p.y));
          items.push({
            type: CanvasItemType.DRAWING,
            x: minX,
            y: minY,
            points: pts.map((p: { x: number, y: number }) => ({ x: p.x - minX, y: p.y - minY })),
            color: node.attributes.stroke || node.attributes.fill || '#2563eb',
            strokeWidth: Number(node.attributes['stroke-width']) || 2,
            fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
          });
        }
      }

      // 递归children
      if (node.children && node.children.length > 0) {
        node.children.forEach((child: any) => walk(child, currentTransform, items));
      }

      return items;
    }
    const items: CanvasItemData[] = [];
    const rootTransform = new DOMMatrix();
    walk(svgJson, rootTransform, items);
    // 合并为GROUP（如果有多个子物体）
    if (items.length > 1) {
      const bbox = getGroupBoundingBox(items);
      const groupX = (bbox.minX + bbox.maxX) / 2;
      const groupY = (bbox.minY + bbox.maxY) / 2;
      const groupWidth = bbox.maxX - bbox.minX;
      const groupHeight = bbox.maxY - bbox.minY;
      const children = items.map(item => {
        // 计算子物体全局锚点（中心点或左上角）
        let anchorX = item.x ?? 0;
        let anchorY = item.y ?? 0;
        if ('width' in item && 'height' in item && typeof item.width === 'number' && typeof item.height === 'number') {
          anchorX += item.width / 2;
          anchorY += item.height / 2;
        }
        return {
          ...item,
          x: anchorX - groupX,
          y: anchorY - groupY,
        };
      });
      return [{
        type: 'GROUP',
        x: groupX,
        y: groupY,
        width: groupWidth,
        height: groupHeight,
        rotation: 0,
        children,
      }];
    }
    return items;
  }, []);

  // 处理导入文件
  const handleImportFile = useCallback(async (file: { name: string; ext: string; content: string }) => {
    // SVG 导入
    if (file.ext === 'svg') {
      //return;
      const parsedItems = await parseSvgWithSvgson(file.content);
      //const test = await parseSvgWithSvgson("");
      if (parsedItems.length === 0) {
        alert('SVG未识别到可导入的线条');
      } else {
        // 保存原始SVG内容用于G代码生成
        const originalContent = file.content;

        // 创建SVG图像用于显示
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(file.content);
        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'svg',
              content: originalContent,
              parsedItems: parsedItems,
            }
          };

          addItem(imageData);
        };
        img.src = dataUrl;
      }
      return;
    }
    // DXF 导入
    if (file.ext === 'dxf') {
      //return;
      // try {
      //   const dxf = parseDxf(file.content);
      //   const items: CanvasItemData[] = [];
      //   if (!dxf || !dxf.entities) {
      //     alert('DXF文件内容无效');
      //     return;
      //   }
      //   (dxf.entities as any[]).forEach((ent: any) => {
      //     if (ent.type === 'LINE') {
      //       const minX = Math.min(ent.vertices[0].x, ent.vertices[1].x);
      //       const minY = Math.min(ent.vertices[0].y, ent.vertices[1].y);
      //       items.push({
      //         type: CanvasItemType.DRAWING,
      //         x: minX,
      //         y: minY,
      //         points: [
      //           { x: ent.vertices[0].x - minX, y: ent.vertices[0].y - minY },
      //           { x: ent.vertices[1].x - minX, y: ent.vertices[1].y - minY },
      //         ],
      //         color: '#16a34a',
      //         strokeWidth: 2,
      //       });
      //     } else if (ent.type === 'LWPOLYLINE' && ent.vertices) {
      //       const points = (ent.vertices as any[]).map((v: any) => ({ x: v.x, y: v.y }));
      //       if (points.length < 2) return;
      //       const minX = Math.min(...points.map(p => p.x));
      //       const minY = Math.min(...points.map(p => p.y));
      //       items.push({
      //         type: CanvasItemType.DRAWING,
      //         x: minX,
      //         y: minY,
      //         points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
      //         color: '#16a34a',
      //         strokeWidth: 2,
      //       });
      //     } else if (ent.type === 'CIRCLE') {
      //       const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      //       const points = Array.from({ length: 36 }, (_, i) => {
      //         const angle = (i / 36) * 2 * Math.PI;
      //         return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      //       });
      //       const minX = Math.min(...points.map(p => p.x));
      //       const minY = Math.min(...points.map(p => p.y));
      //       items.push({
      //         type: CanvasItemType.DRAWING,
      //         x: minX,
      //         y: minY,
      //         points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
      //         color: '#16a34a',
      //         strokeWidth: 2,
      //       });
      //     } else if (ent.type === 'ARC') {
      //       const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      //       const start = ent.startAngle * Math.PI / 180;
      //       const end = ent.endAngle * Math.PI / 180;
      //       const segs = 24;
      //       const points = Array.from({ length: segs + 1 }, (_, i) => {
      //         const angle = start + (end - start) * (i / segs);
      //         return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      //       });
      //       const minX = Math.min(...points.map(p => p.x));
      //       const minY = Math.min(...points.map(p => p.y));
      //       items.push({
      //         type: CanvasItemType.DRAWING,
      //         x: minX,
      //         y: minY,
      //         points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
      //         color: '#16a34a',
      //         strokeWidth: 2,
      //       });
      //     } else if (ent.type === 'SPLINE' && ent.controlPoints) {
      //       // 采样样条曲线
      //       const ctrl = ent.controlPoints;
      //       const sampleCount = Math.max(ctrl.length * 8, 64);
      //       const points: { x: number; y: number }[] = [];
      //       for (let i = 0; i <= sampleCount; i++) {
      //         const t = i / sampleCount;
      //         // De Casteljau算法贝塞尔插值
      //         let temp = ctrl.map((p: any) => ({ x: p.x, y: p.y }));
      //         for (let k = 1; k < ctrl.length; k++) {
      //           for (let j = 0; j < ctrl.length - k; j++) {
      //             temp[j] = {
      //               x: temp[j].x * (1 - t) + temp[j + 1].x * t,
      //               y: temp[j].y * (1 - t) + temp[j + 1].y * t,
      //             };
      //           }
      //         }
      //         points.push(temp[0]);
      //       }
      //       if (points.length < 2) return;
      //       const minX = Math.min(...points.map(p => p.x));
      //       const minY = Math.min(...points.map(p => p.y));
      //       items.push({
      //         type: CanvasItemType.DRAWING,
      //         x: minX,
      //         y: minY,
      //         points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
      //         color: '#16a34a',
      //         strokeWidth: 2,
      //       });
      //     }
      //   });
      //   if (items.length === 0) {
      //     alert('DXF未识别到可导入的线条');
      //   } else {
      //     // 保存原始DXF内容用于G代码生成
      //     const originalContent = file.content;

      //     // 创建DXF图像用于显示
      //     const helper = new Helper(file.content);
      //     const generatedSvg = helper.toSVG();
      //     const dataUrl = 'data:image/svg+xml;base64,' + btoa(generatedSvg);
      //     const img = new Image();
      //     img.onload = () => {
      //       // 创建图像对象时包含矢量源数据
      //       const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
      //         type: CanvasItemType.IMAGE,
      //         x: 0,
      //         y: 0,
      //         width: img.width,
      //         height: img.height,
      //         href: dataUrl,
      //         rotation: 0,
      //         vectorSource: {
      //           type: 'dxf',
      //           content: originalContent,
      //           parsedItems: items
      //         }
      //       };

      //       addItem(imageData);
      //     };
      //     img.src = dataUrl;
      //   }
      // } catch (e) {
      //   alert('DXF解析失败');
      // }
      // return;

      // 8.5
      const helper = new Helper(file.content);
      // 保存dxf转换得到的原始SVG内容用于G代码生成
      const originalContent = helper.toSVG();
      const parsedItems = await parseSvgWithSvgson(originalContent);
      if (parsedItems.length === 0) {
        alert('DXF未识别到可导入的线条');
      } else {
        // 创建SVG图像用于显示
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(originalContent);
        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'svg',
              content: originalContent,
              parsedItems: parsedItems
            }
          };

          addItem(imageData);
        };
        img.src = dataUrl;
      }
      return;
    }
    if (file.ext === 'plt') {
      try {
        const hpglCommands = simpleParseHPGL(file.content);

        const polylines: { x: number; y: number }[][] = [];
        let currentPolyline: { x: number; y: number }[] = [];
        let currentPos = { x: 0, y: 0 };
        let isPenDown = false;

        const finishCurrentPolyline = () => {
          if (currentPolyline.length > 1) {
            polylines.push(currentPolyline);
          }
          currentPolyline = [];
        };

        hpglCommands.forEach((cmd: any) => {
          if (!cmd || !cmd.type) return;

          if (cmd.type.startsWith('PU')) {
            finishCurrentPolyline();
            isPenDown = false;
            if (cmd.points && cmd.points.length > 0) {
              cmd.points.forEach((pt: [number, number]) => currentPos = { x: pt[0], y: pt[1] });
            }
          }
          else if (cmd.type.startsWith('PD')) {
            finishCurrentPolyline();
            isPenDown = true;
            currentPolyline.push({ ...currentPos });
            if (cmd.points && cmd.points.length > 0) {
              cmd.points.forEach((pt: [number, number]) => {
                currentPos = { x: pt[0], y: pt[1] };
                currentPolyline.push({ ...currentPos });
              });
            }
          }
          else if (cmd.type.startsWith('PA')) {
            if (cmd.points && cmd.points.length > 0) {
              cmd.points.forEach((pt: [number, number]) => {
                currentPos = { x: pt[0], y: pt[1] };
                if (isPenDown) {
                  currentPolyline.push({ ...currentPos });
                }
              });
            }
          }
        });
        finishCurrentPolyline();

        if (polylines.length === 0) {
          alert('PLT未识别到可导入的线条');
          return;
        }

        const allPoints = polylines.flat();
        const minX = Math.min(...allPoints.map(p => p.x));
        const minY = Math.min(...allPoints.map(p => p.y));
        const maxX = Math.max(...allPoints.map(p => p.x));
        const maxY = Math.max(...allPoints.map(p => p.y));

        const drawingWidth = maxX - minX;
        const drawingHeight = maxY - minY;

        if (drawingWidth === 0 || drawingHeight === 0) {
          alert('图形尺寸无效，无法进行缩放');
          return;
        }

        const CANVAS_WIDTH = 400;
        const CANVAS_HEIGHT = 400;
        const PADDING = 20;

        const targetWidth = CANVAS_WIDTH - PADDING * 2;
        const targetHeight = CANVAS_HEIGHT - PADDING * 2;

        const scaleX = targetWidth / drawingWidth;
        const scaleY = targetHeight / drawingHeight;
        const scaleFactor = Math.min(scaleX, scaleY);

        const scaledDrawingWidth = drawingWidth * scaleFactor;
        const scaledDrawingHeight = drawingHeight * scaleFactor;
        const offsetX = (CANVAS_WIDTH - scaledDrawingWidth) / 2;
        const offsetY = (CANVAS_HEIGHT - scaledDrawingHeight) / 2;

        const finalItems: CanvasItemData[] = polylines.map(polyline => {
          const transformedPoints = polyline.map(p => {
            const translatedX = p.x - minX;
            const translatedY = maxY - p.y;

            return {
              x: translatedX * scaleFactor + offsetX,
              y: translatedY * scaleFactor + offsetY,
            };
          });

          const newMinX = Math.min(...transformedPoints.map(p => p.x));
          const newMinY = Math.min(...transformedPoints.map(p => p.y));

          return {
            type: CanvasItemType.DRAWING,
            x: newMinX,
            y: newMinY,
            points: transformedPoints.map(p => ({
              x: p.x - newMinX,
              y: p.y - newMinY,
            })),
            color: '#eab308',
            strokeWidth: 2,
          };
        });

        // 保存原始PLT内容用于G代码生成
        const originalContent = file.content;

        // 创建PLT图像用于显示（这里简化处理，实际可能需要更复杂的转换）
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(`<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="none"/>
          ${polylines.map(polyline => {
          const points = polyline.map(p => {
            const translatedX = p.x - minX;
            const translatedY = maxY - p.y;
            return `${translatedX * scaleFactor + offsetX},${translatedY * scaleFactor + offsetY}`;
          }).join(' ');
          return `<polyline points="${points}" fill="none" stroke="#eab308" stroke-width="2"/>`;
        }).join('')}
        </svg>`);

        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'plt',
              content: originalContent,
              parsedItems: finalItems
            }
          };

          addItem(imageData);
        };
        img.src = dataUrl;

      } catch (e: any) {
        console.error(e);
        alert(`PLT解析失败: ${e.message}`);
      }
      return;
    }

    alert('不支持的文件类型');
  }, [addItem, parseSvgWithSvgson]);

  // 分图层导出预览和传递到安卓
  const handleNext = async () => {
    setStep(2);
    setSelectedLayerId(layers[0]?.id || null);
    setDrawer(null); // 新增：关闭移动端工具栏
  };

  const selectedItem = items.find(p => p.id === selectedItemId) || null;

  useEffect(() => {
    // 提供给外部调用的图片注入接口
    (window as any).setWhiteboardImage = (base64ata: string) => {
      const img = new Image();
      img.onload = () => {
        addImage(base64ata, img.width, img.height);
      };
      img.src = base64ata;
    };
    // 可选：卸载时清理
    return () => {
      delete (window as any).setWhiteboardImage;
    };
  }, [addImage]);

  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          addImage(e.target?.result as string, img.width, img.height);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
    event.currentTarget.value = '';
  };


  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'svg') {
      reader.onload = async (e) => {
        const svgString = e.target?.result as string;
        if (!svgString) return;



        // 保存原始SVG内容用于G代码生成
        const originalContent = svgo.optimize(svgString, {
           plugins: [
          // 使用 SVGO 的默认插件集，这已经能完成大部分优化工作
          {
            name: 'preset-default',
            params: {
              overrides: {
                // 您的解析器需要 <g> 标签来处理变换，所以不要合并它们
                collapseGroups: false, 
              },
            },
          },
          'removeStyleElement', // 移除 <style> 标签，因为解析器不处理它
          'removeScripts', // 移除 <script> 标签，保证安全
          'cleanupIds', // 清理无用的ID
        ],
        }).data;

        // 解析SVG为矢量对象
        let parsedItems: CanvasItemData[] = [];
        try {
          parsedItems = await parseSvgWithSvgson(originalContent);
        } catch (error) {
          console.warn('SVG解析失败，将使用位图模式:', error);
        }
        console.log(parsedItems);
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(originalContent);
        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'svg',
              content: originalContent,
              parsedItems: parsedItems
            }
          };

          addItem(imageData);
        };
        img.src = dataUrl;
      };
      reader.readAsText(file);
    }
    else if (ext === 'dxf') {
      // 8.5
      reader.onload = async (e) => {
        const dxfString = e.target?.result as string;
        if (!dxfString) return;

        // 保存原始SVG内容用于G代码生成
        const originalContent = svgo.optimize(new Helper(dxfString).toSVG(), {
           plugins: [
          // 使用 SVGO 的默认插件集，这已经能完成大部分优化工作
          {
            name: 'preset-default',
            params: {
              overrides: {
                // 您的解析器需要 <g> 标签来处理变换，所以不要合并它们
                collapseGroups: false, 
              },
            },
          },
          'removeStyleElement', // 移除 <style> 标签，因为解析器不处理它
          'removeScripts', // 移除 <script> 标签，保证安全
          'cleanupIds', // 清理无用的ID
        ],
        }).data;
        //console.log(originalContent);

        // 解析SVG为矢量对象
        let parsedItems: CanvasItemData[] = [];
        try {
          parsedItems = await parseSvgWithSvgson(originalContent);
        } catch (error) {
          console.warn('DXF解析失败，将使用位图模式:', error);
        }
        console.log(parsedItems);
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(originalContent);
        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: 0,
            y: 0,
            width: img.width,
            height: img.height,
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'svg',
              content: originalContent,
              parsedItems: parsedItems
            }
          };

          addItem(imageData);
        };
        img.src = dataUrl;
      };
      reader.readAsText(file);
      //   reader.onload = async (e) => {
      //     try {
      //       const dxfContents = e.target?.result as string;
      //       const originalContent = dxfContents;

      //       // 解析DXF为矢量对象
      //       let parsedItems: CanvasItemData[] = [];
      //       try {
      //         const dxf = parseDxf(dxfContents);
      //         if (dxf && dxf.entities) {
      //           (dxf.entities as any[]).forEach((ent: any) => {
      //             if (ent.type === 'LINE') {
      //               const minX = Math.min(ent.vertices[0].x, ent.vertices[1].x);
      //               const minY = Math.min(ent.vertices[0].y, ent.vertices[1].y);
      //               parsedItems.push({
      //                 type: CanvasItemType.DRAWING,
      //                 x: minX,
      //                 y: minY,
      //                 points: [
      //                   { x: ent.vertices[0].x - minX, y: ent.vertices[0].y - minY },
      //                   { x: ent.vertices[1].x - minX, y: ent.vertices[1].y - minY },
      //                 ],
      //                 color: '#16a34a',
      //                 strokeWidth: 2,
      //               });
      //             } else if (ent.type === 'LWPOLYLINE' && ent.vertices) {
      //               const points = (ent.vertices as any[]).map((v: any) => ({ x: v.x, y: v.y }));
      //               if (points.length < 2) return;
      //               const minX = Math.min(...points.map(p => p.x));
      //               const minY = Math.min(...points.map(p => p.y));
      //               parsedItems.push({
      //                 type: CanvasItemType.DRAWING,
      //                 x: minX,
      //                 y: minY,
      //                 points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
      //                 color: '#16a34a',
      //                 strokeWidth: 2,
      //               });
      //             } else if (ent.type === 'CIRCLE') {
      //               const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
      //               const points = Array.from({ length: 36 }, (_, i) => {
      //                 const angle = (i / 36) * 2 * Math.PI;
      //                 return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      //               });
      //               const minX = Math.min(...points.map(p => p.x));
      //               const minY = Math.min(...points.map(p => p.y));
      //               parsedItems.push({
      //                 type: CanvasItemType.DRAWING,
      //                 x: minX,
      //                 y: minY,
      //                 points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
      //                 color: '#16a34a',
      //                 strokeWidth: 2,
      //               });
      //             }
      //           });
      //         }
      //       } catch (error) {
      //         console.warn('DXF解析失败，将使用位图模式:', error);
      //       }

      //       const helper = new Helper(dxfContents);
      //       const generatedSvg = helper.toSVG();
      //       processSvgString(generatedSvg, (dataUrl, width, height) => {
      //         // 创建图像对象时包含矢量源数据
      //         const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
      //           type: CanvasItemType.IMAGE,
      //           x: 0,
      //           y: 0,
      //           width: width,
      //           height: height,
      //           href: dataUrl,
      //           rotation: 0,
      //           vectorSource: {
      //             type: 'dxf',
      //             content: originalContent,
      //             parsedItems: parsedItems
      //           }
      //         };

      //         addItem(imageData);
      //       });

      //     } catch (err) {
      //       alert("解析 DXF 文件时发生错误。");
      //     }
      //   };
      //   reader.readAsText(file);
    }
    else if (ext === 'plt') {
      reader.onload = async (e) => {
        if (typeof e.target?.result === 'string') {
          const pltContent = e.target.result;
          const originalContent = pltContent;

          // 解析PLT为矢量对象
          let parsedItems: CanvasItemData[] = [];
          try {
            const hpglCommands = simpleParseHPGL(pltContent);
            const polylines: { x: number; y: number }[][] = [];
            let currentPolyline: { x: number; y: number }[] = [];
            let currentPos = { x: 0, y: 0 };
            let isPenDown = false;

            const finishCurrentPolyline = () => {
              if (currentPolyline.length > 1) {
                polylines.push(currentPolyline);
              }
              currentPolyline = [];
            };

            hpglCommands.forEach((cmd: any) => {
              if (!cmd || !cmd.type) return;

              if (cmd.type.startsWith('PU')) {
                finishCurrentPolyline();
                isPenDown = false;
                if (cmd.points && cmd.points.length > 0) {
                  cmd.points.forEach((pt: [number, number]) => currentPos = { x: pt[0], y: pt[1] });
                }
              }
              else if (cmd.type.startsWith('PD')) {
                finishCurrentPolyline();
                isPenDown = true;
                currentPolyline.push({ ...currentPos });
                if (cmd.points && cmd.points.length > 0) {
                  cmd.points.forEach((pt: [number, number]) => {
                    currentPos = { x: pt[0], y: pt[1] };
                    currentPolyline.push({ ...currentPos });
                  });
                }
              }
              else if (cmd.type.startsWith('PA')) {
                if (cmd.points && cmd.points.length > 0) {
                  cmd.points.forEach((pt: [number, number]) => {
                    currentPos = { x: pt[0], y: pt[1] };
                    if (isPenDown) {
                      currentPolyline.push({ ...currentPos });
                    }
                  });
                }
              }
            });
            finishCurrentPolyline();

            if (polylines.length > 0) {
              const allPoints = polylines.flat();
              const minX = Math.min(...allPoints.map(p => p.x));
              const minY = Math.min(...allPoints.map(p => p.y));
              const maxX = Math.max(...allPoints.map(p => p.x));
              const maxY = Math.max(...allPoints.map(p => p.y));

              const drawingWidth = maxX - minX;
              const drawingHeight = maxY - minY;

              if (drawingWidth > 0 && drawingHeight > 0) {
                const CANVAS_WIDTH = 400;
                const CANVAS_HEIGHT = 400;
                const PADDING = 20;

                const targetWidth = CANVAS_WIDTH - PADDING * 2;
                const targetHeight = CANVAS_HEIGHT - PADDING * 2;

                const scaleX = targetWidth / drawingWidth;
                const scaleY = targetHeight / drawingHeight;
                const scaleFactor = Math.min(scaleX, scaleY);

                const scaledDrawingWidth = drawingWidth * scaleFactor;
                const scaledDrawingHeight = drawingHeight * scaleFactor;
                const offsetX = (CANVAS_WIDTH - scaledDrawingWidth) / 2;
                const offsetY = (CANVAS_HEIGHT - scaledDrawingHeight) / 2;

                parsedItems = polylines.map(polyline => {
                  const transformedPoints = polyline.map(p => {
                    const translatedX = p.x - minX;
                    const translatedY = maxY - p.y;

                    return {
                      x: translatedX * scaleFactor + offsetX,
                      y: translatedY * scaleFactor + offsetY,
                    };
                  });

                  const newMinX = Math.min(...transformedPoints.map(p => p.x));
                  const newMinY = Math.min(...transformedPoints.map(p => p.y));

                  return {
                    type: CanvasItemType.DRAWING,
                    x: newMinX,
                    y: newMinY,
                    points: transformedPoints.map(p => ({
                      x: p.x - newMinX,
                      y: p.y - newMinY,
                    })),
                    color: '#eab308',
                    strokeWidth: 2,
                  };
                });
              }
            }
          } catch (error) {
            console.warn('PLT解析失败，将使用位图模式:', error);
          }

          // 使用现有的handleImportFile处理位图显示
          handleImportFile({
            name: file.name,
            ext,
            content: pltContent
          });

          // 注意：这里需要特殊处理，因为handleImportFile会直接添加多个对象
          // 我们需要在最后添加一个包含矢量源的图像对象
          // 这里简化处理，实际可能需要更复杂的逻辑
        }
      };
      reader.readAsText(file);
    }
    else alert('不支持的文件类型');

    event.currentTarget.value = '';
  };

  const processSvgString = (
    svgString: string,
    onComplete: (dataUrl: string, width: number, height: number) => void
  ) => {
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgString);
    const img = new Image();
    img.onload = () => {
      onComplete(dataUrl, img.width, img.height);
    };
    img.onerror = () => {
      alert("无法从 SVG 字符串加载图像。");
    };
    img.src = dataUrl;
  };

  // 生成单个图层的G代码
  const generateSingleLayerGCode = async (layer: Layer, fileName: string) => {
    // 显示生成进度弹窗
    setIsGeneratingGCode(true);
    setGenerationProgress('正在生成G代码...');

    try {
      if (layer.printingMethod === PrintingMethod.SCAN) {
        const layerImageItems = items.filter(item =>
          item.layerId === layer.id && item.type === CanvasItemType.IMAGE
        );

        if (layerImageItems.length === 0) {
          setIsGeneratingGCode(false);
          alert('扫描图层上没有需要处理的图片。');
          return;
        }

        setGenerationProgress('正在生成平台扫描G代码...');

        const settings: GCodeScanSettings = {
          lineDensity: 1 / (layer.lineDensity || 10),
          isHalftone: !!layer.halftone,
          negativeImage: false,
          hFlipped: false,
          vFlipped: false,
          minPower: 0,
          maxPower: 255,
          burnSpeed: 1000,
          travelSpeed: 6000,
          overscanDist: layer.reverseMovementOffset ?? 3,
        };

        const gcode = await generatePlatformScanGCode(
          layer,
          items,
          canvasWidth,
          canvasHeight,
          settings,
          canvasWidth,
          canvasHeight
        );

        setGenerationProgress('正在保存文件...');
        downloadGCode(gcode, `${fileName}_${layer.name.replace(/\s+/g, '_')}.nc`);
        
        // 关闭弹窗
        setIsGeneratingGCode(false);
      } else {
        // 雕刻图层G代码生成
        const layerItems = items.filter(
          item => item.layerId === layer.id
        );

        console.log('雕刻图层中的对象:', layerItems);

        if (layerItems.length === 0) {
          setIsGeneratingGCode(false);
          alert('雕刻图层上没有对象。');
          return;
        }

        setGenerationProgress('正在生成雕刻G代码...');

        // 使用新的直接G代码生成方法
        const engraveSettings = {
          feedRate: 1000,
          travelSpeed: 3000,
          power: layer.power || 50,
          passes: 1,
          flipY: true,              // 启用Y轴反转，适配机器坐标系
          canvasHeight: canvasHeight, // 传入画布高度用于Y轴反转计算
        };

        console.log('G代码生成设置:', engraveSettings);

        // 直接从矢量对象生成G代码
        const { generateEngraveGCode } = await import('./lib/gcode');
        const gcode = await generateEngraveGCode(layer, layerItems, engraveSettings);

        console.log('生成的G代码长度:', gcode.length);
        console.log('G代码预览:', gcode.substring(0, 500));

        if (!gcode || gcode.trim().length === 0) {
          setIsGeneratingGCode(false);
          alert('生成的G代码为空，请检查图层中的对象类型是否支持。');
          return;
        }

        setGenerationProgress('正在保存文件...');
        downloadGCode(gcode, `${fileName}_${layer.name.replace(/\s+/g, '_')}.nc`);
        
        // 关闭弹窗
        setIsGeneratingGCode(false);
      }
    } catch (error) {
      console.error("G代码生成失败:", error);
      setIsGeneratingGCode(false);
      alert(`G代码生成失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 合并所有图层的G代码
  const generateMergedGCode = async (fileName: string) => {
    // 显示生成进度弹窗
    setIsGeneratingGCode(true);
    setGenerationProgress('正在生成合并G代码...');

    try {
      const allGCodeParts: string[] = [];
      let hasValidLayer = false;

      // 添加文件头注释
      allGCodeParts.push(`; 合并G代码文件 - ${fileName}`);
      allGCodeParts.push(`; 生成时间: ${new Date().toLocaleString()}`);
      allGCodeParts.push(`; 画布尺寸: ${canvasWidth}×${canvasHeight}mm`);
      allGCodeParts.push('');

      // 遍历所有图层
      for (const layer of layers) {
        const layerItems = items.filter(item => item.layerId === layer.id);
        
        if (layerItems.length === 0) {
          continue; // 跳过空图层
        }

        hasValidLayer = true;

        // 更新进度信息
        setGenerationProgress(`正在处理图层: ${layer.name}...`);

        // 添加图层分隔注释
        allGCodeParts.push(`; ========================================`);
        allGCodeParts.push(`; 图层: ${layer.name}`);
        allGCodeParts.push(`; 打印方式: ${layer.printingMethod === PrintingMethod.SCAN ? '扫描' : '雕刻'}`);
        allGCodeParts.push(`; ========================================`);

        try {
          if (layer.printingMethod === PrintingMethod.SCAN) {
            const layerImageItems = layerItems.filter(item => item.type === CanvasItemType.IMAGE);
            
            if (layerImageItems.length > 0) {
              const settings: GCodeScanSettings = {
                lineDensity: 1 / (layer.lineDensity || 10),
                isHalftone: !!layer.halftone,
                negativeImage: false,
                hFlipped: false,
                vFlipped: false,
                minPower: 0,
                maxPower: 255,
                burnSpeed: 1000,
                travelSpeed: 6000,
                overscanDist: layer.reverseMovementOffset ?? 3,
              };

              const gcode = await generatePlatformScanGCode(
                layer,
                items,
                canvasWidth,
                canvasHeight,
                settings,
                canvasWidth,
                canvasHeight
              );

              allGCodeParts.push(gcode);
            }
          } else {
            // 雕刻图层
            const engraveSettings = {
              feedRate: 1000,
              travelSpeed: 3000,
              power: layer.power || 50,
              passes: 1,
              flipY: true,
              canvasHeight: canvasHeight,
            };

            const { generateEngraveGCode } = await import('./lib/gcode');
            const gcode = await generateEngraveGCode(layer, layerItems, engraveSettings);

            if (gcode && gcode.trim().length > 0) {
              allGCodeParts.push(gcode);
            }
          }

          // 添加图层结束分隔
          allGCodeParts.push('');
          allGCodeParts.push('; 图层结束');
          allGCodeParts.push('');

        } catch (error) {
          console.error(`图层 ${layer.name} G代码生成失败:`, error);
          allGCodeParts.push(`; 错误: 图层 ${layer.name} G代码生成失败`);
          allGCodeParts.push('');
        }
      }

      if (!hasValidLayer) {
        setIsGeneratingGCode(false);
        alert('没有找到包含对象的图层。');
        return;
      }

      // 添加文件结束注释
      allGCodeParts.push('; ========================================');
      allGCodeParts.push('; 文件结束');
      allGCodeParts.push('; ========================================');

      // 合并所有G代码
      const mergedGCode = allGCodeParts.join('\n');

      setGenerationProgress('正在保存文件...');
      // 下载合并后的文件
      downloadGCode(mergedGCode, `${fileName}.nc`);
      
      // 关闭弹窗
      setIsGeneratingGCode(false);
    } catch (error) {
      console.error("合并G代码生成失败:", error);
      setIsGeneratingGCode(false);
      alert(`合并G代码生成失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 检测当前运行平台
  const detectPlatform = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (window.Android && typeof window.Android.saveBlobFile === 'function') {
      return 'android';
    } else if (window.iOS && typeof window.iOS.saveBlobFile === 'function') {
      return 'ios';
    } else if (/iphone|ipad|ipod/.test(userAgent)) {
      return 'ios_browser';
    } else if (/android/.test(userAgent)) {
      return 'android_browser';
    } else {
      return 'web';
    }
  };

  // 下载G代码文件的辅助函数
  const downloadGCode = (gcode: string, fileName: string) => {
    const platform = detectPlatform();
    
    // 检查是否在原生移动应用环境中
    if (platform === 'android' && window.Android && typeof window.Android.saveBlobFile === 'function') {
      // 在 Android 原生环境中，直接通过 Android 接口保存文件
      try {
        // 将 G-code 字符串转换为 base64
        const base64 = btoa(unescape(encodeURIComponent(gcode)));
        window.Android.saveBlobFile(base64, fileName, 'text/plain');
      } catch (error) {
        console.error('Android保存文件失败:', error);
        // 如果 Android 接口失败，回退到浏览器下载方式
        fallbackDownload(gcode, fileName);
      }
    } else if (platform === 'ios' && window.iOS && typeof window.iOS.saveBlobFile === 'function') {
      // 在 iOS 原生环境中，直接通过 iOS 接口保存文件
      try {
        // 将 G-code 字符串转换为 base64
        const base64 = btoa(unescape(encodeURIComponent(gcode)));
        window.iOS.saveBlobFile(base64, fileName, 'text/plain');
      } catch (error) {
        console.error('iOS保存文件失败:', error);
        // 如果 iOS 接口失败，回退到浏览器下载方式
        fallbackDownload(gcode, fileName);
      }
    } else {
      // 在浏览器环境中，使用传统的 blob URL 方式
      fallbackDownload(gcode, fileName);
    }
  };

  // 浏览器环境下的下载方式（回退方案）
  const fallbackDownload = (gcode: string, fileName: string) => {
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    (window as any).setCanvasSize = (w: number, h: number) => {
      setCanvasWidth(w);
      setCanvasHeight(h);
    };

    (window as any).addImageToCanvas = (href: string, width: number, height: number) => {
      addImage(href, width, height);
    };

    // 检测并设置画布大小 - 支持Android和iOS
    const setPlatformCanvasSize = () => {
      let size: any = null;
      
      // 尝试从Android获取画布大小
      if (window.Android && typeof window.Android.getPlatformSize === 'function') {
        try {
          size = window.Android.getPlatformSize();
        } catch (e) {
          console.error('Android获取画布大小失败:', e);
        }
      }
      
      // 如果Android没有获取到，尝试从iOS获取
      if (!size && window.iOS && typeof window.iOS.getPlatformSize === 'function') {
        try {
          size = window.iOS.getPlatformSize();
        } catch (e) {
          console.error('iOS获取画布大小失败:', e);
        }
      }
      
      // 处理获取到的大小数据
      if (size) {
        let obj: any = size;
        if (typeof size === 'string') {
          try {
            obj = JSON.parse(size);
          } catch (e) {
            obj = null;
          }
        }
        if (obj && typeof obj === 'object' && 'width' in obj && 'height' in obj) {
          setCanvasWidth(Number(obj.width));
          setCanvasHeight(Number(obj.height));
        }
      }
    };
    
    setPlatformCanvasSize();
    return () => {
      delete (window as any).setCanvasSize;
      delete (window as any).addImageToCanvas;
    };
  }, [addImage]);

  return (
    <div className="h-screen w-screen flex flex-row font-sans text-gray-800 bg-gray-100 overflow-hidden" style={{ width: '100vw', height: '100vh', minHeight: '100vh', minWidth: '100vw' }}>
      {/* 页面顶部：下一步、撤销按钮 */}
      {step === 1 && (
        <div className="w-full flex flex-row items-center justify-between px-4 py-2 bg-white border-b border-gray-200 fixed top-0 left-0 z-40 md:static md:justify-end md:py-0 md:px-0">
          <div className="flex flex-row gap-2">
            <button
              className="px-4 py-2 rounded bg-gray-200 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-300"
              onClick={undo}
              disabled={history.length === 0}
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
      )}
      {/* Main Content Area */}
      {step === 1 ? (
        <>
          <div className="flex-1 flex flex-col min-h-0 min-w-0 pt-14 md:pt-0">
            <div className="hidden md:block h-16 bg-white border-b border-gray-200">
              <Toolbar
                onOpenCategoryPicker={setOpenCategory}
                onAddImage={() => { imageInputRef.current?.click(); }}
                activeTool={activeTool}
                onSetTool={setActiveTool}
                onUndo={undo}
                canUndo={history.length > 0}
                onImportFile={handleImportFile}
                onNext={handleNext}
              />
            </div>
            <main className="flex-1 flex flex-col min-h-0 min-w-0 bg-white relative">
              <Canvas
                items={items}
                layers={layers}
                selectedItemId={selectedItemId}
                onSelectItem={setSelectedItemId}
                onUpdateItem={updateItem}
                onAddItem={addItem}
                onCommitUpdate={commitUpdate}
                activeTool={activeTool}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
                setItems={setItems}
                eraserRadius={eraserRadius}
              />
            </main>
            <button
              className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-6 py-2 rounded-full bg-gray-800 text-white text-base shadow-lg md:hidden"
              style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}
              onClick={() => setDrawer('toolbar')}
            >工具栏</button>
          </div>
          <aside className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0 min-w-0 hidden md:flex">
            {selectedItem ? (
              <ParameterEditor
                selectedItem={selectedItem}
                layers={layers}
                onUpdateItem={updateItem}
                onDeleteItem={deleteItem}
                onCommitUpdate={commitUpdate}
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
        </>
      ) : (
        // step === 2: 图层设置界面
        <div className="w-full h-full flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
            <div className="flex items-center">
              <button
                className="mr-4 px-3 py-1 rounded bg-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-300"
                onClick={() => setStep(1)}
              >返回</button>
              <span className="text-lg font-bold">导出预览</span>
            </div>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
              onClick={async () => {
                // 创建文件名输入对话框
                const dialog = document.createElement('div');
                dialog.style.cssText = `
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background: rgba(0, 0, 0, 0.5);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  z-index: 10000;
                `;

                const content = document.createElement('div');
                content.style.cssText = `
                  background: white;
                  padding: 20px;
                  border-radius: 8px;
                  min-width: 400px;
                  max-width: 500px;
                  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                `;

                content.innerHTML = `
                  <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: bold;">生成G代码</h3>
                  
                  <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">文件名：</label>
                    <input id="fileName" type="text" value="激光雕刻项目" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" />
                    <div style="margin-top: 5px; font-size: 12px; color: #666;">文件将以 .nc 格式保存</div>
                  </div>
                  
                  <div style="margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; font-size: 14px;">
                      <input id="mergeAllLayers" type="checkbox" checked style="margin-right: 8px;" />
                      合并所有图层的G代码为一个文件
                    </label>
                  </div>
                  
                  <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="cancelBtn" style="padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 14px;">取消</button>
                    <button id="confirmBtn" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">生成</button>
                  </div>
                `;

                dialog.appendChild(content);
                document.body.appendChild(dialog);

                const fileNameInput = content.querySelector('#fileName') as HTMLInputElement;
                const mergeAllLayersInput = content.querySelector('#mergeAllLayers') as HTMLInputElement;
                const cancelBtn = content.querySelector('#cancelBtn') as HTMLButtonElement;
                const confirmBtn = content.querySelector('#confirmBtn') as HTMLButtonElement;

                const cleanup = () => {
                  document.body.removeChild(dialog);
                };

                cancelBtn.addEventListener('click', cleanup);

                confirmBtn.addEventListener('click', async () => {
                  const fileName = fileNameInput.value.trim() || '激光雕刻项目';
                  const mergeAllLayers = mergeAllLayersInput.checked;
                  
                  cleanup();

                  if (mergeAllLayers) {
                    // 合并所有图层的G代码
                    await generateMergedGCode(fileName);
                  } else {
                    // 只生成选中图层的G代码
                    const layerToExport = layers.find(l => l.id === selectedLayerId);
                    if (!layerToExport) {
                      alert('请先选择一个图层');
                      return;
                    }
                    await generateSingleLayerGCode(layerToExport, fileName);
                  }
                });

                // 点击对话框外部关闭
                dialog.addEventListener('click', (e) => {
                  if (e.target === dialog) cleanup();
                });

                // ESC键关闭
                const handleKeyDown = (e: KeyboardEvent) => {
                  if (e.key === 'Escape') {
                    cleanup();
                    document.removeEventListener('keydown', handleKeyDown);
                  }
                };
                document.addEventListener('keydown', handleKeyDown);

                // 焦点到文件名输入框
                setTimeout(() => {
                  fileNameInput.focus();
                  fileNameInput.select();
                }, 100);
              }}
            >
              生成G代码
            </button>
          </div>
          <div className="flex-1 min-h-0 min-w-0">
            <LayerSettingsPanel
              layers={layers}
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onUpdateLayer={(layerId: string, updates: Partial<Layer>) => {
                setLayers(prev => prev.map(l => l.id === layerId ? { ...l, ...updates } : l));
              }}
              items={items}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
            />
          </div>
        </div>
      )}
      {openCategory && (
        <CategoryPicker
          category={openCategory}
          onAddPart={addPart}
          onClose={() => setOpenCategory(null)}
        />
      )}

      {/* 工具栏抽屉，仅移动端显示 */}
      {drawer === 'toolbar' && (
        <div className="fixed left-0 right-0 bottom-0 z-50 flex justify-center items-end" style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}>
          <div className="bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full">
            <div className="w-full flex justify-between items-center mb-2">
              <span className="font-semibold">工具栏</span>
              <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
            </div>
            <div className="grid grid-cols-3 grid-rows-3 md:grid-cols-3 md:grid-rows-3 gap-3 w-full">
              {/* 第一行：选择、涂鸦、橡皮擦 */}
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${activeTool === ToolType.SELECT
                  ? 'bg-teal-500 text-white'
                  : 'bg-gray-100 text-gray-800'
                  }`}
                onClick={() => setActiveTool(ToolType.SELECT)}
              >
                <img src={SelectIcon} alt="选择" className="w-6 h-6 mb-1" />
                <span className="text-xs">选择</span>
              </button>
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${activeTool === ToolType.PEN
                  ? 'bg-teal-500 text-white'
                  : 'bg-gray-100 text-gray-800'
                  }`}
                onClick={() => setActiveTool(ToolType.PEN)}
              >
                <img src={DoodleIcon} alt="涂鸦" className="w-6 h-6 mb-1" />
                <span className="text-xs">涂鸦</span>
              </button>
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${activeTool === ToolType.ERASER
                  ? 'bg-teal-500 text-white'
                  : 'bg-gray-100 text-gray-800'
                  }`}
                onClick={() => {
                  setActiveTool(ToolType.ERASER);
                  setSelectedItemId(null); // 切换橡皮擦时取消选中
                }}
              >
                <img src={EraserIcon} alt="橡皮擦" className="w-6 h-6 mb-1" />
                <span className="text-xs">橡皮擦</span>
              </button>
              {/* 第二行、第三行保持原有按钮顺序即可 */}
              {/* 属性按钮 */}
              <button
                className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${!selectedItem
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                onClick={() => setDrawer('property')}
                disabled={!selectedItem}
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
              {/* 基础形状按钮 */}
              <div className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800" onClick={() => {
                setOpenCategory('BASIC_SHAPES');
                setDrawer(null); // 关闭工具栏抽屉
              }} style={{ cursor: 'pointer' }}>
                <img src={ShapeIcon} alt="形状" className="w-6 h-6 mb-1" />
                <span className="text-xs">形状</span>
              </div>
              {/* 零件库按钮 */}
              <div className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800" onClick={() => {
                setOpenCategory('PART_LIBRARY');
                setDrawer(null); // 关闭工具栏抽屉
              }} style={{ cursor: 'pointer' }}>
                <img src={PartLibraryIcon} alt="零件库" className="w-6 h-6 mb-1" />
                <span className="text-xs">零件库</span>
              </div>
              {/* 图片按钮（新版：按钮和input合并，input只覆盖按钮区域） */}
              <div style={{ position: 'relative', width: '100%' }}>
                <button className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800">
                  <img src={ImageIcon} alt="图片" className="w-6 h-6 mb-1" />
                  <span className="text-xs">图片</span>
                </button>
                <input
                  type="file"
                  accept="image/*"
                  style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0, zIndex: 10, cursor: 'pointer' }}
                  onChange={handleImageUpload}
                />
              </div>
              {/* 导入按钮（新版：按钮和input合并，input只覆盖按钮区域） */}
              <div style={{ position: 'relative', width: '100%' }}>
                <button className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800">
                  <img src={ImportIcon} alt="导入" className="w-6 h-6 mb-1" />
                  <span className="text-xs">导入</span>
                </button>
                <input
                  type="file"
                  accept=".dxf,.svg,.plt"
                  style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0, zIndex: 10, cursor: 'pointer' }}
                  onChange={handleImport}
                />
              </div>
            </div>
            {/* 橡皮擦半径调节，仅橡皮擦激活时显示 */}
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
            {/* 隐藏的文件选择input */}
            <input
              type="file"
              ref={imageInputRef}
              className="hidden"
              accept="image/*"
              onChange={e => { handleImageUpload(e); }}
            />
            <input
              type="file"
              ref={importInputRef}
              className="hidden"
              accept=".dxf,.svg,.plt"
              onChange={handleImport}
            />
          </div>
        </div>
      )}

      {/* 移动端底部抽屉：属性/图层 */}
      {drawer === 'property' && selectedItem && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full"
          style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}
        >
          <div className="w-full flex justify-between items-center mb-2">
            <span className="font-semibold">属性编辑</span>
            <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
          </div>
          <div className="w-full overflow-y-auto" style={{ maxHeight: '50vh' }}>
            <ParameterEditor
              selectedItem={selectedItem}
              layers={layers}
              onUpdateItem={updateItem}
              onDeleteItem={deleteItem}
              onCommitUpdate={commitUpdate}
            />
          </div>
        </div>
      )}
      {drawer === 'layer' && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full"
          style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}
        >
          <div className="w-full flex justify-between items-center mb-2">
            <span className="font-semibold">图层管理</span>
            <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
          </div>
          <div className="w-full overflow-y-auto" style={{ maxHeight: '50vh' }}>
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

      {/* G代码生成进度弹窗 */}
      {isGeneratingGCode && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl pointer-events-auto">
            <div className="flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
            </div>
            <h3 className="text-lg font-semibold text-center mb-2">正在生成G代码</h3>
            <p className="text-gray-600 text-center text-sm">{generationProgress}</p>
          </div>
        </div>
      )}
    </div>
  );


};

// 声明window.Android和window.iOS类型
declare global {
  interface Window {
    Android?: {
      onNextStep?: (data: string) => void;
      saveTempFile?: (base64: string, fileName: string) => string; // 新增保存临时文件接口
      getPlatformSize?: () => string | { width: number | string; height: number | string }; // 新增获取画布大小接口
      saveBlobFile?: (base64: string, fileName: string, mimeType: string) => void; // 新增保存文件接口
    };
    iOS?: {
      onNextStep?: (data: string) => void;
      saveTempFile?: (base64: string, fileName: string) => string; // iOS保存临时文件接口
      getPlatformSize?: () => string | { width: number | string; height: number | string }; // iOS获取画布大小接口
      saveBlobFile?: (base64: string, fileName: string, mimeType: string) => void; // iOS保存文件接口
    };
  }
}

export default WhiteboardPage;