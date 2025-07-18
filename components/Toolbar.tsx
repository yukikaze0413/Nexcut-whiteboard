import React, { useRef } from 'react';
import { ToolType } from '../types';
import { FiMousePointer } from 'react-icons/fi';
import SelectIcon from '../assets/选择.svg';
import EraserIcon from '../assets/橡皮擦.svg';
import ShapeIcon from '../assets/形状.svg';

interface ToolbarProps {
  onOpenCategoryPicker: (category: 'BASIC_SHAPES' | 'PART_LIBRARY') => void;
  onAddImage: () => void;
  activeTool: ToolType;
  onSetTool: (tool: ToolType) => void;
  onUndo: () => void;
  canUndo: boolean;
  onImportFile?: (file: { name: string; ext: string; content: string }) => void;
  onNext: () => void;
}

const tools = [
  { type: ToolType.SELECT, name: '选择', icon: <img src={SelectIcon} alt="选择" className="w-6 h-6" /> },
  { type: ToolType.PEN, name: '画笔', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M16.273 4.25a2.531 2.531 0 0 1 3.58 3.579l-9.351 9.352a.75.75 0 0 1-.363.203l-3.536.884a.75.75 0 0 1-.876-.876l.884-3.535a.75.75 0 0 1 .203-.363l9.35-9.351Zm-3.486 9.493 7.838-7.838a1.031 1.031 0 0 0-1.458-1.457l-7.839 7.838L12.787 13.743Z" clipRule="evenodd"/></svg> },
  { type: ToolType.TEXT, name: '文本', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M6 4h12v2H6V4zm4 4h4v12h-2V10H8v10H6V8h4z"/></svg> },
];

const imageTool = { name: '图片', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06l4.22-4.22a.75.75 0 0 1 1.06 0l.94.94 2.12-2.12a.75.75 0 0 1 1.06 0L18 16.061V6H4.063c.283.12.53.282.738.49l13.7 13.7a.75.75 0 0 1-1.06 1.06L3 7.06v9Z" clipRule="evenodd" /></svg> };
const undoTool = { name: '撤销', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M9.53 2.47a.75.75 0 0 1 0 1.06L4.81 8.25H15a6.75 6.75 0 0 1 0 13.5h-3a.75.75 0 0 1 0-1.5h3a5.25 5.25 0 1 0 0-10.5H4.81l4.72 4.72a.75.75 0 1 1-1.06 1.06l-6-6a.75.75 0 0 1 0-1.06l6-6a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg> };

const categoryTools = [
    { type: 'BASIC_SHAPES' as const, name: '基础图形', icon: <img src={ShapeIcon} alt="形状" className="w-6 h-6" /> },
    { type: 'PART_LIBRARY' as const, name: '零件库', icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M11 3H3v8h8V3zm10 0h-8v8h8V3zM3 21h8v-8H3v8zm10 0h8v-8h-8v8z" /></svg> },
];

const Toolbar: React.FC<ToolbarProps> = ({ onOpenCategoryPicker, onAddImage, activeTool, onSetTool, onUndo, canUndo, onImportFile, onNext }) => {
  const importInputRef = useRef<HTMLInputElement>(null);

  

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const reader = new FileReader();
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        // 通过props传递给App处理
        if (onImportFile) {
          onImportFile({
            name: file.name,
            ext,
            content: e.target.result
          });
        }
      }
    };
    reader.readAsText(file);
    event.currentTarget.value = ''; 
  };

  const ToolButton: React.FC<{
    children: React.ReactNode;
    onClick: () => void;
    isActive: boolean;
    disabled?: boolean;
    name: string;
  }> = ({ children, onClick, isActive, disabled = false, name }) => (
     <button
        onClick={onClick}
        className={`rounded-md transition-colors duration-200 flex flex-col items-center justify-center p-1 h-16 w-20 text-center ${
          isActive ? 'bg-teal-500 text-white' : 'text-gray-600 hover:bg-gray-100'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        disabled={disabled}
      >
        <div className="w-6 h-6 mb-1">{children}</div>
        <span className="text-xs font-medium leading-none">{name}</span>
      </button>
  );

  return (
    <div className="flex flex-row items-center justify-center gap-4 h-full px-4">
        {/* Basic Tools */}
        <div className="flex items-center gap-2">
            {tools.map(tool => (
                <ToolButton key={tool.type} onClick={() => onSetTool(tool.type)} isActive={activeTool === tool.type} name={tool.name}>
                    {tool.icon}
                </ToolButton>
            ))}
        </div>

        <div className="w-px h-8 bg-gray-200" />

        {/* Category Tools */}
        <div className="flex items-center gap-2">
            {categoryTools.map(cat => (
                <ToolButton key={cat.type} onClick={() => onOpenCategoryPicker(cat.type)} isActive={false} name={cat.name}>
                    {cat.icon}
                </ToolButton>
            ))}
        </div>

        <div className="w-px h-8 bg-gray-200" />
        
        {/* Action Tools */}
        <div className="flex items-center gap-2">
            <ToolButton onClick={onAddImage} isActive={false} name={imageTool.name}>
                {imageTool.icon}
            </ToolButton>
            <ToolButton onClick={() => importInputRef.current?.click()} isActive={false} name="导入">
              {/* 简单的导入图标 */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 16v-8m0 8l-4-4m4 4l4-4M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </ToolButton>
            <ToolButton onClick={onUndo} isActive={false} disabled={!canUndo} name={undoTool.name}>
                {undoTool.icon}
            </ToolButton>
        </div>
        
        
        <input
          type="file"
          ref={importInputRef}
          className="hidden"
          accept=".dxf,.svg,.plt"
          onChange={handleImport}
        />
        {/* 新增“下一步”按钮 */}
        <button
          onClick={onNext}
          className="ml-6 px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-md text-base transition-colors"
        >
          下一步
        </button>
    </div>
  );
};

export default Toolbar;