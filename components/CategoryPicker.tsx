import React from 'react';
import { BASIC_SHAPES, PART_LIBRARY } from '../constants';
import type { PartDefinition } from '../types';
import PartRenderer from './renderers/PartRenderer';


interface CategoryPickerProps {
  category: string;
  onAddPart: (partType: PartDefinition['type']) => void;
  onClose: () => void;
}

const CategoryPicker: React.FC<CategoryPickerProps> = ({ category, onAddPart, onClose }) => {
  const isBasicShapes = category === 'BASIC_SHAPES';
  const title = isBasicShapes ? '基础图形' : '零件库';
  const items = isBasicShapes ? BASIC_SHAPES : PART_LIBRARY;

  return (
    <div 
        className="fixed inset-0 z-[60] bg-gray-900 bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4" 
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-picker-title"
    >
      <div 
        className="bg-white rounded-lg shadow-xl p-4 sm:p-6 w-full max-w-md border border-gray-200 max-h-[80vh] flex flex-col" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 id="category-picker-title" className="text-xl font-bold text-gray-900">{title}</h2>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-900 transition-colors rounded-full p-1"
            aria-label="关闭"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 overflow-y-auto pr-2 flex-1 min-h-0">
          {items.map(partDef => (
            <button
              key={partDef.type}
              onClick={() => onAddPart(partDef.type)}
              className="bg-gray-100 hover:bg-teal-500 text-gray-700 hover:text-white rounded-lg p-3 flex flex-col items-center justify-center aspect-square transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              <svg width="56" height="56" viewBox="-80 -80 160 160">
                <PartRenderer
                  part={{
                    type: partDef.type,
                    id: '',
                    x: 0,
                    y: 0,
                    layerId: '',
                    parameters: partDef.defaultParameters || {},
                    rotation: 0
                  }}
                  isSelected={false}
                />
              </svg>
              <span className="mt-4 text-base sm:text-lg text-center font-medium w-full block">{partDef.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryPicker;