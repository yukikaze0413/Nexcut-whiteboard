import React, { useState, useEffect } from 'react';

interface PerformanceStats {
  totalItems: number;
  totalPoints: number;
  renderTime: number;
  memoryUsage?: number;
  fps?: number;
}

interface PerformanceMonitorProps {
  items: any[];
  isVisible: boolean;
  onToggle: () => void;
}

const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  items,
  isVisible,
  onToggle
}) => {
  const [stats, setStats] = useState<PerformanceStats>({
    totalItems: 0,
    totalPoints: 0,
    renderTime: 0
  });

  const [fps, setFps] = useState<number>(0);
  const [frameCount, setFrameCount] = useState<number>(0);
  const [lastTime, setLastTime] = useState<number>(performance.now());

  // 计算FPS
  useEffect(() => {
    let animationId: number;
    
    const updateFPS = () => {
      const now = performance.now();
      const delta = now - lastTime;
      
      if (delta >= 1000) { // 每秒更新一次
        setFps(Math.round((frameCount * 1000) / delta));
        setFrameCount(0);
        setLastTime(now);
      } else {
        setFrameCount(prev => prev + 1);
      }
      
      animationId = requestAnimationFrame(updateFPS);
    };
    
    if (isVisible) {
      animationId = requestAnimationFrame(updateFPS);
    }
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isVisible, frameCount, lastTime]);

  // 计算性能统计
  useEffect(() => {
    const startTime = performance.now();
    
    let totalPoints = 0;
    let totalItems = items.length;
    
    items.forEach(item => {
      if (item.type === 'DRAWING') {
        // 计算绘图对象的点数
        if (item.points && Array.isArray(item.points)) {
          totalPoints += item.points.length;
        }
        
        // 如果有多个笔段，计算所有笔段的点数
        if (item.strokes && Array.isArray(item.strokes)) {
          item.strokes.forEach((stroke: any[]) => {
            totalPoints += stroke.length;
          });
        }
        
        // 如果有原始点数据，也计算进去
        if (item.originalPoints && Array.isArray(item.originalPoints)) {
          totalPoints += item.originalPoints.length;
        }
      }
    });
    
    const renderTime = performance.now() - startTime;
    
    setStats({
      totalItems,
      totalPoints,
      renderTime,
      fps
    });
  }, [items, fps]);

  // 获取内存使用情况（如果浏览器支持）
  useEffect(() => {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      setStats(prev => ({
        ...prev,
        memoryUsage: Math.round(memory.usedJSHeapSize / 1024 / 1024) // MB
      }));
    }
  }, []);

  const getPerformanceLevel = () => {
    if (stats.totalPoints > 10000) return 'high';
    if (stats.totalPoints > 5000) return 'medium';
    return 'low';
  };

  const getPerformanceColor = () => {
    const level = getPerformanceLevel();
    switch (level) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      default: return 'text-green-600';
    }
  };

  const getPerformanceText = () => {
    const level = getPerformanceLevel();
    switch (level) {
      case 'high': return '高负载';
      case 'medium': return '中等负载';
      default: return '正常';
    }
  };

  if (!isVisible) {
    return (
      <button
        onClick={onToggle}
        className="fixed top-20 right-4 z-30 bg-gray-800 text-white px-3 py-1 rounded text-xs hover:bg-gray-700 transition-colors"
      >
        性能监控
      </button>
    );
  }

  return (
    <div className="fixed top-20 right-4 z-30 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs min-w-48">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-gray-800">性能监控</h3>
        <button
          onClick={onToggle}
          className="text-gray-500 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-600">状态:</span>
          <span className={`font-medium ${getPerformanceColor()}`}>
            {getPerformanceText()}
          </span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-gray-600">对象数:</span>
          <span className="font-mono">{stats.totalItems}</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-gray-600">总点数:</span>
          <span className="font-mono">{stats.totalPoints.toLocaleString()}</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-gray-600">渲染时间:</span>
          <span className="font-mono">{stats.renderTime.toFixed(2)}ms</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-gray-600">FPS:</span>
          <span className={`font-mono ${fps < 30 ? 'text-red-600' : fps < 50 ? 'text-yellow-600' : 'text-green-600'}`}>
            {fps}
          </span>
        </div>
        
        {stats.memoryUsage && (
          <div className="flex justify-between">
            <span className="text-gray-600">内存:</span>
            <span className="font-mono">{stats.memoryUsage}MB</span>
          </div>
        )}
      </div>
      
      {/* 性能建议 */}
      {getPerformanceLevel() !== 'low' && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <p className="text-gray-600 text-xs">
            {getPerformanceLevel() === 'high' 
              ? '建议: 降低路径精度或启用LOD'
              : '建议: 考虑优化复杂路径'
            }
          </p>
        </div>
      )}
    </div>
  );
};

export default PerformanceMonitor;
