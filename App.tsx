import React, { useState, useCallback, useEffect } from 'react';
import type { CanvasItem, CanvasItemData, PartType, Layer, Part, ImageObject } from './types';
import { CanvasItemType, ToolType, PrintingMethod } from './types';
import { PART_LIBRARY, BASIC_SHAPES } from './constants';
import Toolbar from './components/Toolbar';
import Canvas from './components/Canvas';
import ParameterEditor from './components/ParameterEditor';
import CategoryPicker from './components/CategoryPicker';
import LayerPanel from './components/LayerPanel';
// @ts-ignore
import { parseString as parseDxf } from 'dxf';
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
function getGroupBoundingBox(items: CanvasItemData[]): {minX: number, minY: number, maxX: number, maxY: number} {
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
  return {minX, minY, maxX, maxY};
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
  const [layers, setLayers] = useState<Layer[]>([{ id: firstLayerId, name: '图层 1', isVisible: true, printingMethod: PrintingMethod.SCAN }]);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [history, setHistory] = useState<[Layer[], CanvasItem[]][]>([]);
  
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(firstLayerId);
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'property' | 'layer' | 'toolbar' | null>(null);
  const [eraserRadius, setEraserRadius] = useState(16);

  const [canvasWidth, setCanvasWidth] = useState(400);
  const [canvasHeight, setCanvasHeight] = useState(400);

  useEffect(() => {
    (window as any).setCanvasSize = (w: number, h: number) => {
      setCanvasWidth(w);
      setCanvasHeight(h);
    };
    return () => {
      delete (window as any).setCanvasSize;
    };
  }, []);
  
  const pushHistory = useCallback((currentLayers: Layer[], currentItems: CanvasItem[]) => {
    setHistory(prev => [...prev.slice(prev.length - MAX_HISTORY + 1), [currentLayers, currentItems]]);
  }, []);

  const addItem = useCallback((itemData: CanvasItemData) => {
    pushHistory(layers, items);
    const newItem = { ...itemData, id: `item_${Date.now()}_${Math.random()}`, layerId: activeLayerId } as CanvasItem;
    setItems(prev => [...prev, newItem]);
    setSelectedItemId(newItem.id);
    setActiveTool(ToolType.SELECT);
  }, [items, layers, activeLayerId, pushHistory]);

  const addItems = useCallback((itemsData: CanvasItemData[]) => {
    pushHistory(layers, items);
    const newItems = itemsData.map(itemData => ({
        ...itemData,
        id: `item_${Date.now()}_${Math.random()}`,
        layerId: activeLayerId,
    } as CanvasItem));
    setItems(prev => [...prev, ...newItems]);
    setSelectedItemId(newItems[newItems.length - 1]?.id || null);
    setActiveTool(ToolType.SELECT);
  }, [items, layers, activeLayerId, pushHistory]);

  const addPart = useCallback((partType: PartType) => {
    const partDefinition = ALL_PARTS.find(p => p.type === partType);
    if (!partDefinition) return;

    addItem({
      type: partType,
      x: 200,
      y: 150,
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
      x: 0, // 插入到标尺原点
      y: 0, // 插入到标尺原点
      href,
      width: newWidth,
      height: newHeight,
      rotation: 0,
    } as Omit<ImageObject, 'id' | 'layerId'>);
  }, [addItem]);

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

  // Layer Management
  const addLayer = useCallback(() => {
    pushHistory(layers, items);
    const newLayer: Layer = { id: `layer_${Date.now()}`, name: `图层 ${layers.length + 1}`, isVisible: true, printingMethod: PrintingMethod.SCAN };
    setLayers(prev => [newLayer, ...prev]);
    setActiveLayerId(newLayer.id);
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
    pushHistory(layers, items);
    setLayers(prev => prev.map(l => (l.id === layerId ? { ...l, ...updates } : l)));
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
    let viewBox: number[] = [0,0,0,0];
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
      const skipTags = ['defs','clipPath','mask','marker','symbol','use', 'style', 'title'];
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
            const absPoints: {x:number, y:number}[] = [];
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
        } catch (e) {}
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
        const minX = Math.min(...pts.map((p: {x:number, y:number}) => p.x));
        const minY = Math.min(...pts.map((p: {x:number, y:number}) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: {x:number, y:number}) => ({ x: p.x - minX, y: p.y - minY })),
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
        const minX = Math.min(...pts.map((p: {x:number, y:number}) => p.x));
        const minY = Math.min(...pts.map((p: {x:number, y:number}) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: {x:number, y:number}) => ({ x: p.x - minX, y: p.y - minY })),
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
        const minX = Math.min(...pts.map((p: {x:number, y:number}) => p.x));
        const minY = Math.min(...pts.map((p: {x:number, y:number}) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: {x:number, y:number}) => ({ x: p.x - minX, y: p.y - minY })),
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
        const minX = Math.min(...pts.map((p: {x:number, y:number}) => p.x));
        const minY = Math.min(...pts.map((p: {x:number, y:number}) => p.y));
        items.push({
          type: CanvasItemType.DRAWING,
          x: minX,
          y: minY,
          points: pts.map((p: {x:number, y:number}) => ({ x: p.x - minX, y: p.y - minY })),
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
          if (pts.length < 2 || pts[0].x !== pts[pts.length-1].x || pts[0].y !== pts[pts.length-1].y) {
            points = [...pts, pts[0]];
          }
          const minX = Math.min(...points.map((p: {x:number, y:number}) => p.x));
          const minY = Math.min(...points.map((p: {x:number, y:number}) => p.y));
          items.push({
            type: CanvasItemType.DRAWING,
            x: minX,
            y: minY,
            points: points.map((p: {x:number, y:number}) => ({ x: p.x - minX, y: p.y - minY })),
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
          const minX = Math.min(...pts.map((p: {x:number, y:number}) => p.x));
          const minY = Math.min(...pts.map((p: {x:number, y:number}) => p.y));
          items.push({
            type: CanvasItemType.DRAWING,
            x: minX,
            y: minY,
            points: pts.map((p: {x:number, y:number}) => ({ x: p.x - minX, y: p.y - minY })),
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
    // PLT(HPGL) 导入
    if (file.ext === 'plt') {
      try {
        const hpglData = simpleParseHPGL(file.content);
        const items: CanvasItemData[] = [];
        let cur: { x: number; y: number } = { x: 0, y: 0 };
        let drawing: { x: number; y: number }[] = [];
        hpglData.forEach((cmd: any) => {
          if (cmd.type === 'PU') {
            if (drawing.length > 1) {
              const minX = Math.min(...drawing.map((p: any) => p.x));
              const minY = Math.min(...drawing.map((p: any) => p.y));
              items.push({
                type: CanvasItemType.DRAWING,
                x: minX,
                y: minY,
                points: drawing.map((p: any) => ({ x: p.x - minX, y: p.y - minY })),
                color: '#eab308',
                strokeWidth: 2,
              });
            }
            drawing = [];
            if (cmd.points && cmd.points.length > 0) {
              cur = { x: cmd.points[0][0], y: cmd.points[0][1] };
            }
          } else if (cmd.type === 'PD' || cmd.type === 'PA') {
            if (cmd.points) {
              cmd.points.forEach((pt: [number, number]) => {
                cur = { x: pt[0], y: pt[1] };
                drawing.push({ ...cur });
              });
            }
          }
        });
        if (drawing.length > 1) {
          const minX = Math.min(...drawing.map((p: any) => p.x));
          const minY = Math.min(...drawing.map((p: any) => p.y));
          items.push({
            type: CanvasItemType.DRAWING,
            x: minX,
            y: minY,
            points: drawing.map((p: any) => ({ x: p.x - minX, y: p.y - minY })),
            color: '#eab308',
            strokeWidth: 2,
          });
        }
        if (items.length === 0) {
          alert('PLT未识别到可导入的线条');
        } else {
          addItems(items);
        }
      } catch (e) {
        alert('PLT解析失败');
      }
      return;
    }
    alert('不支持的文件类型');
  }, [addItems, parseSvgWithSvgson]);

  // 分图层导出预览
  const handleNext = async () => {
    // 记录当前选中项
    const prevSelected = selectedItemId;
    setSelectedItemId(null);
    await new Promise(r => setTimeout(r, 0)); // 等待UI刷新

    // 固定导出分辨率
    const exportWidth = 2500;
    const exportHeight = 2500;
    // 1. 获取每个图层的items
    const layerData = await Promise.all(layers.map(async layer => {
      // 只导出可见图层
      if (!layer.isVisible) return null;
      // 只导出当前图层的items
      const layerItems = items.filter(item => item.layerId === layer.id);
      // 构造SVG字符串，viewBox仍然用canvasWidth/canvasHeight，width/height用2500
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${exportWidth}' height='${exportHeight}' viewBox='0 0 ${canvasWidth} ${canvasHeight}'>` +
        `<g>${document.querySelectorAll(`[data-layer-id='${layer.id}']`)[0]?.innerHTML || ''}</g></svg>`;
      // SVG转图片
      const imgUrl = await new Promise(resolve => {
        const img = new window.Image();
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgBlob);
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = exportWidth;
          canvas.height = exportHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, exportWidth, exportHeight);
          }
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png', 1));
        };
        img.src = url;
      });
      return {
        id: layer.id,
        name: layer.name,
        printingMethod: layer.printingMethod,
        bitmap: imgUrl,
        width: exportWidth,
        height: exportHeight
      };
    }));
    // 过滤掉不可见图层
    const filtered = layerData.filter(Boolean);
    // 弹窗预览
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<html><head><title>分图层导出预览</title></head><body style="font-family:sans-serif">');
      win.document.write('<h2>分图层导出预览</h2>');
      win.document.write(`<p style="color:#666;margin-bottom:20px;">导出分辨率: 2500×2500 像素</p>`);
      filtered.forEach(layer => {
        if (!layer) return;
        win.document.write(`<div style="margin-bottom:32px"><h3>${layer.name}（打印方式：${layer.printingMethod}）</h3><img src="${layer.bitmap}" style="max-width:400px;border:1px solid #ccc;"/></div>`);
      });
      win.document.write('</body></html>');
      win.document.close();
    } else {
      alert('无法打开新窗口，请检查浏览器设置');
    }
    // 恢复选中项
    setSelectedItemId(prevSelected);
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
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const reader = new FileReader();
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
    event.currentTarget.value = '';
  };

  return (
    <div className="h-screen w-screen flex flex-row font-sans text-gray-800 bg-gray-100 overflow-hidden" style={{width: '100vw', height: '100vh', minHeight: '100vh', minWidth: '100vw'}}>
        {/* 页面顶部：下一步、撤销按钮 */}
        <div className="w-full flex flex-row items-center justify-between px-4 py-2 bg-white border-b border-gray-200 fixed top-0 left-0 z-40 md:static md:justify-end md:py-0 md:px-0">
          <div className="flex flex-row gap-2">
            <button
              className="px-4 py-2 rounded bg-gray-200 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-300"
              onClick={undo}
              disabled={history.length === 0}
            >撤销</button>
          </div>
          <div className="flex flex-row gap-2">
            <button
              className="px-4 py-2 rounded bg-blue-500 text-white text-sm font-medium shadow-sm hover:bg-blue-600"
              onClick={handleNext}
            >下一步</button>
          </div>
        </div>
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 pt-14 md:pt-0">
            {/* PC端工具栏 */}
            <div className="hidden md:block h-16 bg-white border-b border-gray-200">
              <Toolbar
                onOpenCategoryPicker={setOpenCategory}
                onAddImage={() => {
                  imageInputRef.current?.click();
                }}
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
            {/* 底部工具栏抽屉触发按钮，仅移动端显示 */}
            <button
              className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-6 py-2 rounded-full bg-gray-800 text-white text-base shadow-lg md:hidden"
              style={{paddingBottom: 'env(safe-area-inset-bottom,16px)'}}
              onClick={() => setDrawer('toolbar')}
            >工具栏</button>
        </div>

        {/* 右侧面板：仅PC端显示 */}
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
        
        {openCategory && (
            <CategoryPicker
            category={openCategory}
            onAddPart={addPart}
            onClose={() => setOpenCategory(null)}
            />
        )}

        {/* 工具栏抽屉，仅移动端显示 */}
        {drawer === 'toolbar' && (
          <div className="fixed left-0 right-0 bottom-0 z-50 flex justify-center items-end" style={{paddingBottom: 'env(safe-area-inset-bottom,16px)'}}>
            <div className="bg-white rounded-t-2xl shadow-lg p-4 flex flex-col items-stretch w-full">
              <div className="w-full flex justify-between items-center mb-2">
                <span className="font-semibold">工具栏</span>
                <button className="text-gray-500 text-lg" onClick={() => setDrawer(null)}>×</button>
              </div>
              <div className="grid grid-cols-3 grid-rows-3 md:grid-cols-3 md:grid-rows-3 gap-3 w-full">
                {/* 第一行：选择、涂鸦、橡皮擦 */}
                <button 
                  className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${
                    activeTool === ToolType.SELECT 
                      ? 'bg-teal-500 text-white' 
                      : 'bg-gray-100 text-gray-800'
                  }`} 
                  onClick={() => setActiveTool(ToolType.SELECT)}
                >
                  <img src={SelectIcon} alt="选择" className="w-6 h-6 mb-1" />
                  <span className="text-xs">选择</span>
                </button>
                <button 
                  className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${
                    activeTool === ToolType.PEN 
                      ? 'bg-teal-500 text-white' 
                      : 'bg-gray-100 text-gray-800'
                  }`} 
                  onClick={() => setActiveTool(ToolType.PEN)}
                >
                  <img src={DoodleIcon} alt="涂鸦" className="w-6 h-6 mb-1" />
                  <span className="text-xs">涂鸦</span>
                </button>
                <button 
                  className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${
                    activeTool === ToolType.ERASER 
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
                  className={`flex flex-col items-center justify-center w-full h-14 rounded-lg transition-colors ${
                    !selectedItem 
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
                }} style={{cursor: 'pointer'}}>
                  <img src={ShapeIcon} alt="形状" className="w-6 h-6 mb-1" />
                  <span className="text-xs">形状</span>
                </div>
                {/* 零件库按钮 */}
                <div className="flex flex-col items-center justify-center w-full h-14 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-800" onClick={() => {
                  setOpenCategory('PART_LIBRARY');
                  setDrawer(null); // 关闭工具栏抽屉
                }} style={{cursor: 'pointer'}}>
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
    </div>
  );
};

// 声明window.Android类型
declare global {
  interface Window {
    Android?: {
      onNextStep?: (data: string) => void;
    };
  }
}

export default App;