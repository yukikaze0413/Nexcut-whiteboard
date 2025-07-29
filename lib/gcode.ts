

import type { ImageObject } from '../types';

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
 * 从图像对象创建用于雕刻的像素数据
 * @param image - 源图像的HTMLImageElement
 * @param width - 目标宽度 (mm)
 * @param height - 目标高度 (mm)
 * @param lineDensity - 分辨率 (mm/pixel)
 * @param isHalftone - 是否使用半调网屏
 * @param negativeImage - 是否反色
 * @param hFlipped - 是否水平翻转
 * @param vFlipped - 是否垂直翻转
 * @returns 处理后的图像数据
 */
function createEngravingImage(
  image: HTMLImageElement,
  width: number,
  height: number,
  lineDensity: number,
  isHalftone: boolean,
  negativeImage: boolean,
  hFlipped: boolean,
  vFlipped: boolean
): { width: number; height: number; data: Int16Array } {
  const engravingWidth = Math.round(width / lineDensity);
  const engravingHeight = Math.round(height / lineDensity);

  // 1. 将源图像绘制到临时的Canvas上以进行缩放和像素提取
  const canvas = document.createElement("canvas");
  canvas.width = engravingWidth;
  canvas.height = engravingHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法获取Canvas 2D上下文");
  }
  ctx.drawImage(image, 0, 0, engravingWidth, engravingHeight);

  // 2. 提取像素数据并转换为灰度
  const srcData = ctx.getImageData(0, 0, engravingWidth, engravingHeight).data;
  const destData = new Int16Array(engravingWidth * engravingHeight);
  for (let y = 0, i = 0; y < engravingHeight; y++) {
    for (let x = 0; x < engravingWidth; x++, i++) {
      const si = i << 2; // i * 4
      // 计算亮度 (Luminance)
      const l = 0.2126 * sRGB2Linear(srcData[si]) + 0.7152 * sRGB2Linear(srcData[si + 1]) + 0.0722 * sRGB2Linear(srcData[si + 2]);
      destData[i] = linear2sRGB(Math.pow(negativeImage ? 1 - l : l, 1.0)); // Gamma is 1.0 for now
    }
  }

  // 3. 水平翻转
  if (hFlipped) {
    for (let y = 0, i = 0; y < engravingHeight; y++, i += engravingWidth) {
      let x = engravingWidth >> 1;
      let i1 = i + engravingWidth - 1;
      while (x-- > 0) {
        const c = destData[i + x];
        destData[i + x] = destData[i1 - x];
        destData[i1 - x] = c;
      }
    }
  }

  // 4. 垂直翻转
  if (vFlipped) {
    let y = engravingHeight >> 1;
    while (y-- > 0) {
      const i0 = y * engravingWidth;
      const i1 = (engravingHeight - 1 - y) * engravingWidth;
      for (let x = 0; x < engravingWidth; x++) {
        const c = destData[i0 + x];
        destData[i0 + x] = destData[i1 + x];
        destData[i1 + x] = c;
      }
    }
  }

  // 5. 应用半调网屏 (抖动算法)
  if (isHalftone) {
    // Jarvis-Judice-Ninke Dithering
    const matrix = [[0, 0, 0, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]];
    for (let y = 0, i = 0; y < engravingHeight; y++) {
      for (let x = 0; x < engravingWidth; x++, i++) {
        const c = destData[i];
        destData[i] = c < 128 ? 0 : 255; // 量化为黑或白
        const quantError = c - destData[i];
        if (quantError === 0) continue;
        for (let iy = 0; iy < 3; iy++) {
          const my = y + iy;
          if (my >= engravingHeight) continue;
          for (let ix = 0; ix < 5; ix++) {
            const m = matrix[iy][ix];
            if (m === 0) continue;
            const mx = x + ix - 2;
            if (mx < 0 || mx >= engravingWidth) continue;
            destData[mx + my * engravingWidth] += quantError * m / 48;
          }
        }
      }
    }
  }

  return {
    width: engravingWidth,
    height: engravingHeight,
    data: destData,
  };
}


/**
 * 为扫描图层生成G代码
 * @param imageItem - 画布上的图像对象
 * @param settings - G代码生成相关的设置
 * @returns 生成的G代码字符串
 */
export async function generateScanGCode(imageItem: ImageObject, settings: GCodeScanSettings): Promise<string> {
  return new Promise((resolve, reject) => {
    const {
      lineDensity,
      isHalftone,
      negativeImage = false,
      hFlipped = false,
      vFlipped = false,
      minPower = 0,
      maxPower = 255,
      burnSpeed = 1000,
      travelSpeed = 6000,
      overscanDist = 3,
    } = settings;

    const sourceImage = new Image();
    sourceImage.crossOrigin = "anonymous"; // 允许跨域加载图片数据
    sourceImage.src = imageItem.href;

    sourceImage.onload = () => {
      try {
        const engravingImage = createEngravingImage(
          sourceImage,
          imageItem.width,
          imageItem.height,
          lineDensity,
          isHalftone,
          negativeImage,
          hFlipped,
          vFlipped
        );

        const { width, height, data } = engravingImage;
        const dx = lineDensity;
        const dy = lineDensity;
        const overscanPixels = Math.floor(overscanDist / dx);
        
        const gcode: string[] = [];
        let x0: number | null, y0: number | null, speed0: number | null;
        let x1: number | null, y1: number | null, speed1: number | null, power1 = 0;

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

        gcode.push(`; Image to G-Code for Nexcut`);
        gcode.push(`; Image Size: ${imageItem.width}x${imageItem.height} mm`);
        gcode.push(`; Resolution: ${lineDensity} mm/pixel`);
        gcode.push(`; Mode: ${isHalftone ? "Halftone" : "Greyscale"}`);
        gcode.push(`; Power: [${minPower}, ${maxPower}]`);
        gcode.push(`; Speed: Burn=${burnSpeed} mm/min, Travel=${travelSpeed} mm/min`);
        gcode.push(`;`);
        gcode.push(`G90 ; Absolute positioning`);
        gcode.push(`G0 X0 Y0 F${travelSpeed} ; Move to origin`);
        gcode.push(`M4 ; Enable laser`);
        gcode.push(``);

        for (let y = 0; y < height; y++) {
          const reverseDir = y % 2 !== 0;
          const currentY = imageItem.y + y * dy;

          // Move to the start of the line (with overscan)
          const startX = imageItem.x + (reverseDir ? (width * dx) + overscanDist : -overscanDist);
          goTo(startX, currentY, 0, travelSpeed, true);

          // Move to the edge of the image
          goTo(imageItem.x + (reverseDir ? width * dx : 0), null, 0, travelSpeed);

          for (let sx = 0; sx < width; sx++) {
            const ix = reverseDir ? (width - 1 - sx) : sx;
            const c = data[ix + (height - 1 - y) * width]; // Y is inverted to match machine coordinates
            
            const power = isHalftone
              ? (c < 128 ? maxPower : 0)
              : Math.round((minPower + (1.0 - c / 255.0) * (maxPower - minPower)) * 10) / 10;

            const xpos = imageItem.x + ix * dx;
            
            if (power > 0) {
              goTo(xpos, null, power, burnSpeed);
            } else {
              goTo(xpos, null, 0, burnSpeed);
            }
          }
          
          // Move to the end of the line (with overscan)
          const endX = imageItem.x + (reverseDir ? -overscanDist : (width * dx) + overscanDist);
          goTo(endX, null, 0, travelSpeed, true);
          gcode.push(``);
        }

        gcode.push(`M5 ; Disable laser`);
        gcode.push(`G1 S0`);
        gcode.push(`G1 X0 Y0 S0 F${travelSpeed}`);
        gcode.push(`M2 ; End program`);
        gcode.push(``);

        resolve(gcode.join('\n'));
      } catch (error) {
        reject(error);
      }
    };

    sourceImage.onerror = () => {
      reject(new Error('无法加载图像，请检查图片链接或是否跨域。'));
    };
  });
}
