import React from 'react';
import type { ImageObject } from '../../types';

interface ImageRendererProps {
  imageObject: ImageObject;
  isSelected: boolean;
  x: number;
  y: number;
}

const ENLARGE = 8;

const ImageRenderer: React.FC<ImageRendererProps> = ({ imageObject, isSelected }) => {
  const { width, height, href } = imageObject;

  return (
    <g transform="scale(1,-1)">
      {isSelected && (
        <rect
          x={-width / 2 - ENLARGE / 2}
          y={-height / 2 - ENLARGE / 2}
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
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
      />
    </g>
  );
};

export default ImageRenderer;