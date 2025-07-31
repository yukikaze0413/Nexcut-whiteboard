import React, { useState, useEffect, useCallback, ChangeEvent, KeyboardEvent } from 'react';
//import '../fabric'; // 引入 fabric
import type { Layer } from '../types'; // 导入 Layer 类型

// 定义新的 Props 接口
interface ParameterEditorProps {
  selectedObject: fabric.Object | null;
  layers: Layer[]; // 依然需要图层列表来显示
  onUpdateProperty: (prop: string, value: any) => void;
  onDeleteItem: () => void;
}

// 简化的翻译函数，可以根据需要扩展
const t = (key: string): string => {
  const translations: Record<string, string> = {
    // Fabric 对象类型
    'rect': '矩形',
    'circle': '圆形',
    'textbox': '文本',
    'image': '图片',
    'path': '手绘路径', // 将 "path" 翻译为 "手绘路径"
    'group': '组合',
    'activeSelection': '多选',

    // 属性
    'width': '宽度',
    'height': '高度',
    'radius': '半径',
    'fill': '填充色',
    'stroke': '描边色',
    'strokeWidth': '描边宽度',
    'angle': '旋转角度',
    'text': '文本内容',
    'fontSize': '字体大小',
    'left': 'X坐标',
    'top': 'Y坐标',
    'layerId': '图层',

    // UI 文本
    'Properties': '属性',
  };
  return translations[key] || key;
}

// 可编辑输入组件 (这个组件基本不需要大改)
const EditableParameterInput: React.FC<{
  label: string;
  value: string | number;
  onCommit: (newValue: string | number) => void;
  type?: string;
}> = ({ label, value: initialValue, onCommit, type = 'number' }) => {
  const [value, setValue] = useState(String(initialValue));

  useEffect(() => {
    setValue(String(initialValue));
  }, [initialValue]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  const handleCommit = () => {
    if (type === 'number') {
      const numericValue = parseFloat(value);
      if (!isNaN(numericValue)) {
        onCommit(numericValue);
      } else {
        setValue(String(initialValue)); //  无效输入则恢复原值
      }
    } else {
      onCommit(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommit();
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
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        className="w-full bg-white text-gray-900 rounded-md p-2 border border-gray-300 focus:ring-teal-500 focus:border-teal-500"
      />
    </div>
  );
};

const ParameterEditor: React.FC<ParameterEditorProps> = ({ selectedObject, layers, onUpdateProperty, onDeleteItem }) => {
  
  // --- 新增代码: 为颜色创建局部状态 ---
  const [fillColor, setFillColor] = useState('#ffffff');
  const [strokeColor, setStrokeColor] = useState('#ffffff');

  // --- 新增代码: 使用 useEffect 同步 props 和 局部状态 ---
  useEffect(() => {
    if (selectedObject) {
      setFillColor(selectedObject.fill as string || '#ffffff');
      setStrokeColor(selectedObject.stroke as string || '#ffffff');
    }
  }, [selectedObject]);

  const handleColorChange = (prop: 'fill' | 'stroke', value: string) => {
    // 1. 更新局部状态以立即刷新UI
    if (prop === 'fill') {
      setFillColor(value);
    } else {
      setStrokeColor(value);
    }
    // 2. 调用回调函数更新Fabric对象
    onUpdateProperty(prop, value);
  };
  
  const renderContent = () => {
    if (!selectedObject) return null;

    // 通用属性
    const commonProps = (
      <>
        <EditableParameterInput label={t('left')} value={Math.round(selectedObject.left || 0)} onCommit={(val) => onUpdateProperty('left', val)} />
        <EditableParameterInput label={t('top')} value={Math.round(selectedObject.top || 0)} onCommit={(val) => onUpdateProperty('top', val)} />
        <EditableParameterInput label={t('angle')} value={Math.round(selectedObject.angle || 0)} onCommit={(val) => onUpdateProperty('angle', val)} />
      </>
    );

    // 特定属性
    let specificProps = null;
    switch (selectedObject.type) {
      case 'rect':
      case 'image':
        specificProps = (
          <>
            <EditableParameterInput label={t('width')} value={Math.round(selectedObject.get('width') * (selectedObject.scaleX || 1))} onCommit={(val) => onUpdateProperty('width', val as number / (selectedObject.scaleX || 1))} />
            <EditableParameterInput label={t('height')} value={Math.round(selectedObject.get('height') * (selectedObject.scaleY || 1))} onCommit={(val) => onUpdateProperty('height', val as number / (selectedObject.scaleY || 1))} />
          </>
        );
        break;
      case 'circle':
        specificProps = (
          <EditableParameterInput label={t('radius')} value={selectedObject.get('radius')} onCommit={(val) => onUpdateProperty('radius', val)} />
        );
        break;
      case 'textbox':
        specificProps = (
          <>
            <EditableParameterInput label={t('text')} type="text" value={(selectedObject as fabric.Textbox).text || ''} onCommit={(val) => onUpdateProperty('text', val)} />
            <EditableParameterInput label={t('fontSize')} value={(selectedObject as fabric.Textbox).fontSize || 16} onCommit={(val) => onUpdateProperty('fontSize', val)} />
          </>
        );
        break;
      case 'path': // 自由绘制的线条是 path
        specificProps = (
          <EditableParameterInput label={t('strokeWidth')} value={selectedObject.strokeWidth || 1} onCommit={(val) => onUpdateProperty('strokeWidth', val)} />
        );
        break;
    }

    // --- 修改颜色属性部分 ---
    const colorProps = (
      <>
        <div>
          <label className="block text-sm font-medium text-gray-600 capitalize mb-1">{t('fill')}</label>
          <input 
            type="color" 
            value={fillColor} 
            onChange={(e) => handleColorChange('fill', e.target.value)} 
            className="w-full h-10 p-1 bg-white border border-gray-300 rounded-md cursor-pointer" 
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 capitalize mb-1">{t('stroke')}</label>
          <input 
            type="color" 
            value={strokeColor} 
            onChange={(e) => handleColorChange('stroke', e.target.value)} 
            className="w-full h-10 p-1 bg-white border border-gray-300 rounded-md cursor-pointer" 
          />
        </div>
      </>
    );

    return <> {commonProps} {specificProps} {colorProps} </>;
  };

  // 图层选择器
  const handleLayerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // 更新 fabric 对象的自定义 layerId 属性
    onUpdateProperty('layerId', e.target.value);
  };

  return (
    <div className="p-4 h-full flex flex-col">
      {selectedObject ? (
        <>
          <div className="flex-1 overflow-y-auto pr-2 space-y-4 pb-4">
            <h3 className="text-lg font-semibold text-gray-800 capitalize">
              {t(selectedObject.type || 'object')} {t('Properties')}
            </h3>
            {/* 图层选择 */}
            <div>
              <label htmlFor="layer-select" className="block text-sm font-medium text-gray-600">{t('layerId')}</label>
              <select
                id="layer-select"
                value={(selectedObject as any).layerId || ''}
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
              onClick={onDeleteItem}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors"
            >
              删除
            </button>
          </div>
        </>
      ) : (
        <div className="h-full pt-4">
          <p className="text-gray-500">选择一个项目以编辑其属性。</p>
        </div>
      )}
    </div>
  );
};

export default ParameterEditor;