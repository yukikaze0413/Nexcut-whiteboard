/**
 * 对齐工具函数
 * 支持单个元素相对于画布的6种对齐方式
 */

import type { CanvasItem, Part, Drawing, ImageObject, TextObject, GroupObject } from '../types';
import { CanvasItemType } from '../types';

export type AlignType = 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV' | 'center';

interface BoundingBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * 计算元素的边界框
 */
export function getBoundingBox(item: CanvasItem): BoundingBox {
  let width = 0;
  let height = 0;

  switch (item.type) {
    case CanvasItemType.IMAGE:
      width = (item as ImageObject).width;
      height = (item as ImageObject).height;
      break;
    case CanvasItemType.TEXT:
      // 文本估算：fontSize * 字符数 * 0.6 作为宽度
      const textItem = item as TextObject;
      width = textItem.fontSize * textItem.text.length * 0.6;
      height = textItem.fontSize;
      break;
    case CanvasItemType.DRAWING:
      // 绘图：根据points计算边界
      const drawing = item as Drawing;
      if (drawing.points && drawing.points.length > 0) {
        const xs = drawing.points.map(p => p.x);
        const ys = drawing.points.map(p => p.y);
        width = Math.max(...xs) - Math.min(...xs);
        height = Math.max(...ys) - Math.min(...ys);
      }
      break;
    case 'GROUP':
      width = (item as GroupObject).width;
      height = (item as GroupObject).height;
      break;
    default:
      // Part类型：从parameters中获取尺寸
      const part = item as Part;
      const params = part.parameters;
      if (params.width !== undefined) width = params.width;
      else if (params.radius !== undefined) width = params.radius * 2;
      else if (params.outerRadius !== undefined) width = params.outerRadius * 2;
      else if (params.outerDiameter !== undefined) width = params.outerDiameter;
      else if (params.length !== undefined) width = params.length;
      else if (params.sideLength !== undefined) width = params.sideLength;
      else if (params.legLength !== undefined) width = params.legLength;

      if (params.height !== undefined) height = params.height;
      else if (params.radius !== undefined) height = params.radius * 2;
      else if (params.outerRadius !== undefined) height = params.outerRadius * 2;
      else if (params.outerDiameter !== undefined) height = params.outerDiameter;
      else if (params.sideLength !== undefined) height = params.sideLength * Math.sqrt(3) / 2;
      else if (params.legLength !== undefined) height = params.legLength;
      break;
  }

  // 考虑缩放
  const scaleX = (item as any).scalex ?? 1;
  const scaleY = (item as any).scaley ?? 1;
  width *= scaleX;
  height *= scaleY;

  return {
    left: item.x - width / 2,
    right: item.x + width / 2,
    top: item.y + height / 2,
    bottom: item.y - height / 2,
    width,
    height,
  };
}

/**
 * 计算对齐后的新位置
 */
export function alignToCanvas(
  item: CanvasItem,
  alignType: AlignType,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const bbox = getBoundingBox(item);
  let newX = item.x;
  let newY = item.y;

  switch (alignType) {
    case 'left':
      newX = bbox.width / 2;
      break;
    case 'right':
      newX = canvasWidth - bbox.width / 2;
      break;
    case 'top':
      newY = canvasHeight - bbox.height / 2;
      break;
    case 'bottom':
      newY = bbox.height / 2;
      break;
    case 'centerH':
      newX = canvasWidth / 2;
      break;
    case 'centerV':
      newY = canvasHeight / 2;
      break;
    case 'center':
      newX = canvasWidth / 2;
      newY = canvasHeight / 2;
      break;
  }

  return { x: newX, y: newY };
}
