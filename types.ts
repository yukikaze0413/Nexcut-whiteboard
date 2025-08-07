import type { ReactNode } from 'react';

export enum ToolType {
  SELECT = 'SELECT',
  PEN = 'PEN',
  ERASER = 'ERASER',
  TEXT = 'TEXT',
}

export enum CanvasItemType {
  // Parts
  RECTANGLE = 'RECTANGLE',
  L_BRACKET = 'L_BRACKET',
  U_CHANNEL = 'U_CHANNEL',
  CIRCLE = 'CIRCLE',
  FLANGE = 'FLANGE',
  LINE = 'LINE',
  POLYLINE = 'POLYLINE',
  ARC = 'ARC',
  SECTOR = 'SECTOR',
  TORUS = 'TORUS',
  EQUILATERAL_TRIANGLE = 'EQUILATERAL_TRIANGLE',
  ISOSCELES_RIGHT_TRIANGLE = 'ISOSCELES_RIGHT_TRIANGLE',
  CIRCLE_WITH_HOLES = 'CIRCLE_WITH_HOLES',
  RECTANGLE_WITH_HOLES = 'RECTANGLE_WITH_HOLES',
  // Whiteboard items
  DRAWING = 'DRAWING',
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
}

export enum PrintingMethod {
  SCAN = 'scan',
  ENGRAVE = 'engrave',
}

export interface Layer {
  id: string;
  name: string;
  isVisible: boolean;
  printingMethod: PrintingMethod;
  lineDensity?: number;
  halftone?: boolean;
  reverseMovementOffset?: number;
  power?: number;
}

export interface PartParameters {
  [key: string]: number;
}

export type PartType =
  | CanvasItemType.RECTANGLE
  | CanvasItemType.L_BRACKET
  | CanvasItemType.U_CHANNEL
  | CanvasItemType.CIRCLE
  | CanvasItemType.FLANGE
  | CanvasItemType.LINE
  | CanvasItemType.POLYLINE
  | CanvasItemType.ARC
  | CanvasItemType.SECTOR
  | CanvasItemType.TORUS
  | CanvasItemType.EQUILATERAL_TRIANGLE
  | CanvasItemType.ISOSCELES_RIGHT_TRIANGLE
  | CanvasItemType.CIRCLE_WITH_HOLES
  | CanvasItemType.RECTANGLE_WITH_HOLES;

export interface Part {
  id: string;
  type: PartType;
  x: number;
  y: number;
  parameters: PartParameters;
  rotation: number;
  layerId: string;
  scaleX?: number; // <--- 新增
  scaleY?: number; // <--- 新增
}

export interface Drawing {
  id: string;
  type: CanvasItemType.DRAWING;
  x: number;
  y: number;
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  rotation: number;
  layerId: string;
  fillColor?: string;
  scaleX?: number; // <--- 新增
  scaleY?: number; // <--- 新增
}

export interface TextObject {
  id: string;
  type: CanvasItemType.TEXT;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  rotation: number;
  layerId: string;
  scaleX?: number; // <--- 新增
  scaleY?: number; // <--- 新增
}

export interface ImageObject {
  id: string;
  type: CanvasItemType.IMAGE;
  x: number;
  y: number;
  width: number;
  height: number;
  href: string;
  rotation: number;
  layerId: string;
  scaleX?: number; // <--- 新增
  scaleY?: number; // <--- 新增
  vectorSource?: {
    type: 'svg' | 'dxf' | 'plt';
    content: string; // 原始文件内容
    parsedItems?: CanvasItemData[]; // 解析后的矢量对象
  };
}

export interface GroupObject {
  id: string;
  type: 'GROUP';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  children: CanvasItem[];
  layerId: string;
  scaleX?: number; // <--- 新增
  scaleY?: number; // <--- 新增
}


export type CanvasItem = Part | Drawing | TextObject | ImageObject | GroupObject;

// CanvasItemData 也将自动继承这些可选属性
export type CanvasItemData =
  | Omit<Part, 'id' | 'layerId'>
  | Omit<Drawing, 'id' | 'layerId'>
  | Omit<TextObject, 'id' | 'layerId'>
  | Omit<ImageObject, 'id' | 'layerId'>
  | Omit<GroupObject, 'id' | 'layerId' | 'children'> & { children: CanvasItemData[] };

export interface PartDefinition {
  type: PartType;
  name: string;
  icon: ReactNode;
  defaultParameters: PartParameters;
}