import React from 'react';
import type { CanvasItem } from '../../types';
import { CanvasItemType } from '../../types';
import PartRenderer from './PartRenderer';
import DrawingRenderer from './DrawingRenderer';
import TextRenderer from './TextRenderer';
import ImageRenderer from './ImageRenderer';

interface CanvasItemRendererProps {
  item: CanvasItem;
  isSelected: boolean;
}

const CanvasItemRenderer: React.FC<CanvasItemRendererProps> = ({ item, isSelected }) => {
  // 递归渲染GroupObject
  if (item.type === 'GROUP') {
    // 以中心为基准缩放和旋转
    const scaleX = item.width > 0 ? item.width / (item.width || 1) : 1;
    const scaleY = item.height > 0 ? item.height / (item.height || 1) : 1;
    const transform = `rotate(${item.rotation || 0}) scale(${scaleX},${scaleY})`;
    return (
      <g transform={transform}>
        {item.children.map((child, idx) => (
          <CanvasItemRenderer key={child.id || idx} item={child} isSelected={isSelected} />
        ))}
      </g>
    );
  }
  switch (item.type) {
    case CanvasItemType.RECTANGLE:
    case CanvasItemType.CIRCLE:
    case CanvasItemType.L_BRACKET:
    case CanvasItemType.U_CHANNEL:
    case CanvasItemType.FLANGE:
    case CanvasItemType.LINE:
    case CanvasItemType.POLYLINE:
    case CanvasItemType.ARC:
    case CanvasItemType.SECTOR:
    case CanvasItemType.TORUS:
    case CanvasItemType.EQUILATERAL_TRIANGLE:
    case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE:
    case CanvasItemType.CIRCLE_WITH_HOLES:
    case CanvasItemType.RECTANGLE_WITH_HOLES:
      return <PartRenderer part={item} isSelected={isSelected} />;
    case CanvasItemType.DRAWING:
      return <DrawingRenderer drawing={item} isSelected={isSelected} />;
    case CanvasItemType.TEXT:
      return <TextRenderer textObject={item} isSelected={isSelected} />;
    case CanvasItemType.IMAGE:
      return <ImageRenderer imageObject={item} isSelected={isSelected} />;
    default:
      return null;
  }
};

export default CanvasItemRenderer;