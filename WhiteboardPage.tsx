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
import PerformanceConfigPanel from './components/PerformanceConfigPanel';
import PerformanceMonitor from './components/PerformanceMonitor';
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
      name: '雕刻图层',
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

  // 添加G代码生成进度弹窗状态
  const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);
  const [generationProgress, setGenerationProgress] = useState('');

  // 添加状态用于显示导入进度
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');

  // 添加性能优化配置
  const [performanceConfig, setPerformanceConfig] = useState({
    maxPointsPerPath: 500,        // 每个路径最大点数
    simplificationTolerance: 2.0,  // 路径简化容差
    batchSize: 50,                // 批处理大小
    enableLOD: true,              // 启用细节层次
    maxTotalPoints: 5000          // 总点数限制
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

  // 处理从路由传递的图片数据 - 分离处理location.state的变化
  useEffect(() => {
    // 检查是否已经处理过这个location.state，避免重复处理
    if (processedLocationState === location.state) {
      return;
    }

    // 处理线框提取和矢量化的数据
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
              parsedItems: parsedItems // 使用解析后的矢量数据
            }
          } as Omit<ImageObject, 'id' | 'layerId'>);
        };
        img.src = displayImage;
      }

      // 清除路由状态，避免重复处理
      window.history.replaceState({}, document.title);
      return;
    }

    // 处理普通图片数据（原有逻辑）
    if (location.state?.image && location.state.image !== processedImage) {
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
    }
  }, [location.state, canvasWidth, canvasHeight, addItem, processedImage, processedLocationState]);

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

      // 只有扫描图层才添加扫描特有属性
      if (layerTypeSelect.value === 'scan') {
        newLayer.lineDensity = parseInt(lineDensityInput.value) || 10;
        newLayer.halftone = halftoneInput.checked;
        newLayer.reverseMovementOffset = parseFloat(reverseMovementOffsetInput.value) || 0;
        newLayer.maxPower = parseInt(maxPowerInput.value) || 100;
        newLayer.minPower = parseInt(minPowerInput.value) || 0;
        newLayer.moveSpeed = parseInt(moveSpeedInput.value) || 3000;
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

  // 优化的SVG解析函数 - 支持性能配置和进度回调
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

    // 优化: 缓存DOM元素以减少重复创建
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const transformCache = new Map<string, DOMMatrix>();

    // 优化: 分帧处理以避免阻塞UI
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    // 收集所有需要处理的节点
    const collectNodes = (node: any, nodes: any[] = []) => {
      const skipTags = ['defs', 'clipPath', 'mask', 'marker', 'symbol', 'use', 'style', 'title'];
      if (!skipTags.includes(node.name)) {
        nodes.push(node);
      }
      if (node.children) {
        node.children.forEach((child: any) => collectNodes(child, nodes));
      }
      return nodes;
    };

    const allNodes = collectNodes(svgJson);
    let processedNodes = 0;

    // 递归处理 - 优化版本
    async function walk(node: any, parentTransform: DOMMatrix, items: CanvasItemData[] = []) {
      // 跳过无关元素
      const skipTags = ['defs', 'clipPath', 'mask', 'marker', 'symbol', 'use', 'style', 'title'];
      if (skipTags.includes(node.name)) return items;

      // 优化: 使用缓存的变换矩阵
      let currentTransform = parentTransform.translate(0, 0); // 创建副本
      if (node.attributes.transform) {
        const transformKey = node.attributes.transform;
        if (transformCache.has(transformKey)) {
          const cachedMatrix = transformCache.get(transformKey)!;
          currentTransform.multiplySelf(cachedMatrix);
        } else {
        const tempG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          tempG.setAttribute('transform', transformKey);
        tempSvg.appendChild(tempG);
        const ctm = tempG.getCTM();
          if (ctm) {
            transformCache.set(transformKey, ctm);
          currentTransform.multiplySelf(ctm);
          }
          tempSvg.removeChild(tempG);
        }
      }

      // 处理path - 支持多笔段
      if (node.name === 'path' && node.attributes.d) {
        const d = node.attributes.d;
        try {
          const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          tempPath.setAttribute('d', d);
          tempSvg.appendChild(tempPath);
          const totalLength = tempPath.getTotalLength();
          if (totalLength > 0) {
            // 检查是否包含多个 moveto 命令（表示多个子路径）
            const movetoMatches = d.match(/[Mm]/g);
            const hasMultipleSubpaths = movetoMatches && movetoMatches.length > 1;

            if (hasMultipleSubpaths) {
              console.log(`检测到包含 ${movetoMatches.length} 个子路径的复杂path，使用智能分段采样`);

              // 解析 SVG path 的 d 属性，找到所有 M 命令的位置
              const findMovetoPositions = (pathD: string): number[] => {
                const movetoPositions: number[] = [];

                // 使用正则表达式找到所有 M/m 命令及其位置
                const movetoRegex = /[Mm][^MmZz]*/g;
                let match;
                const segments: string[] = [];

                while ((match = movetoRegex.exec(pathD)) !== null) {
                  segments.push(match[0]);
                }

                if (segments.length <= 1) return movetoPositions;

                console.log(`找到 ${segments.length} 个 M 命令段`);

                // 为每个段创建临时路径，计算其在总长度中的位置
                let accumulatedLength = 0;

                for (let i = 0; i < segments.length; i++) {
                  if (i > 0) {
                    // 从第二个段开始，记录断点位置
                    const lengthRatio = accumulatedLength / totalLength;
                    const sampleIndex = Math.round(lengthRatio * allPoints.length);
                    movetoPositions.push(sampleIndex);
                    console.log(`M命令 ${i + 1} 对应采样点索引: ${sampleIndex} (长度比例: ${(lengthRatio * 100).toFixed(1)}%)`);
                  }

                  // 计算当前段的长度
                  try {
                    // 构建到当前段结束的路径
                    const partialPath = segments.slice(0, i + 1).join(' ');
                    const tempPartialPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    tempPartialPath.setAttribute('d', partialPath);
                    tempSvg.appendChild(tempPartialPath);

                    const partialLength = tempPartialPath.getTotalLength();
                    accumulatedLength = partialLength;

                    tempSvg.removeChild(tempPartialPath);
                  } catch (error) {
                    console.warn(`计算段 ${i + 1} 长度失败:`, error);
                  }
                }

                return movetoPositions;
              };

              // 使用智能采样替代固定采样
              const maxSamples = Math.min(performanceConfig.maxPointsPerPath, Math.max(Math.floor(totalLength), 64));
              const rawPoints = smartSamplePath(tempPath, maxSamples);

              // 应用变换和缩放
              const allPoints: { x: number; y: number }[] = rawPoints.map(pt => {
              const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
                return { x: transformedPt.x * scaleX, y: transformedPt.y * scaleY };
              });

              // 更新进度
              setImportStatus(`处理复杂路径: ${allPoints.length} 个采样点`);

              // 基于 M 命令位置检测断点
              const totalSamples = allPoints.length;
              const breakIndices = findMovetoPositions(d);

              // 如果基于M命令的检测失败，使用多重几何检测策略
              if (breakIndices.length === 0 && allPoints.length > 2) {
                console.log('M命令检测未找到断点，使用多重几何检测策略');

                // 1. 距离检测（更敏感的阈值）
                const distances: number[] = [];
                for (let i = 1; i < allPoints.length; i++) {
                  const prev = allPoints[i - 1];
                  const curr = allPoints[i];
                  const dist = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));
                  distances.push(dist);
                }

                // 2. 方向变化检测（检测急剧转向）
                const directionChanges: number[] = [];
                for (let i = 2; i < allPoints.length; i++) {
                  const p1 = allPoints[i - 2];
                  const p2 = allPoints[i - 1];
                  const p3 = allPoints[i];

                  const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
                  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

                  const dot = v1.x * v2.x + v1.y * v2.y;
                  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
                  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

                  if (mag1 > 0 && mag2 > 0) {
                    const cosAngle = dot / (mag1 * mag2);
                    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
                    directionChanges.push(angle);
                  } else {
                    directionChanges.push(0);
                  }
                }

                // 3. 曲率变化检测（检测从直线到曲线的转换）
                const curvatureChanges: number[] = [];
                for (let i = 3; i < allPoints.length; i++) {
                  const p1 = allPoints[i - 3];
                  const p2 = allPoints[i - 2];
                  const p3 = allPoints[i - 1];
                  const p4 = allPoints[i];

                  // 计算前后两段的曲率差异
                  const curvature1 = calculateCurvature(p1, p2, p3);
                  const curvature2 = calculateCurvature(p2, p3, p4);
                  const curvatureChange = Math.abs(curvature2 - curvature1);
                  curvatureChanges.push(curvatureChange);
                }

                // 4. 速度变化检测（检测运动速度的突变）
                const velocityChanges: number[] = [];
                for (let i = 2; i < allPoints.length; i++) {
                  const p1 = allPoints[i - 2];
                  const p2 = allPoints[i - 1];
                  const p3 = allPoints[i];

                  const v1 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
                  const v2 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

                  if (v1 > 0) {
                    const velocityRatio = Math.abs(v2 - v1) / v1;
                    velocityChanges.push(velocityRatio);
                  } else {
                    velocityChanges.push(0);
                  }
                }

                // 计算各种阈值（更敏感）
                const sortedDistances = [...distances].sort((a, b) => a - b);
                const distanceQ75 = sortedDistances[Math.floor(sortedDistances.length * 0.75)];
                const distanceQ90 = sortedDistances[Math.floor(sortedDistances.length * 0.9)];
                const distanceThreshold = Math.max(distanceQ75 * 2, distanceQ90 * 1.5, totalLength / allPoints.length * 3);

                const sortedAngles = [...directionChanges].sort((a, b) => a - b);
                const angleQ85 = sortedAngles[Math.floor(sortedAngles.length * 0.85)];
                const angleThreshold = Math.max(angleQ85 * 0.9, Math.PI * 0.6); // 约108度

                const sortedCurvatures = [...curvatureChanges].sort((a, b) => a - b);
                const curvatureQ90 = sortedCurvatures[Math.floor(sortedCurvatures.length * 0.9)];
                const curvatureThreshold = curvatureQ90 * 0.8;

                const sortedVelocities = [...velocityChanges].sort((a, b) => a - b);
                const velocityQ90 = sortedVelocities[Math.floor(sortedVelocities.length * 0.9)];
                const velocityThreshold = Math.max(velocityQ90 * 0.8, 2.0); // 速度变化200%以上

                // 收集各类断点
                const distanceBreaks: number[] = [];
                const angleBreaks: number[] = [];
                const curvatureBreaks: number[] = [];
                const velocityBreaks: number[] = [];

                for (let i = 0; i < distances.length; i++) {
                  if (distances[i] > distanceThreshold) {
                    distanceBreaks.push(i + 1);
                  }
                }

                for (let i = 0; i < directionChanges.length; i++) {
                  if (directionChanges[i] > angleThreshold) {
                    angleBreaks.push(i + 2);
                  }
                }

                for (let i = 0; i < curvatureChanges.length; i++) {
                  if (curvatureChanges[i] > curvatureThreshold) {
                    curvatureBreaks.push(i + 3);
                  }
                }

                for (let i = 0; i < velocityChanges.length; i++) {
                  if (velocityChanges[i] > velocityThreshold) {
                    velocityBreaks.push(i + 2);
                  }
                }

                // 合并所有断点
                const allBreaks = [...distanceBreaks, ...angleBreaks, ...curvatureBreaks, ...velocityBreaks];
                const uniqueBreaks = [...new Set(allBreaks)].sort((a, b) => a - b);

                // 过滤太近的断点，但使用更小的最小间隔以捕获更多断点
                const minGap = Math.max(allPoints.length * 0.03, 3);
                for (const breakPoint of uniqueBreaks) {
                  if (breakIndices.length === 0 || breakPoint - breakIndices[breakIndices.length - 1] >= minGap) {
                    breakIndices.push(breakPoint);
                  }
                }

                console.log(`多重检测结果: 距离=${distanceBreaks.length}, 角度=${angleBreaks.length}, 曲率=${curvatureBreaks.length}, 速度=${velocityBreaks.length}, 最终=${breakIndices.length}`);
                console.log(`阈值: 距离=${distanceThreshold.toFixed(2)}, 角度=${(angleThreshold * 180 / Math.PI).toFixed(1)}°, 曲率=${curvatureThreshold.toFixed(4)}, 速度=${velocityThreshold.toFixed(2)}`);
              }

              // 曲率计算辅助函数
              function calculateCurvature(p1: {x: number, y: number}, p2: {x: number, y: number}, p3: {x: number, y: number}): number {
                const dx1 = p2.x - p1.x;
                const dy1 = p2.y - p1.y;
                const dx2 = p3.x - p2.x;
                const dy2 = p3.y - p2.y;

                const cross = dx1 * dy2 - dy1 * dx2;
                const dot = dx1 * dx2 + dy1 * dy2;

                const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

                if (len1 === 0 || len2 === 0) return 0;

                const curvature = Math.abs(cross) / (len1 * len2 * Math.sqrt(len1 * len1 + len2 * len2 + 2 * dot));
                return curvature;
              }

              // 计算边界框
              let minX = allPoints[0].x, maxX = allPoints[0].x;
              let minY = allPoints[0].y, maxY = allPoints[0].y;
              for (const p of allPoints) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
              }

              const centerX = (minX + maxX) / 2;
              const centerY = (minY + maxY) / 2;

              // 转换为相对坐标
              const originalPoints = allPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY }));

              if (breakIndices.length > 0) {
                // 有断点：按断点分割成多个笔段
                const allStrokes: { x: number; y: number }[][] = [];
                let segmentStart = 0;
                const allBreakPoints = [...breakIndices, allPoints.length].sort((a, b) => a - b);

                for (const breakPoint of allBreakPoints) {
                  if (breakPoint > segmentStart) {
                    const segmentPoints = originalPoints.slice(segmentStart, breakPoint);
                    if (segmentPoints.length >= 2) {
                      allStrokes.push(segmentPoints);
                    }
                    segmentStart = breakPoint;
                  }
                }

                // 生成显示用的简化数据 - 使用性能配置
                const displayStrokes = allStrokes.map(stroke => {
                  if (stroke.length > performanceConfig.maxPointsPerPath / 4) {
                    return simplifyPath(stroke, performanceConfig.simplificationTolerance, performanceConfig.maxPointsPerPath / 4);
                  }
                  return stroke;
                });

                console.log(`多笔段处理: ${allStrokes.length} 个笔段，总计 ${originalPoints.length} 个点`);

                items.push({
                  type: CanvasItemType.DRAWING,
                  x: centerX,
                  y: centerY,
                  points: displayStrokes[0] || [],
                  originalPoints: allStrokes[0] || [],
                  strokes: displayStrokes,
                  originalStrokes: allStrokes,
                  fillColor: node.attributes.fill,
                  strokeWidth: Number(node.attributes['stroke-width']) || 0,
                  color: '',
                  rotation: 0,
                });
              } else {
                // 无断点：使用单笔段 + 智能简化
                const shouldSimplify = originalPoints.length > performanceConfig.maxPointsPerPath / 2;
                const simplifiedDisplayPoints = shouldSimplify
                  ? simplifyPath(allPoints, performanceConfig.simplificationTolerance, performanceConfig.maxPointsPerPath / 2)
                  : allPoints;
                const displayPoints = simplifiedDisplayPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY }));

                console.log(`复杂单笔段处理: ${originalPoints.length} 个点 → ${displayPoints.length} 个显示点`);

                items.push({
                  type: CanvasItemType.DRAWING,
                  x: centerX,
                  y: centerY,
                  points: displayPoints,
                  originalPoints: originalPoints,
                  fillColor: node.attributes.fill,
                  strokeWidth: Number(node.attributes['stroke-width']) || 0,
                  color: '',
                  rotation: 0,
                });
              }
            } else {
              // 单子路径：使用优化的智能采样
              const maxSamplePoints = Math.min(performanceConfig.maxPointsPerPath, Math.max(Math.floor(totalLength), 64));
              setImportStatus(`处理单路径: 目标采样 ${maxSamplePoints} 个点`);

              const rawPoints = smartSamplePath(tempPath, maxSamplePoints);
              const highPrecisionPoints: { x: number, y: number }[] = rawPoints.map(pt => {
                const transformedPt = new DOMPoint(pt.x, pt.y).matrixTransform(currentTransform);
                return { x: transformedPt.x * scaleX, y: transformedPt.y * scaleY };
              });

              // 分批处理以避免阻塞UI
              if (highPrecisionPoints.length > performanceConfig.batchSize) {
                await sleep(0);
              }

              const absPoints = highPrecisionPoints;

            if (absPoints.length >= 2) {
                let minX = absPoints[0].x, maxX = absPoints[0].x;
                let minY = absPoints[0].y, maxY = absPoints[0].y;
                for (let i = 1; i < absPoints.length; i++) {
                  const p = absPoints[i];
                  if (p.x < minX) minX = p.x;
                  if (p.x > maxX) maxX = p.x;
                  if (p.y < minY) minY = p.y;
                  if (p.y > maxY) maxY = p.y;
                }

              const centerX = (minX + maxX) / 2;
              const centerY = (minY + maxY) / 2;

                const originalPoints = highPrecisionPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY }));
                const shouldSimplify = absPoints.length > performanceConfig.maxPointsPerPath / 2;
                const simplifiedDisplayPoints = shouldSimplify
                  ? simplifyPath(absPoints, performanceConfig.simplificationTolerance, performanceConfig.maxPointsPerPath / 2)
                  : absPoints;
                const displayPoints = simplifiedDisplayPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY }));

                console.log(`单路径采样: 高精度 ${highPrecisionPoints.length} 点 → 界面显示 ${displayPoints.length} 点`);

              items.push({
                type: CanvasItemType.DRAWING,
                x: centerX,
                y: centerY,
                  points: displayPoints,
                  originalPoints: originalPoints,
                fillColor: node.attributes.fill,
                strokeWidth: Number(node.attributes['stroke-width']) || 0,
                color: '',
                rotation: 0,
              });
            }
          }
          }
          tempSvg.removeChild(tempPath);
        } catch (e) { 
          console.warn('解析path失败:', e);
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

      // 更新进度
      processedNodes++;
      if (processedNodes % 10 === 0) {
        setImportProgress((processedNodes / allNodes.length) * 100);
        await sleep(0); // 让出控制权更新UI
      }

      // 递归children
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
    
    // 清理
    transformCache.clear();
    
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
        x: 0,
        y: 0,
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
    //alert(file.content);
    // SVG 导入
    if (file.ext === 'svg') {
      try {
        alert("1");
        // 显示导入进度
        setIsImporting(true);
        setImportProgress(0);
        alert("2");
      const parsedItems = await parseSvgWithSvgson(file.content);
      alert("3");
      if (parsedItems.length === 0) {
        alert('SVG未识别到可导入的线条');
          setIsImporting(false);
      } else {
        alert("4");
        // 保存原始SVG内容用于G代码生成
        const originalContent = file.content;
        alert("5");
        // 创建SVG图像用于显示
        const dataUrl = 'data:image/svg+xml;base64,' + toBase64Utf8(file.content);
        alert("6");
        const img = new Image();
        alert("7");
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
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
            
            // 隐藏进度条
            setIsImporting(false);
            setImportProgress(0);
        };
        alert("8");
        img.src = dataUrl;
        alert("9");
        }
      } catch (error) {
        console.error('SVG导入失败:', error);
        alert('SVG导入失败，请检查文件格式');
        setIsImporting(false);
        setImportProgress(0);
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
        const dataUrl = 'data:image/svg+xml;base64,' + toBase64Utf8(originalContent);
        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
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

          return createCenterCoordinateDrawing(transformedPoints, {
            color: '#eab308',
            strokeWidth: 2,
          });
        });

        // 保存原始PLT内容用于G代码生成
        const originalContent = file.content;

        // 创建PLT图像用于显示（这里简化处理，实际可能需要更复杂的转换）
        const dataUrl = 'data:image/svg+xml;base64,' + toBase64Utf8(`<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
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
            x: canvasWidth / 2,
            y: canvasHeight / 2,
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
        const dataUrl = 'data:image/svg+xml;base64,' + toBase64Utf8(originalContent);
        const img = new Image();
        img.onload = () => {
          // 创建图像对象时包含矢量源数据
          const imageData: Omit<ImageObject, 'id' | 'layerId'> = {
            type: CanvasItemType.IMAGE,
            x: canvasWidth / 2,
            y: canvasHeight / 2,
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
            x: canvasWidth / 2,
            y: canvasHeight / 2,
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

                  return createCenterCoordinateDrawing(transformedPoints, {
                    color: '#eab308',
                    strokeWidth: 2,
                  });
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

      {/* 性能监控组件 */}
      <PerformanceMonitor
        items={items}
        isVisible={showPerformanceMonitor}
        onToggle={() => setShowPerformanceMonitor(!showPerformanceMonitor)}
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

    // 处理path
    if (node.name === 'path' && node.attributes.d) {
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
            const maxX = Math.max(...absPoints.map(p => p.x));
            const minY = Math.min(...absPoints.map(p => p.y));
            const maxY = Math.max(...absPoints.map(p => p.y));
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            items.push({
              type: CanvasItemType.DRAWING,
              x: centerX,
              y: centerY,
              points: absPoints.map(p => ({ x: p.x - centerX, y: p.y - centerY })),
              fillColor: node.attributes.fill,
              strokeWidth: Number(node.attributes['stroke-width']) || 0,
              color: '',
              rotation: 0,
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
  return items;
};

export default WhiteboardPage;