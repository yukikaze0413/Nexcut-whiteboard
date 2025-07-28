import React, { useState, useEffect, useCallback, ChangeEvent, KeyboardEvent } from 'react';
import type { CanvasItem, Layer } from '../types';
import { CanvasItemType } from '../types';

interface ParameterEditorProps {
  selectedItem: CanvasItem | null;
  layers: Layer[];
  onUpdateItem: (itemId: string, updates: Partial<CanvasItem>) => void;
  onDeleteItem: (itemId: string) => void;
  onCommitUpdate: () => void;
}

const translations: Record<string, string> = {
    // Item types
    [CanvasItemType.RECTANGLE]: '矩形',
    [CanvasItemType.L_BRACKET]: 'L型支架',
    [CanvasItemType.U_CHANNEL]: 'U型槽',
    [CanvasItemType.CIRCLE]: '圆形',
    [CanvasItemType.FLANGE]: '法兰',
    [CanvasItemType.DRAWING]: '绘图',
    [CanvasItemType.TEXT]: '文本',
    [CanvasItemType.IMAGE]: '图片',
    [CanvasItemType.LINE]: '直线',
    [CanvasItemType.POLYLINE]: '多段线',
    [CanvasItemType.ARC]: '圆弧',
    [CanvasItemType.SECTOR]: '扇形',
    [CanvasItemType.TORUS]: '圆环',
    [CanvasItemType.EQUILATERAL_TRIANGLE]: '等边三角形',
    [CanvasItemType.ISOSCELES_RIGHT_TRIANGLE]: '直角等腰三角形',
    [CanvasItemType.CIRCLE_WITH_HOLES]: '带孔圆板',
    [CanvasItemType.RECTANGLE_WITH_HOLES]: '带孔矩形板',

    // Parameters
    'width': '宽度',
    'height': '高度',
    'radius': '半径',
    'thickness': '厚度',
    'flange': '凸缘',
    'outerDiameter': '外径',
    'innerDiameter': '内径',
    'boltCircleDiameter': '螺栓孔中心圆直径',
    'boltHoleCount': '螺栓孔数量',
    'boltHoleDiameter': '螺栓孔直径',
    'length': '长度',
    'seg1': '段1长度',
    'seg2': '段2长度',
    'seg3': '段3长度',
    'angle': '拐角角度',
    'startAngle': '起始角度',
    'sweepAngle': '扫描角度',
    'outerRadius': '外圈半径',
    'innerRadius': '内圈半径',
    'sideLength': '边长',
    'legLength': '直角边长',
    'holeRadius': '孔半径',
    'holeCount': '孔数量',
    'holeDistance': '孔距中心距离',
    'horizontalMargin': '水平边距',
    'verticalMargin': '垂直边距',


    // Generic properties
    'text': '文本内容',
    'fontSize': '字体大小',
    'color': '颜色',
    'rotation': '旋转',
    'strokeWidth': '描边宽度',
    'layer': '图层',

    // UI Text
    'Properties': '属性',
    'ID': 'ID',
    'Delete Item': '删除项目',
    'Select an item to edit its properties.': '选择一个项目以编辑其属性。'
};

const t = (key: string): string => translations[key] || key;


const EditableParameterInput: React.FC<{
  label: string;
  initialValue: string | number;
  onCommit: (newValue: string | number) => void;
  type?: string;
  min?: number;
}> = ({ label, initialValue, onCommit, type = 'number', min }) => {
  const [value, setValue] = useState(String(initialValue));

  useEffect(() => {
    setValue(String(initialValue));
  }, [initialValue]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  const handleBlur = () => {
    if (type === 'number') {
      const numericValue = parseFloat(value);
      if (value.trim() !== '' && !isNaN(numericValue) && (min === undefined || numericValue >= min)) {
        onCommit(numericValue);
      } else {
        setValue(String(initialValue));
      }
    } else {
      onCommit(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setValue(String(initialValue));
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 capitalize mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        min={min}
        className="w-full bg-white text-gray-900 rounded-md p-2 border border-gray-300 focus:ring-teal-500 focus:border-teal-500"
      />
    </div>
  );
};

// 拆分组合对象参数编辑为独立组件
const GroupParameterEditor: React.FC<{
  selectedItem: any;
  onUpdateItem: (itemId: string, updates: Partial<CanvasItem>) => void;
  onCommitUpdate: () => void;
}> = ({ selectedItem, onUpdateItem, onCommitUpdate }) => {
  // 取第一个线条的颜色和缩放为参考
  const firstDrawing = selectedItem.children.find((child: any) => child.type === 'DRAWING');
  const defaultColor = firstDrawing && 'color' in firstDrawing ? firstDrawing.color : '#2563eb';
  const [color, setColor] = React.useState(defaultColor);
  const [width, setWidth] = React.useState(selectedItem.width);
  const [height, setHeight] = React.useState(selectedItem.height);
  const [rotation, setRotation] = React.useState(selectedItem.rotation);

  // 颜色变更
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setColor(newColor);
    // 批量更新所有子线条颜色
    selectedItem.children.forEach((child: any) => {
      if (child.type === 'DRAWING') {
        onUpdateItem(child.id, { color: newColor });
      }
    });
    onCommitUpdate();
  };

  // 宽高变更
  const handleSizeChange = (key: 'width' | 'height', value: number) => {
    if (value <= 0) return;
    const oldW = selectedItem.width;
    const oldH = selectedItem.height;
    let scaleX = 1, scaleY = 1;
    if (key === 'width') {
      scaleX = value / oldW;
      scaleY = 1;
    } else {
      scaleX = 1;
      scaleY = value / oldH;
    }
    // 批量缩放所有子元素
    selectedItem.children.forEach((child: any) => {
      if ('points' in child && Array.isArray(child.points)) {
        const newPoints = (child.points as any[]).map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
        onUpdateItem(child.id, { points: newPoints });
      }
    });
    if (key === 'width') setWidth(value);
    if (key === 'height') setHeight(value);
    onUpdateItem(selectedItem.id, { width: key === 'width' ? value : selectedItem.width, height: key === 'height' ? value : selectedItem.height });
    onCommitUpdate();
  };

  // 旋转变更
  const handleRotationChange = (value: number) => {
    setRotation(value);
    onUpdateItem(selectedItem.id, { rotation: value });
    onCommitUpdate();
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <h3 className="text-lg font-semibold text-gray-800">组合对象</h3>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-600 mb-1">颜色</label>
        <input type="color" value={color} onChange={handleColorChange} className="w-12 h-8 p-1 bg-white border border-gray-300 rounded-md cursor-pointer" />
      </div>
      <div className="mb-4 flex gap-2">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">宽度</label>
          <input type="number" min="1" value={width} onChange={e => handleSizeChange('width', parseFloat(e.target.value))} className="w-20 p-1 bg-white border border-gray-300 rounded-md" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">高度</label>
          <input type="number" min="1" value={height} onChange={e => handleSizeChange('height', parseFloat(e.target.value))} className="w-20 p-1 bg-white border border-gray-300 rounded-md" />
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-600 mb-1">旋转</label>
        <input type="number" value={rotation} onChange={e => handleRotationChange(parseFloat(e.target.value))} className="w-20 p-1 bg-white border border-gray-300 rounded-md" />
      </div>
      <p className="text-gray-500 text-xs">可整体调整组合对象的颜色、宽高和旋转。</p>
    </div>
  );
};

const ParameterEditor: React.FC<ParameterEditorProps> = ({ selectedItem, layers, onUpdateItem, onDeleteItem, onCommitUpdate }) => {
    // GROUP类型单独渲染
    if (selectedItem && selectedItem.type === 'GROUP') {
      return <GroupParameterEditor selectedItem={selectedItem} onUpdateItem={onUpdateItem} onCommitUpdate={onCommitUpdate} />;
    }

    const handleUpdate = useCallback((key: string, value: string | number) => {
        if (!selectedItem) return;
        onUpdateItem(selectedItem.id, { [key]: value });
        onCommitUpdate();
    }, [selectedItem, onUpdateItem, onCommitUpdate]);
    
    const handleParameterUpdate = useCallback((paramName: string, value: number) => {
        if (!selectedItem || !('parameters' in selectedItem)) return;
        const newParameters = { ...selectedItem.parameters, [paramName]: value };
        onUpdateItem(selectedItem.id, { parameters: newParameters });
        onCommitUpdate();
    }, [selectedItem, onUpdateItem, onCommitUpdate]);
    
    const handleColorUpdate = useCallback((key: string, value: string) => {
        if (!selectedItem) return;
        onUpdateItem(selectedItem.id, { [key]: value });
    }, [selectedItem, onUpdateItem]);


    const renderContent = () => {
      if (!selectedItem) return null;
      switch(selectedItem.type) {
          case CanvasItemType.TEXT:
              return <>
                  <EditableParameterInput label={t('text')} type="text" initialValue={selectedItem.text} onCommit={(val) => handleUpdate('text', val as string)} />
                  <EditableParameterInput label={t('fontSize')} initialValue={selectedItem.fontSize} onCommit={(val) => handleUpdate('fontSize', val as number)} min={1}/>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 capitalize mb-1">{t('color')}</label>
                    <input type="color" value={selectedItem.color} onChange={(e) => handleColorUpdate('color', e.target.value)} onBlur={onCommitUpdate} className="w-full h-10 p-1 bg-white border border-gray-300 rounded-md cursor-pointer"/>
                  </div>
                  <EditableParameterInput label={t('rotation')} initialValue={selectedItem.rotation} onCommit={(val) => handleUpdate('rotation', val as number)} />
              </>;
          case CanvasItemType.IMAGE:
               return <>
                  <EditableParameterInput label={t('width')} initialValue={selectedItem.width} onCommit={(val) => handleUpdate('width', val as number)} min={1}/>
                  <EditableParameterInput label={t('height')} initialValue={selectedItem.height} onCommit={(val) => handleUpdate('height', val as number)} min={1}/>
                  <EditableParameterInput label={t('rotation')} initialValue={selectedItem.rotation} onCommit={(val) => handleUpdate('rotation', val as number)} />
              </>;
          case CanvasItemType.DRAWING:
               return <>
                  <EditableParameterInput label={t('strokeWidth')} initialValue={selectedItem.strokeWidth} onCommit={(val) => handleUpdate('strokeWidth', val as number)} min={1}/>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 capitalize mb-1">{t('color')}</label>
                    <input type="color" value={selectedItem.color} onChange={(e) => handleColorUpdate('color', e.target.value)} onBlur={onCommitUpdate} className="w-full h-10 p-1 bg-white border border-gray-300 rounded-md cursor-pointer"/>
                  </div>
               </>
          default: // Part types
              const showRotation = selectedItem.type !== CanvasItemType.ARC && selectedItem.type !== CanvasItemType.SECTOR;
              return <>
                  {showRotation && <EditableParameterInput label={t('rotation')} initialValue={selectedItem.rotation} onCommit={(val) => handleUpdate('rotation', val as number)} />}
                  {Object.entries(selectedItem.parameters).map(([key, value]) => (
                      <EditableParameterInput key={key} label={t(key)} initialValue={value} onCommit={(val) => handleParameterUpdate(key, val as number)} />
                  ))}
              </>;
      }
    }

    const handleLayerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedItem) return;
      onUpdateItem(selectedItem.id, { layerId: e.target.value });
      onCommitUpdate();
    };

    return (
        <div className="p-4 h-full flex flex-col">
          {selectedItem ? (
            <>
              <div className="flex-1 overflow-y-auto pr-2 space-y-4 pb-4">
                <h3 className="text-lg font-semibold text-gray-800">{t(selectedItem.type)} {t('Properties')}</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-600">{t('ID')}</label>
                  <p className="text-xs text-gray-500 truncate">{selectedItem.id}</p>
                </div>
                <div>
                  <label htmlFor="layer-select" className="block text-sm font-medium text-gray-600">{t('layer')}</label>
                  <select
                    id="layer-select"
                    value={selectedItem.layerId}
                    onChange={handleLayerChange}
                    className="w-full bg-white text-gray-900 rounded-md p-2 border border-gray-300 focus:ring-teal-500 focus:border-teal-500"
                  >
                    {layers.map(layer => (
                      <option key={layer.id} value={layer.id}>
                        {layer.name}
                      </option>
                    ))}
                  </select>
                </div>
                {renderContent()}
              </div>
              <div className="flex-shrink-0 pt-4 border-t border-gray-200">
                <button
                    onClick={() => onDeleteItem(selectedItem.id)}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors"
                >
                    {t('Delete Item')}
                </button>
              </div>
            </>
          ) : (
            <div className="h-full pt-4">
              <p className="text-gray-500">{t('Select an item to edit its properties.')}</p>
            </div>
          )}
        </div>
  );
};

export default ParameterEditor;