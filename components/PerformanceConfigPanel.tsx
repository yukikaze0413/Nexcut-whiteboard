import React, { useState } from 'react';

interface PerformanceConfig {
  maxPointsPerPath: number;
  simplificationTolerance: number;
  batchSize: number;
  enableLOD: boolean;
  maxTotalPoints: number;
}

interface PerformanceConfigPanelProps {
  config: PerformanceConfig;
  onConfigChange: (config: PerformanceConfig) => void;
  onClose: () => void;
}

const PerformanceConfigPanel: React.FC<PerformanceConfigPanelProps> = ({
  config,
  onConfigChange,
  onClose
}) => {
  const [localConfig, setLocalConfig] = useState<PerformanceConfig>(config);

  const handleSave = () => {
    onConfigChange(localConfig);
    onClose();
  };

  const handleReset = () => {
    const defaultConfig: PerformanceConfig = {
      maxPointsPerPath: 500,
      simplificationTolerance: 2.0,
      batchSize: 50,
      enableLOD: true,
      maxTotalPoints: 5000
    };
    setLocalConfig(defaultConfig);
  };

  const presets = {
    high: {
      name: '高质量',
      config: {
        maxPointsPerPath: 1000,
        simplificationTolerance: 1.0,
        batchSize: 100,
        enableLOD: true,
        maxTotalPoints: 10000
      }
    },
    balanced: {
      name: '平衡',
      config: {
        maxPointsPerPath: 500,
        simplificationTolerance: 2.0,
        batchSize: 50,
        enableLOD: true,
        maxTotalPoints: 5000
      }
    },
    performance: {
      name: '高性能',
      config: {
        maxPointsPerPath: 200,
        simplificationTolerance: 3.0,
        batchSize: 25,
        enableLOD: true,
        maxTotalPoints: 2000
      }
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[200] bg-black bg-opacity-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">矢量导入性能配置</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>

        {/* 预设配置 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            预设配置
          </label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(presets).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => setLocalConfig(preset.config)}
                className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* 详细配置 */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              每个路径最大点数: {localConfig.maxPointsPerPath}
            </label>
            <input
              type="range"
              min="50"
              max="2000"
              step="50"
              value={localConfig.maxPointsPerPath}
              onChange={(e) => setLocalConfig({
                ...localConfig,
                maxPointsPerPath: parseInt(e.target.value)
              })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>50 (快)</span>
              <span>2000 (精细)</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              路径简化容差: {localConfig.simplificationTolerance.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.1"
              value={localConfig.simplificationTolerance}
              onChange={(e) => setLocalConfig({
                ...localConfig,
                simplificationTolerance: parseFloat(e.target.value)
              })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0.5 (精细)</span>
              <span>5.0 (简化)</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              批处理大小: {localConfig.batchSize}
            </label>
            <input
              type="range"
              min="10"
              max="200"
              step="10"
              value={localConfig.batchSize}
              onChange={(e) => setLocalConfig({
                ...localConfig,
                batchSize: parseInt(e.target.value)
              })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>10 (流畅)</span>
              <span>200 (快速)</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              总点数限制: {localConfig.maxTotalPoints}
            </label>
            <input
              type="range"
              min="1000"
              max="20000"
              step="1000"
              value={localConfig.maxTotalPoints}
              onChange={(e) => setLocalConfig({
                ...localConfig,
                maxTotalPoints: parseInt(e.target.value)
              })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1000 (快)</span>
              <span>20000 (详细)</span>
            </div>
          </div>

          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={localConfig.enableLOD}
                onChange={(e) => setLocalConfig({
                  ...localConfig,
                  enableLOD: e.target.checked
                })}
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700">
                启用细节层次 (LOD)
              </span>
            </label>
            <p className="text-xs text-gray-500 mt-1">
              根据缩放级别自动调整显示精度
            </p>
          </div>
        </div>

        {/* 性能提示 */}
        <div className="mt-6 p-3 bg-blue-50 rounded-lg">
          <h4 className="text-sm font-medium text-blue-800 mb-1">性能提示</h4>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• 降低最大点数可提高导入速度</li>
            <li>• 增加简化容差可减少内存使用</li>
            <li>• 较小的批处理大小可保持界面响应</li>
            <li>• LOD 可在缩放时提供更好的性能</li>
          </ul>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleReset}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
          >
            重置默认
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default PerformanceConfigPanel;
