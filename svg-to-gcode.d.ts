declare module 'svg-to-gcode' {
  export class Converter {
    constructor();
    convert(svg: string): string;
  }
} 