import React from 'react';
import type { Drawing } from '../../types';
// @ts-ignore
import { findMinBoundingRect } from 'min-bounding-rectangle';

interface DrawingRendererProps {
  drawing: Drawing;
  isSelected: boolean;
}



const DrawingRenderer: React.FC<DrawingRendererProps> = ({ drawing, isSelected }) => {
  const { points, color, strokeWidth, fillColor, x, y } = drawing;
  const ENLARGE = 8;
  const HITBOX_STROKE_WIDTH = 20; // 点击区域宽度
  if (!points || points.length < 2) return null;

  // 计算 OBB
  const polygon = points.map(p => [p.x, p.y] as [number, number]);
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

  // 原始路径
  // const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const minDistance = 1.414; // 最小距离阈值
  const d = points.map((p, i) => {
  if (i === 0) {
    // 第一个点总是使用 M 命令
    return `M ${p.x} ${p.y}`;
  } else {
    // 计算当前点与前一个点的距离
    const prev = points[i - 1];
    const distance = Math.sqrt(Math.pow(p.x - prev.x, 2) + Math.pow(p.y - prev.y, 2));
    // 距离大于阈值时使用 M 命令，否则使用 L 命令
    return `${distance > minDistance ? 'M' : 'L'} ${p.x} ${p.y}`;
  }
}).join(' ');

  return (
    <g transform={`translate(${x},${y})`}>
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
      {/* 透明的点击区域 */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={HITBOX_STROKE_WIDTH}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 实际显示的路径 */}
      <path
        d={d}
        fill={fillColor || 'none'}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

export default DrawingRenderer;