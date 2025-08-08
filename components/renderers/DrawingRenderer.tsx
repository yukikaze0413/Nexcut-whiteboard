import React, { useMemo } from 'react';
import type { Drawing } from '../../types';
// @ts-ignore
import { findMinBoundingRect } from 'min-bounding-rectangle';

interface DrawingRendererProps {
  drawing: Drawing;
  isSelected: boolean;
  viewBoxScale?: number; // 用于LOD计算
  enableLOD?: boolean;   // 是否启用细节层次
}



const DrawingRenderer: React.FC<DrawingRendererProps> = ({
  drawing,
  isSelected,
  viewBoxScale = 1,
  enableLOD = true
}) => {
  const { points, color, strokeWidth, fillColor } = drawing;
  const ENLARGE = 8;
  const HITBOX_STROKE_WIDTH = 20; // 点击区域宽度

  // 获取所有笔段数据
  const drawingItem = drawing as any; // 类型断言以访问扩展字段
  const allStrokes = drawingItem.strokes && Array.isArray(drawingItem.strokes)
    ? drawingItem.strokes
    : (points && points.length >= 2 ? [points] : []);

  if (allStrokes.length === 0) return null;

  // LOD计算 - 根据缩放级别动态调整显示精度
  const lodStrokes = useMemo(() => {
    if (!enableLOD) return allStrokes;

    const scale = viewBoxScale;
    let simplificationFactor = 1;

    // 根据缩放级别确定简化程度
    if (scale < 0.1) {
      simplificationFactor = 8; // 极度缩小时，大幅简化
    } else if (scale < 0.25) {
      simplificationFactor = 4; // 缩小时，中度简化
    } else if (scale < 0.5) {
      simplificationFactor = 2; // 轻微缩小时，轻度简化
    }

    if (simplificationFactor === 1) return allStrokes;

    // 对每个笔段进行简化
    return allStrokes.map((stroke: { x: number; y: number }[]) => {
      if (stroke.length <= simplificationFactor * 2) return stroke;

      // 均匀采样简化
      const simplified: { x: number; y: number }[] = [];
      for (let i = 0; i < stroke.length; i += simplificationFactor) {
        simplified.push(stroke[i]);
      }

      // 确保包含最后一个点
      if (simplified[simplified.length - 1] !== stroke[stroke.length - 1]) {
        simplified.push(stroke[stroke.length - 1]);
      }

      return simplified;
    });
  }, [allStrokes, viewBoxScale, enableLOD]);

  // 计算所有笔段的合并边界来做OBB - 使用LOD优化后的笔段
  const allPoints = lodStrokes.flat();
  if (allPoints.length === 0) return null;

  // 计算 OBB
  const polygon = allPoints.map((p: { x: number; y: number }) => [p.x, p.y] as [number, number]);
  let obb: [number, number][] = [];
  try {
    // @ts-ignore
    obb = findMinBoundingRect(polygon);
  } catch (e) {
    // 兜底：如果计算失败，obb为空
    obb = [];
  }

  // 计算 OBB 的中心、宽高、旋转角度
  let obbRect = null;
  if (obb.length >= 4) {
    const [p1, p2, p3] = obb;
    const centerX = (p1[0] + obb[2][0]) / 2;
    const centerY = (p1[1] + obb[2][1]) / 2;
    const width = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const height = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI;
    obbRect = { centerX, centerY, width, height, angle };
  }

  // 生成多个路径 - 使用LOD优化后的笔段
  const pathElements = lodStrokes
    .filter((stroke: { x: number; y: number }[]) => stroke.length >= 2)
    .map((stroke: { x: number; y: number }[], index: number) => {
      const d = stroke.map((p: { x: number; y: number }, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      return (
        <g key={`stroke-${index}`}>
          {/* 透明的点击区域 */}
          <path
            d={d}
            fill="transparent"
            stroke="transparent"
            strokeWidth={HITBOX_STROKE_WIDTH}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 实际显示的路径 */}
          <path
            d={d}
            fill={fillColor && index === 0 ? fillColor : 'none'} // 只对第一个笔段应用填充
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    });

  return (
    <g>
      {isSelected && obbRect && (
        <rect
          x={obbRect.centerX - obbRect.width / 2 - ENLARGE / 2}
          y={obbRect.centerY - obbRect.height / 2 - ENLARGE / 2}
          width={obbRect.width + ENLARGE}
          height={obbRect.height + ENLARGE}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          strokeDasharray="6,4"
          pointerEvents="none"
          transform={`rotate(${obbRect.angle}, ${obbRect.centerX}, ${obbRect.centerY})`}
        />
      )}
      
      {/* 渲染所有笔段 */}
      {pathElements}
    </g>
  );
};

export default DrawingRenderer;