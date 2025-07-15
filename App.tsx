import React, { useState, useCallback } from 'react';
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
    if (itemPoints.length > 0) {
        const itemMinX = (item.x ?? 0) + Math.min(...itemPoints.map((p: any) => p.x));
        const itemMinY = (item.y ?? 0) + Math.min(...itemPoints.map((p: any) => p.y));
        const itemMaxX = (item.x ?? 0) + Math.max(...itemPoints.map((p: any) => p.x));
        const itemMaxY = (item.y ?? 0) + Math.max(...itemPoints.map((p: any) => p.y));
        minX = Math.min(minX, itemMinX);
        minY = Math.min(minY, itemMinY);
        maxX = Math.max(maxX, itemMaxX);
        maxY = Math.max(maxY, itemMaxY);
    } else if ('width' in item && 'height' in item) {
        minX = Math.min(minX, (item.x ?? 0) - item.width / 2);
        minY = Math.min(minY, (item.y ?? 0) - item.height / 2);
        maxX = Math.max(maxX, (item.x ?? 0) + item.width / 2);
        maxY = Math.max(maxY, (item.y ?? 0) + item.height / 2);
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
const App: React.FC<AppProps> = ({ canvasWidth = 500, canvasHeight = 500 }) => {
  const firstLayerId = `layer_${Date.now()}`;
  const [layers, setLayers] = useState<Layer[]>([{ id: firstLayerId, name: '图层 1', isVisible: true, printingMethod: PrintingMethod.SCAN }]);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [history, setHistory] = useState<[Layer[], CanvasItem[]][]>([]);
  
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(firstLayerId);
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  // 移除原有的const canvasWidth = 500; const canvasHeight = 500;
  
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
    addItem({
      type: CanvasItemType.IMAGE,
      x: 250,
      y: 200,
      href,
      width,
      height,
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
    // 1. 获取每个图层的items
    const layerData = await Promise.all(layers.map(async layer => {
      // 只导出可见图层
      if (!layer.isVisible) return null;
      // 只导出当前图层的items
      const layerItems = items.filter(item => item.layerId === layer.id);
      // 构造SVG字符串
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${canvasWidth}' height='${canvasHeight}' viewBox='0 0 ${canvasWidth} ${canvasHeight}'>` +
        `<g>${document.querySelectorAll(`[data-layer-id='${layer.id}']`)[0]?.innerHTML || ''}</g></svg>`;
      // SVG转图片
      const imgUrl = await new Promise(resolve => {
        const img = new window.Image();
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgBlob);
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = url;
      });
      return {
        id: layer.id,
        name: layer.name,
        printingMethod: layer.printingMethod,
        bitmap: imgUrl
      };
    }));
    // 过滤掉不可见图层
    const filtered = layerData.filter(Boolean);
    // 弹窗预览
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<html><head><title>分图层导出预览</title></head><body style="font-family:sans-serif">');
      win.document.write('<h2>分图层导出预览</h2>');
      filtered.forEach(layer => {
        if (!layer) return;
        win.document.write(`<div style="margin-bottom:32px"><h3>${layer.name}（打印方式：${layer.printingMethod}）</h3><img src="${layer.bitmap}" style="max-width:400px;border:1px solid #ccc;"/></div>`);
      });
      win.document.write('</body></html>');
      win.document.close();
    } else {
      alert('无法打开新窗口，请检查浏览器设置');
    }
  };

  const selectedItem = items.find(p => p.id === selectedItemId) || null;

  return (
    <div className="h-screen w-screen flex flex-row font-sans text-gray-800 bg-gray-100 overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col">
            <main className="flex-1 flex flex-col min-h-0 bg-white relative">
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
            />
            </main>
            <footer className="h-20 flex-shrink-0 bg-white border-t border-gray-200 flex items-center justify-center z-10">
                <Toolbar
                    onOpenCategoryPicker={setOpenCategory}
                    onAddImage={addImage}
                    activeTool={activeTool}
                    onSetTool={setActiveTool}
                    onUndo={undo}
                    canUndo={history.length > 0}
                    onImportFile={handleImportFile}
                    onNext={handleNext}
                />
            </footer>
        </div>

        {/* Right Sidebar */}
        <aside className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col">
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