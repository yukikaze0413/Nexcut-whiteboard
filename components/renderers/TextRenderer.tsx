import React, { useRef, useLayoutEffect, useState } from 'react';
import type { TextObject } from '../../types';

interface TextRendererProps {
  textObject: TextObject;
  isSelected: boolean;
}

const TextRenderer: React.FC<TextRendererProps> = ({ textObject, isSelected }) => {
  const { text, fontSize, color, rotation } = textObject;
  const textRef = useRef<SVGTextElement>(null);
  const [bbox, setBbox] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (textRef.current) {
      setBbox(textRef.current.getBBox());
    }
  }, [text, fontSize]);
  
  const transform = `rotate(${rotation})`;

  return (
    <g transform={transform}>
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
          x={bbox.x - 4}
          y={bbox.y - 4}
          width={bbox.width + 8}
          height={bbox.height + 8}
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          strokeDasharray="5,5"
        />
      )}
    </g>
  );
};

export default TextRenderer;