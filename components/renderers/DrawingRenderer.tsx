import React from 'react';
import type { Drawing } from '../../types';
// @ts-ignore
import { findMinBoundingRect } from 'min-bounding-rectangle';

interface DrawingRendererProps {
  drawing: Drawing;
  isSelected: boolean;
}

const pointsToString = (points: { x: number; y: number }[]) => {
  return points.map(p => `${p.x},${p.y}`).join(' ');
};

const getCentroid = (points: { x: number; y: number }[]) => {
  const n = points.length;
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / n, y: sum.y / n };
};

const DrawingRenderer: React.FC<DrawingRendererProps> = ({ drawing, isSelected }) => {
  const { points, color, strokeWidth, fillColor, rotation = 0, x = 0, y = 0 } = drawing;
  const ENLARGE = 8;
  const HITBOX_STROKE_WIDTH = 20; // 点击区域宽度
  if (!points || points.length < 2) return null;

  const minX = Math.min(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxX = Math.max(...points.map(p => p.x));
  const maxY = Math.max(...points.map(p => p.y));

  const width = maxX - minX;
  const height = maxY - minY;

  // 原始路径
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - minX} ${p.y - minY}`).join(' ');
  const transform = `translate(${x + minX}, ${y + minY}) rotate(${rotation})`;

  return (
    <g transform={transform}>
      {isSelected && (
        <rect
          x={-ENLARGE / 2}
          y={-ENLARGE / 2}
          width={width + ENLARGE}
          height={height + ENLARGE}
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