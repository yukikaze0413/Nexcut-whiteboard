import React from 'react';
import type { Drawing } from '../../types';

interface DrawingRendererProps {
  drawing: Drawing;
  isSelected: boolean;
}



const DrawingRenderer: React.FC<DrawingRendererProps> = ({ drawing, isSelected }) => {
  const { points, color, strokeWidth, fillColor } = drawing;
  const ENLARGE = 8;
  const HITBOX_STROKE_WIDTH = 20; // 点击区域宽度
  if (!points || points.length < 2) return null;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  // 计算包络盒
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const w = maxX - minX;
  const h = maxY - minY;
  const strokeExpand = (strokeWidth || 0) / 2;
  return (
    <g>
      {isSelected && (
        <rect
          x={minX - ENLARGE / 2 - strokeExpand}
          y={minY - ENLARGE / 2 - strokeExpand}
          width={w + ENLARGE + strokeExpand * 2}
          height={h + ENLARGE + strokeExpand * 2}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          strokeDasharray="6,4"
          pointerEvents="none"
        />
      )}
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
