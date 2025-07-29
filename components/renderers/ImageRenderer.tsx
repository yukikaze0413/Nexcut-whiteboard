import React from 'react';
import type { ImageObject } from '../../types';

interface ImageRendererProps {
  imageObject: ImageObject;
  isSelected: boolean;
  x: number;
  y: number;
}

const ENLARGE = 8;

const ImageRenderer: React.FC<ImageRendererProps> = ({ imageObject, isSelected, x, y }) => {
  const { width, height, href, rotation } = imageObject;

  const transform = `translate(${x}, ${y}) rotate(${rotation}, ${width / 2}, ${height / 2})`;

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
      <image
        href={href}
        x={0}
        y={0}
        width={width}
        height={height}
      />
    </g>
  );
};

export default ImageRenderer;