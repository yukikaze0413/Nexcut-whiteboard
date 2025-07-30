import type { ImageObject, CanvasItem, Layer } from '../types';
import { CanvasItemType, PrintingMethod } from '../types';

// 定义G代码生成所需的参数
export interface GCodeScanSettings {
  lineDensity: number; // 线密度 (mm/pixel)
  isHalftone: boolean; // 是否开启半调网屏
  negativeImage?: boolean; // 是否为负片
  hFlipped?: boolean; // 水平翻转
  vFlipped?: boolean; // 垂直翻转
  minPower?: number; // 最小功率
  maxPower?: number; // 最大功率
  burnSpeed?: number; // 燃烧速度 (mm/min)
  travelSpeed?: number; // 空程速度 (mm/min)
  overscanDist?: number; // 超扫描距离 (mm)
}

// 颜色空间转换 (sRGB -> Linear)
function sRGB2Linear(c: number): number {
  c /= 255.0;
  return c < 0.04045 ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
}

// 颜色空间转换 (Linear -> sRGB)
function linear2sRGB(l: number): number {
  return Math.round((l > 0.0031308 ? 1.055 * (Math.pow(l, (1.0 / 2.4))) - 0.055 : 12.92 * l) * 255);
}

function roundCoord(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * 创建整个平台的像素数据
 * @param imageItems - 图层中的所有图像对象
 * @param platformWidth - 平台宽度 (mm)
 * @param platformHeight - 平台高度 (mm)
 * @param lineDensity - 线密度 (mm/pixel)
 * @param settings - 处理设置
 * @returns 整个平台的像素数据
 */
async function createPlatformImage(
  imageItems: ImageObject[],
  platformWidth: number,
  platformHeight: number,
  lineDensity: number,
  settings: GCodeScanSettings,
  // +++ 新增参数 +++
  canvasWidth: number, 
  canvasHeight: number
): Promise<{ width: number; height: number; data: Int16Array }> {
  const pixelWidth = Math.round(platformWidth / lineDensity);
  const pixelHeight = Math.round(platformHeight / lineDensity);
  
  const platformCanvas = document.createElement("canvas");
  platformCanvas.width = pixelWidth;
  platformCanvas.height = pixelHeight;
  const platformCtx = platformCanvas.getContext("2d");
  if (!platformCtx) {
    throw new Error("无法创建平台图像上下文");
  }
  
  platformCtx.fillStyle = "white";
  platformCtx.fillRect(0, 0, pixelWidth, pixelHeight);

  // +++ 核心改动：计算缩放比例 +++
  // 从前端画布尺寸到物理平台像素尺寸的缩放比例
  const scaleX = pixelWidth / canvasWidth;
  const scaleY = pixelHeight / canvasHeight;
  
  const imagePromises = imageItems.map(async (item) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // 1. 计算图像在前端画布中的左上角坐标
        //    item.x, item.y 已经是左上角坐标，不需要再计算
        const itemTopLeftX_canvas = item.x;
        const itemTopLeftY_canvas = item.y;

        // 2. 将前端画布的坐标和尺寸，按比例转换到平台画布（像素单位）
        const destX_pixels = itemTopLeftX_canvas * scaleX;
        const destY_pixels = itemTopLeftY_canvas * scaleY;
        const destWidth_pixels = item.width * scaleX;
        const destHeight_pixels = item.height * scaleY;
        
        // 3. 绘制到平台Canvas上
        platformCtx.drawImage(
          img, 
          destX_pixels, 
          destY_pixels, 
          destWidth_pixels, 
          destHeight_pixels
        );
        resolve();
      };
      img.onerror = () => reject(new Error(`无法加载图像: ${item.href}`));
      img.src = item.href;
    });
  });
  
  await Promise.all(imagePromises);  
  // 提取像素数据并转换为灰度
  const srcData = platformCtx.getImageData(0, 0, pixelWidth, pixelHeight).data;
  const destData = new Int16Array(pixelWidth * pixelHeight);
  
  for (let y = 0, i = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++, i++) {
      const si = i << 2; // i * 4
      // 计算亮度 (Luminance)
      const l = 0.2126 * sRGB2Linear(srcData[si]) + 0.7152 * sRGB2Linear(srcData[si + 1]) + 0.0722 * sRGB2Linear(srcData[si + 2]);
      destData[i] = linear2sRGB(Math.pow(settings.negativeImage ? 1 - l : l, 1.0));
    }
  }
  
  // 应用翻转处理
  if (settings.hFlipped) {
    for (let y = 0, i = 0; y < pixelHeight; y++, i += pixelWidth) {
      let x = pixelWidth >> 1;
      let i1 = i + pixelWidth - 1;
      while (x-- > 0) {
        const c = destData[i + x];
        destData[i + x] = destData[i1 - x];
        destData[i1 - x] = c;
      }
    }
  }
  
  if (settings.vFlipped) {
    let y = pixelHeight >> 1;
    while (y-- > 0) {
      const i0 = y * pixelWidth;
      const i1 = (pixelHeight - 1 - y) * pixelWidth;
      for (let x = 0; x < pixelWidth; x++) {
        const c = destData[i0 + x];
        destData[i0 + x] = destData[i1 + x];
        destData[i1 + x] = c;
      }
    }
  }
  
  // 应用半调网屏处理
  if (settings.isHalftone) {
    const matrix = [[0, 0, 0, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]];
    for (let y = 0, i = 0; y < pixelHeight; y++) {
      for (let x = 0; x < pixelWidth; x++, i++) {
        const c = destData[i];
        destData[i] = c < 128 ? 0 : 255;
        const quantError = c - destData[i];
        if (quantError === 0) continue;
        for (let iy = 0; iy < 3; iy++) {
          const my = y + iy;
          if (my >= pixelHeight) continue;
          for (let ix = 0; ix < 5; ix++) {
            const m = matrix[iy][ix];
            if (m === 0) continue;
            const mx = x + ix - 2;
            if (mx < 0 || mx >= pixelWidth) continue;
            destData[mx + my * pixelWidth] += quantError * m / 48;
          }
        }
      }
    }
  }
  
  return {
    width: pixelWidth,
    height: pixelHeight,
    data: destData,
  };
}

/**
 * 为整个扫描图层（平台）生成G代码
 * @param layer - 扫描图层
 * @param items - 画布中的所有项目
 * @param platformWidth - 平台宽度 (mm)
 * @param platformHeight - 平台高度 (mm)
 * @param settings - G代码生成设置
 * @returns 生成的G代码字符串
 */
export async function generatePlatformScanGCode(
  layer: Layer,
  items: CanvasItem[],
  platformWidth: number,
  platformHeight: number,
  settings: GCodeScanSettings,
  // +++ 新增参数 +++
  canvasWidth: number,
  canvasHeight: number
): Promise<string> {
  // 筛选出属于该图层的图像对象
  const imageItems = items.filter(item => 
    item.layerId === layer.id && item.type === CanvasItemType.IMAGE
  ) as ImageObject[];
  
  if (imageItems.length === 0) {
    throw new Error('扫描图层中没有图像对象');
  }

  const {
    lineDensity,
    minPower = 0,
    maxPower = 255,
    burnSpeed = 1000,
    travelSpeed = 6000,
    overscanDist = 3,
  } = settings;
  
  // 创建整个平台的像素数据
 const platformImage = await createPlatformImage(
    imageItems, 
    platformWidth, 
    platformHeight, 
    lineDensity, 
    settings,
    // +++ 传递新参数 +++
    canvasWidth,
    canvasHeight
  );
  
  const { width, height, data } = platformImage;
  const dx = lineDensity;
  const dy = lineDensity;
  
  const gcode: string[] = [];
  let x0: number | null = null, y0: number | null = null, speed0: number | null = null;
  let x1: number | null = null, y1: number | null = null, speed1: number | null = null, power1 = 0;
  
  function flush(ignoreTravel: boolean = false) {
    let cmd = "G1 ";
    if (x0 !== x1 && x1 != null) {
      cmd += `X${roundCoord(x1)}`;
      x0 = x1;
    }
    if (y0 !== y1 && y1 != null) {
      cmd += `Y${roundCoord(y1)}`;
      y0 = y1;
    }
    if (cmd.length === 3 || (power1 === 0 && ignoreTravel)) {
      return;
    }
    cmd += `S${power1}`;
    if (speed0 !== speed1) {
      cmd += `F${speed1}`;
      speed0 = speed1;
    }
    gcode.push(cmd);
  }
  
  function goTo(x: number | null, y: number | null, power: number, speed: number, forceFlush: boolean = false) {
    if (power1 !== power || speed1 !== speed) {
      flush();
      power1 = power;
      speed1 = speed;
    }
    x1 = x ?? x1;
    y1 = y ?? y1;
    if (forceFlush) {
      flush();
    }
  }
  
  // G代码头部信息
  gcode.push(`; Platform Scan G-Code for Nexcut`);
  gcode.push(`; Layer: ${layer.name}`);
  gcode.push(`; Image Count: ${imageItems.length}`);
  gcode.push(`; Platform Size: ${platformWidth}x${platformHeight} mm`);
  gcode.push(`; Resolution: ${lineDensity} mm/pixel (${width}x${height} pixels)`);
  gcode.push(`; Mode: ${settings.isHalftone ? "Halftone" : "Greyscale"}`);
  gcode.push(`; Power: [${minPower}, ${maxPower}]`);
  gcode.push(`; Speed: Burn=${burnSpeed} mm/min, Travel=${travelSpeed} mm/min`);
  gcode.push(`; Overscan: ${overscanDist} mm`);
  gcode.push(`;`);
  gcode.push(`G90 ; Absolute positioning`);
  gcode.push(`G21 ; Units in millimeters`);
  gcode.push(`G0 X0 Y0 F${travelSpeed} ; Move to origin`);
  gcode.push(`M4 ; Enable laser (variable power mode)`);
  gcode.push(``);
  
  // 生成扫描路径 - 覆盖整个平台
  for (let y = 0; y < height; y++) {
    const reverseDir = y % 2 !== 0; // 之字形扫描
    const currentY = y * dy;
    
    // 移动到行的开始位置（带超扫描）
    const startX = reverseDir ? (width * dx) + overscanDist : -overscanDist;
    goTo(startX, currentY, 0, travelSpeed, true);
    
    // 移动到平台边缘
    goTo(reverseDir ? width * dx : 0, null, 0, travelSpeed);
    
    // 扫描这一行
    for (let sx = 0; sx < width; sx++) {
      const ix = reverseDir ? (width - 1 - sx) : sx;
      const pixelIndex = ix + (height - 1 - y) * width; // Y坐标反转以匹配机器坐标系
      const c = data[pixelIndex];
      
      // 计算激光功率
      const power = settings.isHalftone
        ? (c < 128 ? maxPower : 0)
        : Math.round((minPower + (1.0 - c / 255.0) * (maxPower - minPower)) * 10) / 10;
      
      const xpos = ix * dx;
      
      if (power > 0) {
        goTo(xpos, null, power, burnSpeed);
      } else {
        goTo(xpos, null, 0, burnSpeed);
      }
    }
    
    // 移动到行的结束位置（带超扫描）
    const endX = reverseDir ? -overscanDist : (width * dx) + overscanDist;
    goTo(endX, null, 0, travelSpeed, true);
    gcode.push(``);
  }
  
  // G代码尾部
  gcode.push(`M5 ; Disable laser`);
  gcode.push(`G1 S0 F${travelSpeed} ; Set power to 0`);
  gcode.push(`G0 X0 Y0 ; Return to origin`);
  gcode.push(`M2 ; End program`);
  gcode.push(``);
  
  return gcode.join('\n');
}

/**
 * 为单个图像对象生成G代码（保留原有功能）
 * @deprecated 建议使用 generatePlatformScanGCode 来处理整个图层
 */
export async function generateScanGCode(imageItem: ImageObject, settings: GCodeScanSettings): Promise<string> {
  // 为了兼容性，创建一个临时图层来使用新的平台扫描功能
  const tempLayer: Layer = { 
    id: 'temp', 
    name: 'Single Image', 
    isVisible: true, 
    printingMethod: PrintingMethod.SCAN 
  };
  
  const tempItems: CanvasItem[] = [imageItem];
  
  // 使用图像的尺寸作为"平台"尺寸
  return generatePlatformScanGCode(
    tempLayer,
    tempItems,
    imageItem.width,  // platformWidth
    imageItem.height, // platformHeight
    settings,
    // +++ 补上缺失的参数 +++
    imageItem.width,  // canvasWidth
    imageItem.height  // canvasHeight
  );
}