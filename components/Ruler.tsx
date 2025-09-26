// 已弃用
import React from 'react';

interface RulerProps {
  direction: 'horizontal' | 'vertical';
  offset: number;
  size: number;
}

const Ruler: React.FC<RulerProps> = ({ direction, offset, size }) => {
  const ticks = [];
  const majorTickInterval = 100;
  const minorTickInterval = 20;

  if (direction === 'horizontal') {
    const firstVisible = Math.floor(offset / minorTickInterval) * minorTickInterval;
    for (let pos = firstVisible; pos < offset + size + minorTickInterval; pos += minorTickInterval) {
      const relativePos = pos - offset;
      const isMajor = pos % majorTickInterval === 0;

      ticks.push(
        <line
          key={pos}
          x1={relativePos}
          y1={isMajor ? 15 : 22}
          x2={relativePos}
          y2={30}
          stroke="#9ca3af"
          strokeWidth="0.5"
        />
      );
      if (isMajor) {
        ticks.push(
          <text key={`text-${pos}`} x={relativePos + 4} y="12" fontSize="10" fill="#6b7280">
            {pos}
          </text>
        );
      }
    }
  } else { // vertical
    const firstVisible = Math.floor(offset / minorTickInterval) * minorTickInterval;
    for (let pos = firstVisible; pos < offset + size + minorTickInterval; pos += minorTickInterval) {
      const isMajor = pos % majorTickInterval === 0;
      const relativePos = pos - offset;

      ticks.push(
        <line
          key={pos}
          x1={isMajor ? 15 : 22}
          y1={relativePos}
          x2={30}
          y2={relativePos}
          stroke="#9ca3af"
          strokeWidth="0.5"
        />
      );
      if (isMajor) {
        ticks.push(
          <text key={`text-${pos}`} x="4" y={relativePos + 12} fontSize="10" fill="#6b7280">
            {pos}
          </text>
        );
      }
    }
  }


  return (
    <svg width="100%" height="100%" className="absolute top-0 left-0">
      {ticks}
    </svg>
  );
};

export default Ruler;