import React from 'react';
import { Layer, PrintingMethod, CanvasItem, CanvasItemType } from '../types';
import PartRenderer from './renderers/PartRenderer';

// 帮助函数：根据类型获取中文名称
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

// 新组件: 渲染雕刻图层的轨迹列表
const EngravingTrajectoryList: React.FC<{ layer: Layer; items: CanvasItem[] }> = ({ layer, items }) => {
  const layerItems = items.filter(item => item.layerId === layer.id && item.type !== CanvasItemType.IMAGE);

  if (layerItems.length === 0) {
    return <p className="text-sm text-gray-500 text-center py-4">该图层没有可雕刻的矢量轨迹。</p>;
  }
  
  return (
    <div className="space-y-2">
      {layerItems.map((item, index) => (
        <div key={item.id} className="p-2 border rounded bg-white shadow-sm">
          <div className="font-semibold text-sm">类型：{getTypeName(item.type)}</div>
          <div className="text-xs text-gray-600">ID：{getTypeName(item.type)}{index + 1}</div>
          <div className="text-xs text-gray-600">坐标：x: {Math.round(item.x)}, y: {Math.round(item.y)}</div>
          {'parameters' in item && item.parameters && (
            <div className="text-xs text-gray-600 break-all">参数：{Object.entries(item.parameters).map(([k, v]) => `${k}: ${v}`).join(', ')}</div>
          )}
        </div>
      ))}
    </div>
  );
};

// 重构后的预览组件，可同时用于扫描和雕刻图层
const LayerPreview: React.FC<{
  layer: Layer;
  items: CanvasItem[];
  canvasWidth: number;
  canvasHeight: number;
}> = ({ layer, items, canvasWidth, canvasHeight }) => {
  
  let layerItems = items.filter(item => item.layerId === layer.id);

  // 雕刻图层预览不应显示位图
  if (layer.printingMethod === PrintingMethod.ENGRAVE) {
      layerItems = layerItems.filter(item => item.type !== CanvasItemType.IMAGE);
  }

  return (
    <svg width={200} height={200} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} className="border rounded-md bg-white">
      {layerItems.map(item => {
        const type = String(item.type);
        if (type === CanvasItemType.DRAWING && 'points' in item && Array.isArray(item.points)) {
          const transform = `translate(${item.x || 0},${item.y || 0}) rotate(${item.rotation || 0})`;
          return (
            <polyline
              key={item.id}
              points={item.points.map((p: any) => `${p.x},${p.y}`).join(' ')}
              stroke={'color' in item ? (item.color || '#2563eb') : '#2563eb'}
              strokeWidth={'strokeWidth' in item ? (item.strokeWidth || 2) : 2}
              fill={'fillColor' in item ? (item.fillColor || 'none') : 'none'}
              transform={transform}
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
              textAnchor="middle" 
              alignmentBaseline="middle"
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
        // 使用 PartRenderer 统一渲染所有基于参数的零件
        if ('parameters' in item && type !== CanvasItemType.TEXT && type !== CanvasItemType.IMAGE && type !== CanvasItemType.DRAWING) {
          return <PartRenderer key={item.id} part={item as any} isSelected={false} />;
        }
        return null;
      })}
    </svg>
  );
};


const LayerSettingsPanel: React.FC<LayerSettingsPanelProps> = ({ layers, selectedLayerId, onSelectLayer, onUpdateLayer, items, canvasWidth, canvasHeight }) => {
  const selectedLayer = layers.find(l => l.id === selectedLayerId) || layers[0];

  const handleInputChange = (key: 'lineDensity' | 'power' | 'reverseMovementOffset', value: number) => {
    if (!selectedLayer) return;
    const updates: Partial<Layer> = {};
    updates[key] = value;
    onUpdateLayer(selectedLayer.id, updates);
  };
  const handleCheckboxChange = (key: 'halftone', value: boolean) => {
    if (!selectedLayer) return;
    const updates: Partial<Layer> = {};
    updates[key] = value;
    onUpdateLayer(selectedLayer.id, updates);
  };

  return (
    <div className="flex h-full bg-gray-100">
      {/* 左侧图层列表 */}
      <div className="w-48 border-r bg-white p-2 overflow-y-auto">
        <h3 className="text-base font-semibold mb-2 px-1">图层列表</h3>
        <ul>
          {layers.map(layer => (
            <li
              key={layer.id}
              className={`p-2 rounded cursor-pointer flex items-center justify-between gap-2 mb-1 ${selectedLayer?.id === layer.id ? 'bg-blue-500 text-white' : 'hover:bg-gray-200'}`}
              onClick={() => onSelectLayer(layer.id)}
            >
              <span className="truncate flex-1">{layer.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${selectedLayer?.id === layer.id ? 'bg-white text-blue-500' : 'bg-gray-200 text-gray-700'}`}>
                {layer.printingMethod === 'scan' ? '扫描' : '雕刻'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* 右侧设置区域 */}
      <div className="flex-1 p-4 overflow-y-auto max-h-full">
        {selectedLayer && (
          <>
            <h2 className="text-xl font-bold mb-4 pb-2 border-b">{selectedLayer.name} 设置</h2>
            
            {/* 统一的预览图区域 */}
            <div className="mb-4">
                <h3 className="text-md font-semibold mb-2">图层预览</h3>
                <div className="flex justify-center items-center p-2 border rounded-lg bg-gray-200">
                    <LayerPreview layer={selectedLayer} items={items} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                </div>
            </div>

            {selectedLayer.printingMethod === PrintingMethod.SCAN ? (
              // --- 扫描图层设置 ---
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">线密度 (线/毫米)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={selectedLayer.lineDensity ?? 10}
                    onChange={e => handleInputChange('lineDensity', Number(e.target.value))}
                    className="w-full p-2 border rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">空移距离 (mm)</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.1}
                    value={selectedLayer.reverseMovementOffset ?? 3}
                    onChange={e => handleInputChange('reverseMovementOffset', Number(e.target.value))}
                    className="w-full p-2 border rounded-md"
                  />
                  <p className="text-xs text-gray-500 mt-1">每行扫描时在两端额外移动的距离</p>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={!!selectedLayer.halftone}
                    onChange={e => handleCheckboxChange('halftone', e.target.checked)}
                    id="halftone-checkbox"
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="halftone-checkbox" className="ml-2 block text-sm text-gray-900">半调网屏</label>
                </div>
              </div>
            ) : (
              // --- 雕刻图层设置 ---
              <div className="space-y-4">
                  {/* 激光功率设置 */}
                  <div>
                    <label className="block text-sm font-medium mb-1">激光功率（%）</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={selectedLayer.power ?? 50}
                      onChange={e => handleInputChange('power', Number(e.target.value))}
                      className="w-full p-2 border rounded-md"
                    />
                  </div>

                  {/* 可滚动的轨迹列表 */}
                  <div>
                      <h3 className="text-md font-semibold mb-2">轨迹列表</h3>
                      <div className="p-2 border rounded-lg bg-gray-200 overflow-y-auto" style={{ maxHeight: '250px' }}>
                          <EngravingTrajectoryList layer={selectedLayer} items={items} />
                      </div>
                  </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LayerSettingsPanel;