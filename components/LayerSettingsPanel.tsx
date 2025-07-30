import React from 'react';
import { Layer, PrintingMethod, CanvasItem, CanvasItemType } from '../types';
import PartRenderer from './renderers/PartRenderer';

interface LayerSettingsPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, updates: Partial<Layer>) => void;
  items: CanvasItem[];
  canvasWidth: number;
  canvasHeight: number;
}

// 递归渲染零件和组合对象为SVG
const renderPartSVG = (item: CanvasItem, parentTransform: string = ''): React.ReactNode => {
  // 组合对象递归
  if (item.type === 'GROUP' && Array.isArray(item.children)) {
    const groupTransform = `${parentTransform} translate(${item.x || 0},${item.y || 0}) rotate(${item.rotation || 0})`;
    return (
      <g key={item.id} transform={groupTransform}>
        {item.children.map(child => renderPartSVG(child))}
      </g>
    );
  }
  // 其它类型
  let transform = `${parentTransform} translate(${item.x || 0},${item.y || 0})`;
  if ('rotation' in item && item.rotation) {
    transform += ` rotate(${item.rotation})`;
  }
  // RECTANGLE
  if (item.type === CanvasItemType.RECTANGLE && 'parameters' in item) {
    const w = item.parameters.width || 40;
    const h = item.parameters.height || 40;
    return <rect key={item.id} x={-w/2} y={-h/2} width={w} height={h} fill="none" stroke="#2563eb" strokeWidth={2} transform={transform} />;
  }
  // CIRCLE
  if (item.type === CanvasItemType.CIRCLE && 'parameters' in item) {
    const r = item.parameters.radius || 20;
    return <circle key={item.id} cx={0} cy={0} r={r} fill="none" stroke="#2563eb" strokeWidth={2} transform={transform} />;
  }
  // LINE
  if (item.type === CanvasItemType.LINE && 'parameters' in item) {
    const l = item.parameters.length || 40;
    return <line key={item.id} x1={-l/2} y1={0} x2={l/2} y2={0} stroke="#2563eb" strokeWidth={2} transform={transform} />;
  }
  // POLYLINE
  if (item.type === CanvasItemType.POLYLINE && 'parameters' in item) {
    const segs = [item.parameters.seg1, item.parameters.seg2, item.parameters.seg3].filter(Boolean);
    let points = [[0,0]];
    let x = 0;
    segs.forEach((len, i) => {
      x += len;
      points.push([x, 0]);
    });
    return <polyline key={item.id} points={points.map(p => p.join(",")).join(" ")} fill="none" stroke="#2563eb" strokeWidth={2} transform={transform} />;
  }
  // CIRCLE_WITH_HOLES
  if (item.type === CanvasItemType.CIRCLE_WITH_HOLES && 'parameters' in item) {
    const r = item.parameters.radius || 20;
    const holeR = item.parameters.holeRadius || 3;
    const count = item.parameters.holeCount || 4;
    const dist = item.parameters.holeDistance || (r-5);
    return (
      <g key={item.id} transform={transform}>
        <circle cx={0} cy={0} r={r} fill="none" stroke="#2563eb" strokeWidth={2} />
        {Array.from({length: count}).map((_, i) => {
          const angle = (2*Math.PI/count)*i;
          return <circle key={i} cx={Math.cos(angle)*dist} cy={Math.sin(angle)*dist} r={holeR} fill="none" stroke="#2563eb" strokeWidth={1} />;
        })}
      </g>
    );
  }
  // RECTANGLE_WITH_HOLES
  if (item.type === CanvasItemType.RECTANGLE_WITH_HOLES && 'parameters' in item) {
    const w = item.parameters.width || 40;
    const h = item.parameters.height || 20;
    const holeR = item.parameters.holeRadius || 3;
    const count = item.parameters.holeCount || 2;
    return (
      <g key={item.id} transform={transform}>
        <rect x={-w/2} y={-h/2} width={w} height={h} fill="none" stroke="#2563eb" strokeWidth={2} />
        {Array.from({length: count}).map((_, i) => (
          <circle key={i} cx={-w/4 + (i * w/2/(count-1))} cy={0} r={holeR} fill="none" stroke="#2563eb" strokeWidth={1} />
        ))}
      </g>
    );
  }
  // DRAWING
  if (item.type === CanvasItemType.DRAWING && 'points' in item && Array.isArray(item.points)) {
    return <polyline key={item.id} points={item.points.map((p: any) => `${p.x},${p.y}`).join(' ')} stroke={'color' in item ? (item.color || '#2563eb') : '#2563eb'} strokeWidth={'strokeWidth' in item ? (item.strokeWidth || 2) : 2} fill={'fillColor' in item ? (item.fillColor || 'none') : 'none'} transform={transform} />;
  }
  // TEXT
  if (item.type === CanvasItemType.TEXT && 'fontSize' in item && 'color' in item) {
    return <text key={item.id} x={0} y={0} fontSize={item.fontSize} fill={item.color} textAnchor="middle" alignmentBaseline="middle" transform={transform}>{('text' in item ? item.text : '')}</text>;
  }
  // 其它类型可继续补充...
  return null;
};

const renderVectorElementPreview = (item: CanvasItem) => {
  const size = 60;
  if (item.type === CanvasItemType.IMAGE) return null;
  return (
    <div key={item.id} className="flex flex-col items-center mx-2 my-2">
      <svg width={size} height={size} viewBox={`-30 -30 60 60`} className="border rounded bg-white">
        {renderPartSVG(item)}
      </svg>
      <div className="text-xs text-gray-500 mt-1">x: {item.x}, y: {item.y}</div>
    </div>
  );
};

const renderLayerPreview = (layer: Layer, items: CanvasItem[], canvasWidth: number, canvasHeight: number) => {
  const layerItems = items.filter(item => item.layerId === layer.id);
  
  // 类型映射函数
  const getTypeName = (type: CanvasItemType | 'GROUP'): string => {
    switch (type) {
      case CanvasItemType.DRAWING: return '手绘';
      case CanvasItemType.TEXT: return '文本';
      case CanvasItemType.IMAGE: return '图片';
      case CanvasItemType.RECTANGLE: return '矩形';
      case CanvasItemType.CIRCLE: return '圆形';
      case CanvasItemType.LINE: return '直线';
      case CanvasItemType.POLYLINE: return '折线';
      case CanvasItemType.CIRCLE_WITH_HOLES: return '带孔圆形';
      case CanvasItemType.RECTANGLE_WITH_HOLES: return '带孔矩形';
      case CanvasItemType.FLANGE: return '法兰';
      case CanvasItemType.TORUS: return '圆环';
      case CanvasItemType.U_CHANNEL: return 'U型槽';
      case CanvasItemType.L_BRACKET: return 'L型支架';
      case CanvasItemType.SECTOR: return '扇形';
      case CanvasItemType.ARC: return '圆弧';
      case CanvasItemType.EQUILATERAL_TRIANGLE: return '等边三角形';
      case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: return '等腰直角三角形';
      case 'GROUP': return '组合';
      default: return String(type);
    }
  };
  
  // 雕刻图层：只展示矢量元素的信息
  if (layer.printingMethod === PrintingMethod.ENGRAVE) {
    return (
      <div className="space-y-2">
        {layerItems.filter(item => item.type !== CanvasItemType.IMAGE).map((item, index) => (
          <div key={item.id} className="p-2 border rounded bg-gray-50">
            <div className="font-semibold text-sm">类型：{getTypeName(item.type)}</div>
            <div className="text-xs text-gray-600">ID：{getTypeName(item.type)}{index + 1}</div>
            <div className="text-xs text-gray-600">坐标：x: {item.x}, y: {item.y}</div>
            {'parameters' in item && item.parameters && (
              <div className="text-xs text-gray-600">参数：{Object.entries(item.parameters).map(([k, v]) => `${k}: ${v}`).join(', ')}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  // 扫描图层：保持原有整体预览
  return (
    <svg width={200} height={200} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} className="border rounded bg-white">
      {layerItems.map(item => {
        const type = String(item.type);
        if (type === CanvasItemType.DRAWING && 'points' in item && Array.isArray(item.points)) {
          return (
            <polyline
              key={item.id}
              points={item.points.map((p: any) => `${item.x + p.x},${item.y + p.y}`).join(' ')}
              stroke={'color' in item ? (item.color || '#2563eb') : '#2563eb'}
              strokeWidth={'strokeWidth' in item ? (item.strokeWidth || 2) : 2}
              fill={'fillColor' in item ? (item.fillColor || 'none') : 'none'}
            />
          );
        }
        if (type === CanvasItemType.TEXT && 'fontSize' in item && 'color' in item) {
          return (
            <text
              key={item.id}
              x={item.x}
              y={item.y}
              fontSize={item.fontSize}
              fill={item.color}
              transform={'rotation' in item && item.rotation ? `rotate(${item.rotation},${item.x},${item.y})` : undefined}
            >{('text' in item ? item.text : '')}</text>
          );
        }
        if (type === CanvasItemType.IMAGE && 'width' in item && 'height' in item && 'href' in item) {
          return (
            <image
              key={item.id}
              x={item.x}
              y={item.y}
              width={item.width}
              height={item.height}
              href={item.href}
              transform={'rotation' in item && item.rotation ? `rotate(${item.rotation},${item.x + item.width/2},${item.y + item.height/2})` : undefined}
            />
          );
        }
        if ('parameters' in item && type !== CanvasItemType.TEXT && type !== CanvasItemType.IMAGE && type !== CanvasItemType.DRAWING) {
          if (type === CanvasItemType.RECTANGLE) {
            const w = item.parameters.width || 40;
            const h = item.parameters.height || 40;
            return (
              <rect
                key={item.id}
                x={item.x - w/2}
                y={item.y - h/2}
                width={w}
                height={h}
                fill="none"
                stroke="#2563eb"
                strokeWidth={2}
                transform={'rotation' in item && item.rotation ? `rotate(${item.rotation},${item.x},${item.y})` : undefined}
              />
            );
          }
          return <PartRenderer key={item.id} part={item} isSelected={false} />;
        }
        return null;
      })}
    </svg>
  );
};

const LayerSettingsPanel: React.FC<LayerSettingsPanelProps> = ({ layers, selectedLayerId, onSelectLayer, onUpdateLayer, items, canvasWidth, canvasHeight }) => {
  const selectedLayer = layers.find(l => l.id === selectedLayerId) || layers[0];

  // 预览占位
  const renderPreview = () => (
    <div className="w-40 h-24 bg-gray-100 flex items-center justify-center rounded mb-4 border border-gray-200">
      <span className="text-gray-400 text-sm">图层预览</span>
    </div>
  );

  const handleInputChange = (key: 'lineDensity' | 'power', value: number) => {
    if (!selectedLayer) return;
    onUpdateLayer(selectedLayer.id, { [key]: value });
  };
  const handleCheckboxChange = (key: 'halftone', value: boolean) => {
    if (!selectedLayer) return;
    onUpdateLayer(selectedLayer.id, { [key]: value });
  };

  return (
    <div className="flex h-full">
      {/* 左侧边栏 */}
      <div className="w-56 border-r bg-gray-50 p-2 overflow-y-auto">
        <h3 className="text-base font-semibold mb-2">图层列表</h3>
        <ul>
          {layers.map(layer => (
            <li
              key={layer.id}
              className={`p-2 rounded cursor-pointer flex items-center gap-2 mb-1 ${selectedLayer?.id === layer.id ? 'bg-teal-100' : 'hover:bg-gray-100'}`}
              onClick={() => onSelectLayer(layer.id)}
            >
              <span className="truncate flex-1">{layer.name}</span>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {layer.printingMethod === 'scan' ? '扫描' : '雕刻'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* 右侧设置区 */}
      <div className="flex-1 p-6 overflow-y-auto max-h-full">
        {selectedLayer && (
          <>
            <h2 className="text-lg font-bold mb-2">{selectedLayer.name} 设置</h2>
            {renderLayerPreview(selectedLayer, items, canvasWidth, canvasHeight)}
            {selectedLayer.printingMethod === PrintingMethod.SCAN ? (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">线密度 (线/毫米)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={selectedLayer.lineDensity ?? 10}
                    onChange={e => handleInputChange('lineDensity', Number(e.target.value))}
                    className="w-full p-2 border rounded"
                  />
                </div>
                <div className="mb-4 flex items-center">
                  <input
                    type="checkbox"
                    checked={!!selectedLayer.halftone}
                    onChange={e => handleCheckboxChange('halftone', e.target.checked)}
                    id="halftone-checkbox"
                    className="h-4 w-4 text-teal-600 focus:ring-teal-500 border-gray-300 rounded"
                  />
                  <label htmlFor="halftone-checkbox" className="ml-2 block text-sm text-gray-900">半调网屏</label>
                </div>
              </>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">激光功率（%）</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={selectedLayer.power ?? 50}
                  onChange={e => handleInputChange('power', Number(e.target.value))}
                  className="w-32 p-2 border rounded"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LayerSettingsPanel; 