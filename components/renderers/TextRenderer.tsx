import React, { useRef, useLayoutEffect, useState } from 'react';
import type { TextObject } from '../../types';

interface TextRendererProps {
  textObject: TextObject;
  isSelected: boolean;
}

const TextRenderer: React.FC<TextRendererProps> = ({ textObject, isSelected }) => {
  const { text, fontSize, color } = textObject;
  const textRef = useRef<SVGTextElement>(null);
  const [bbox, setBbox] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (textRef.current) {
      setBbox(textRef.current.getBBox());
    }
  }, [text, fontSize]);

  const ENLARGE = 8;

  return (
    <g transform="scale(1,-1)">
      <text
        ref={textRef}
        x="0"
        y="0"
        dominantBaseline="middle"
        textAnchor="middle"
        style={{ fontSize: `${fontSize}px`, fill: color, userSelect: 'none' }}
      >
        {text}
      </text>
      {isSelected && bbox && (
        <rect
          x={bbox.x - 4 - ENLARGE / 2}
          y={bbox.y - 4 - ENLARGE / 2}
          width={bbox.width + 8 + ENLARGE}
          height={bbox.height + 8 + ENLARGE}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          strokeDasharray="6,4"
          pointerEvents="none"
        />
      )}
    </g>
  );
};

export default TextRenderer;