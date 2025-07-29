import React, { useState, useCallback, useEffect } from 'react';
import type { CanvasItem, CanvasItemData, PartType, Layer, Part, ImageObject } from './types';
import { CanvasItemType, ToolType, PrintingMethod } from './types';
import { PART_LIBRARY, BASIC_SHAPES } from './constants';

import Canvas from './components/Canvas';
import ParameterEditor from './components/ParameterEditor';
import CategoryPicker from './components/CategoryPicker';
import LayerPanel from './components/LayerPanel';
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
import HomeIcon from './assets/回零.svg';

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

const MAX_HISTORY = 50;
const ALL_PARTS = [...BASIC_SHAPES, ...PART_LIBRARY];

// 1. 定义AppProps接口，支持canvasWidth和canvasHeight
interface AppProps {
  canvasWidth?: number;
  canvasHeight?: number;
}

// 2. App组件支持props传入宽高，默认500
const App: React.FC<AppProps> = () => {
  const firstLayerId = `layer_${Date.now()}`;
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

  // 初始化activeLayerId
  useEffect(() => {
    if (!activeLayerId && layers.length > 0) {
      setActiveLayerId(layers[0].id);
    }
  }, [layers, activeLayerId]);

  // 根据对象类型确定图层类型
  const getPrintingMethodByItemType = useCallback((itemType: CanvasItemType | 'GROUP') => {
    // 矢量图类型（包括形状、零件、涂鸦、文本）
    const vectorTypes = [
      CanvasItemType.RECTANGLE,
      CanvasItemType.CIRCLE,
      CanvasItemType.LINE,
      CanvasItemType.POLYLINE,
      CanvasItemType.ARC,
      CanvasItemType.SECTOR,
      CanvasItemType.EQUILATERAL_TRIANGLE,
      CanvasItemType.ISOSCELES_RIGHT_TRIANGLE,
      CanvasItemType.L_BRACKET,
      CanvasItemType.U_CHANNEL,
      CanvasItemType.FLANGE,
      CanvasItemType.TORUS,
      CanvasItemType.CIRCLE_WITH_HOLES,
      CanvasItemType.RECTANGLE_WITH_HOLES,
      CanvasItemType.DRAWING,
      CanvasItemType.TEXT,
    ];
    
    // 位图类型
    const bitmapTypes = [
      CanvasItemType.IMAGE,
    ];
    
    // GROUP类型默认为矢量（雕刻）
    if (itemType === 'GROUP') {
      return PrintingMethod.ENGRAVE;
    }
    
    if (vectorTypes.includes(itemType as CanvasItemType)) {
      return PrintingMethod.ENGRAVE; // 矢量默认使用雕刻图层
    } else if (bitmapTypes.includes(itemType as CanvasItemType)) {
      return PrintingMethod.SCAN; // 位图只能使用扫描图层
    }
    
    // 默认返回雕刻（矢量）
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
    const MAX_IMAGE_WIDTH = 400;
    const MAX_IMAGE_HEIGHT = 400;
    let newWidth = width;
    let newHeight = height;
    const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1);
    if (scale < 1) {
      newWidth = width * scale;
      newHeight = height * scale;
    }
    addItem({
      type: CanvasItemType.IMAGE,
      x: 0, // 设置为原点位置
      y: 0, // 设置为原点位置
      href,
      width: newWidth,
      height: newHeight,
      rotation: 0,
    } as Omit<ImageObject, 'id' | 'layerId'>);
  }, [addItem]);

  const updateItem = useCallback((itemId: string, updates: Partial<CanvasItem>) => {
    // 如果尝试修改图层，需要验证图层类型是否匹配
    if ('layerId' in updates && updates.layerId) {
      const item = items.find(i => i.id === itemId);
      if (item) {
        const targetLayer = layers.find(l => l.id === updates.layerId);
        
        if (targetLayer) {
          // 位图对象只能使用扫描图层
          if (item.type === CanvasItemType.IMAGE && targetLayer.printingMethod === PrintingMethod.ENGRAVE) {
            console.warn('位图对象只能使用扫描图层');
            return; // 阻止位图移动到雕刻图层
          }
          
          // 矢量对象可以使用雕刻或扫描图层（允许灵活分配）
        }
      }
    }
    
    setItems(prevItems =>
      prevItems.map(p => (p.id === itemId ? { ...p, ...updates } as CanvasItem : p))
    );
  }, [items, layers]);

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
      min-width: 300px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;
    
    content.innerHTML = `
      <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold;">选择图层属性</h3>
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-size: 14px;">图层类型：</label>
        <select id="layerType" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
          <option value="scan">扫描图层</option>
          <option value="engrave">雕刻图层</option>
        </select>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">取消</button>
        <button id="confirmBtn" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">确定</button>
      </div>
    `;
    
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    const select = content.querySelector('#layerType') as HTMLSelectElement;
    const cancelBtn = content.querySelector('#cancelBtn') as HTMLButtonElement;
    const confirmBtn = content.querySelector('#confirmBtn') as HTMLButtonElement;
    
    const cleanup = () => {
      document.body.removeChild(dialog);
    };
    
    cancelBtn.onclick = cleanup;
    confirmBtn.onclick = () => {
      const selectedMethod = select.value as PrintingMethod;
      const layerName = selectedMethod === PrintingMethod.SCAN 
        ? `扫描图层 ${layers.filter(l => l.printingMethod === PrintingMethod.SCAN).length + 1}`
        : `雕刻图层 ${layers.filter(l => l.printingMethod === PrintingMethod.ENGRAVE).length + 1}`;
      
      const newLayer: Layer = { 
        id: `layer_${Date.now()}`, 
        name: layerName, 
        isVisible: true, 
        printingMethod: selectedMethod
      };
      pushHistory(layers, items);
      setLayers(prev => [newLayer, ...prev]);
      setActiveLayerId(newLayer.id);
      cleanup();
    };
    
    // 点击背景关闭
    dialog.onclick = (e) => {
      if (e.target === dialog) cleanup();
    };
  }, [layers, items, pushHistory]);

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
        if (!node.attributes.fill || node.attributes.fill === 'none') return items;
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
      const parsedItems = await parseSvgWithSvgson(file.content);
      if (parsedItems.length === 0) {
        alert('SVG未识别到可导入的线条');
      } else {
        addItems(parsedItems);
      }
      return;
    }
    // DXF 导入
    if (file.ext === 'dxf') {
      try {
        const dxf = parseDxf(file.content);
        const items: CanvasItemData[] = [];
        if (!dxf || !dxf.entities) {
          alert('DXF文件内容无效');
          return;
        }
        (dxf.entities as any[]).forEach((ent: any) => {
          if (ent.type === 'LINE') {
            const minX = Math.min(ent.vertices[0].x, ent.vertices[1].x);
            const minY = Math.min(ent.vertices[0].y, ent.vertices[1].y);
            items.push({
              type: CanvasItemType.DRAWING,
              x: minX,
              y: minY,
              points: [
                { x: ent.vertices[0].x - minX, y: ent.vertices[0].y - minY },
                { x: ent.vertices[1].x - minX, y: ent.vertices[1].y - minY },
              ],
              color: '#16a34a',
              strokeWidth: 2,
            });
          } else if (ent.type === 'LWPOLYLINE' && ent.vertices) {
            const points = (ent.vertices as any[]).map((v: any) => ({ x: v.x, y: v.y }));
            if (points.length < 2) return;
            const minX = Math.min(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            items.push({
              type: CanvasItemType.DRAWING,
              x: minX,
              y: minY,
              points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
              color: '#16a34a',
              strokeWidth: 2,
            });
          } else if (ent.type === 'CIRCLE') {
            const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
            const points = Array.from({ length: 36 }, (_, i) => {
              const angle = (i / 36) * 2 * Math.PI;
              return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
            });
            const minX = Math.min(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            items.push({
              type: CanvasItemType.DRAWING,
              x: minX,
              y: minY,
              points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
              color: '#16a34a',
              strokeWidth: 2,
            });
          } else if (ent.type === 'ARC') {
            const cx = ent.center.x, cy = ent.center.y, r = ent.radius;
            const start = ent.startAngle * Math.PI / 180;
            const end = ent.endAngle * Math.PI / 180;
            const segs = 24;
            const points = Array.from({ length: segs + 1 }, (_, i) => {
              const angle = start + (end - start) * (i / segs);
              return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
            });
            const minX = Math.min(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            items.push({
              type: CanvasItemType.DRAWING,
              x: minX,
              y: minY,
              points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
              color: '#16a34a',
              strokeWidth: 2,
            });
          } else if (ent.type === 'SPLINE' && ent.controlPoints) {
            // 采样样条曲线
            const ctrl = ent.controlPoints;
            const sampleCount = Math.max(ctrl.length * 8, 64);
            const points: { x: number; y: number }[] = [];
            for (let i = 0; i <= sampleCount; i++) {
              const t = i / sampleCount;
              // De Casteljau算法贝塞尔插值
              let temp = ctrl.map((p: any) => ({ x: p.x, y: p.y }));
              for (let k = 1; k < ctrl.length; k++) {
                for (let j = 0; j < ctrl.length - k; j++) {
                  temp[j] = {
                    x: temp[j].x * (1 - t) + temp[j + 1].x * t,
                    y: temp[j].y * (1 - t) + temp[j + 1].y * t,
                  };
                }
              }
              points.push(temp[0]);
            }
            if (points.length < 2) return;
            const minX = Math.min(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            items.push({
              type: CanvasItemType.DRAWING,
              x: minX,
              y: minY,
              points: points.map(p => ({ x: p.x - minX, y: p.y - minY })),
              color: '#16a34a',
              strokeWidth: 2,
            });
          }
        });
        if (items.length === 0) {
          alert('DXF未识别到可导入的线条');
        } else {
          addItems(items);
        }
      } catch (e) {
        alert('DXF解析失败');
      }
      return;
    }
    // // PLT(HPGL) 导入
    // if (file.ext === 'plt') {
    //   try {
    //     alert('导入中');
    //     const hpglData = simpleParseHPGL(file.content);
    //     const items: CanvasItemData[] = [];
    //     let cur: { x: number; y: number } = { x: 0, y: 0 };
    //     let drawing: { x: number; y: number }[] = [];
    //     hpglData.forEach((cmd: any) => {
    //       if (cmd.type === 'PU') {
    //         if (drawing.length > 1) {
    //           const minX = Math.min(...drawing.map((p: any) => p.x));
    //           const minY = Math.min(...drawing.map((p: any) => p.y));
    //           items.push({
    //             type: CanvasItemType.DRAWING,
    //             x: minX,
    //             y: minY,
    //             points: drawing.map((p: any) => ({ x: p.x - minX, y: p.y - minY })),
    //             color: '#eab308',
    //             strokeWidth: 2,
    //           });
    //         }
    //         drawing = [];
    //         if (cmd.points && cmd.points.length > 0) {
    //           cur = { x: cmd.points[0][0], y: cmd.points[0][1] };
    //         }
    //       } else if (cmd.type === 'PD' || cmd.type === 'PA') {
    //         if (cmd.points) {
    //           cmd.points.forEach((pt: [number, number]) => {
    //             cur = { x: pt[0], y: pt[1] };
    //             drawing.push({ ...cur });
    //           });
    //         }
    //       }
    //     });
    //     if (drawing.length > 1) {
    //       const minX = Math.min(...drawing.map((p: any) => p.x));
    //       const minY = Math.min(...drawing.map((p: any) => p.y));
    //       items.push({
    //         type: CanvasItemType.DRAWING,
    //         x: minX,
    //         y: minY,
    //         points: drawing.map((p: any) => ({ x: p.x - minX, y: p.y - minY })),
    //         color: '#eab308',
    //         strokeWidth: 2,
    //       });
    //     }
    //     if (items.length === 0) {
    //       alert('PLT未识别到可导入的线条');
    //     } else {
    //       addItems(items);
    //     }
    //   } catch (e) {
    //     alert('PLT解析失败');
    //   }
    //   return;
    // }
    if (file.ext === 'plt') {
      try {
        //alert('导入中');
        const hpglCommands = simpleParseHPGL(file.content);

        // ==========================================================
        // 步骤 1: 将 HPGL 指令解析为原始坐标的多段线
        // ==========================================================
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

        // ==========================================================
        // 步骤 2: 坐标缩放适配 (Fit to View)
        // ==========================================================

        // 2.1 找到所有点的总边界框
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

        // 2.2 定义你的画布尺寸，并留出一些边距
        const CANVAS_WIDTH = 400; // <-- 请替换为您的画布实际宽度
        const CANVAS_HEIGHT = 400; // <-- 请替换为您的画布实际高度
        const PADDING = 20; // 在画布周围留出20像素的边距

        const targetWidth = CANVAS_WIDTH - PADDING * 2;
        const targetHeight = CANVAS_HEIGHT - PADDING * 2;

        // 2.3 计算缩放比例，必须取较小值以保持长宽比
        const scaleX = targetWidth / drawingWidth;
        const scaleY = targetHeight / drawingHeight;
        const scaleFactor = Math.min(scaleX, scaleY);

        // (可选) 计算居中所需的偏移量
        const scaledDrawingWidth = drawingWidth * scaleFactor;
        const scaledDrawingHeight = drawingHeight * scaleFactor;
        const offsetX = (CANVAS_WIDTH - scaledDrawingWidth) / 2;
        const offsetY = (CANVAS_HEIGHT - scaledDrawingHeight) / 2;


        // ==========================================================
        // 步骤 3: 使用新的坐标创建最终的画布项目
        // ==========================================================
        const finalItems: CanvasItemData[] = polylines.map(polyline => {
          // 3.1 转换这条多段线上的每一个点
          const transformedPoints = polyline.map(p => {
            const translatedX = p.x - minX;
            // 注意：HPGL的Y轴向上，Canvas的Y轴向下，所以需要翻转
            const translatedY = maxY - p.y;

            return {
              x: translatedX * scaleFactor + offsetX,
              y: translatedY * scaleFactor + offsetY,
            };
          });

          // 3.2 计算转换后这条线的新的边界框左上角坐标
          const newMinX = Math.min(...transformedPoints.map(p => p.x));
          const newMinY = Math.min(...transformedPoints.map(p => p.y));

          return {
            type: CanvasItemType.DRAWING,
            x: newMinX, // 定位点
            y: newMinY, // 定位点
            // 内部点的坐标是相对于这个新的定位点的
            points: transformedPoints.map(p => ({
              x: p.x - newMinX,
              y: p.y - newMinY,
            })),
            color: '#eab308',
            strokeWidth: 2,
          };
        });

        addItems(finalItems);

      } catch (e: any) {
        console.error(e);
        alert(`PLT解析失败: ${e.message}`);
      }
      return;
    }

    alert('不支持的文件类型');
  }, [addItems, parseSvgWithSvgson]);

  // 分图层导出预览和传递到安卓
  const handleNext = async () => {
    setStep(2);
    setSelectedLayerId(layers[0]?.id || null);
    setDrawer(null); // 新增：关闭移动端工具栏
  };

  const selectedItem = items.find(p => p.id === selectedItemId) || null;

  // 文件处理相关的refs和函数
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
      reader.onload = (e) => {
        const svgString = e.target?.result as string;
        if (!svgString) return;
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgString);
        const img = new Image();
        img.onload = () => {
          addImage(dataUrl, img.width, img.height);
        };
        img.src = dataUrl;
      };
      reader.readAsText(file);
    }
    else if (ext === 'dxf') {
      reader.onload = (e) => {
        try {
          const dxfContents = e.target?.result as string;
          const helper = new Helper(dxfContents);
          const generatedSvg = helper.toSVG();
          processSvgString(generatedSvg, addImage);
        } catch (err) {
          alert("解析 DXF 文件时发生错误。");
        }
      };
      reader.readAsText(file);
    }
    else if (ext === 'plt') {
      reader.onload = (e) => {
        if (typeof e.target?.result === 'string') {
          handleImportFile({
            name: file.name,
            ext,
            content: e.target.result
          });
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

  useEffect(() => {
    // 移动端性能优化配置
    const optimizeMobilePerformance = () => {
      // 禁用移动端双击缩放
      document.addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) {
          e.preventDefault();
        }
      }, { passive: false });

      // 优化移动端滚动性能
      document.body.style.overscrollBehavior = 'none';
      document.body.style.touchAction = 'none';
      
      // 禁用文本选择（画布操作时）
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    };

    optimizeMobilePerformance();

    // 提供给外部调用的图片注入接口
    (window as any).setWhiteboardImage = (base64ata: string) => {
      const img = new Image();
      img.onload = () => {
        addImage(base64ata, img.width, img.height);
      };
      img.src = base64ata;
    };

    (window as any).setCanvasSize = (w: number, h: number) => {
      setCanvasWidth(w);
      setCanvasHeight(h);
    };

    (window as any).addImageToCanvas = (href: string, width: number, height: number) => {
      addImage(href, width, height);
    };

    // 主动向安卓端请求画布大小
    if (window.Android && typeof window.Android.getPlatformSize === 'function') {
      try {
        const size = window.Android.getPlatformSize();
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
      } catch (e) {
        // 忽略异常，保持默认
      }
    }
    
    return () => {
      delete (window as any).setWhiteboardImage;
      delete (window as any).setCanvasSize;
      delete (window as any).addImageToCanvas;
    };
  }, [addImage]);
  
  return (
    <div className="h-screen w-screen flex flex-col font-sans text-gray-800 bg-gray-100 overflow-hidden" style={{ width: '100vw', height: '100vh', minHeight: '100vh', minWidth: '100vw' }}>
      {/* 页面顶部：下一步、撤销按钮 */}
      {step === 1 && (
        <div className="w-full flex flex-row items-center justify-between px-4 py-2 bg-white border-b border-gray-200 fixed top-0 left-0 z-40">
          <div className="flex flex-row gap-2">
            <button
              className="px-4 py-2 rounded bg-gray-200 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-300"
              onClick={undo}
              disabled={history.length === 0}
            >撤销</button>
          </div>
          {/* 画布大小显示在中间 */}
          <div className="flex-1 flex justify-center items-center gap-2">
            <span style={{ color: '#888', fontSize: 13 }}>
              画布大小：{canvasWidth} × {canvasHeight}
            </span>
            <button 
              onClick={() => {
                const debugInfo = {
                  画布状态: {
                    设置宽度: canvasWidth,
                    设置高度: canvasHeight,
                  },
                  当前数据: {
                    图层数量: layers.length,
                    元素总数: items.length,
                    选中元素: selectedItemId,
                  },
                  viewBox状态: '需要在Canvas组件中检查',
                  说明: 'SVG预览可能显示200x200但实际坐标系是400x400'
                };
                console.log('🔍 画布调试信息:', debugInfo);
                alert(`调试信息已输出到控制台\n\n当前画布: ${canvasWidth}×${canvasHeight}\n图层: ${layers.length}个\n元素: ${items.length}个\n\n请检查控制台获取详细信息`);
              }}
              className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded"
              style={{ fontSize: 10 }}
            >
              调试
            </button>
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
        <div className="flex-1 flex flex-col min-h-0 min-w-0 pt-14">
          {/* 主画布区域 */}
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
          
          {/* 底部工具栏触发按钮 */}
          <button
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-6 py-2 rounded-full bg-gray-800 text-white text-base shadow-lg"
            style={{ paddingBottom: 'env(safe-area-inset-bottom,16px)' }}
            onClick={() => setDrawer('toolbar')}
          >工具栏</button>
        </div>
      ) : (
        // step === 2: 图层设置界面
        <div className="w-full h-full flex flex-col">
          {/* 顶部返回栏 */}
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
              onClick={() => {
                // G代码生成：确保传递正确的画布尺寸
                const gCodeData = {
                  layers,
                  items,
                  canvasWidth,
                  canvasHeight,
                  // 添加画布信息用于调试
                  canvasInfo: {
                    width: canvasWidth,
                    height: canvasHeight,
                    totalItems: items.length,
                    timestamp: new Date().toISOString()
                  }
                };
                
                console.log('生成G代码 - 画布尺寸确认:', {
                  设置的画布尺寸: `${canvasWidth}x${canvasHeight}`,
                  实际传递的宽度: canvasWidth,
                  实际传递的高度: canvasHeight,
                  完整数据: gCodeData
                });
                
                // 如果有安卓接口，也传递画布尺寸
                if (window.Android && typeof window.Android.onNextStep === 'function') {
                  window.Android.onNextStep(JSON.stringify(gCodeData));
                } else {
                  // 开发环境提示
                  alert(`准备生成G代码\n画布尺寸: ${canvasWidth}×${canvasHeight}\n图层数: ${layers.length}\n元素数: ${items.length}`);
                }
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
              onUpdateLayer={(layerId, updates) => {
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
            <div className="grid grid-cols-3 gap-4 w-full">
              {/* 第一行：选择、涂鸦、橡皮擦 */}
              <button
                className={`flex flex-col items-center justify-center w-full h-16 rounded-xl transition-all duration-200 active:scale-95 ${activeTool === ToolType.SELECT
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'bg-gray-100 text-gray-800 active:bg-gray-200'
                  }`}
                onClick={() => setActiveTool(ToolType.SELECT)}
              >
                <img src={SelectIcon} alt="选择" className="w-6 h-6 mb-1" />
                <span className="text-xs">选择</span>
              </button>
              <button
                className={`flex flex-col items-center justify-center w-full h-16 rounded-xl transition-all duration-200 active:scale-95 ${activeTool === ToolType.PEN
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'bg-gray-100 text-gray-800 active:bg-gray-200'
                  }`}
                onClick={() => setActiveTool(ToolType.PEN)}
              >
                <img src={DoodleIcon} alt="涂鸦" className="w-6 h-6 mb-1" />
                <span className="text-xs">涂鸦</span>
              </button>
              <button
                className={`flex flex-col items-center justify-center w-full h-16 rounded-xl transition-all duration-200 active:scale-95 ${activeTool === ToolType.ERASER
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'bg-gray-100 text-gray-800 active:bg-gray-200'
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
                className={`flex flex-col items-center justify-center w-full h-16 rounded-xl transition-all duration-200 ${!selectedItem
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-50'
                  : 'bg-gray-100 text-gray-800 active:bg-gray-200 active:scale-95'
                  }`}
                onClick={() => setDrawer('property')}
                disabled={!selectedItem}
              >
                <img src={PropertyIcon} alt="属性" className="w-6 h-6 mb-1" />
                <span className="text-xs">属性</span>
              </button>
              <button
                className="flex flex-col items-center justify-center w-full h-16 bg-gray-100 rounded-xl active:bg-gray-200 active:scale-95 transition-all duration-200 text-gray-800"
                onClick={() => setDrawer('layer')}
              >
                <img src={LayerIcon} alt="图层" className="w-6 h-6 mb-1" />
                <span className="text-xs">图层</span>
              </button>
              {/* 基础形状按钮 */}
              <div className="flex flex-col items-center justify-center w-full h-16 bg-gray-100 rounded-xl active:bg-gray-200 active:scale-95 transition-all duration-200 text-gray-800" onClick={() => {
                setOpenCategory('BASIC_SHAPES');
                setDrawer(null); // 关闭工具栏抽屉
              }} style={{ cursor: 'pointer' }}>
                <img src={ShapeIcon} alt="形状" className="w-6 h-6 mb-1" />
                <span className="text-xs">形状</span>
              </div>
              {/* 零件库按钮 */}
              <div className="flex flex-col items-center justify-center w-full h-16 bg-gray-100 rounded-xl active:bg-gray-200 active:scale-95 transition-all duration-200 text-gray-800" onClick={() => {
                setOpenCategory('PART_LIBRARY');
                setDrawer(null); // 关闭工具栏抽屉
              }} style={{ cursor: 'pointer' }}>
                <img src={PartLibraryIcon} alt="零件库" className="w-6 h-6 mb-1" />
                <span className="text-xs">零件库</span>
              </div>
              {/* 图片按钮（新版：按钮和input合并，input只覆盖按钮区域） */}
              <div style={{ position: 'relative', width: '100%' }}>
                <button className="flex flex-col items-center justify-center w-full h-16 bg-gray-100 rounded-xl active:bg-gray-200 active:scale-95 transition-all duration-200 text-gray-800">
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
                <button className="flex flex-col items-center justify-center w-full h-16 bg-gray-100 rounded-xl active:bg-gray-200 active:scale-95 transition-all duration-200 text-gray-800">
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
    </div>
  );

  
};

// 声明window.Android类型
declare global {
  interface Window {
    Android?: {
      onNextStep?: (data: string) => void;
      saveTempFile?: (base64: string, fileName: string) => string; // 新增保存临时文件接口
      getPlatformSize?: () => string | { width: number | string; height: number | string }; // 新增获取画布大小接口
    };
  }
}

export default App;