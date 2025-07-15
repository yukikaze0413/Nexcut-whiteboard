import React from 'react';
import { BASIC_SHAPES, PART_LIBRARY } from '../constants';
import type { PartDefinition } from '../types';
import { CanvasItemType } from '../types';

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
        className="fixed inset-0 z-50 bg-gray-900 bg-opacity-50 backdrop-blur-sm flex items-center justify-center" 
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-picker-title"
    >
      <div 
        className="bg-white rounded-lg shadow-xl p-4 sm:p-6 w-full max-w-md m-4 border border-gray-200" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 max-h-[60vh] overflow-y-auto pr-2">
          {items.map(partDef => (
            <button
              key={partDef.type}
              onClick={() => onAddPart(partDef.type)}
              className="bg-gray-100 hover:bg-teal-500 text-gray-700 hover:text-white rounded-lg p-3 flex flex-col items-center justify-center aspect-square transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 text-gray-600">{partDef.icon}</div>
              <span className="mt-2 text-xs sm:text-sm text-center font-medium">{partDef.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryPicker;