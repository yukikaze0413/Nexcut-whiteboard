import React, { useState, useEffect, KeyboardEvent } from 'react';
import type { Layer } from '../types';
import { PrintingMethod } from '../types';

interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string | null;
  onAddLayer: () => void;
  onDeleteLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, updates: Partial<Omit<Layer, 'id'>>) => void;
  onSetActiveLayerId: (layerId: string) => void;
  onMoveLayer: (layerId: string, direction: 'up' | 'down') => void;
}

const LayerItem: React.FC<{
  layer: Layer;
  isActive: boolean;
  isTop: boolean;
  isBottom: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Omit<Layer, 'id'>>) => void;
  onSelect: () => void;
  onMove: (direction: 'up' | 'down') => void;
  canDelete: boolean;
}> = ({ layer, isActive, isTop, isBottom, onDelete, onUpdate, onSelect, onMove, canDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingProperties, setIsEditingProperties] = useState(false);
  const [name, setName] = useState(layer.name);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(layer.name);
  }, [layer.name]);
  
  useEffect(() => {
    if (isEditing) {
        inputRef.current?.focus();
        inputRef.current?.select();
    }
  }, [isEditing]);

  const handleCommitEdit = () => {
    if (name.trim()) {
      onUpdate({ name });
    } else {
      setName(layer.name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleCommitEdit();
    if (e.key === 'Escape') {
      setName(layer.name);
      setIsEditing(false);
    }
  };

  const openPropertiesEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingProperties(true);
  };

  const closePropertiesEditor = () => {
    setIsEditingProperties(false);
  };

  return (
    <>
      <li
        className={`group flex items-center justify-between p-2 rounded-md ${isActive ? 'bg-teal-100' : 'hover:bg-gray-100'}`}
        onClick={onSelect}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); onUpdate({ isVisible: !layer.isVisible }); }}
            className="text-gray-500 hover:text-gray-900"
            title={layer.isVisible ? "隐藏图层" : "显示图层"}
          >
            {layer.isVisible ? 
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg> :
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zM10 12a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /><path d="M2 10s3.939 4 8 4 8-4 8-4-3.939-4-8-4-8 4-8 4z" /></svg>
            }
          </button>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleCommitEdit}
              onKeyDown={handleKeyDown}
              onClick={e => e.stopPropagation()}
              className="bg-white border border-teal-500 rounded px-1 w-full text-sm"
            />
          ) : (
            <span onDoubleClick={() => setIsEditing(true)} className="text-sm truncate cursor-pointer select-none">
              {layer.name}
            </span>
          )}
          {/* 打印方式显示（可点击编辑） */}
          <button
            onClick={openPropertiesEditor}
            className="ml-2 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded cursor-pointer transition-colors"
            title="点击编辑图层属性"
          >
            {layer.printingMethod === 'scan' ? '扫描' : '切割'}
          </button>
        </div>
        <div className={`flex items-center gap-1 transition-opacity opacity-0 ${isEditing ? '' : 'group-hover:opacity-100'}`}>
            <button onClick={(e) => { e.stopPropagation(); onMove('up'); }} disabled={isTop} className="p-1 rounded hover:bg-gray-200 disabled:opacity-25" title="上移">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); onMove('down'); }} disabled={isBottom} className="p-1 rounded hover:bg-gray-200 disabled:opacity-25" title="下移">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {canDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-red-100 text-red-500" title="删除">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>}
        </div>
      </li>

      {/* 图层属性编辑对话框 */}
      {isEditingProperties && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={closePropertiesEditor}
        >
          <div
            className="bg-white rounded-lg p-6 w-96 max-w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4">编辑图层属性</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">图层名称:</label>
                <input
                  type="text"
                  value={layer.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">打印方式:</label>
                <select
                  value={layer.printingMethod}
                  onChange={(e) => onUpdate({ printingMethod: e.target.value as PrintingMethod })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="scan">扫描</option>
                  <option value="engrave">切割</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">功率 (%):</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={layer.power || 50}
                  onChange={(e) => onUpdate({ power: parseInt(e.target.value) || 50 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {layer.printingMethod === 'scan' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">线密度 (线/毫米):</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={layer.lineDensity || 10}
                      onChange={(e) => onUpdate({ lineDensity: parseInt(e.target.value) || 10 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  <div>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={layer.halftone || false}
                        onChange={(e) => onUpdate({ halftone: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm font-medium">启用半色调</span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">反向移动偏移:</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={layer.reverseMovementOffset || 0}
                      onChange={(e) => onUpdate({ reverseMovementOffset: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={layer.isVisible}
                    onChange={(e) => onUpdate({ isVisible: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">图层可见</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closePropertiesEditor}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const LayerPanel: React.FC<LayerPanelProps> = ({ layers, activeLayerId, onAddLayer, onDeleteLayer, onUpdateLayer, onSetActiveLayerId, onMoveLayer }) => {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto pr-1">
        <ul className="space-y-1">
          {layers.map((layer, index) => (
            <LayerItem
              key={layer.id}
              layer={layer}
              isActive={layer.id === activeLayerId}
              isTop={index === 0}
              isBottom={index === layers.length - 1}
              onDelete={() => onDeleteLayer(layer.id)}
              onUpdate={(updates) => onUpdateLayer(layer.id, updates)}
              onSelect={() => onSetActiveLayerId(layer.id)}
              onMove={(dir) => onMoveLayer(layer.id, dir)}
              canDelete={layer.printingMethod === 'scan'}
            />
          ))}
        </ul>
      </div>
      <div className="flex-shrink-0 pt-4 border-t border-gray-200">
        <button
          onClick={onAddLayer}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition-colors"
        >
          添加扫描图层
        </button>
      </div>
    </div>
  );
};

export default LayerPanel;