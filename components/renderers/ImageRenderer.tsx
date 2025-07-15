import React from 'react';
import type { ImageObject } from '../../types';

interface ImageRendererProps {
  imageObject: ImageObject;
  isSelected: boolean;
}

const ImageRenderer: React.FC<ImageRendererProps> = ({ imageObject, isSelected }) => {
  const { width, height, href, rotation } = imageObject;

  const transform = `rotate(${rotation})`;

  return (
    <g transform={transform}>
      <image
        href={href}
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
      />
      {isSelected && (
        <rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          strokeDasharray="5,5"
        />
      )}
    </g>
  );
};

export default ImageRenderer;