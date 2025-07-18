import React from 'react';
import type { Part } from '../../types';
import { CanvasItemType } from '../../types';

interface PartRendererProps {
  part: Part;
  isSelected: boolean;
}

// 新增 SelectionBox 组件
interface SelectionBoxProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
const SelectionBox: React.FC<SelectionBoxProps> = ({ x, y, width, height, rotation }) => (
  <rect
    x={x - width / 2}
    y={y - height / 2}
    width={width}
    height={height}
    fill="none"
    stroke="#2563eb"
    strokeWidth={2}
    strokeDasharray="6,4"
    pointerEvents="none"
    transform={`rotate(${rotation}, ${x}, ${y})`}
  />
);

const PartRenderer: React.FC<PartRendererProps> = ({ part, isSelected }) => {
  const strokeColor = '#1f2937'; // 始终为默认色
  const strokeWidth = 1;
  const fillColor = 'none';

  const { parameters, rotation } = part;
  const transform = `rotate(${rotation})`;
  
  const HITBOX_STROKE_WIDTH = 20;
  const ENLARGE = 8; // 包络盒放大像素

  // 修改 getBoundingBox，返回 {x, y, width, height, rotation}
  function getBoundingBox() {
    switch (part.type) {
      case CanvasItemType.RECTANGLE:
      case CanvasItemType.RECTANGLE_WITH_HOLES: {
        const { width = 100, height = 60 } = parameters;
        return {
          x: 0,
          y: 0,
          width: width + ENLARGE,
          height: height + ENLARGE,
          rotation: rotation || 0,
        };
      }
      case CanvasItemType.CIRCLE:
      case CanvasItemType.CIRCLE_WITH_HOLES: {
        const { radius = 40 } = parameters;
        return {
          x: 0,
          y: 0,
          width: radius * 2 + ENLARGE,
          height: radius * 2 + ENLARGE,
          rotation: rotation || 0,
        };
      }
      case CanvasItemType.LINE: {
        const { length = 100 } = parameters;
        return {
          x: 0,
          y: 0,
          width: length + ENLARGE,
          height: ENLARGE + 4,
          rotation: rotation || 0,
        };
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
        return {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          width: (maxX - minX) + ENLARGE,
          height: (maxY - minY) + ENLARGE,
          rotation: rotation || 0,
        };
      }
      case CanvasItemType.ARC:
      case CanvasItemType.SECTOR: {
        const { radius = 50 } = parameters;
        return {
          x: 0,
          y: 0,
          width: radius * 2 + ENLARGE,
          height: radius * 2 + ENLARGE,
          rotation: rotation || 0,
        };
      }
      case CanvasItemType.L_BRACKET:
      case CanvasItemType.U_CHANNEL: {
        const { width = 80, height = 80 } = parameters;
        return {
          x: 0,
          y: 0,
          width: width + ENLARGE,
          height: height + ENLARGE,
          rotation: rotation || 0,
        };
      }
      case CanvasItemType.FLANGE:
      case CanvasItemType.TORUS: {
        const { outerDiameter = 120, outerRadius = 60 } = parameters;
        const r = outerDiameter ? outerDiameter / 2 : (outerRadius || 60);
        return {
          x: 0,
          y: 0,
          width: r * 2 + ENLARGE,
          height: r * 2 + ENLARGE,
          rotation: rotation || 0,
        };
      }
      case CanvasItemType.EQUILATERAL_TRIANGLE:
      case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: {
        const { sideLength = 80, legLength = 80 } = parameters;
        const s = sideLength || legLength;
        return {
          x: 0,
          y: 0,
          width: s + ENLARGE,
          height: s + ENLARGE,
          rotation: rotation || 0,
        };
      }
      default:
        return null;
    }
  }

  // 调试输出
  if (isSelected) {
    // eslint-disable-next-line no-console
    console.log('包络盒调试', part.type, part, parameters);
  }

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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(rect)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(circle)}
        </g>
      );
    }
     case CanvasItemType.LINE: {
      const { length = 100 } = parameters;
      const d = `M ${-length / 2} 0 L ${length / 2} 0`;
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeWidth * 2} strokeLinecap="round" />)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill="none" stroke={strokeColor} strokeWidth={strokeWidth * 2} strokeLinejoin="round" strokeLinecap="round" />)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill="none" stroke={strokeColor} strokeWidth={strokeWidth * 2} strokeLinecap="round" />)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={simplePathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />)}
        </g>
      );
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

      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} fillRule="evenodd" strokeLinejoin="round" />)}
        </g>
      );
    }
    case CanvasItemType.TORUS: {
      const { outerRadius = 60, innerRadius = 30 } = parameters;
      const pathData =
        // Outer circle
        `M ${-outerRadius}, 0 A ${outerRadius},${outerRadius} 0 1,1 ${outerRadius},0 A ${outerRadius},${outerRadius} 0 1,1 ${-outerRadius},0 Z` +
        // Inner circle
        `M ${-innerRadius}, 0 A ${innerRadius},${innerRadius} 0 1,1 ${innerRadius},0 A ${innerRadius},${innerRadius} 0 1,1 ${-innerRadius},0 Z`;
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} fillRule="evenodd" />)}
        </g>
      );
    }
    case CanvasItemType.EQUILATERAL_TRIANGLE: {
      const { sideLength = 80 } = parameters;
      const h = (Math.sqrt(3) / 2) * sideLength;
      // Centered at (0,0), pointing up (Y is down)
      const p1 = { x: 0, y: (-2/3) * h };
      const p2 = { x: -sideLength / 2, y: (1/3) * h };
      const p3 = { x: sideLength / 2, y: (1/3) * h };
      const pathData = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`;
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />)}
        </g>
      );
    }
    case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: {
        const { legLength = 80 } = parameters;
        // Centered at (0,0), right angle at top-left
        const l = legLength;
        const p1 = { x: -l / 3, y: -l / 3 }; // top-left (right angle)
        const p2 = { x: (2 * l) / 3, y: -l / 3 }; // top-right
        const p3 = { x: -l / 3, y: (2 * l) / 3 }; // bottom-left
        const pathData = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`;
        const bbox = getBoundingBox();
        return (
          <g>
            {isSelected && bbox && (
              <SelectionBox {...bbox} />
            )}
            {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" />)}
          </g>
        );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} fillRule="evenodd" />)}
        </g>
      );
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
      const bbox = getBoundingBox();
      return (
        <g>
          {isSelected && bbox && (
            <SelectionBox {...bbox} />
          )}
          {renderWithHitbox(<path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} fillRule="evenodd" />)}
        </g>
      );
    }
    default:
      return null;
  }
};

export default PartRenderer;