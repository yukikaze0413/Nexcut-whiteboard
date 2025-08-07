
import type { PartDefinition } from './types';
import { CanvasItemType } from './types';

export const BASIC_SHAPES: PartDefinition[] = [
  {
    type: CanvasItemType.RECTANGLE,
    name: '矩形',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M4 6v12h16V6H4zm14 10H6V8h12v8z"></path></svg>,
    defaultParameters: { width: 100, height: 60 },
  },
  {
    type: CanvasItemType.CIRCLE,
    name: '圆形',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z"></path></svg>,
    defaultParameters: { radius: 40 },
  },
  {
    type: CanvasItemType.LINE,
    name: '直线',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M3 11h18v2H3z"/></svg>,
    defaultParameters: { length: 100 },
  },
  {
    type: CanvasItemType.POLYLINE,
    name: '多段线',
    icon: <svg viewBox="0 0 24 24" className="w-6 h-6"><path d="M2 16.154V14.5l6-3.5 4 2 8-5v1.654l-8 5-4-2-6 3.5z" fill="currentColor"/></svg>,
    defaultParameters: { seg1: 40, seg2: 50, angle: 135, seg3: 40 },
  },
  {
    type: CanvasItemType.ARC,
    name: '圆弧',
    icon: <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" className="w-6 h-6"><path d="M22 12A10 10 0 0 1 7 20.66"/></svg>,
    defaultParameters: { radius: 50, startAngle: 0, sweepAngle: 120 },
  },
  {
    type: CanvasItemType.SECTOR,
    name: '扇形',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 12H22A10 10 0 0 1 12 22V12z"/></svg>,
    defaultParameters: { radius: 50, startAngle: -90, sweepAngle: 90 },
  },
  {
    type: CanvasItemType.EQUILATERAL_TRIANGLE,
    name: '等边三角形',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 2L1.5 21h21L12 2z"></path></svg>,
    defaultParameters: { sideLength: 80 },
  },
  {
    type: CanvasItemType.ISOSCELES_RIGHT_TRIANGLE,
    name: '直角等腰三角形',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22 21H2V2l20 19z"></path></svg>,
    defaultParameters: { legLength: 80 },
  },
];

export const PART_LIBRARY: PartDefinition[] = [
  {
    type: CanvasItemType.L_BRACKET,
    name: 'L型支架',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M18 4v2h-6v12H6v-6H4V4h14zm-2 12V8h-2v8h2zM6 10h2v4H6v-4z"></path></svg>,
    defaultParameters: { width: 80, height: 80, thickness: 15 },
  },
  {
    type: CanvasItemType.U_CHANNEL,
    name: 'U型槽',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M20 4H4v16h2V6h12v14h2V4z"></path></svg>,
    defaultParameters: { width: 80, height: 100, flange: 25, thickness: 10 },
  },
  {
    type: CanvasItemType.FLANGE,
    name: '法兰',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" />
        <circle cx="12" cy="5" r="1.2" />
        <circle cx="19" cy="12" r="1.2" />
        <circle cx="12" cy="19" r="1.2" />
        <circle cx="5" cy="12" r="1.2" />
      </svg>
    ),
    defaultParameters: {
      outerDiameter: 120,
      innerDiameter: 60,
      boltCircleDiameter: 90,
      boltHoleCount: 6,
      boltHoleDiameter: 8,
    },
  },
  {
    type: CanvasItemType.TORUS,
    name: '圆环',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" />
      </svg>
    ),
    defaultParameters: { outerRadius: 60, innerRadius: 30 },
  },
  {
    type: CanvasItemType.CIRCLE_WITH_HOLES,
    name: '带孔圆板',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z" />
        <circle cx="12" cy="7" r="1" />
        <circle cx="17" cy="12" r="1" />
        <circle cx="12" cy="17" r="1" />
        <circle cx="7" cy="12" r="1" />
      </svg>
    ),
    defaultParameters: { radius: 80, holeRadius: 8, holeCount: 4, holeDistance: 50 },
  },
  {
    type: CanvasItemType.RECTANGLE_WITH_HOLES,
    name: '带孔矩形板',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M4 4h16v16H4V4zm2 2v12h12V6H6z" />
        <circle cx="9" cy="9" r="1.2" />
        <circle cx="15" cy="9" r="1.2" />
        <circle cx="9" cy="15" r="1.2" />
        <circle cx="15" cy="15" r="1.2" />
      </svg>
    ),
    defaultParameters: { width: 120, height: 80, holeRadius: 8, horizontalMargin: 20, verticalMargin: 20 },
  },
];