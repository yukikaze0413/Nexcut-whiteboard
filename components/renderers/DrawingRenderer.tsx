import React from 'react';
import type { Drawing } from '../../types';

interface DrawingRendererProps {
  drawing: Drawing;
  isSelected: boolean;
}



const DrawingRenderer: React.FC<DrawingRendererProps> = ({ drawing, isSelected }) => {
  const { points, color, strokeWidth, fillColor } = drawing;
  if (!points || points.length < 2) return null;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <g>
      <path
        d={d}
        fill={fillColor || 'none'}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {isSelected && (
        <path
          d={d}
          fill="none"
          stroke="#34d399"
          strokeWidth={strokeWidth + 4}
          strokeDasharray="5,5"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
};

export default DrawingRenderer;
