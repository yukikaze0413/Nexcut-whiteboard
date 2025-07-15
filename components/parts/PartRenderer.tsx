import React from 'react';
import type { Part } from '../../types';
import { CanvasItemType } from '../../types';

interface PartRendererProps {
  part: Part;
  isSelected: boolean;
}

const PartRenderer: React.FC<PartRendererProps> = ({ part, isSelected }) => {
  const strokeColor = isSelected ? '#34d399' : '#1f2937'; // Emerald-400 or Gray-800 for "black"
  const strokeWidth = isSelected ? 2 : 1;
  const fillColor = 'none';

  const { parameters, rotation } = part;
  const transform = `rotate(${rotation})`;
  
  const HITBOX_STROKE_WIDTH = 20;

  const renderWithHitbox = <T extends SVGElement>(visual: React.ReactElement<React.SVGProps<T>>, hitbox?: React.ReactElement) => {
    const hitboxElement = hitbox ?? React.cloneElement(visual, {
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: HITBOX_STROKE_WIDTH
    });
    
    return (
        <g transform={transform}>
            {hitboxElement}
            {React.cloneElement(visual, { style: { pointerEvents: 'none' } })}
        </g>
    );
  }


  switch (part.type) {
    case CanvasItemType.RECTANGLE: {
      const { width = 100, height = 60 } = parameters;
      const rect = <rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />;
      return renderWithHitbox(rect);
    }
    case CanvasItemType.CIRCLE: {
      const { radius = 40 } = parameters;
      const circle = <circle
          cx="0"
          cy="0"
          r={radius}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />;
        return renderWithHitbox(circle);
    }
     case CanvasItemType.LINE: {
      const { length = 100 } = parameters;
      const line = <path
          d={`M ${-length / 2} 0 L ${length / 2} 0`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth * 2}
          strokeLinecap="round"
        />
      return renderWithHitbox(line);
    }
    case CanvasItemType.POLYLINE: {
      const { seg1 = 40, seg2 = 50, angle = 135, seg3 = 40 } = parameters;
      const rad = ((180 - angle) * Math.PI) / 180;
      
      const p0 = { x: 0, y: 0 };
      const p1 = { x: p0.x + seg1, y: p0.y };
      const p2 = { x: p1.x + seg2 * Math.cos(rad), y: p1.y - seg2 * Math.sin(rad) };
      const p3 = { x: p2.x + seg3, y: p2.y };
      const allPoints = [p0, p1, p2, p3];

      const minX = Math.min(...allPoints.map(p => p.x));
      const maxX = Math.max(...allPoints.map(p => p.x));
      const minY = Math.min(...allPoints.map(p => p.y));
      const maxY = Math.max(...allPoints.map(p => p.y));

      const w = maxX - minX;
      const h = maxY - minY;

      const offsetX = -minX - w / 2;
      const offsetY = -minY - h / 2;

      const pathData = allPoints.map((p, i) =>
          `${i === 0 ? 'M' : 'L'} ${p.x + offsetX} ${p.y + offsetY}`
      ).join(' ');

      const polyline = <path
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth * 2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      return renderWithHitbox(polyline);
    }
    case CanvasItemType.ARC: {
      const { radius = 50, startAngle = -90, sweepAngle = 180 } = parameters;
      if (radius <= 0) return null;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = ((startAngle + sweepAngle) * Math.PI) / 180;

      const sx = radius * Math.cos(startRad);
      const sy = radius * Math.sin(startRad);
      const ex = radius * Math.cos(endRad);
      const ey = radius * Math.sin(endRad);

      const largeArcFlag = Math.abs(sweepAngle) > 180 ? 1 : 0;
      const sweepFlag = sweepAngle > 0 ? 1 : 0;

      const pathData = `M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${ex} ${ey}`;

      const arc = <path
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth * 2}
          strokeLinecap="round"
        />
      return renderWithHitbox(arc);
    }
    case CanvasItemType.SECTOR: {
      const { radius = 50, startAngle = -90, sweepAngle = 90 } = parameters;
      if (radius <= 0) return null;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = ((startAngle + sweepAngle) * Math.PI) / 180;

      const sx = radius * Math.cos(startRad);
      const sy = radius * Math.sin(startRad);
      const ex = radius * Math.cos(endRad);
      const ey = radius * Math.sin(endRad);

      const largeArcFlag = Math.abs(sweepAngle) > 180 ? 1 : 0;
      const sweepFlag = sweepAngle > 0 ? 1 : 0;

      const pathData = `M 0 0 L ${sx} ${sy} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${ex} ${ey} Z`;

      const sector = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          strokeLinejoin="round"
        />
      return renderWithHitbox(sector, hitbox);
    }
    case CanvasItemType.L_BRACKET: {
      const { width = 80, height = 80, thickness = 15 } = parameters;
      const pathData = `
        M ${-width/2} ${-height/2}
        L ${width/2} ${-height/2}
        L ${width/2} ${-height/2 + thickness}
        L ${-width/2 + thickness} ${-height/2 + thickness}
        L ${-width/2 + thickness} ${height/2}
        L ${-width/2} ${height/2}
        Z
      `;
      const bracket = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          strokeLinejoin="round"
        />;
      return renderWithHitbox(bracket, hitbox);
    }
    case CanvasItemType.U_CHANNEL: {
      const { width = 80, height = 100, thickness = 10 } = parameters;
      const simplePathData = `
        M ${-width/2} ${-height/2}
        L ${width/2} ${-height/2}
        L ${width/2} ${height/2}
        L ${width/2 - thickness} ${height/2}
        L ${width/2 - thickness} ${-height/2 + thickness}
        L ${-width/2 + thickness} ${-height/2 + thickness}
        L ${-width/2 + thickness} ${height/2}
        L ${-width/2} ${height/2}
        Z
      `;
      const channel = <path
          d={simplePathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      const hitbox = <path
          d={simplePathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          strokeLinejoin="round"
        />;
      return renderWithHitbox(channel, hitbox);
    }
    case CanvasItemType.FLANGE: {
      const {
        outerDiameter = 120,
        innerDiameter = 60,
        boltCircleDiameter = 90,
        boltHoleCount = 4,
        boltHoleDiameter = 8
      } = parameters;

      const outerRadius = outerDiameter / 2;
      const innerRadius = innerDiameter / 2;
      const boltCircleRadius = boltCircleDiameter / 2;
      const boltHoleRadius = boltHoleDiameter / 2;

      let pathData = `M ${-outerRadius}, 0 A ${outerRadius},${outerRadius} 0 1,1 ${outerRadius},0 A ${outerRadius},${outerRadius} 0 1,1 ${-outerRadius},0 Z`; // Outer circle
      pathData += ` M ${-innerRadius}, 0 A ${innerRadius},${innerRadius} 0 1,1 ${innerRadius},0 A ${innerRadius},${innerRadius} 0 1,1 ${-innerRadius},0 Z`; // Inner circle

      for (let i = 0; i < boltHoleCount; i++) {
        const angle = (i / boltHoleCount) * 2 * Math.PI - Math.PI / 2; // Start from top
        const holeX = boltCircleRadius * Math.cos(angle);
        const holeY = boltCircleRadius * Math.sin(angle);
        
        pathData += ` M ${holeX + boltHoleRadius},${holeY}`; // Move to start of hole circle
        pathData += ` A ${boltHoleRadius},${boltHoleRadius} 0 1,1 ${holeX - boltHoleRadius},${holeY}`;
        pathData += ` A ${boltHoleRadius},${boltHoleRadius} 0 1,1 ${holeX + boltHoleRadius},${holeY}`;
        pathData += ` Z`;
      }

      const flange = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fillRule="evenodd"
          strokeLinejoin="round"
        />;
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          fillRule="evenodd"
          strokeLinejoin="round"
      />;
      return renderWithHitbox(flange, hitbox);
    }
    case CanvasItemType.TORUS: {
      const { outerRadius = 60, innerRadius = 30 } = parameters;
      const pathData =
        // Outer circle
        `M ${-outerRadius}, 0 A ${outerRadius},${outerRadius} 0 1,1 ${outerRadius},0 A ${outerRadius},${outerRadius} 0 1,1 ${-outerRadius},0 Z` +
        // Inner circle
        `M ${-innerRadius}, 0 A ${innerRadius},${innerRadius} 0 1,1 ${innerRadius},0 A ${innerRadius},${innerRadius} 0 1,1 ${-innerRadius},0 Z`;
      const torus = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fillRule="evenodd"
        />
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          fillRule="evenodd"
        />;
      return renderWithHitbox(torus, hitbox);
    }
    case CanvasItemType.EQUILATERAL_TRIANGLE: {
      const { sideLength = 80 } = parameters;
      const h = (Math.sqrt(3) / 2) * sideLength;
      // Centered at (0,0), pointing up (Y is down)
      const p1 = { x: 0, y: (-2/3) * h };
      const p2 = { x: -sideLength / 2, y: (1/3) * h };
      const p3 = { x: sideLength / 2, y: (1/3) * h };
      const pathData = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`;
      const triangle = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />;
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          strokeLinejoin="round"
        />;
      return renderWithHitbox(triangle, hitbox);
    }
    case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: {
        const { legLength = 80 } = parameters;
        // Centered at (0,0), right angle at top-left
        const l = legLength;
        const p1 = { x: -l / 3, y: -l / 3 }; // top-left (right angle)
        const p2 = { x: (2 * l) / 3, y: -l / 3 }; // top-right
        const p3 = { x: -l / 3, y: (2 * l) / 3 }; // bottom-left
        const pathData = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`;
        const triangle = <path
            d={pathData}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />;
        const hitbox = <path
            d={pathData}
            fill="transparent"
            stroke="transparent"
            strokeWidth={HITBOX_STROKE_WIDTH}
            strokeLinejoin="round"
          />;
        return renderWithHitbox(triangle, hitbox);
      }
    case CanvasItemType.CIRCLE_WITH_HOLES: {
      const { radius = 80, holeRadius = 8, holeCount = 4, holeDistance = 50 } = parameters;
      let pathData = `M ${-radius}, 0 A ${radius},${radius} 0 1,1 ${radius},0 A ${radius},${radius} 0 1,1 ${-radius},0 Z`;

      for (let i = 0; i < holeCount; i++) {
        const angle = (i / holeCount) * 2 * Math.PI;
        const holeX = holeDistance * Math.cos(angle);
        const holeY = holeDistance * Math.sin(angle);
        pathData += ` M ${holeX + holeRadius},${holeY} A ${holeRadius},${holeRadius} 0 1,1 ${holeX - holeRadius},${holeY} A ${holeRadius},${holeRadius} 0 1,1 ${holeX + holeRadius},${holeY} Z`;
      }
      const item = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fillRule="evenodd"
        />;
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          fillRule="evenodd"
        />;
      return renderWithHitbox(item, hitbox);
    }
    case CanvasItemType.RECTANGLE_WITH_HOLES: {
      const { width = 120, height = 80, holeRadius = 8, horizontalMargin = 20, verticalMargin = 20 } = parameters;
      const w2 = width / 2;
      const h2 = height / 2;
      let pathData = `M ${-w2},${-h2} H ${w2} V ${h2} H ${-w2} Z`;
      const holePositions = [
        { x: -w2 + horizontalMargin, y: h2 - verticalMargin },
        { x: w2 - horizontalMargin, y: h2 - verticalMargin },
        { x: w2 - horizontalMargin, y: -h2 + verticalMargin },
        { x: -w2 + horizontalMargin, y: -h2 + verticalMargin },
      ];
      holePositions.forEach(pos => {
        pathData += ` M ${pos.x + holeRadius},${pos.y} A ${holeRadius},${holeRadius} 0 1,1 ${pos.x - holeRadius},${pos.y} A ${holeRadius},${holeRadius} 0 1,1 ${pos.x + holeRadius},${pos.y} Z`;
      });
      const item = <path
          d={pathData}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fillRule="evenodd"
        />;
      const hitbox = <path
          d={pathData}
          fill="transparent"
          stroke="transparent"
          strokeWidth={HITBOX_STROKE_WIDTH}
          fillRule="evenodd"
        />;
      return renderWithHitbox(item, hitbox);
    }
    default:
      return null;
  }
};

export default PartRenderer;