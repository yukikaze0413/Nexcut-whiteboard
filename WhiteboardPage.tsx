import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import PerformanceConfigPanel from './components/PerformanceConfigPanel';
import PerformanceMonitor from './components/PerformanceMonitor';
import ImportProgressModal from './components/ImportProgressModal';
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

// UTF-8 安全的 base64 编码（用于包含中文的 SVG 文本）
function toBase64Utf8(str: string): string {
  try {
    return window.btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    // 兜底：如果编码失败，退回原字符串（可能导致后续失败，但不阻塞）
    return window.btoa(str);
  }
}

// 8.25
interface AdaptiveSampleConfig {
  minSegmentLength?: number; // 初始采样的最小段长（像素）
  curvatureThreshold?: number; // 决定是否需要细分的曲率/偏差阈值
  maxSamples?: number; // 防止无限递归的最大采样点数
}

/**
 * 使用自适应算法对SVG路径进行采样
 * @param pathElement - 要采样的 SVGPathElement
 * @param config - 采样配置
 * @returns 采样点数组
 */
function adaptiveSamplePath(
  pathElement: SVGPathElement,
  config: AdaptiveSampleConfig = {}
): { x: number; y: number }[] {
  const {
    minSegmentLength = 5,
    curvatureThreshold = 0.5,
    maxSamples = 1000
  } = config;

  const totalLength = pathElement.getTotalLength();
  if (totalLength === 0) return [];

  const initialSampleCount = Math.max(2, Math.floor(totalLength / minSegmentLength));
  const points: { dist: number; pt: DOMPoint }[] = [];

  // 1. 初始粗略采样
  for (let i = 0; i <= initialSampleCount; i++) {
    const dist = (i / initialSampleCount) * totalLength;
    points.push({ dist, pt: pathElement.getPointAtLength(dist) });
  }

  // 2. 递归细分
  let i = 0;
  while (i < points.length - 2 && points.length < maxSamples) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2];

    // 3. 计算 P2 到 P1-P3 连线的垂直距离
    const dx = p3.pt.x - p1.pt.x;
    const dy = p3.pt.y - p1.pt.y;
    const segmentLenSq = dx * dx + dy * dy;
    let deviation = 0;
    if (segmentLenSq > 1e-6) {
      const t = ((p2.pt.x - p1.pt.x) * dx + (p2.pt.y - p1.pt.y) * dy) / segmentLenSq;
      const closestX = p1.pt.x + t * dx;
      const closestY = p1.pt.y + t * dy;
      deviation = Math.hypot(p2.pt.x - closestX, p2.pt.y - closestY);
    }

    // 4. 判断是否需要细分
    if (deviation > curvatureThreshold) {
      // 在 P1-P2 和 P2-P3 中间插入新点
      const dist1 = (p1.dist + p2.dist) / 2;
      points.splice(i + 1, 0, { dist: dist1, pt: pathElement.getPointAtLength(dist1) });

      const dist2 = (p2.dist + p3.dist) / 2;
      points.splice(i + 3, 0, { dist: dist2, pt: pathElement.getPointAtLength(dist2) });

      // 不需要移动 i，因为新插入的点需要重新评估
    } else {
      i++; // 如果线段足够平直，继续检查下一段
    }
  }

  return points.map(p => ({ x: p.pt.x, y: p.pt.y }));
}


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
 * 辅助函数：创建使用中心坐标的绘图对象
 */
export function createCenterCoordinateDrawing(points: { x: number; y: number }[], attributes: any = {}): any {
  if (points.length < 2) return null;
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    type: CanvasItemType.DRAWING,
    x: centerX,
    y: centerY,
    points: points.map(p => ({ x: p.x - centerX, y: p.y - centerY })),
    color: attributes.color || '#2563eb',
    strokeWidth: attributes.strokeWidth || 2,
    rotation: attributes.rotation || 0,
    fillColor: attributes.fillColor,
    ...attributes
  };
}

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
    {
      id: `scan_layer_${Date.now()}`,
      name: '扫描图层',
      isVisible: true,
      printingMethod: PrintingMethod.SCAN,
      lineDensity: 10,
      halftone: false,
      reverseMovementOffset: 0,
      power: 50,
      maxPower: 100,
      minPower: 0,
      moveSpeed: 100
    },
    {
      id: `engrave_layer_${Date.now()}`,
      name: '切割图层',
      isVisible: true,
      printingMethod: PrintingMethod.ENGRAVE,
      power: 50
    }
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
  const [showPerformanceConfig, setShowPerformanceConfig] = useState(false); // 性能配置面板
  const [showPerformanceMonitor, setShowPerformanceMonitor] = useState(false); // 性能监控面板
  const [processedLocationState, setProcessedLocationState] = useState<any>(null); // 跟踪已处理的图片
  const [isRestored, setIsRestored] = useState(false); // 恢复是否完成，用于避免导入/恢复竞态

  // 自动保存/恢复：在首次加载时尝试恢复白板内容
  useEffect(() => {
    try {
      // 检测是否当前有导入请求（但仍然先执行恢复，再由导入逻辑追加图片）
      const hasIncomingImport = !!(location.state?.image || location.state?.hasVectorData);
      const saved = localStorage.getItem('whiteboardAutosave');
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data.layers) && Array.isArray(data.items)) {
          setLayers(data.layers as Layer[]);
          setItems(data.items as CanvasItem[]);
          if (data.activeLayerId === null || typeof data.activeLayerId === 'string') {
            setActiveLayerId(data.activeLayerId || null);
          }
          // 若没有导入请求，方可清理残留路由状态；有导入请求则保留以便后续导入逻辑处理
          if (!hasIncomingImport) {
            try { window.history.replaceState({}, document.title); } catch { }
          }
          console.log('[Whiteboard Restore] 已恢复本地存档', {
            layers: (data.layers || []).length,
            items: (data.items || []).length,
            activeLayerId: data.activeLayerId ?? null,
          });
        }
      }
    } catch (e) {
      console.warn('恢复白板自动保存内容失败:', e);
    }
    // 无论是否有存档，都标记恢复流程已完成，允许后续导入继续
    setIsRestored(true);
  }, []);

  // 手动保存：写入localStorage并短Toast提示
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const saveWhiteboard = useCallback(async () => {
    try {
      const payload = JSON.stringify({
        layers,
        items,
        activeLayerId,
        ts: Date.now(),
      });
      localStorage.setItem('whiteboardAutosave', payload);
      console.log('[Whiteboard Autosave] 已保存', {
        layers: layers.length,
        items: items.length,
        activeLayerId,
        time: new Date().toISOString(),
      });
      setToastMessage('已保存');
      await new Promise(resolve => setTimeout(resolve, 50));
      setTimeout(() => setToastMessage(null), 800);
    } catch (e) {
      console.warn('[Whiteboard Autosave] 保存失败:', e);
      setToastMessage('保存失败');
      setTimeout(() => setToastMessage(null), 1200);
    }
  }, [layers, items, activeLayerId]);

  // 添加G代码生成进度弹窗状态
  const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);
  const [generationProgress, setGenerationProgress] = useState('');

  // 添加状态用于显示导入进度
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');

  // 添加性能优化配置
  const [performanceConfig, setPerformanceConfig] = useState({
    maxPointsPerPath: Infinity,        // 每个路径最大点数
    simplificationTolerance: 2.0,  // 路径简化容差
    batchSize: 50,                // 批处理大小
    enableLOD: true,              // 启用细节层次
    maxTotalPoints: 500000         // 总点数限制
  });



  // 优化的路径简化函数 - 支持多种算法和性能配置
  const simplifyPath = useCallback((points: { x: number, y: number }[], tolerance: number = 2.0, maxPoints?: number): { x: number, y: number }[] => {
    if (points.length <= 2) return points;

    // 如果指定了最大点数且当前点数超过限制，先进行均匀采样
    let workingPoints = points;
    if (maxPoints && points.length > maxPoints) {
      const step = Math.floor(points.length / maxPoints);
      workingPoints = points.filter((_, index) => index % step === 0);
      // 确保包含最后一个点
      if (workingPoints[workingPoints.length - 1] !== points[points.length - 1]) {
        workingPoints.push(points[points.length - 1]);
      }
    }

    // 道格拉斯-普克算法 - 优化版本
    const douglasPeucker = (pts: { x: number, y: number }[], epsilon: number): { x: number, y: number }[] => {
      if (pts.length <= 2) return pts;

      let maxDist = 0;
      let index = 0;
      const first = pts[0];
      const last = pts[pts.length - 1];

      // 优化的点到直线距离计算
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const lengthSq = dx * dx + dy * dy;

      if (lengthSq === 0) return [first, last];

      // 找到距离直线最远的点
      for (let i = 1; i < pts.length - 1; i++) {
        const point = pts[i];
        const t = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSq));
        const projX = first.x + t * dx;
        const projY = first.y + t * dy;
        const dist = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);

        if (dist > maxDist) {
          maxDist = dist;
          index = i;
        }
      }

      // 如果最大距离大于阈值，则递归简化
      if (maxDist > epsilon) {
        const left = douglasPeucker(pts.slice(0, index + 1), epsilon);
        const right = douglasPeucker(pts.slice(index), epsilon);
        return [...left.slice(0, -1), ...right];
      } else {
        return [first, last];
      }
    };

    return douglasPeucker(workingPoints, tolerance);
  }, []);

  // 初始化activeLayerId
  useEffect(() => {
    if (!activeLayerId && layers.length > 0) {
      setActiveLayerId(layers[0].id);
    }
  }, [layers, activeLayerId]);

  // 根据对象类型确定图层类型 - 图片默认扫描图层，其他默认切割图层
  const getPrintingMethodByItemType = useCallback((itemType: CanvasItemType | 'GROUP') => {
    // 图片类型默认使用扫描图层
    if (itemType === CanvasItemType.IMAGE) {
      return PrintingMethod.SCAN;
    }

    // 其他所有对象类型默认使用切割图层
    return PrintingMethod.ENGRAVE;
  }, []);

  // 获取指定类型的图层ID，如果没有对应类型的图层，则创建
  const getLayerIdByType = useCallback((printingMethod: PrintingMethod) => {
    let layer = layers.find(l => l.printingMethod === printingMethod);

    // 如果没有对应类型的图层，创建一个新的
    if (!layer) {
      const newLayer: Layer = {
        id: `layer_${Date.now()}`,
        name: printingMethod === PrintingMethod.SCAN ? '扫描图层' : '切割图层',
        isVisible: true,
        printingMethod: printingMethod,
        power: 50
      };

      // 为扫描图层添加默认参数
      if (printingMethod === PrintingMethod.SCAN) {
        newLayer.lineDensity = 10;
        newLayer.halftone = false;
        newLayer.reverseMovementOffset = 0;
        newLayer.maxPower = 100;
        newLayer.minPower = 0;
        newLayer.moveSpeed = 100;
      }

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
      x: canvasWidth / 2, // 图片中心坐标
      y: canvasHeight / 2,
      href,
      width: newWidth,
      height: newHeight,
      rotation: 0,
    } as Omit<ImageObject, 'id' | 'layerId'>);
  }, [addItem, canvasWidth, canvasHeight]);

  // 路由与恢复控制（需在使用前声明）
  const navigate = useNavigate();

  // 处理从路由传递的图片数据 - 分离处理location.state的变化
  useEffect(() => {
    // 等待恢复完成，避免导入与恢复发生竞态
    if (!isRestored) {
      if (location.state?.image || location.state?.hasVectorData) {
        console.log('[Whiteboard Import] 等待恢复完成后再导入...');
      }
      return;
    }
    // 检查是否已经处理过这个location.state，避免重复处理
    if (processedLocationState === location.state) {
      return;
    }

    //MARK: 处理线框提取和矢量化的数据
    if (location.state?.hasVectorData) {
      console.log('接收到矢量图数据:', location.state);

      // 标记已处理
      setProcessedLocationState(location.state);

      // 创建单一ImageObject：显示线框位图，但包含原始矢量数据用于G代码生成
      if (location.state.displayImage && location.state.vectorSource) {
        const displayImage = location.state.displayImage;
        const vectorSource = location.state.vectorSource;

        const img = new Image();
        img.onload = async () => {
          // 根据画布大小动态设定图片最大尺寸（占画布的40%）
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

          // 如果图片太小，设定一个最小尺寸
          const MIN_SIZE = Math.min(canvasWidth, canvasHeight) * 0.05;
          if (Math.max(newWidth, newHeight) < MIN_SIZE) {
            const minScale = MIN_SIZE / Math.max(newWidth, newHeight);
            newWidth *= minScale;
            newHeight *= minScale;
          }

          // 使用从HomePage传递过来的已解析的parsedItems数据，如果没有则重新解析
          let parsedItems: CanvasItemData[] = vectorSource.parsedItems || [];
          if (parsedItems.length === 0 && vectorSource.type === 'svg' && vectorSource.content) {
            try {
              parsedItems = await parseSvgWithSvgson(vectorSource.content);
              console.log('重新解析SVG内容成功，得到', parsedItems.length, '个矢量对象');
            } catch (error) {
              console.error('解析SVG内容失败:', error);
            }
          } else if (parsedItems.length > 0) {
            console.log('使用已解析的SVG数据，包含', parsedItems.length, '个矢量对象');
          }

          // 添加单一ImageObject到画布
          // href显示线框位图，vectorSource包含原始矢量数据
          addItem({
            type: CanvasItemType.IMAGE,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
            href: displayImage, // 显示线框位图
            width: newWidth,
            height: newHeight,
            rotation: 0,
            vectorSource: {
              ...vectorSource,
              parsedItems: parsedItems, // 使用解析后的矢量数据
              originalDimensions: { width: img.width, height: img.height, imageCenterX: img.width / 2, imageCenterY: img.height / 2 }
            }
          } as Omit<ImageObject, 'id' | 'layerId'>);
        };
        img.src = displayImage;
      }

      // 清除路由状态，避免重复处理
      window.history.replaceState({}, document.title);
      return;
    }

    // 处理普通图片数据（新：以是否为新一次导航为准，避免同图被拦截）
    if (location.state?.image && processedLocationState !== location.state) {
      setProcessedImage(location.state.image);
      setProcessedLocationState(location.state);

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
          x: canvasWidth / 2, // 图片中心坐标
          y: canvasHeight / 2,
          href: location.state.image,
          width: newWidth,
          height: newHeight,
          rotation: 0,
        } as Omit<ImageObject, 'id' | 'layerId'>);
      };
      img.src = location.state.image;
      // 一旦接收并开始加载本次图片，立即清除路由状态，防止回退或刷新导致重复导入
      try { window.history.replaceState({}, document.title); } catch { }
    }
  }, [location.state, canvasWidth, canvasHeight, addItem, processedImage, processedLocationState, isRestored]);

  const updateItem = useCallback((itemId: string, updates: Partial<CanvasItem>) => {
    setItems(prevItems =>
      prevItems.map(p => {
        if (p.id !== itemId) return p;
        // 等比锁定：针对图片对象，若仅修改了宽或高，则按当前宽高比同步另一个维度，避免失真
        if (p.type === CanvasItemType.IMAGE) {
          const hasWidth = Object.prototype.hasOwnProperty.call(updates, 'width');
          const hasHeight = Object.prototype.hasOwnProperty.call(updates, 'height');
          if (hasWidth && !hasHeight && typeof (updates as any).width === 'number' && p.width > 0) {
            const aspectRatio = p.height / p.width;
            const newWidth = (updates as any).width as number;
            return { ...p, ...updates, height: newWidth * aspectRatio } as CanvasItem;
          }
          if (hasHeight && !hasWidth && typeof (updates as any).height === 'number' && p.height > 0) {
            const aspectRatio = p.height / p.width;
            const newHeight = (updates as any).height as number;
            return { ...p, ...updates, width: newHeight / aspectRatio } as CanvasItem;
          }
        }
        return { ...p, ...updates } as CanvasItem;
      })
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
        <select id="layerType" disabled style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: #f9f9f9; color: #666;">
          <option value="scan">扫描</option>
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
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">出边距离：</label>
          <input id="reverseMovementOffset" type="number" min="0" step="0.1" value="0" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
        </div>

        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">功率最大值 (%)：</label>
          <input id="maxPower" type="number" min="0" max="100" value="100" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
        </div>

        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">功率最小值 (%)：</label>
          <input id="minPower" type="number" min="0" max="100" value="0" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
        </div>

        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 3px; font-size: 13px;">移动速度 (mm/s)：</label>
          <input id="moveSpeed" type="number" min="10" max="500" value="100" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;" />
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
    const maxPowerInput = content.querySelector('#maxPower') as HTMLInputElement;
    const minPowerInput = content.querySelector('#minPower') as HTMLInputElement;
    const moveSpeedInput = content.querySelector('#moveSpeed') as HTMLInputElement;
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

      // 只允许创建扫描图层
      newLayer.printingMethod = 'scan' as PrintingMethod;
      newLayer.lineDensity = parseInt(lineDensityInput.value) || 10;
      newLayer.halftone = halftoneInput.checked;
      newLayer.reverseMovementOffset = parseFloat(reverseMovementOffsetInput.value) || 0;
      newLayer.maxPower = parseInt(maxPowerInput.value) || 100;
      newLayer.minPower = parseInt(minPowerInput.value) || 0;
      newLayer.moveSpeed = parseInt(moveSpeedInput.value) || 3000;

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
    const target = layers.find(l => l.id === layerId);
    if (!target) return;
    // 禁止删除切割图层；只允许删除扫描图层
    if (target.printingMethod === PrintingMethod.ENGRAVE) return;
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

  // 智能采样函数 - 根据路径复杂度动态调整采样密度
  const smartSamplePath = useCallback((path: SVGPathElement, maxSamples: number = 1000): { x: number; y: number }[] => {
    const totalLength = path.getTotalLength();
    if (totalLength === 0) return [];

    // 基于路径长度和复杂度计算采样点数
    const baseSamples = Math.min(Math.max(Math.floor(totalLength / 2), 32), maxSamples);
    const points: { x: number; y: number }[] = [];

    // 自适应采样 - 在曲率变化大的地方增加采样密度
    let lastPoint: DOMPoint | null = null;
    let lastDirection: { x: number; y: number } | null = null;

    for (let i = 0; i <= baseSamples; i++) {
      const t = i / baseSamples;
      const len = t * totalLength;
      const point = path.getPointAtLength(len);

      if (lastPoint) {
        const direction = {
          x: point.x - lastPoint.x,
          y: point.y - lastPoint.y
        };

        // 计算方向变化
        if (lastDirection) {
          const dot = direction.x * lastDirection.x + direction.y * lastDirection.y;
          const mag1 = Math.sqrt(direction.x ** 2 + direction.y ** 2);
          const mag2 = Math.sqrt(lastDirection.x ** 2 + lastDirection.y ** 2);

          if (mag1 > 0 && mag2 > 0) {
            const cosAngle = dot / (mag1 * mag2);
            const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

            // 如果方向变化大，在中间插入额外的点
            if (angle > Math.PI / 6 && i > 0) { // 30度以上的转向
              const midLen = ((i - 1) / baseSamples + t) * totalLength / 2;
              const midPoint = path.getPointAtLength(midLen);
              points.push({ x: midPoint.x, y: midPoint.y });
            }
          }
        }

        lastDirection = direction;
      }

      points.push({ x: point.x, y: point.y });
      lastPoint = point;
    }

    return points;
  }, []);

  // svgson + svg.js递归解析SVG节点 8-25 - 增强版本支持分帧处理
  const parseSvgWithSvgson = useCallback(async (svgContent: string): Promise<CanvasItemData[]> => {
    const svgJson = await parseSvgson(svgContent);
    // 获取viewBox和缩放
    let viewBox: number[] = [0, 0, 0, 0];
    let scaleX = 1, scaleY = 1;
    if (svgJson.attributes.viewBox) {
      viewBox = svgJson.attributes.viewBox.split(/\s+/).map(Number);
    }
    // if (svgJson.attributes.width && svgJson.attributes.height && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    //   scaleX = parseFloat(svgJson.attributes.width) / viewBox[2];
    //   scaleY = parseFloat(svgJson.attributes.height) / viewBox[3];
    // }

    // 分帧处理辅助函数
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    let processedCount = 0;
    let totalPathCount = 0;

    // 预计算总路径数量 - 修正版本
    const countPaths = (node: any): number => {
      let count = 0;
      if (node.name === 'path' && node.attributes.d) {
        // 使用与 walk 函数中完全相同的逻辑来计算子路径段的数量
        const d = node.attributes.d as string;
        const subPathChunks = d.trim().split(/(?=[Mm])/).filter((sp: string) => sp.trim() !== '');
        count = subPathChunks.length; // 关键改动：count 等于子路径段的数量，而不是 1
      }
      // 递归累加子节点的路径段数量
      if (node.children) {
        node.children.forEach((child: any) => count += countPaths(child));
      }
      return count;
    };

    totalPathCount = countPaths(svgJson);
    console.log(`开始解析SVG，预计包含 ${totalPathCount} 个路径`);

    // 更新导入状态
    setIsImporting(true);
    setImportProgress(0);
    setImportStatus(`开始解析SVG，预计包含 ${totalPathCount} 个路径`);

    // 递归处理 - 增强版本
    async function walk(node: any, parentTransform: DOMMatrix, items: CanvasItemData[] = []): Promise<CanvasItemData[]> {
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

      const viewboxDiagonalLength = Math.sqrt(viewBox[2] ** 2 + viewBox[3] ** 2);

      // 处理path
      // 处理path
      // <<< MODIFIED & FIXED >>> 重构 path 处理逻辑
      if (node.name === 'path' && node.attributes.d) {
        const d = node.attributes.d;

        const subPathChunks = d.trim().split(/(?=[Mm])/).filter((sp: string) => sp.trim() !== '');

        let lastEndPoint = { x: 0, y: 0 };

        for (const subPathData of subPathChunks) {
          try {
            // 每处理一定数量的路径后让出控制权
            processedCount++;
            if (processedCount % performanceConfig.batchSize === 0) {
              const progress = (processedCount / totalPathCount) * 100;
              console.log(`已处理 ${processedCount}/${totalPathCount} 个路径 (${progress.toFixed(1)}%)`);
              setImportProgress(progress);
              setImportStatus(`正在解析路径 ${processedCount}/${totalPathCount}`);
              await sleep(0); // 让出控制权给UI线程
            }

            let effectiveD: string;
            const command = subPathData.trim()[0];
            const isRelative = command === 'm';

            // 提取出 'm' 或 'M' 后面的坐标和剩余指令
            // 正则表达式匹配指令字母，可选的空格，然后是两个数字，最后捕获剩余所有内容
            //const pathRegex = /^[Mm]\s*(-?[\d.]+)\s*,?\s*(-?[\d.]+)(.*)/;
            const numberPattern = '-?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?';
            const pathRegex = new RegExp(`^[Mm]\\s*(${numberPattern})\\s*,?\\s*(${numberPattern})(.*)`);
            const match = subPathData.trim().match(pathRegex);

            if (!match) {
              // 如果路径段不是以 M/m 开头，或者格式不匹配，则跳过
              // 这种情况可能发生在 SVG 格式非常不规范时
              console.warn("跳过格式不正确的路径段:", subPathData);
              continue;
            }

            const xVal = parseFloat(match[1]);
            const yVal = parseFloat(match[2]);
            const remainingD = match[3].trim(); // 捕获到的剩余路径指令，如 "a196.587..."

            let newX = xVal;
            let newY = yVal;

            if (isRelative) {
              newX += lastEndPoint.x;
              newY += lastEndPoint.y;
            }

            // 构建以绝对坐标 'M' 开头的、可以被独立渲染的 d 属性
            effectiveD = `M ${newX} ${newY} ${remainingD}`;

            const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempPath.setAttribute('d', effectiveD);
            tempSvg.appendChild(tempPath);

            const totalLength = tempPath.getTotalLength();

            if (totalLength > viewboxDiagonalLength / 10000) {
              // 使用性能配置动态调整采样参数
              const maxSamples = Math.min(performanceConfig.maxPointsPerPath, 500);
              const curvatureThreshold = Math.max(0.1, performanceConfig.simplificationTolerance / 20);

              let absPoints = adaptiveSamplePath(tempPath, {
                minSegmentLength: 2,
                curvatureThreshold: curvatureThreshold,
                maxSamples: maxSamples
              }).map(pt => {
                const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
                return { x: transformedPt.x * scaleX, y: transformedPt.y * scaleY };
              });

              // 如果点数仍然过多，使用道格拉斯-普克算法进一步简化
              if (absPoints.length > performanceConfig.maxPointsPerPath) {
                absPoints = simplifyPath(absPoints, performanceConfig.simplificationTolerance, performanceConfig.maxPointsPerPath);
              }

              if (absPoints.length >= 2) {
                // 检查总点数限制
                const currentTotalPoints = items.reduce((total, item) => {
                  if (item.type === 'DRAWING' && item.points) {
                    return total + item.points.length;
                  }
                  return total;
                }, 0);

                if (currentTotalPoints + absPoints.length <= performanceConfig.maxTotalPoints) {
                  const drawing = createCenterCoordinateDrawing(absPoints, {
                    fillColor: node.attributes.fill,
                    strokeWidth: Number(node.attributes['stroke-width']) || 0,
                    color: node.attributes.stroke || '#2563eb',
                    rotation: 0,
                  });
                  if (drawing) {
                    items.push(drawing);
                  }
                } else {
                  console.warn(`跳过路径：总点数将超过限制 (${currentTotalPoints + absPoints.length} > ${performanceConfig.maxTotalPoints})`);
                }
              }

              const endPoint = tempPath.getPointAtLength(totalLength);
              lastEndPoint = { x: endPoint.x, y: endPoint.y };
            } else {
              // 如果路径长度为0（可能只有一个M指令），我们也需要更新终点位置
              lastEndPoint = { x: newX, y: newY };
            }
          } catch (e) {
            console.warn("解析子路径时出错:", subPathData, e);
          }
        }
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
        const drawing = createCenterCoordinateDrawing(pts, {
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
        if (drawing) items.push(drawing);
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
        const drawing = createCenterCoordinateDrawing(pts, {
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
        if (drawing) items.push(drawing);
      }
      // 处理eclipse
      else if (node.name === 'eclipse') {
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
        const drawing = createCenterCoordinateDrawing(pts, {
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
        if (drawing) items.push(drawing);
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
        const drawing = createCenterCoordinateDrawing(pts, {
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
        });
        if (drawing) items.push(drawing);
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
          const drawing = createCenterCoordinateDrawing(points, {
            color: node.attributes.stroke || node.attributes.fill || '#2563eb',
            strokeWidth: Number(node.attributes['stroke-width']) || 2,
            fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
          });
          if (drawing) items.push(drawing);
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
          const drawing = createCenterCoordinateDrawing(pts, {
            color: node.attributes.stroke || node.attributes.fill || '#2563eb',
            strokeWidth: Number(node.attributes['stroke-width']) || 2,
            fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
          });
          if (drawing) items.push(drawing);
        }
      }

      // 递归children - 使用异步处理
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          await walk(child, currentTransform, items);
        }
      }

      return items;
    }
    const items: CanvasItemData[] = [];
    const rootTransform = new DOMMatrix();
    await walk(svgJson, rootTransform, items);
    console.log(`SVG解析完成，共生成 ${items.length} 个对象`);

    // 完成导入
    setImportProgress(100);
    setImportStatus(`解析完成，共生成 ${items.length} 个对象`);
    setTimeout(() => {
      setIsImporting(false);
    }, 1000); // 显示完成状态1秒后关闭
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

  // 处理导入文件 8-25
  const handleImportFile = useCallback(async (file: { name: string; ext: string; content: string }) => {
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
    // 提供给Android/iOS调用的矢量导入接口
    (window as any).importVectorToWhiteboard = async (content: string, ext: string = 'svg') => {
      try {
        // 仅支持内联 SVG 文本（允许前置 XML 声明、DOCTYPE、注释）
        const svgPattern = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
        if (!svgPattern.test(content)) {
          alert('仅支持内联 SVG 文本');
          return;
        }
        const file = new File([content], 'android_import.svg', { type: 'image/svg+xml' });
        const fakeEvent = { target: { files: [file] }, currentTarget: { value: '' } } as any;
        handleImport(fakeEvent);
      } catch (e) {
        console.error('importVectorToWhiteboard 失败:', e);
        alert('矢量数据导入失败');
      }
    };

    // 如有来自首页的待处理矢量导入，立即处理
    if ((window as any).__pendingVectorImport) {
      const pending = (window as any).__pendingVectorImport;
      (window as any).__pendingVectorImport = null;
      (window as any).importVectorToWhiteboard?.(pending.content, pending.ext);
    }
    // 可选：卸载时清理
    return () => {
      delete (window as any).setWhiteboardImage;
      delete (window as any).importVectorToWhiteboard;
    };
  }, [addImage]);

  // 已提前声明 navigate 与恢复标志，移除重复声明
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    //console.log("handleImageUpload", 1);
    const file = event.target.files?.[0];
    //console.log("handleImageUpload", file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        //console.log("handleImageUpload", dataUrl);
        navigate('/', { state: { image: dataUrl } });
      };
      reader.readAsDataURL(file);
    }
    event.currentTarget.value = '';
  };


  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    // 在导入开始时立即显示进度弹窗
    setIsImporting(true);
    setImportProgress(0);
    setImportStatus('图片加载中');
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'svg') {
      reader.onload = async (e) => {
        const svgString = e.target?.result as string;
        if (!svgString) return;

        // 保存原始SVG内容用于G代码生成
        var originalContent = svgo.optimize(svgString, {
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  convertShapeToPath: {
                    convertArcs: false,
                  },
                  convertPathData: {
                    applyTransforms: true,
                    makeAbsolute: true,
                    forceAbsolutePath: true,
                  },
                  mergePaths: {
                    force: false,
                    floatPrecision: 3,
                    noSpaceAfterFlags: false
                  },
                },
              },
            },
            {
              name: 'removeAttrs',
              params: {
                attrs: 'svg:preserveAspectRatio',
              }
            },
            'removeStyleElement',
            'collapseGroups',
            'cleanupIds',
          ],
        }).data;
        console.log(originalContent);



        // 尝试从SVG内容中直接解析viewBox
        const viewBoxMatch = originalContent.match(/viewBox="([^"]*)"/);
        let viewBoxX = 0;
        let viewBoxY = 0;
        if (viewBoxMatch && viewBoxMatch[1]) {
          const viewBoxParts = viewBoxMatch[1].split(/\s+|,/).map(Number);
          if (viewBoxParts.length === 4) {
            // 使用 viewBox 的宽度和高度作为最精确的原始尺寸
            viewBoxX = viewBoxParts[0];
            viewBoxY = viewBoxParts[1];
            console.log('成功解析 viewBox，得到 viewBox 起点:', viewBoxX, viewBoxY);
          }
        }

        const dataUrl = 'data:image/svg+xml;base64,' + btoa(originalContent);
        const img = new Image();
        img.onload = async () => {

          // let newContent = originalContent
          //   .replace(/\s*\bwidth\s*=\s*"[^"]*"/g, '')   // 去掉 width
          //   .replace(/\s*\bheight\s*=\s*"[^"]*"/g, ''); // 去掉 height
          // // 再插入新的 width / height
          // newContent = newContent.replace(
          //   /(<\s*svg\b)([^>]*>)/i,
          //   `$1 width="${img.width}" height="${img.height}"$2`
          // );
          // originalContent = newContent;

          // 2. 提取旧 viewBox
          const vbMatch = originalContent.match(/viewBox="([^"]+)"/);
          if (!vbMatch) throw new Error('No viewBox found');
          const [x, y, w, h] = vbMatch[1].split(/\s+/).map(Number);

          // 解析SVG为矢量对象
          let parsedItems: CanvasItemData[] = [];
          try {
            parsedItems = await parseSvgWithSvgson(originalContent);
          } catch (error) {
            console.warn('SVG解析失败，将使用位图模式:', error);
          }
          console.log(parsedItems);

          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
            width: img.width,  // 显示尺寸仍然是渲染尺寸
            height: img.height, // 显示尺寸仍然是渲染尺寸
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'svg',
              content: originalContent,
              parsedItems: parsedItems,
              //MARK: 将我们精确解析出的 viewBox 尺寸存储起来
              originalDimensions: { width: w, height: h, imageCenterX: viewBoxX + w / 2, imageCenterY: viewBoxY + h / 2, type: "svg" }
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

        // 保存转换后的SVG内容用于G代码生成
        var originalContent = svgo.optimize(new Helper(dxfString).toSVG(), {
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  convertShapeToPath: {
                    convertArcs: false,
                  },
                  convertPathData: {
                    applyTransforms: true,
                    makeAbsolute: true,
                    forceAbsolutePath: true,
                  },
                  mergePaths: {
                    force: false,
                    floatPrecision: 3,
                    noSpaceAfterFlags: false
                  },
                },
              },
            },
            {
              name: 'removeAttrs',
              params: {
                attrs: 'svg:preserveAspectRatio',
              }
            },
            'removeStyleElement',
            'collapseGroups',
            'cleanupIds',
          ],
        }).data;

        console.log(originalContent);

        // 尝试从SVG内容中直接解析viewBox
        const viewBoxMatch = originalContent.match(/viewBox="([^"]*)"/);
        let viewBoxX = 0;
        let viewBoxY = 0;
        let viewBoxW = 0;
        let viewBoxH = 0;
        if (viewBoxMatch && viewBoxMatch[1]) {
          const viewBoxParts = viewBoxMatch[1].split(/\s+|,/).map(Number);
          if (viewBoxParts.length === 4) {
            // 使用 viewBox 的宽度和高度作为最精确的原始尺寸
            viewBoxX = viewBoxParts[0];
            viewBoxY = viewBoxParts[1];
            viewBoxW = viewBoxParts[2];
            viewBoxH = viewBoxParts[3];
            console.log('成功解析 viewBox，得到 viewBox 起点:', viewBoxX, viewBoxY);
          }
        }
        let newContent = originalContent
          .replace(/\s*\b width\s*=\s*"[^"]*"/g, ' ')   // 去掉 width
          .replace(/\s*\b height\s*=\s*"[^"]*"/g, ' ') // 去掉 height
          .replace(/\s*preserveAspectRatio="[^"]*"/g, ''); //dxf生成的svg，有了这个属性，img里的svg显示不居中了，g代码是居中的，所以去掉
        // 再插入新的 width / height
        newContent = newContent.replace(
          /(<\s*svg\b)([^>]*>)/i,
          `$1 width="${300}" height="${300 / viewBoxW * viewBoxH}"$2`
        );
        originalContent = newContent;

        const dataUrl = 'data:image/svg+xml;base64,' + btoa(originalContent);
        const img = new Image();
        img.onload = async () => {
          let originalWidth = img.width;
          let originalHeight = img.height;

          // 2. 提取旧 viewBox
          const vbMatch = originalContent.match(/viewBox="([^"]+)"/);
          if (!vbMatch) throw new Error('No viewBox found');
          const [x, y, w, h] = vbMatch[1].split(/\s+/).map(Number);

          // 解析DXF得到的SVG为矢量对象
          let parsedItems: CanvasItemData[] = [];
          try {
            parsedItems = await parseSvgWithSvgson(originalContent);
          } catch (error) {
            console.warn('DXF解析失败，将使用位图模式:', error);
          }
          console.log('从DXF转换得到的SVG解析结果:' + originalContent);
          console.log(parsedItems);

          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
            width: img.width,  // 显示尺寸仍然是渲染尺寸
            height: img.height, // 显示尺寸仍然是渲染尺寸
            href: dataUrl,
            rotation: 0,
            vectorSource: {
              type: 'svg',
              content: originalContent,
              parsedItems: parsedItems,
              // 将我们精确解析出的 viewBox 尺寸存储起来
              // originalDimensions: { width: img.width, height: img.height, imageCenterX: viewBoxX + img.width / 2, imageCenterY: viewBoxY + img.height / 2 }
              originalDimensions: { width: w, height: h, imageCenterX: viewBoxX + w / 2, imageCenterY: viewBoxY + h / 2 }
            }
          };
          addItem(imageData);
        };
        img.src = dataUrl;
      };
      reader.readAsText(file);
    }
    else if (ext === 'plt') {
      try {
        // 将 reader.onload 设置为 async 函数
        reader.onload = async (e) => {
          if (typeof e.target?.result !== 'string') {
            alert('无法读取PLT文件内容。');
            return;
          }
          const pltContent = e.target.result;

          try {
            // --- 步骤 1-3: 从 PLT 解析、重建路径、坐标变换 (与之前相同) ---
            const hpglCommands = simpleParseHPGL(pltContent);

            // ... [此处省略了从 hpglCommands 重建 polylines 并进行坐标变换的完整代码，
            //      因为它与之前的版本完全相同，为了简洁，这里不再重复] ...
            // 假设在这之后，我们已经得到了变换后的 polylines 和相关的变换参数
            // (minX, minY, maxX, maxY, scaleFactor, offsetX, offsetY, CANVAS_WIDTH, CANVAS_HEIGHT)
            // ...

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
                finishCurrentPolyline(); isPenDown = false;
                if (cmd.points && cmd.points.length > 0) { cmd.points.forEach((pt: [number, number]) => currentPos = { x: pt[0], y: pt[1] }); }
              } else if (cmd.type.startsWith('PD')) {
                finishCurrentPolyline(); isPenDown = true; currentPolyline.push({ ...currentPos });
                if (cmd.points && cmd.points.length > 0) { cmd.points.forEach((pt: [number, number]) => { currentPos = { x: pt[0], y: pt[1] }; currentPolyline.push({ ...currentPos }); }); }
              } else if (cmd.type.startsWith('PA')) {
                if (cmd.points && cmd.points.length > 0) { cmd.points.forEach((pt: [number, number]) => { currentPos = { x: pt[0], y: pt[1] }; if (isPenDown) { currentPolyline.push({ ...currentPos }); } }); }
              }
            });
            finishCurrentPolyline();

            if (polylines.length === 0) {
              alert('PLT未识别到可导入的线条'); return;
            }
            const allPoints = polylines.flat();
            const minX = Math.min(...allPoints.map(p => p.x)); const minY = Math.min(...allPoints.map(p => p.y));
            const maxX = Math.max(...allPoints.map(p => p.x)); const maxY = Math.max(...allPoints.map(p => p.y));
            const drawingWidth = maxX - minX; const drawingHeight = maxY - minY;
            if (drawingWidth === 0 || drawingHeight === 0) {
              alert('图形尺寸无效，无法进行缩放'); return;
            }
            const CANVAS_WIDTH = 400; const CANVAS_HEIGHT = 400; const PADDING = 20;
            const targetWidth = CANVAS_WIDTH - PADDING * 2; const targetHeight = CANVAS_HEIGHT - PADDING * 2;
            const scaleX = targetWidth / drawingWidth; const scaleY = targetHeight / drawingHeight;
            const scaleFactor = Math.min(scaleX, scaleY);
            const scaledDrawingWidth = drawingWidth * scaleFactor; const scaledDrawingHeight = drawingHeight * scaleFactor;
            const offsetX = (CANVAS_WIDTH - scaledDrawingWidth) / 2; const offsetY = (CANVAS_HEIGHT - scaledDrawingHeight) / 2;

            // --- 步骤 4: 生成并优化SVG字符串 (与上一版修改相同) ---
            const rawSvgString = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
          ${polylines.map(polyline => {
              const points = polyline.map(p => {
                const translatedX = p.x - minX;
                const translatedY = maxY - p.y;
                return `${(translatedX * scaleFactor + offsetX).toFixed(3)},${(translatedY * scaleFactor + offsetY).toFixed(3)}`;
              }).join(' ');
              return `<polyline points="${points}" fill="none" stroke="#eab308" stroke-width="2"/>`;
            }).join('')}
        </svg>`;

            const optimizedSvgString = svgo.optimize(rawSvgString, {
              // ... svgo config ...
              plugins: [
                {
                  name: 'preset-default',
                  params: {
                    overrides: {
                      convertShapeToPath: {
                        convertArcs: false,
                      },
                      convertPathData: {
                        applyTransforms: true,
                        makeAbsolute: true,
                        forceAbsolutePath: true,
                      },
                      mergePaths: {
                        force: false,
                        floatPrecision: 3,
                        noSpaceAfterFlags: false
                      },
                    },
                  },
                },
                {
                  name: 'removeAttrs',
                  params: {
                    attrs: 'svg:preserveAspectRatio',
                  }
                },
                'removeStyleElement',
                'collapseGroups',
                'cleanupIds',
              ],
            }).data;

            // --- 步骤 5 (新): 使用 svgson 解析优化后的 SVG ---
            let parsedItems: CanvasItemData[] = [];
            try {
              // 调用 await 等待解析完成
              parsedItems = await parseSvgWithSvgson(optimizedSvgString);
            } catch (error) {
              console.error("解析由PLT生成的SVG时失败:", error);
              alert(`从PLT文件生成的SVG解析失败，无法导入: ${error}`);
              return;
            }

            if (parsedItems.length === 0) {
              alert('PLT文件转换后未识别到可用的矢量图形。');
              return;
            }

            // --- 步骤 6: 加载图像以获取尺寸并创建最终的 ImageObject ---
            const dataUrl = 'data:image/svg+xml;base64,' + btoa(optimizedSvgString);
            const img = new Image();

            img.onload = () => {
              // 在这里，我们拥有了所有需要的信息：
              // - 预览图的 Data URL (href)
              // - 预览图的尺寸 (img.width, img.height)
              // - 优化后的 SVG 字符串 (vectorSource.content)
              // - 解析后的矢量对象 (vectorSource.parsedItems)

              const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
                type: CanvasItemType.IMAGE,
                x: canvasWidth / 2,
                y: canvasHeight / 2,
                width: img.width,
                height: img.height,
                href: dataUrl,
                rotation: 0,
                vectorSource: {
                  type: 'svg', // **关键变更**: 类型统一为 'svg'
                  content: optimizedSvgString, // 存储优化后的SVG内容
                  parsedItems: parsedItems, // 存储从SVG解析出的矢量对象
                  originalDimensions: { width: img.width, height: img.height } // 存储原始尺寸
                }
              };

              // 将这个标准化的对象添加到画布
              addItem(imageData);
            };

            img.onerror = () => {
              alert("无法从PLT生成的SVG加载预览图像。");
            };

            img.src = dataUrl;

          } catch (e: any) {
            console.error(e);
            alert(`PLT解析失败: ${e.message}`);
          }
        };
        reader.readAsText(file);
      } catch (err) {
        alert("读取PLT文件时发生错误。");
      }
    }
    else alert('不支持的文件类型');

    event.currentTarget.value = '';
  };

  const processSvgString = (
    svgString: string,
    onComplete: (dataUrl: string, width: number, height: number) => void
  ) => {
    const dataUrl = 'data:image/svg+xml;base64,' + toBase64Utf8(svgString);
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
          minPower: layer.minPower ?? 0,
          maxPower: layer.maxPower ?? 100,
          burnSpeed: (layer.moveSpeed ?? 100) * 60, // 转换 mm/s 到 mm/min
          travelSpeed: (layer.moveSpeed ?? 100) * 60 * 2, // 移动速度通常是燃烧速度的2倍
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
        // 切割图层G代码生成
        const layerItems = items.filter(
          item => item.layerId === layer.id
        );

        console.log('切割图层中的对象:', layerItems);

        if (layerItems.length === 0) {
          setIsGeneratingGCode(false);
          alert('切割图层上没有对象。');
          return;
        }

        setGenerationProgress('正在生成切割G代码...');

        // 使用新的直接G代码生成方法
        const engraveSettings = {
          feedRate: 1000,
          travelSpeed: 3000,
          power: layer.power || 50,
          passes: 1,
          flipY: false,             
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

      // 先扫描后切割的顺序遍历所有图层
      const orderedLayers = [...layers].sort((a, b) => {
        const rank = (l: Layer) => (l.printingMethod === PrintingMethod.SCAN ? 0 : 1);
        return rank(a) - rank(b);
      });
      for (const layer of orderedLayers) {
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
        allGCodeParts.push(`; 打印方式: ${layer.printingMethod === PrintingMethod.SCAN ? '扫描' : '切割'}`);
        allGCodeParts.push(`; ========================================`);

        try {
          if (layer.printingMethod === PrintingMethod.SCAN) {
            //const layerImageItems = layerItems.filter(item => item.type === CanvasItemType.IMAGE);
            const layerImageItems = layerItems;
            
            if (layerImageItems.length > 0) {
              const settings: GCodeScanSettings = {
                lineDensity: 1 / (layer.lineDensity || 10),
                isHalftone: !!layer.halftone,
                negativeImage: false,
                hFlipped: false,
                vFlipped: false,
                minPower: layer.minPower ?? 0,
                maxPower: layer.maxPower ?? 100,
                burnSpeed: (layer.moveSpeed ?? 100) * 60, // 转换 mm/s 到 mm/min
                travelSpeed: (layer.moveSpeed ?? 100) * 60 * 2, // 移动速度通常是燃烧速度的2倍
                overscanDist: layer.reverseMovementOffset ?? 3,
              };

              let gcode = await generatePlatformScanGCode(
                layer,
                items,
                canvasWidth,
                canvasHeight,
                settings,
                canvasWidth,
                canvasHeight
              );

              // 移除中途结束程序的指令与注释，避免后续图层无法执行
              gcode = gcode
                .replace(/;.*$/gm, '')
                .replace(/^[ \t]*;(.*)$|^[ \t]*$/gm, '')
                .replace(/\bM2\b.*$/gmi, '')
                .replace(/\bM30\b.*$/gmi, '');

              allGCodeParts.push(gcode);
            }
          } else {
            // 切割图层
            const engraveSettings = {
              feedRate: 1000,
              travelSpeed: 3000,
              power: layer.power || 50,
              passes: 1,
                        flipY: false,
          canvasHeight: canvasHeight,
            };

            const { generateEngraveGCode } = await import('./lib/gcode');
            let gcode = await generateEngraveGCode(layer, layerItems, engraveSettings);

            if (gcode && gcode.trim().length > 0) {
              // 移除中途结束程序的指令与注释
              gcode = gcode
                .replace(/;.*$/gm, '')
                .replace(/^[ \t]*;(.*)$|^[ \t]*$/gm, '')
                .replace(/\bM2\b.*$/gmi, '')
                .replace(/\bM30\b.*$/gmi, '');
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
      let mergedGCode = allGCodeParts.join('\n');

      // 全局清理：去除所有注释（行内与整行）与空行，移除任何残留的M2/M30，并在末尾追加单一M2结束
      mergedGCode = mergedGCode
        .replace(/;.*$/gm, '')
        .replace(/^[ \t]*;(.*)$|^[ \t]*$/gm, '')
        .replace(/\bM2\b.*$/gmi, '')
        .replace(/\bM30\b.*$/gmi, '')
        .split('\n')
        .filter(line => line.trim().length > 0)
        .join('\n');

      // 在末尾追加一次程序结束
      mergedGCode += '\nM2\n';

      setGenerationProgress('正在保存文件...');
      // 下载合并后的文件
      downloadGCode(mergedGCode, `${fileName}.nc`);

      // 关闭弹窗
      setIsGeneratingGCode(false);
    } catch (error) {
      console.error('合并G代码失败:', error);
      setIsGeneratingGCode(false);
      alert(`合并G代码失败: ${error instanceof Error ? error.message : String(error)}`);
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

  // useEffect(() => {
  //   (window as any).setCanvasSize = (w: number, h: number) => {
  //     setCanvasWidth(w);
  //     setCanvasHeight(h);
  //   };

  //   (window as any).addImageToCanvas = (href: string, width: number, height: number) => {
  //     addImage(href, width, height);
  //   };

  // 检测并设置画布大小 - 支持Android和iOS
  //   const setPlatformCanvasSize = () => {
  //     let size: any = null;

  //     // 尝试从Android获取画布大小
  //     if (window.Android && typeof window.Android.getPlatformSize === 'function') {
  //       try {
  //         size = window.Android.getPlatformSize();
  //       } catch (e) {
  //         console.error('Android获取画布大小失败:', e);
  //       }
  //     }

  //     // 如果Android没有获取到，尝试从iOS获取
  //     if (!size && window.iOS && typeof window.iOS.getPlatformSize === 'function') {
  //       try {
  //         size = window.iOS.getPlatformSize();
  //       } catch (e) {
  //         console.error('iOS获取画布大小失败:', e);
  //       }
  //     }

  //     // 处理获取到的大小数据
  //     if (size) {
  //       let obj: any = size;
  //       if (typeof size === 'string') {
  //         try {
  //           obj = JSON.parse(size);
  //         } catch (e) {
  //           obj = null;
  //         }
  //       }
  //       if (obj && typeof obj === 'object' && 'width' in obj && 'height' in obj) {
  //         setCanvasWidth(Number(obj.width));
  //         setCanvasHeight(Number(obj.height));
  //       }
  //     }
  //   };

  //   setPlatformCanvasSize();
  //   return () => {
  //     delete (window as any).setCanvasSize;
  //     delete (window as any).addImageToCanvas;
  //   };
  // }, [addImage]);

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
            <button
              className="px-4 py-2 rounded bg-gray-200 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-300"
              onClick={() => {
                // 清空白板内容与本地存档
                setItems([]);
                setHistory([]);
                // 保留初始两层结构，避免界面异常
                setLayers([
                  {
                    id: `scan_layer_${Date.now()}`,
                    name: '扫描图层',
                    isVisible: true,
                    printingMethod: PrintingMethod.SCAN,
                    lineDensity: 10,
                    halftone: false,
                    reverseMovementOffset: 0,
                    power: 50,
                    maxPower: 100,
                    minPower: 0,
                    moveSpeed: 100
                  },
                  {
                    id: `engrave_layer_${Date.now()}`,
                    name: '切割图层',
                    isVisible: true,
                    printingMethod: PrintingMethod.ENGRAVE,
                    power: 50
                  }
                ]);
                setActiveLayerId(null);
                setSelectedItemId(null);
                try { localStorage.removeItem('whiteboardAutosave'); } catch { }
                console.log('[Whiteboard Clear] 已清空画布与本地存档');
              }}
            >清空</button>
          </div>
          <div className="flex-1 flex justify-center">
            <span style={{ color: '#888', fontSize: 13 }}>
              {canvasWidth} × {canvasHeight}
            </span>
          </div>
          <div className="flex flex-row gap-2">
            <button
              className="px-4 py-2 rounded bg-gray-200 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-300"
              onClick={saveWhiteboard}
            >保存</button>
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
                onOpenPerformanceConfig={() => setShowPerformanceConfig(true)}
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
                onCommitUpdate={() => { commitUpdate(); saveWhiteboard(); }}
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
              layoutMode="grid"
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
                  onChange={async (e) => { await saveWhiteboard(); handleImageUpload(e); }}
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
                  // accept=".dxf,.svg,.plt"
                  accept='image/svg+xml,.dxf,.plt,application/octet-stream'
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
          <div className="w-full overflow-y-auto" style={{ maxHeight: '80vh' }}>
            <ParameterEditor
              selectedItem={selectedItem}
              layers={layers}
              onUpdateItem={updateItem}
              onDeleteItem={deleteItem}
              onCommitUpdate={() => { commitUpdate(); saveWhiteboard(); }}
              onClose={() => setDrawer(null)}
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

      {/* 轻量Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-4 py-2 bg-black bg-opacity-75 text-white text-sm rounded-md shadow">
          {toastMessage}
        </div>
      )}

      {/* SVG导入进度弹窗 - 优化版本 */}
      {isImporting && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl pointer-events-auto">
            <div className="flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
            <h3 className="text-lg font-semibold text-center mb-2">正在导入矢量文件</h3>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(5, importProgress)}%` }}
              ></div>
            </div>
            <p className="text-gray-600 text-center text-sm">
              {importProgress > 0 ? `${Math.round(importProgress)}% 已完成` : '正在解析文件...'}
            </p>
            {importStatus && (
              <p className="text-gray-500 text-center text-xs mt-1">
                {importStatus}
              </p>
            )}
            <div className="mt-3 text-xs text-gray-400 text-center">
              <p>性能优化已启用</p>
              <p>最大点数: {performanceConfig.maxPointsPerPath} | 简化容差: {performanceConfig.simplificationTolerance}</p>
            </div>
          </div>
        </div>
      )}

      {/* 性能配置面板 */}
      {showPerformanceConfig && (
        <PerformanceConfigPanel
          config={performanceConfig}
          onConfigChange={setPerformanceConfig}
          onClose={() => setShowPerformanceConfig(false)}
        />
      )}

      {/* 导入进度模态框 */}
      <ImportProgressModal
        isVisible={isImporting}
        progress={importProgress}
        status={importStatus}
        onCancel={() => setIsImporting(false)}
      />
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
    // 由原生(Android/iOS)调用，将矢量图数据导入白板。ext 支持 'svg' | 'dxf' | 'plt'
    importVectorToWhiteboard?: (content: string, ext?: string) => void;
    // 当白板未就绪时，暂存待导入的矢量数据
    __pendingVectorImport?: { content: string; ext: string } | null;
  }
}

// 导出SVG解析函数供其他组件使用
// export const parseSvgWithSvgson = async (svgContent: string): Promise<CanvasItemData[]> => {
//   const svgJson = await parseSvgson(svgContent);
//   // 获取viewBox和缩放
//   let viewBox: number[] = [0, 0, 0, 0];
//   let scaleX = 1, scaleY = 1;
//   if (svgJson.attributes.viewBox) {
//     viewBox = svgJson.attributes.viewBox.split(/\s+/).map(Number);
//   }
//   if (svgJson.attributes.width && svgJson.attributes.height && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
//     scaleX = parseFloat(svgJson.attributes.width) / viewBox[2];
//     scaleY = parseFloat(svgJson.attributes.height) / viewBox[3];
//   }

//   // 递归处理
//   function walk(node: any, parentTransform: DOMMatrix, items: CanvasItemData[] = []) {
//     // 跳过无关元素
//     const skipTags = ['defs', 'clipPath', 'mask', 'marker', 'symbol', 'use', 'style', 'title'];
//     if (skipTags.includes(node.name)) return items;

//     // 合并transform
//     let currentTransform = parentTransform.translate(0, 0); // 创建副本
//     if (node.attributes.transform) {
//       const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
//       const tempG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
//       tempG.setAttribute('transform', node.attributes.transform);
//       tempSvg.appendChild(tempG);
//       const ctm = tempG.getCTM();
//       if (ctm) { // FIX: Check for null before using
//         currentTransform.multiplySelf(ctm);
//       }
//     }

//     // 处理path
//     if (node.name === 'path' && node.attributes.d) {
//       const d = node.attributes.d;
//       try {
//         const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
//         const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
//         tempPath.setAttribute('d', d);
//         tempSvg.appendChild(tempPath);
//         const totalLength = tempPath.getTotalLength();
//         if (totalLength > 0) {
//           const sampleCount = Math.max(Math.floor(totalLength), 128);
//           const absPoints: { x: number, y: number }[] = [];
//           for (let i = 0; i <= sampleCount; i++) {
//             const len = (i / sampleCount) * totalLength;
//             const pt = tempPath.getPointAtLength(len);
//             const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
//             absPoints.push({ x: transformedPt.x * scaleX, y: transformedPt.y * scaleY });
//           }
//           if (absPoints.length >= 2) {
//             const minX = Math.min(...absPoints.map(p => p.x));
//             const maxX = Math.max(...absPoints.map(p => p.x));
//             const minY = Math.min(...absPoints.map(p => p.y));
//             const maxY = Math.max(...absPoints.map(p => p.y));
//             const centerX = (minX + maxX) / 2;
//             const centerY = (minY + maxY) / 2;
//             items.push({
//               type: CanvasItemType.DRAWING,
//               x: centerX,
//               y: centerY,
//               points: absPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY })),
//               fillColor: node.attributes.fill,
//               strokeWidth: Number(node.attributes['stroke-width']) || 0,
//               color: '',
//               rotation: 0,
//             });
//           }
//         }
//       } catch (e) { }
//     }
//     // 处理rect
//     else if (node.name === 'rect') {
//       const x = Number(node.attributes.x);
//       const y = Number(node.attributes.y);
//       const w = Number(node.attributes.width);
//       const h = Number(node.attributes.height);
//       const pts = [
//         { x: x, y: y },
//         { x: x + w, y: y },
//         { x: x + w, y: y + h },
//         { x: x, y: y + h },
//         { x: x, y: y },
//       ].map(pt => {
//         const tpt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
//         return { x: tpt.x * scaleX, y: tpt.y * scaleY };
//       });
//       const drawing = createCenterCoordinateDrawing(pts, {
//         color: node.attributes.stroke || node.attributes.fill || '#2563eb',
//         strokeWidth: Number(node.attributes['stroke-width']) || 2,
//         fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
//       });
//       if (drawing) items.push(drawing);
//     }
//     // 处理circle
//     else if (node.name === 'circle') {
//       const cx = Number(node.attributes.cx);
//       const cy = Number(node.attributes.cy);
//       const r = Number(node.attributes.r);
//       const segs = 64;
//       const pts = Array.from({ length: segs + 1 }, (_, i) => {
//         const angle = (i / segs) * 2 * Math.PI;
//         const pt = new DOMPoint(cx + r * Math.cos(angle), cy + r * Math.sin(angle)).matrixTransform(currentTransform);
//         return { x: pt.x * scaleX, y: pt.y * scaleY };
//       });
//       const drawing = createCenterCoordinateDrawing(pts, {
//         color: node.attributes.stroke || node.attributes.fill || '#2563eb',
//         strokeWidth: Number(node.attributes['stroke-width']) || 2,
//         fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
//       });
//       if (drawing) items.push(drawing);
//     }
//     // 处理ellipse
//     else if (node.name === 'ellipse') {
//       const cx = Number(node.attributes.cx);
//       const cy = Number(node.attributes.cy);
//       const rx = Number(node.attributes.rx);
//       const ry = Number(node.attributes.ry);
//       const segs = 64;
//       const pts = Array.from({ length: segs + 1 }, (_, i) => {
//         const angle = (i / segs) * 2 * Math.PI;
//         const pt = new DOMPoint(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)).matrixTransform(currentTransform);
//         return { x: pt.x * scaleX, y: pt.y * scaleY };
//       });
//       const drawing = createCenterCoordinateDrawing(pts, {
//         color: node.attributes.stroke || node.attributes.fill || '#2563eb',
//         strokeWidth: Number(node.attributes['stroke-width']) || 2,
//         fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
//       });
//       if (drawing) items.push(drawing);
//     }
//     // 处理line
//     else if (node.name === 'line') {
//       const x1 = Number(node.attributes.x1);
//       const y1 = Number(node.attributes.y1);
//       const x2 = Number(node.attributes.x2);
//       const y2 = Number(node.attributes.y2);
//       const pts = [
//         new DOMPoint(x1, y1).matrixTransform(currentTransform),
//         new DOMPoint(x2, y2).matrixTransform(currentTransform),
//       ].map(pt => ({ x: pt.x * scaleX, y: pt.y * scaleY }));
//       const drawing = createCenterCoordinateDrawing(pts, {
//         color: node.attributes.stroke || node.attributes.fill || '#2563eb',
//         strokeWidth: Number(node.attributes['stroke-width']) || 2,
//       });
//       if (drawing) items.push(drawing);
//     }
//     // 处理polygon
//     else if (node.name === 'polygon' && node.attributes.points) {
//       const rawPoints = node.attributes.points.trim().split(/\s+/).map((pair: string) => pair.split(',').map(Number));
//       const pts = rawPoints.map(([x, y]: [number, number]) => {
//         const pt = new DOMPoint(x, y).matrixTransform(currentTransform);
//         return { x: pt.x * scaleX, y: pt.y * scaleY };
//       });
//       if (pts.length >= 2) {
//         // polygon自动闭合
//         let points = pts;
//         if (pts.length < 2 || pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y) {
//           points = [...pts, pts[0]];
//         }
//         const drawing = createCenterCoordinateDrawing(points, {
//           color: node.attributes.stroke || node.attributes.fill || '#2563eb',
//           strokeWidth: Number(node.attributes['stroke-width']) || 2,
//           fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
//         });
//         if (drawing) items.push(drawing);
//       }
//     }
//     // 处理polyline
//     else if (node.name === 'polyline' && node.attributes.points) {
//       const rawPoints = node.attributes.points.trim().split(/\s+/).map((pair: string) => pair.split(',').map(Number));
//       const pts = rawPoints.map(([x, y]: [number, number]) => {
//         const pt = new DOMPoint(x, y).matrixTransform(currentTransform);
//         return { x: pt.x * scaleX, y: pt.y * scaleY };
//       });
//       if (pts.length >= 2) {
//         const drawing = createCenterCoordinateDrawing(pts, {
//           color: node.attributes.stroke || node.attributes.fill || '#2563eb',
//           strokeWidth: Number(node.attributes['stroke-width']) || 2,
//           fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
//         });
//         if (drawing) items.push(drawing);
//       }
//     }

//     // 递归children
//     if (node.children && node.children.length > 0) {
//       node.children.forEach((child: any) => walk(child, currentTransform, items));
//     }

//     return items;
//   }

//   const items: CanvasItemData[] = [];
//   const rootTransform = new DOMMatrix();
//   walk(svgJson, rootTransform, items);
//   return items;
// };

// 导出SVG解析函数供其他组件使用 8-25
// svgson + svg.js递归解析SVG节点
export const parseSvgWithSvgson = async (svgContent: string): Promise<CanvasItemData[]> => {
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

    const viewboxDiagonalLength = Math.sqrt(viewBox[2] ** 2 + viewBox[3] ** 2);

    // 处理path
    // 处理path
    // <<< MODIFIED & FIXED >>> 重构 path 处理逻辑
    if (node.name === 'path' && node.attributes.d) {
      const d = node.attributes.d;

      const subPathChunks = d.trim().split(/(?=[Mm])/).filter((sp: string) => sp.trim() !== '');

      let lastEndPoint = { x: 0, y: 0 };

      for (const subPathData of subPathChunks) {
        try {
          let effectiveD: string;
          const command = subPathData.trim()[0];
          const isRelative = command === 'm';

          // 提取出 'm' 或 'M' 后面的坐标和剩余指令
          // 正则表达式匹配指令字母，可选的空格，然后是两个数字，最后捕获剩余所有内容
          //const pathRegex = /^[Mm]\s*(-?[\d.]+)\s*,?\s*(-?[\d.]+)(.*)/;
          const numberPattern = '-?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?';
          const pathRegex = new RegExp(`^[Mm]\\s*(${numberPattern})\\s*,?\\s*(${numberPattern})(.*)`);
          const match = subPathData.trim().match(pathRegex);

          if (!match) {
            // 如果路径段不是以 M/m 开头，或者格式不匹配，则跳过
            // 这种情况可能发生在 SVG 格式非常不规范时
            console.warn("跳过格式不正确的路径段:", subPathData);
            continue;
          }

          const xVal = parseFloat(match[1]);
          const yVal = parseFloat(match[2]);
          const remainingD = match[3].trim(); // 捕获到的剩余路径指令，如 "a196.587..."

          let newX = xVal;
          let newY = yVal;

          if (isRelative) {
            newX += lastEndPoint.x;
            newY += lastEndPoint.y;
          }

          // 构建以绝对坐标 'M' 开头的、可以被独立渲染的 d 属性
          effectiveD = `M ${newX} ${newY} ${remainingD}`;

          const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          tempPath.setAttribute('d', effectiveD);
          tempSvg.appendChild(tempPath);

          const totalLength = tempPath.getTotalLength();

          if (totalLength > viewboxDiagonalLength / 10000) {
            const absPoints = adaptiveSamplePath(tempPath, { minSegmentLength: 2, curvatureThreshold: 0.1, maxSamples: 500 }).map(pt => {
              const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
              return { x: transformedPt.x * scaleX, y: transformedPt.y * scaleY };
            });

            if (absPoints.length >= 2) {
              const drawing = createCenterCoordinateDrawing(absPoints, {
                fillColor: node.attributes.fill,
                strokeWidth: Number(node.attributes['stroke-width']) || 0,
                color: node.attributes.stroke || '#2563eb',
                rotation: 0,
              });
              if (drawing) {
                items.push(drawing);
              }
            }

            const endPoint = tempPath.getPointAtLength(totalLength);
            lastEndPoint = { x: endPoint.x, y: endPoint.y };
          } else {
            // 如果路径长度为0（可能只有一个M指令），我们也需要更新终点位置
            lastEndPoint = { x: newX, y: newY };
          }
        } catch (e) {
          console.warn("解析子路径时出错:", subPathData, e);
        }
      }
    }
    // <<< END MODIFIED & FIXED >>>
    // <<< END MODIFIED >>>
    // if (node.name === 'path' && node.attributes.d) {
    //   // 只采样有填充的 path
    //   //if (!node.attributes.fill || node.attributes.fill === 'none') return items;
    //   const d = node.attributes.d;
    //   try {
    //     const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    //     const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    //     tempPath.setAttribute('d', d);
    //     tempSvg.appendChild(tempPath);
    //     const totalLength = tempPath.getTotalLength();
    //     if (totalLength > 0) {
    //       const sampleCount = Math.max(Math.floor(totalLength), 128);
    //       const absPoints: { x: number, y: number }[] = [];
    //       for (let i = 0; i <= sampleCount; i++) {
    //         const len = (i / sampleCount) * totalLength;
    //         const pt = tempPath.getPointAtLength(len);
    //         const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
    //         absPoints.push({ x: transformedPt.x * scaleX, y: transformedPt.y * scaleY });
    //       }
    //       if (absPoints.length >= 2) {
    //         const minX = Math.min(...absPoints.map(p => p.x));
    //         const maxX = Math.max(...absPoints.map(p => p.x));
    //         const minY = Math.min(...absPoints.map(p => p.y));
    //         const maxY = Math.max(...absPoints.map(p => p.y));
    //         const centerX = (minX + maxX) / 2;
    //         const centerY = (minY + maxY) / 2;
    //         items.push({
    //           type: CanvasItemType.DRAWING,
    //           x: centerX,
    //           y: centerY,
    //           points: absPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY })),
    //           fillColor: node.attributes.fill,
    //           strokeWidth: Number(node.attributes['stroke-width']) || 0,
    //           color: '',
    //           rotation: 0,
    //         });
    //       }
    //     }
    //   } catch (e) { }
    // }
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
      const drawing = createCenterCoordinateDrawing(pts, {
        color: node.attributes.stroke || node.attributes.fill || '#2563eb',
        strokeWidth: Number(node.attributes['stroke-width']) || 2,
        fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
      });
      if (drawing) items.push(drawing);
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
      const drawing = createCenterCoordinateDrawing(pts, {
        color: node.attributes.stroke || node.attributes.fill || '#2563eb',
        strokeWidth: Number(node.attributes['stroke-width']) || 2,
        fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
      });
      if (drawing) items.push(drawing);
    }
    // 处理eclipse
    else if (node.name === 'eclipse') {
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
      const drawing = createCenterCoordinateDrawing(pts, {
        color: node.attributes.stroke || node.attributes.fill || '#2563eb',
        strokeWidth: Number(node.attributes['stroke-width']) || 2,
        fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
      });
      if (drawing) items.push(drawing);
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
      const drawing = createCenterCoordinateDrawing(pts, {
        color: node.attributes.stroke || node.attributes.fill || '#2563eb',
        strokeWidth: Number(node.attributes['stroke-width']) || 2,
      });
      if (drawing) items.push(drawing);
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
        const drawing = createCenterCoordinateDrawing(points, {
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
        if (drawing) items.push(drawing);
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
        const drawing = createCenterCoordinateDrawing(pts, {
          color: node.attributes.stroke || node.attributes.fill || '#2563eb',
          strokeWidth: Number(node.attributes['stroke-width']) || 2,
          fillColor: (node.attributes.fill && node.attributes.fill !== 'none') ? String(node.attributes.fill) : undefined,
        });
        if (drawing) items.push(drawing);
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
};

export default WhiteboardPage;