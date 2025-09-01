import React from 'react';

interface ImportProgressModalProps {
  isVisible: boolean;
  progress: number;
  status: string;
  onCancel?: () => void;
}

const ImportProgressModal: React.FC<ImportProgressModalProps> = ({
  isVisible,
  progress,
  status,
  onCancel
}) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[300] bg-black bg-opacity-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">导入矢量图</h3>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-gray-500 hover:text-gray-700 text-xl"
            >
              ×
            </button>
          )}
        </div>

        {/* 进度条 */}
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>进度</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>

        {/* 状态信息 */}
        <div className="text-sm text-gray-600 mb-4">
          <p>{status}</p>
        </div>

        {/* 性能提示 */}
        {progress > 0 && (
          <div className="bg-blue-50 rounded-lg p-3">
            <h4 className="text-sm font-medium text-blue-800 mb-1">性能提示</h4>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• 如果导入时间过长，可以在性能设置中降低精度</li>
              <li>• 大型矢量文件建议使用"高性能"模式</li>
              <li>• 导入完成后可以调整为"平衡"或"高质量"模式</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportProgressModal; 