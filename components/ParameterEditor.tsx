import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import type { Layer } from '../types';

interface ParameterEditorProps {
  selectedObject: fabric.Object | null;
  layers: Layer[];
  onUpdateProperty: (prop: string, value: any) => void;
  onDeleteItem: () => void;
}

const translations: Record<string, string> = {
    // Item types
    'RECTANGLE': '矩形',
    'L_BRACKET': 'L型支架',
    'U_CHANNEL': 'U型槽',
    'CIRCLE': '圆形',
    'FLANGE': '法兰',
    'DRAWING': '绘图',
    'TEXT': '文本',
    'IMAGE': '图片',
    'LINE': '直线',
    'POLYLINE': '多段线',
    'ARC': '圆弧',
    'SECTOR': '扇形',
    'TORUS': '圆环',
    'EQUILATERAL_TRIANGLE': '等边三角形',
    'ISOSCELES_RIGHT_TRIANGLE': '直角等腰三角形',
    'CIRCLE_WITH_HOLES': '带孔圆板',
    'RECTANGLE_WITH_HOLES': '带孔矩形板',

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

    // Position properties
    'x': 'X坐标',
    'y': 'Y坐标',

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
    'Select an item to edit its properties.': '选择一个项目以编辑其属性。',
    'Position': '位置'
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
    // 如果是数字类型，格式化为两位小数
    if (type === 'number' && typeof initialValue === 'number') {
      setValue(initialValue.toFixed(2));
    } else {
      setValue(String(initialValue));
    }
  }, [initialValue, type]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  const handleBlur = () => {
    if (type === 'number') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        onCommit(numValue);
      } else {
        setValue(String(initialValue));
      }
    } else {
      onCommit(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setValue(String(initialValue));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        min={min}
        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    </div>
  );
};

const ParameterEditor: React.FC<ParameterEditorProps> = ({ selectedObject, layers, onUpdateProperty, onDeleteItem }) => {
  if (!selectedObject) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('Select an item to edit its properties.')}
      </div>
    );
  }

  const handlePropertyChange = (prop: string, value: any) => {
    onUpdateProperty(prop, value);
  };

  const renderContent = () => {
    const obj = selectedObject;
    const objType = obj.type || 'unknown';

    return (
      <div className="space-y-4">
        {/* 基本信息 */}
        <div className="border-b border-gray-200 pb-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">{t('Properties')}</h3>
          
          {/* 位置属性 */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <EditableParameterInput
              label={t('x')}
              initialValue={obj.left || 0}
              onCommit={(value) => handlePropertyChange('left', value)}
            />
            <EditableParameterInput
              label={t('y')}
              initialValue={obj.top || 0}
              onCommit={(value) => handlePropertyChange('top', value)}
            />
          </div>

          {/* 尺寸属性 */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <EditableParameterInput
              label={t('width')}
              initialValue={obj.width || 0}
              onCommit={(value) => handlePropertyChange('width', value)}
            />
            <EditableParameterInput
              label={t('height')}
              initialValue={obj.height || 0}
              onCommit={(value) => handlePropertyChange('height', value)}
            />
          </div>

          {/* 旋转 */}
          <div className="mb-4">
            <EditableParameterInput
              label={t('rotation')}
              initialValue={obj.angle || 0}
              onCommit={(value) => handlePropertyChange('angle', value)}
            />
          </div>

          {/* 文本特殊属性 */}
          {objType === 'textbox' && (
            <div className="space-y-3 mb-4">
              <EditableParameterInput
                label={t('text')}
                initialValue={(obj as any).text || ''}
                onCommit={(value) => handlePropertyChange('text', value)}
                type="text"
              />
              <EditableParameterInput
                label={t('fontSize')}
                initialValue={(obj as any).fontSize || 16}
                onCommit={(value) => handlePropertyChange('fontSize', value)}
              />
            </div>
          )}

          {/* 颜色属性 */}
          <div className="space-y-3 mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">{t('color')}</label>
              <input
                type="color"
                value={obj.fill as string || '#000000'}
                onChange={(e) => handlePropertyChange('fill', e.target.value)}
                className="w-full h-10 border border-gray-300 rounded-md"
              />
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">{t('strokeWidth')}</label>
              <input
                type="range"
                min="0"
                max="10"
                value={obj.strokeWidth || 0}
                onChange={(e) => handlePropertyChange('strokeWidth', parseFloat(e.target.value))}
                className="w-full"
              />
              <span className="text-xs text-gray-500">{obj.strokeWidth || 0}px</span>
            </div>
          </div>

          {/* 图层选择 */}
          <div className="mb-4">
            <label className="text-sm font-medium text-gray-700 block mb-2">{t('layer')}</label>
            <select
              value={obj.data?.layerId || layers[0]?.id || ''}
              onChange={(e) => handlePropertyChange('data', { ...obj.data, layerId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {layers.map(layer => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 删除按钮 */}
        <div className="pt-4">
          <button
            onClick={onDeleteItem}
            className="w-full px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
          >
            {t('Delete Item')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 h-full overflow-y-auto">
      {renderContent()}
    </div>
  );
};

export default ParameterEditor;