import React from 'react';
import { BASIC_SHAPES, PART_LIBRARY } from '../constants';
import type { PartDefinition } from '../types';



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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-md border border-gray-200 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl font-bold p-1"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-2 flex-1 min-h-0">
          {items.map((partDef) => (
            <button
              key={partDef.type}
              onClick={() => onAddPart(partDef.type)}
              className="flex flex-col items-center justify-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors min-h-[120px]"
            >
              <div className="text-gray-600 mb-2 flex-shrink-0">
                {partDef.icon}
              </div>
              <span className="mt-4 text-base text-center font-medium w-full block">{partDef.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryPicker;