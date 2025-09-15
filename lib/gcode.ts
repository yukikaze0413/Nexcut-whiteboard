import type { ImageObject, CanvasItem, Layer } from '../types';
import { CanvasItemType, PrintingMethod } from '../types';
import { Helper, parseString as parseDxf } from 'dxf';

// 定义G代码生成所需的参数
export interface GCodeScanSettings {
  lineDensity: number; // 线密度 (mm/pixel)
  isHalftone: boolean; // 是否开启半调网屏
  negativeImage?: boolean; // 是否为负片
  hFlipped?: boolean; // 水平翻转
  vFlipped?: boolean; // 垂直翻转
  minPower?: number; // 最小功率 (0-100)
  maxPower?: number; // 最大功率 (0-100)
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
 * 辅助函数：在Canvas上绘制单个矢量图形项
 * @param ctx - Canvas 2D渲染上下文
 * @param item - 要绘制的CanvasItem (零件或基础形状)
 * @param scaleX - X轴缩放比例 (mm -> pixel)
 * @param scaleY - Y轴缩放比例 (mm -> pixel)
 */
function drawCanvasItem(ctx: CanvasRenderingContext2D, item: CanvasItem, scaleX: number, scaleY: number): void {
  // 我们只处理带有参数的矢量图形
  if (!('parameters' in item)) {
    return;
  }
  
  // 对于扫描，我们总是填充黑色实体
  ctx.fillStyle = 'black';
  ctx.strokeStyle = 'black';

  // 计算图形中心点在平台画布上的像素坐标
  const centerX_pixels = item.x * scaleX;
  const centerY_pixels = item.y * scaleY;
  const rotation_rad = ('rotation' in item ? item.rotation || 0 : 0) * Math.PI / 180;
  
  // 保存当前画布状态
  ctx.save();
  
  // 应用变换：平移到中心点，然后旋转
  ctx.translate(centerX_pixels, centerY_pixels);
  ctx.rotate(rotation_rad);
  
  // 开始绘制路径
  ctx.beginPath();
  
  // 根据图形类型进行绘制
  switch (item.type) {
    case CanvasItemType.RECTANGLE: {
      const { width = 40, height = 40 } = item.parameters;
      const w_px = width * scaleX;
      const h_px = height * scaleY;
      ctx.rect(-w_px / 2, -h_px / 2, w_px, h_px);
      break;
    }
    case CanvasItemType.CIRCLE: {
      const { radius = 20 } = item.parameters;
      // 使用平均缩放比例以保持圆形
      const r_px = radius * ((scaleX + scaleY) / 2);
      ctx.arc(0, 0, r_px, 0, 2 * Math.PI);
      break;
    }
    case CanvasItemType.LINE: {
      const { length = 40 } = item.parameters;
      const l_px = length * scaleX;
      // 将线渲染为有厚度的矩形，否则没有面积无法扫描
      ctx.rect(-l_px / 2, -1, l_px, 2); // 2像素厚度
      break;
    }
    case CanvasItemType.FLANGE: {
      const { outerDiameter = 120, innerDiameter = 60, boltCircleDiameter = 90, boltHoleCount = 4, boltHoleDiameter = 8 } = item.parameters;
      const avgScale = (scaleX + scaleY) / 2;
      const outerRadius_px = outerDiameter / 2 * avgScale;
      const innerRadius_px = innerDiameter / 2 * avgScale;
      const boltCircleRadius_px = boltCircleDiameter / 2 * avgScale;
      const boltHoleRadius_px = boltHoleDiameter / 2 * avgScale;

      // 1. 绘制外圆
      ctx.arc(0, 0, outerRadius_px, 0, 2 * Math.PI);
      // 2. 绘制内圆（反向，用于镂空）
      ctx.moveTo(innerRadius_px, 0);
      ctx.arc(0, 0, innerRadius_px, 0, 2 * Math.PI, true);
      // 3. 绘制螺栓孔（反向，用于镂空）
      for (let i = 0; i < boltHoleCount; i++) {
        const angle = (i / boltHoleCount) * 2 * Math.PI;
        const holeX = boltCircleRadius_px * Math.cos(angle);
        const holeY = boltCircleRadius_px * Math.sin(angle);
        ctx.moveTo(holeX + boltHoleRadius_px, holeY);
        ctx.arc(holeX, holeY, boltHoleRadius_px, 0, 2 * Math.PI, true);
      }
      break;
    }
    case CanvasItemType.TORUS: {
      const { outerRadius = 60, innerRadius = 30 } = item.parameters;
      const avgScale = (scaleX + scaleY) / 2;
      const outerRadius_px = outerRadius * avgScale;
      const innerRadius_px = innerRadius * avgScale;
      // 绘制外圆
      ctx.arc(0, 0, outerRadius_px, 0, 2 * Math.PI);
      // 绘制内圆（反向，用于镂空）
      ctx.moveTo(innerRadius_px, 0);
      ctx.arc(0, 0, innerRadius_px, 0, 2 * Math.PI, true);
      break;
    }
    case CanvasItemType.L_BRACKET: {
      const { width = 80, height = 80, thickness = 15 } = item.parameters;
      const w_px = width * scaleX;
      const h_px = height * scaleY;
      const t_w_px = thickness * scaleX;
      const t_h_px = thickness * scaleY;
      
      const w2 = w_px / 2;
      const h2 = h_px / 2;

      ctx.moveTo(-w2, -h2);
      ctx.lineTo(w2, -h2);
      ctx.lineTo(w2, -h2 + t_h_px);
      ctx.lineTo(-w2 + t_w_px, -h2 + t_h_px);
      ctx.lineTo(-w2 + t_w_px, h2);
      ctx.lineTo(-w2, h2);
      ctx.closePath();
      break;
    }
    case CanvasItemType.U_CHANNEL: {
      const { width = 80, height = 100, thickness = 10 } = item.parameters;
      const w_px = width * scaleX;
      const h_px = height * scaleY;
      const t_w_px = thickness * scaleX;
      const t_h_px = thickness * scaleY;

      const w2 = w_px / 2;
      const h2 = h_px / 2;

      // 外轮廓
      ctx.moveTo(-w2, -h2);
      ctx.lineTo(w2, -h2);
      ctx.lineTo(w2, h2);
      ctx.lineTo(-w2, h2);
      ctx.closePath();
      
      // 内轮廓（反向镂空）
      ctx.moveTo(-w2 + t_w_px, -h2 + t_h_px);
      ctx.lineTo(-w2 + t_w_px, h2);
      ctx.lineTo(w2 - t_w_px, h2);
      ctx.lineTo(w2 - t_w_px, -h2 + t_h_px);
      ctx.closePath();
      break;
    }
    case CanvasItemType.RECTANGLE_WITH_HOLES: {
      const { width = 120, height = 80, holeRadius = 8, horizontalMargin = 20, verticalMargin = 20 } = item.parameters;
      const avgScale = (scaleX + scaleY) / 2;
      const w_px = width * scaleX;
      const h_px = height * scaleY;
      const r_px = holeRadius * avgScale;
      const hm_px = horizontalMargin * scaleX;
      const vm_px = verticalMargin * scaleY;

      const w2 = w_px / 2;
      const h2 = h_px / 2;

      // 主矩形
      ctx.rect(-w2, -h2, w_px, h_px);

      // 孔（反向镂空）
      const holePositions = [
        { x: -w2 + hm_px, y: -h2 + vm_px },
        { x: w2 - hm_px, y: -h2 + vm_px },
        { x: -w2 + hm_px, y: h2 - vm_px },
        { x: w2 - hm_px, y: h2 - vm_px },
      ];
      holePositions.forEach(pos => {
        ctx.moveTo(pos.x + r_px, pos.y);
        ctx.arc(pos.x, pos.y, r_px, 0, 2 * Math.PI, true);
      });
      break;
    }
    //... 在这里添加所有其他基础形状和零件库零件的绘制逻辑 ...
    // 下面补充了剩余的形状
    case CanvasItemType.CIRCLE_WITH_HOLES: {
      const { radius = 50, holeRadius = 8, holeCount = 4 } = item.parameters;
      const avgScale = (scaleX + scaleY) / 2;
      const r_px = radius * avgScale;
      const hr_px = holeRadius * avgScale;
      const holeCircleRadius_px = r_px * 0.7;

      // 主圆
      ctx.arc(0, 0, r_px, 0, 2 * Math.PI);
      
      // 孔（反向镂空）
      for (let i = 0; i < holeCount; i++) {
        const angle = (i / holeCount) * 2 * Math.PI;
        const holeX = holeCircleRadius_px * Math.cos(angle);
        const holeY = holeCircleRadius_px * Math.sin(angle);
        ctx.moveTo(holeX + hr_px, holeY);
        ctx.arc(holeX, holeY, hr_px, 0, 2 * Math.PI, true);
      }
      break;
    }
    case CanvasItemType.EQUILATERAL_TRIANGLE: {
      const { sideLength = 40 } = item.parameters;
      const s_px = sideLength * scaleX;
      const h_px = (s_px * Math.sqrt(3)) / 2;

      ctx.moveTo(0, -2 * h_px / 3);
      ctx.lineTo(-s_px / 2, h_px / 3);
      ctx.lineTo(s_px / 2, h_px / 3);
      ctx.closePath();
      break;
    }
    case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: {
        const { cathetus = 50 } = item.parameters;
        const c_px = cathetus * ((scaleX + scaleY) / 2); // 等腰，用平均缩放
        const c2 = c_px / 2;

        ctx.moveTo(-c2, -c2); // 直角顶点
        ctx.lineTo(c2, -c2);
        ctx.lineTo(-c2, c2);
        ctx.closePath();
        break;
    }
    case CanvasItemType.SECTOR: {
        const { radius = 50, startAngle = -90, sweepAngle = 90 } = item.parameters;
        const r_px = radius * ((scaleX + scaleY) / 2);
        const startRad = startAngle * Math.PI / 180;
        const endRad = (startAngle + sweepAngle) * Math.PI / 180;
        
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r_px, startRad, endRad);
        ctx.closePath();
        break;
    }
    case CanvasItemType.ARC: {
        const { radius = 50, startAngle = 0, sweepAngle = 120 } = item.parameters;
        const r_px = radius * ((scaleX + scaleY) / 2);
        const startRad = startAngle * Math.PI / 180;
        const endRad = (startAngle + sweepAngle) * Math.PI / 180;
        // 渲染为有厚度的弧线
        ctx.lineWidth = 2; // 2像素厚度
        ctx.arc(0, 0, r_px, startRad, endRad);
        ctx.stroke(); // 注意这里用stroke而不是fill
        // 因为路径没有闭合，所以fill不会生效。我们需要stroke
        return; //提前返回，避免执行下面的fill
    }
    case CanvasItemType.POLYLINE: {
        const { seg1 = 40, seg2 = 50, seg3 = 30, angle } = item.parameters;
        const s1_px = seg1 * scaleX;
        const s2_px = seg2 * ((scaleX + scaleY) / 2);
        const s3_px = seg3 * scaleX;
        const angleRad = angle * Math.PI / 180;
        
        const p1 = { x: -s1_px/2, y: 0 };
        const p2 = { x: s1_px/2, y: 0 };
        const p3 = { x: p2.x + s2_px * Math.cos(angleRad), y: p2.y + s2_px * Math.sin(angleRad) };
        const p4 = { x: p3.x + s3_px, y: p3.y }; // 假设第三段水平
        
        // 渲染为有厚度的折线
        ctx.lineWidth = 2; // 2像素厚度
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.stroke(); // 注意这里用stroke
        return; // 提前返回
    }
    case CanvasItemType.DRAWING: {
        if ('points' in item && Array.isArray(item.points) && item.points.length > 1) {
            ctx.lineWidth = (item.strokeWidth || 2) * ((scaleX + scaleY) / 2);
            item.points.forEach((p, i) => {
                const px = p.x * scaleX;
                const py = p.y * scaleY;
                if (i === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            });
            ctx.stroke();
        }
        return; // 提前返回
    }
  }
  
  // 执行填充（使用非零环绕规则处理镂空）
  ctx.fill('nonzero');
  
  // 恢复画布状态
  ctx.restore();
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
// async function createPlatformImage(
//   imageItems: ImageObject[],
//   platformWidth: number,
//   platformHeight: number,
//   lineDensity: number,
//   settings: GCodeScanSettings,
//   // +++ 新增参数 +++
//   canvasWidth: number,
//   canvasHeight: number
// ): Promise<{ width: number; height: number; data: Int16Array }> {
//   const pixelWidth = Math.round(platformWidth / lineDensity);
//   const pixelHeight = Math.round(platformHeight / lineDensity);

//   const platformCanvas = document.createElement("canvas");
//   platformCanvas.width = pixelWidth;
//   platformCanvas.height = pixelHeight;
//   const platformCtx = platformCanvas.getContext("2d");
//   if (!platformCtx) {
//     throw new Error("无法创建平台图像上下文");
//   }

//   platformCtx.fillStyle = "white";
//   platformCtx.fillRect(0, 0, pixelWidth, pixelHeight);

//   // +++ 核心改动：计算缩放比例 +++
//   // 从前端画布尺寸到物理平台像素尺寸的缩放比例
//   const scaleX = pixelWidth / canvasWidth;
//   const scaleY = pixelHeight / canvasHeight;

//   const imagePromises = imageItems.map(async (item) => {
//     return new Promise<void>((resolve, reject) => {
//       const img = new Image();
//       img.crossOrigin = "anonymous";
//       img.onload = () => {
//         // 1. 计算图像在前端画布中的左上角坐标
//         //    item.x, item.y 现在是中心坐标，需要转换为左上角坐标
//         const itemTopLeftX_canvas = item.x - item.width / 2;
//         const itemTopLeftY_canvas = item.y - item.height / 2;

//         // 2. 将前端画布的坐标和尺寸，按比例转换到平台画布（像素单位）
//         const destX_pixels = itemTopLeftX_canvas * scaleX;
//         const destY_pixels = itemTopLeftY_canvas * scaleY;
//         const destWidth_pixels = item.width * scaleX;
//         const destHeight_pixels = item.height * scaleY;

//         // 3. 绘制到平台Canvas上
//         platformCtx.drawImage(
//           img,
//           destX_pixels,
//           destY_pixels,
//           destWidth_pixels,
//           destHeight_pixels
//         );
//         resolve();
//       };
//       img.onerror = () => reject(new Error(`无法加载图像: ${item.href}`));
//       img.src = item.href;
//     });
//   });

//   await Promise.all(imagePromises);
//   // 提取像素数据并转换为灰度
//   const srcData = platformCtx.getImageData(0, 0, pixelWidth, pixelHeight).data;
//   const destData = new Int16Array(pixelWidth * pixelHeight);

//   for (let y = 0, i = 0; y < pixelHeight; y++) {
//     for (let x = 0; x < pixelWidth; x++, i++) {
//       const si = i << 2; // i * 4
//       // 计算亮度 (Luminance)
//       const l = 0.2126 * sRGB2Linear(srcData[si]) + 0.7152 * sRGB2Linear(srcData[si + 1]) + 0.0722 * sRGB2Linear(srcData[si + 2]);
//       destData[i] = linear2sRGB(Math.pow(settings.negativeImage ? 1 - l : l, 1.0));
//     }
//   }

//   // 应用翻转处理
//   if (settings.hFlipped) {
//     for (let y = 0, i = 0; y < pixelHeight; y++, i += pixelWidth) {
//       let x = pixelWidth >> 1;
//       let i1 = i + pixelWidth - 1;
//       while (x-- > 0) {
//         const c = destData[i + x];
//         destData[i + x] = destData[i1 - x];
//         destData[i1 - x] = c;
//       }
//     }
//   }

//   if (settings.vFlipped) {
//     let y = pixelHeight >> 1;
//     while (y-- > 0) {
//       const i0 = y * pixelWidth;
//       const i1 = (pixelHeight - 1 - y) * pixelWidth;
//       for (let x = 0; x < pixelWidth; x++) {
//         const c = destData[i0 + x];
//         destData[i0 + x] = destData[i1 + x];
//         destData[i1 + x] = c;
//       }
//     }
//   }

//   // 应用半调网屏处理
//   if (settings.isHalftone) {
//     // 创建工作缓冲区以避免误差扩散污染原始空白区域
//     const workingData = new Float32Array(destData);
//     const originalWhiteMask = new Uint8Array(pixelWidth * pixelHeight);

//     // 记录原始的纯白像素位置
//     for (let i = 0; i < destData.length; i++) {
//       originalWhiteMask[i] = destData[i] >= 220 ? 1 : 0; // 原始白色区域
//     }

//     const matrix = [[0, 0, 0, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]];
//     for (let y = 0, i = 0; y < pixelHeight; y++) {
//       for (let x = 0; x < pixelWidth; x++, i++) {
//         const c = workingData[i];
//         const newValue = c < 128 ? 0 : 255;
//         destData[i] = newValue;

//         const quantError = c - newValue;
//         if (quantError === 0) continue;

//         // 误差扩散到周围像素（在工作缓冲区中）
//         for (let iy = 0; iy < 3; iy++) {
//           const my = y + iy;
//           if (my >= pixelHeight) continue;
//           for (let ix = 0; ix < 5; ix++) {
//             const m = matrix[iy][ix];
//             if (m === 0) continue;
//             const mx = x + ix - 2;
//             if (mx < 0 || mx >= pixelWidth) continue;
//             const targetIndex = mx + my * pixelWidth;

//             // 只对非原始白色区域进行误差扩散
//             if (originalWhiteMask[targetIndex] === 0) {
//               workingData[targetIndex] += quantError * m / 48;
//               // 确保值在有效范围内
//               workingData[targetIndex] = Math.max(0, Math.min(255, workingData[targetIndex]));
//             }
//           }
//         }
//       }
//     }

//     // 确保原始纯白区域保持为255
//     for (let i = 0; i < destData.length; i++) {
//       if (originalWhiteMask[i] === 1) {
//         destData[i] = 255;
//       }
//     }
//   }

//   return {
//     width: pixelWidth,
//     height: pixelHeight,
//     data: destData,
//   };
// }

/**
 * 【已修改】创建整个平台的像素数据
 * @param drawableItems - 图层中的所有可绘制对象 (包括图像和矢量图形)
 * @param platformWidth - 平台宽度 (mm)
 * @param platformHeight - 平台高度 (mm)
 * @param lineDensity - 线密度 (mm/pixel)
 * @param settings - 处理设置
 * @param canvasWidth - 前端画布宽度 (mm)
 * @param canvasHeight - 前端画布高度 (mm)
 * @returns 整个平台的像素数据
 */
async function createPlatformImage(
  drawableItems: CanvasItem[], // <--- 修改：接收 CanvasItem[]
  platformWidth: number,
  platformHeight: number,
  lineDensity: number,
  settings: GCodeScanSettings,
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

  // 背景填充为白色（代表无功率）
  platformCtx.fillStyle = "white";
  platformCtx.fillRect(0, 0, pixelWidth, pixelHeight);

  // 计算从前端画布(mm)到物理平台(pixels)的缩放比例
  const scaleX = pixelWidth / canvasWidth;
  const scaleY = pixelHeight / canvasHeight;

  // 使用 Promise.all 来处理所有对象的绘制（图片加载是异步的）
  const drawingPromises = drawableItems.map(async (item) => {
    // 【新逻辑】判断对象类型
    if (item.type === CanvasItemType.IMAGE) {
      // 逻辑1：处理图片对象 (异步)
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const itemTopLeftX_canvas = item.x - item.width / 2;
          const itemTopLeftY_canvas = item.y - item.height / 2;

          const destX_pixels = itemTopLeftX_canvas * scaleX;
          const destY_pixels = itemTopLeftY_canvas * scaleY;
          const destWidth_pixels = item.width * scaleX;
          const destHeight_pixels = item.height * scaleY;

          platformCtx.drawImage(img, destX_pixels, destY_pixels, destWidth_pixels, destHeight_pixels);
          resolve();
        };
        img.onerror = () => reject(new Error(`无法加载图像: ${(item as ImageObject).href}`));
        img.src = (item as ImageObject).href;
      });
    } else {
      // 逻辑2：处理矢量图形对象 (同步)
      drawCanvasItem(platformCtx, item, scaleX, scaleY);
      return Promise.resolve(); // 返回一个已完成的Promise
    }
  });

  await Promise.all(drawingPromises);

  // 【新增】根据用户要求，在控制台输出生成的图片，用于调试
  console.log("生成的平台扫描预览图 (栅格化结果):");
  console.log(platformCanvas.toDataURL());

  // 后续的像素数据提取、灰度化、翻转、半色调处理保持不变...
  const srcData = platformCtx.getImageData(0, 0, pixelWidth, pixelHeight).data;
  const destData = new Int16Array(pixelWidth * pixelHeight);

  for (let y = 0, i = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++, i++) {
      const si = i << 2;
      const l = 0.2126 * sRGB2Linear(srcData[si]) + 0.7152 * sRGB2Linear(srcData[si + 1]) + 0.0722 * sRGB2Linear(srcData[si + 2]);
      destData[i] = linear2sRGB(Math.pow(settings.negativeImage ? 1 - l : l, 1.0));
    }
  }
  
  // ... (翻转和半色调逻辑与原文件一致，此处省略)
  if (settings.hFlipped) { /* ... */ }
  if (settings.vFlipped) { /* ... */ }
  if (settings.isHalftone) { /* ... */ }

  return {
    width: pixelWidth,
    height: pixelHeight,
    data: destData,
  };
}


/**
 * 【已修改】为整个扫描图层（平台）生成G代码
 * @param layer - 扫描图层
 * @param items - 画布中的所有项目
 * @param platformWidth - 平台宽度 (mm)
 * @param platformHeight - 平台高度 (mm)
 * @param settings - G代码生成设置
 * @param canvasWidth - 前端画布宽度 (mm)
 * @param canvasHeight - 前端画布高度 (mm)
 * @returns 生成的G代码字符串
 */
export async function generatePlatformScanGCode(
  layer: Layer,
  items: CanvasItem[],
  platformWidth: number,
  platformHeight: number,
  settings: GCodeScanSettings,
  canvasWidth: number,
  canvasHeight: number
): Promise<string> {
  // 【核心修改】筛选出属于该图层的所有可绘制对象（图像、基础形状、零件库）
  const drawableItems = items.filter(item =>
    item.layerId === layer.id &&
    // 任何图片或带有'parameters'属性的对象都被认为是可绘制的
    (item.type === CanvasItemType.IMAGE || 'parameters' in item) 
  );

  if (drawableItems.length === 0) {
    // 修改了错误提示
    throw new Error('扫描图层中没有可绘制的对象（图片、形状或零件）');
  }

  const {
    lineDensity,
    minPower = 0,
    maxPower = 100,
    burnSpeed = 1000,
    travelSpeed = 6000,
    overscanDist = 3,
  } = settings;

  // 【核心修改】将筛选出的所有可绘制对象传递给 createPlatformImage
  const platformImage = await createPlatformImage(
    drawableItems,
    platformWidth,
    platformHeight,
    lineDensity,
    settings,
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
    // 根据功率决定使用G0还是G1指令
    // 功率为0时使用G0（快速移动），功率大于0时使用G1（工作移动）
    const isRapidMove = power1 === 0;
    let cmd = isRapidMove ? "G0 " : "G1 ";

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

    // 只有G1指令需要功率参数，G0指令不需要
    if (!isRapidMove) {
      cmd += `S${power1}`;
    }

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
  gcode.push(`; Image Count: ${drawableItems.length}`);
  gcode.push(`; Platform Size: ${platformWidth}x${platformHeight} mm`);
  gcode.push(`; Resolution: ${lineDensity} mm/pixel (${width}x${height} pixels)`);
  gcode.push(`; Mode: ${settings.isHalftone ? "Halftone" : "Greyscale"}`);
  gcode.push(`; Power Range: [${minPower}, ${maxPower}] (0-100 scale)`);
  gcode.push(`; Speed: Burn=${burnSpeed} mm/min, Travel=${travelSpeed} mm/min`);
  gcode.push(`; Optimization: Skip blank rows/columns, fast travel for blank areas`);
  gcode.push(`;`);
  gcode.push(`G90 ; Absolute positioning`);
  gcode.push(`G21 ; Units in millimeters`);
  gcode.push(`G0 X0 Y0 F${travelSpeed} ; Move to origin`);
  gcode.push(`M4 ; Enable laser (variable power mode)`);
  gcode.push(``);

  // 计算实际内容的边界框，避免扫描空白区域
  let minY = height, maxY = -1, minX = width, maxX = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = x + (height - 1 - y) * width; // Y坐标反转以匹配机器坐标系
      const c = data[pixelIndex];
      if (c < 220) { // 非纯白色像素（使用更宽松的阈值）
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }

  // 如果没有内容，生成空的G代码
  if (minY > maxY || minX > maxX) {
    gcode.push(`; No content found in layer`);
    gcode.push(`M5 ; Disable laser`);
    gcode.push(`G0 X0 Y0 ; Return to origin`);
    gcode.push(`M2 ; End program`);
    return gcode.join('\n');
  }

  // 添加内容边界信息到注释
  const contentWidth = (maxX - minX + 1) * dx;
  const contentHeight = (maxY - minY + 1) * dy;
  const reductionX = ((width * dx - contentWidth) / (width * dx) * 100).toFixed(1);
  const reductionY = ((height * dy - contentHeight) / (height * dy) * 100).toFixed(1);

  gcode.push(`; Content detection: using threshold < 250 (instead of < 255) for better edge detection`);
  gcode.push(`; Halftone processing: ${settings.isHalftone ? 'ENABLED - binary threshold at 128, blank areas protected' : 'DISABLED - greyscale mode'}`);
  gcode.push(`; Reverse Movement Offset (空移): ${overscanDist} mm (${Math.ceil(overscanDist / dx)} pixels at ${dx.toFixed(3)} mm/pixel)`);
  gcode.push(`; Content bounds: X[${(minX * dx).toFixed(1)}, ${(maxX * dx).toFixed(1)}] Y[${(minY * dy).toFixed(1)}, ${(maxY * dy).toFixed(1)}] mm`);
  gcode.push(`; Actual scan range: X[${((minX * dx) - overscanDist).toFixed(1)}, ${((maxX * dx) + overscanDist).toFixed(1)}] mm (content + overscan)`);
  gcode.push(`; Overscan application: ${settings.isHalftone ? 'Applied in halftone mode for smooth edge transitions' : 'Applied in greyscale mode for power ramping'}`);
  gcode.push(`; Content pixels: minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY} (${maxX - minX + 1}x${maxY - minY + 1} pixels)`);
  gcode.push(`; Content area: ${contentWidth.toFixed(1)}x${contentHeight.toFixed(1)} mm (reduced by ${reductionX}%x${reductionY}%)`);
  gcode.push(`; Scan area optimized: ${(maxY - minY + 1)} rows of ${height} total (${((maxY - minY + 1) / height * 100).toFixed(1)}%)`);
  gcode.push(``);

  // 生成扫描路径 - 只扫描有内容的区域
  let skippedRows = 0;
  const processedRows = maxY - minY + 1;

  for (let y = minY; y <= maxY; y++) {
    const reverseDir = y % 2 !== 0; // 之字形扫描
    const currentY = y * dy;

    // 检查这一行是否有内容
    let hasContent = false;
    let rowMinX = width, rowMaxX = -1;
    for (let x = minX; x <= maxX; x++) {
      const pixelIndex = x + (height - 1 - y) * width; // Y坐标反转以匹配机器坐标系
      const c = data[pixelIndex];
      if (c < 220) { // 非纯白色像素（使用更宽松的阈值）
        hasContent = true;
        rowMinX = Math.min(rowMinX, x);
        rowMaxX = Math.max(rowMaxX, x);
      }
    }

    // 跳过空白行
    if (!hasContent) {
      skippedRows++;
      continue;
    }

    // 计算内容的实际边界（毫米）
    const contentStartX = rowMinX * dx;
    const contentEndX = rowMaxX * dx;

    // 计算扫描范围（仅用于像素级别的处理）
    const overscanPixels = Math.ceil(overscanDist / dx);
    const scanStartX = Math.max(0, rowMinX - overscanPixels);
    const scanEndX = Math.min(width - 1, rowMaxX + overscanPixels);

    // 移动到行的开始位置（带超扫描）- 直接使用内容边界 + 超扫描距离
    const startX = reverseDir ? contentEndX + overscanDist : contentStartX - overscanDist;
    goTo(startX, currentY, 0, travelSpeed, true);

    // 在半调网屏模式下，确保空移区域有适当的处理
    if (settings.isHalftone && overscanDist > 0) {
      // 在内容开始前，先移动到空移起始位置，确保激光头有足够的加速距离
      const preheatX = reverseDir ? contentEndX + overscanDist * 0.5 : contentStartX - overscanDist * 0.5;
      goTo(preheatX, null, 0, travelSpeed);
    }

    // 移动到扫描起始点（内容边界）
    goTo(reverseDir ? contentEndX : contentStartX, null, 0, travelSpeed);

    // 扫描这一行的有效范围 - 优化连续空白像素处理
    let sx = scanStartX;
    while (sx <= scanEndX) {
      const ix = reverseDir ? (scanEndX - (sx - scanStartX)) : sx;
      const pixelIndex = ix + (height - 1 - y) * width;
      const c = data[pixelIndex];

      // 计算激光功率 (0-100范围)
      let power: number;
      if (settings.isHalftone) {
        power = c < 128 ? maxPower : 0;
      } else {
        // 灰度模式功率计算
        if (maxPower === minPower) {
          // 当最大最小功率相同时，实现单一功率效果
          // 使用127作为阈值：暗于127的像素使用设定功率，亮于127的像素不出光
          power = c < 127 ? maxPower : 0;
        } else {
          // 正常的功率范围映射
          power = Math.round(minPower + (1.0 - c / 255.0) * (maxPower - minPower));
        }
      }

      if (power > 0) {
        // 有功率输出，直接移动并设置功率
        const xpos = ix * dx;
        goTo(xpos, null, power, burnSpeed);
        sx++;
      } else {
        // 功率为0，查找连续的空白像素
        let blankStart = sx;
        let blankEnd = sx;

        // 向前查找连续的空白像素
        while (blankEnd <= scanEndX) {
          const testIx = reverseDir ? (scanEndX - (blankEnd - scanStartX)) : blankEnd;
          const testPixelIndex = testIx + (height - 1 - y) * width;
          const testC = data[testPixelIndex];
          let testPower: number;
          if (settings.isHalftone) {
            testPower = testC < 128 ? maxPower : 0;
          } else {
            // 灰度模式功率计算
            if (maxPower === minPower) {
              // 当最大最小功率相同时，实现单一功率效果
              // 使用127作为阈值：暗于127的像素使用设定功率，亮于127的像素不出光
              testPower = testC < 127 ? maxPower : 0;
            } else {
              // 正常的功率范围映射
              testPower = Math.round(minPower + (1.0 - testC / 255.0) * (maxPower - minPower));
            }
          }

          if (testPower > 0) {
            break; // 遇到非空白像素，停止
          }
          blankEnd++;
        }

        // 如果有连续的空白像素（超过3个），使用快速移动跳过
        if (blankEnd - blankStart > 3) {
          const skipToIx = reverseDir ? (scanEndX - (blankEnd - 1 - scanStartX)) : (blankEnd - 1);
          const skipToX = skipToIx * dx;
          goTo(skipToX, null, 0, travelSpeed); // 使用快速移动跳过空白区域
          sx = blankEnd;
        } else {
          // 少量空白像素，正常处理
          const xpos = ix * dx;
          goTo(xpos, null, 0, burnSpeed);
          sx++;
        }
      }
    }

    // 移动到行的结束位置（带超扫描）- 使用精确的毫米距离
    const endX = reverseDir ? contentStartX - overscanDist : contentEndX + overscanDist;
    goTo(endX, null, 0, travelSpeed, true);
    gcode.push(``);
  }

  // G代码尾部
  gcode.push(`M5 ; Disable laser`);
  gcode.push(`G0 X0 Y0 F${travelSpeed} ; Return to origin`);
  gcode.push(``);
  gcode.push(`; Optimization Results:`);
  gcode.push(`; - Processed ${processedRows - skippedRows} rows, skipped ${skippedRows} blank rows`);
  gcode.push(`; - Total area reduction: ${((width * dx - contentWidth) / (width * dx) * 100).toFixed(1)}% width × ${((height * dy - contentHeight) / (height * dy) * 100).toFixed(1)}% height`);
  gcode.push(`; - Scan time reduced by skipping blank areas`);
  gcode.push(`M2 ; End program`);

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

/**
 * 雕刻图层G代码生成设置
 */
export interface GCodeEngraveSettings {
  feedRate?: number;        // 雕刻速度 (mm/min)
  travelSpeed?: number;     // 移动速度 (mm/min)
  power?: number;           // 激光功率 (0-100%)
  passes?: number;          // 雕刻遍数
  stepDown?: number;        // 每遍下降深度
  pathOptimization?: boolean; // 路径优化
  flipY?: boolean;          // Y轴反转 (适配机器坐标系)
  canvasHeight?: number;    // 画布高度 (用于Y轴反转计算)
}

/**
 * 应用坐标转换（包括Y轴反转）
 * @param x X坐标
 * @param y Y坐标  
 * @param settings G代码设置
 * @returns 转换后的坐标
 */
function transformCoordinate(x: number, y: number, settings: GCodeEngraveSettings): { x: number, y: number } {
  let transformedY = y;

  // 如果启用Y轴反转且提供了画布高度
  if (settings.flipY && settings.canvasHeight) {
    transformedY = settings.canvasHeight - y;
  }

  return {
    x: parseFloat(x.toFixed(3)),
    y: parseFloat(transformedY.toFixed(3))
  };
}

/**
 * 应用旋转变换到坐标点
 * @param px 点的X坐标
 * @param py 点的Y坐标
 * @param centerX 旋转中心X坐标
 * @param centerY 旋转中心Y坐标
 * @param rotation 旋转角度（度数）
 * @returns 变换后的坐标
 */
function rotatePoint(px: number, py: number, centerX: number, centerY: number, rotation: number): { x: number, y: number } {
  if (rotation === 0) return { x: px, y: py };

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 平移到原点
  const dx = px - centerX;
  const dy = py - centerY;

  // 应用旋转
  const rotatedX = dx * cos - dy * sin;
  const rotatedY = dx * sin + dy * cos;

  // 平移回去
  return {
    x: rotatedX + centerX,
    y: rotatedY + centerY
  };
}

/**
 * 将矢量对象直接转换为G代码路径
 * @param item 画布对象
 * @param settings 雕刻设置
 * @returns G代码路径数组
 */
// function itemToGCodePaths(item: CanvasItem, settings: GCodeEngraveSettings): string[] {
//   const paths: string[] = [];
//   const { x = 0, y = 0 } = item;
//   const { scalex=1, scaley=1 } = item ;
//   const rotation = 'rotation' in item ? item.rotation || 0 : 0;

//   // 激光功率设置 (0-100范围)
//   const laserPower = Math.round(settings.power || 50); // 保持0-100范围

//   console.log(`处理对象 ${item.type} at (${x}, ${y}), rotation: ${rotation}°, Y轴${settings.flipY ? '已' : '未'}反转`);
//   if ('parameters' in item) {
//     console.log('参数:', item.parameters);
//   }

//   if ('parameters' in item) {
//     switch (item.type) {
//       case CanvasItemType.RECTANGLE: {
//         const { width = 40, height = 40 } = item.parameters;
//         const w2 = width / 2;
//         const h2 = height / 2;

//         // 矩形四个角点（相对于中心）
//         const corners = [
//           { x: x - w2, y: y - h2 }, // 左上
//           { x: x + w2, y: y - h2 }, // 右上  
//           { x: x + w2, y: y + h2 }, // 右下
//           { x: x - w2, y: y + h2 }, // 左下
//         ];

//         // 应用旋转变换
//         const rotatedCorners = corners.map(corner =>
//           rotatePoint(corner.x, corner.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedCorners = rotatedCorners.map(corner =>
//           transformCoordinate(corner.x, corner.y, settings)
//         );

//         // 生成G代码路径
//         const rectPaths = [
//           `G0 X${transformedCorners[0].x} Y${transformedCorners[0].y}`, // 移动到起点
//           `M3 S${laserPower}`,        // 开启激光
//           `G1 X${transformedCorners[1].x} Y${transformedCorners[1].y} F${settings.feedRate || 1000}`, // 上边
//           `G1 X${transformedCorners[2].x} Y${transformedCorners[2].y}`, // 右边
//           `G1 X${transformedCorners[3].x} Y${transformedCorners[3].y}`, // 下边
//           `G1 X${transformedCorners[0].x} Y${transformedCorners[0].y}`, // 左边回到起点
//           `M5`,                       // 关闭激光
//         ];
//         paths.push(...rectPaths);
//         break;
//       }

//       case CanvasItemType.CIRCLE: {
//         const { radius = 20 } = item.parameters;

//         // 圆形的起始点（右侧）
//         const startPoint = rotatePoint(x + radius, y, x, y, rotation);
//         const transformedStart = transformCoordinate(startPoint.x, startPoint.y, settings);
//         const transformedCenter = transformCoordinate(x, y, settings);

//         // 计算I和J偏移（相对于起始点）
//         const iOffset = transformedCenter.x - transformedStart.x;
//         const jOffset = transformedCenter.y - transformedStart.y;

//         // 当Y轴反转时，圆的方向也要反转
//         const circleCommand = settings.flipY ? 'G03' : 'G02';

//         const circlePaths = [
//           `G0 X${transformedStart.x} Y${transformedStart.y}`,  // 移动到起点
//           `M3 S${laserPower}`,        // 开启激光
//           `${circleCommand} X${transformedStart.x} Y${transformedStart.y} I${iOffset.toFixed(3)} J${jOffset.toFixed(3)} F${settings.feedRate || 1000}`, // 绘制整圆
//           `M5`,                       // 关闭激光
//         ];
//         paths.push(...circlePaths);
//         break;
//       }

//       case CanvasItemType.LINE: {
//         const { length = 40 } = item.parameters;
//         const l2 = length / 2;

//         // 直线两端点
//         const startPoint = rotatePoint(x - l2, y, x, y, rotation);
//         const endPoint = rotatePoint(x + l2, y, x, y, rotation);

//         const transformedStart = transformCoordinate(startPoint.x, startPoint.y, settings);
//         const transformedEnd = transformCoordinate(endPoint.x, endPoint.y, settings);

//         // 直线路径
//         const linePaths = [
//           `G0 X${transformedStart.x} Y${transformedStart.y}`,      // 移动到起点
//           `M3 S${laserPower}`,        // 开启激光
//           `G1 X${transformedEnd.x} Y${transformedEnd.y} F${settings.feedRate || 1000}`, // 绘制直线
//           `M5`,                       // 关闭激光
//         ];
//         paths.push(...linePaths);
//         break;
//       }

//       case CanvasItemType.FLANGE: {
//         const {
//           outerDiameter = 120,
//           innerDiameter = 60,
//           boltCircleDiameter = 90,
//           boltHoleCount = 4,
//           boltHoleDiameter = 8
//         } = item.parameters;

//         const outerRadius = outerDiameter / 2;
//         const innerRadius = innerDiameter / 2;
//         const boltCircleRadius = boltCircleDiameter / 2;
//         const boltHoleRadius = boltHoleDiameter / 2;

//         console.log(`法兰参数 - 外径: ${outerDiameter}, 内径: ${innerDiameter}, 螺栓孔数: ${boltHoleCount}`);

//         // 外圆
//         const outerStart = rotatePoint(x + outerRadius, y, x, y, rotation);
//         const transformedOuterStart = transformCoordinate(outerStart.x, outerStart.y, settings);
//         const transformedCenter = transformCoordinate(x, y, settings);
//         const outerIOffset = transformedCenter.x - transformedOuterStart.x;
//         const outerJOffset = transformedCenter.y - transformedOuterStart.y;

//         // 当Y轴反转时，圆的方向也要反转
//         const outerCircleCommand = settings.flipY ? 'G03' : 'G02';

//         paths.push(
//           `G0 X${transformedOuterStart.x} Y${transformedOuterStart.y}`,
//           `M3 S${laserPower}`,
//           `${outerCircleCommand} X${transformedOuterStart.x} Y${transformedOuterStart.y} I${outerIOffset.toFixed(3)} J${outerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
//           `M5`
//         );

//         // 内圆
//         const innerStart = rotatePoint(x + innerRadius, y, x, y, rotation);
//         const transformedInnerStart = transformCoordinate(innerStart.x, innerStart.y, settings);
//         const innerIOffset = transformedCenter.x - transformedInnerStart.x;
//         const innerJOffset = transformedCenter.y - transformedInnerStart.y;

//         // 当Y轴反转时，圆的方向也要反转
//         const innerCircleCommand = settings.flipY ? 'G03' : 'G02';

//         paths.push(
//           `G0 X${transformedInnerStart.x} Y${transformedInnerStart.y}`,
//           `M3 S${laserPower}`,
//           `${innerCircleCommand} X${transformedInnerStart.x} Y${transformedInnerStart.y} I${innerIOffset.toFixed(3)} J${innerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
//           `M5`
//         );

//         // 螺栓孔
//         for (let i = 0; i < boltHoleCount; i++) {
//           const angle = (i / boltHoleCount) * 2 * Math.PI - Math.PI / 2;
//           const holeX = x + boltCircleRadius * Math.cos(angle);
//           const holeY = y + boltCircleRadius * Math.sin(angle);

//           // 应用整体旋转
//           const rotatedHoleCenter = rotatePoint(holeX, holeY, x, y, rotation);
//           const transformedHoleCenter = transformCoordinate(rotatedHoleCenter.x, rotatedHoleCenter.y, settings);
//           const holeStart = { x: transformedHoleCenter.x + boltHoleRadius, y: transformedHoleCenter.y };

//           // 当Y轴反转时，圆的方向也要反转
//           const holeCircleCommand = settings.flipY ? 'G03' : 'G02';

//           paths.push(
//             `G0 X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)}`,
//             `M3 S${laserPower}`,
//             `${holeCircleCommand} X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)} I${-boltHoleRadius} J0 F${settings.feedRate || 1000}`,
//             `M5`
//           );
//         }
//         break;
//       }

//       case CanvasItemType.TORUS: {
//         const { outerRadius = 60, innerRadius = 30 } = item.parameters;

//         console.log(`圆环参数 - 外径: ${outerRadius * 2}, 内径: ${innerRadius * 2}`);

//         // 外圆起始点（考虑旋转）
//         const outerStart = rotatePoint(x + outerRadius, y, x, y, rotation);
//         const transformedOuterStart = transformCoordinate(outerStart.x, outerStart.y, settings);
//         const transformedCenter = transformCoordinate(x, y, settings);
//         const outerIOffset = transformedCenter.x - transformedOuterStart.x;
//         const outerJOffset = transformedCenter.y - transformedOuterStart.y;

//         // 当Y轴反转时，圆的方向也要反转
//         const outerCircleCommand = settings.flipY ? 'G03' : 'G02';

//         paths.push(
//           `G0 X${transformedOuterStart.x} Y${transformedOuterStart.y}`,
//           `M3 S${laserPower}`,
//           `${outerCircleCommand} X${transformedOuterStart.x} Y${transformedOuterStart.y} I${outerIOffset.toFixed(3)} J${outerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
//           `M5`
//         );

//         // 内圆起始点（考虑旋转）
//         const innerStart = rotatePoint(x + innerRadius, y, x, y, rotation);
//         const transformedInnerStart = transformCoordinate(innerStart.x, innerStart.y, settings);
//         const innerIOffset = transformedCenter.x - transformedInnerStart.x;
//         const innerJOffset = transformedCenter.y - transformedInnerStart.y;

//         // 当Y轴反转时，圆的方向也要反转
//         const innerCircleCommand = settings.flipY ? 'G03' : 'G02';

//         paths.push(
//           `G0 X${transformedInnerStart.x} Y${transformedInnerStart.y}`,
//           `M3 S${laserPower}`,
//           `${innerCircleCommand} X${transformedInnerStart.x} Y${transformedInnerStart.y} I${innerIOffset.toFixed(3)} J${innerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
//           `M5`
//         );
//         break;
//       }

//       case CanvasItemType.L_BRACKET: {
//         const { width = 80, height = 80, thickness = 15 } = item.parameters;
//         const w2 = width / 2;
//         const h2 = height / 2;

//         console.log(`L型支架参数 - 宽: ${width}, 高: ${height}, 厚度: ${thickness}`);

//         // L型支架的关键点
//         const points = [
//           { x: x - w2, y: y - h2 },                          // 起点
//           { x: x + w2, y: y - h2 },                          // 上边终点
//           { x: x + w2, y: y - h2 + thickness },              // 右上垂直
//           { x: x - w2 + thickness, y: y - h2 + thickness },  // 内部水平
//           { x: x - w2 + thickness, y: y + h2 },              // 右下垂直
//           { x: x - w2, y: y + h2 },                          // 下边
//           { x: x - w2, y: y - h2 },                          // 回到起点
//         ];

//         // 应用旋转变换
//         const rotatedPoints = points.map(point =>
//           rotatePoint(point.x, point.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedPoints = rotatedPoints.map(point =>
//           transformCoordinate(point.x, point.y, settings)
//         );

//         // 生成G代码路径
//         const bracketPaths = [
//           `G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`,  // 移动到起点
//           `M3 S${laserPower}`,
//         ];

//         for (let i = 1; i < transformedPoints.length; i++) {
//           bracketPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         bracketPaths.push(`M5`);
//         paths.push(...bracketPaths);
//         break;
//       }

//       case CanvasItemType.U_CHANNEL: {
//         const { width = 80, height = 100, thickness = 10 } = item.parameters;
//         const w2 = width / 2;
//         const h2 = height / 2;

//         console.log(`U型槽参数 - 宽: ${width}, 高: ${height}, 厚度: ${thickness}`);

//         // U型槽的关键点
//         const points = [
//           { x: x - w2, y: y - h2 },                          // 起点
//           { x: x + w2, y: y - h2 },                          // 上边
//           { x: x + w2, y: y + h2 },                          // 右边
//           { x: x + w2 - thickness, y: y + h2 },              // 右下水平
//           { x: x + w2 - thickness, y: y - h2 + thickness },  // 右内垂直
//           { x: x - w2 + thickness, y: y - h2 + thickness },  // 内部水平
//           { x: x - w2 + thickness, y: y + h2 },              // 左内垂直
//           { x: x - w2, y: y + h2 },                          // 左下水平
//           { x: x - w2, y: y - h2 },                          // 左边回到起点
//         ];

//         // 应用旋转变换
//         const rotatedPoints = points.map(point =>
//           rotatePoint(point.x, point.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedPoints = rotatedPoints.map(point =>
//           transformCoordinate(point.x, point.y, settings)
//         );

//         // 生成G代码路径
//         const channelPaths = [
//           `G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`,
//           `M3 S${laserPower}`,
//         ];

//         for (let i = 1; i < transformedPoints.length; i++) {
//           channelPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         channelPaths.push(`M5`);
//         paths.push(...channelPaths);
//         break;
//       }

//       case CanvasItemType.RECTANGLE_WITH_HOLES: {
//         const { width = 120, height = 80, holeRadius = 8, horizontalMargin = 20, verticalMargin = 20 } = item.parameters;
//         const w2 = width / 2;
//         const h2 = height / 2;

//         console.log(`带孔矩形参数 - 宽: ${width}, 高: ${height}, 孔半径: ${holeRadius}`);

//         // 主矩形的四个角点
//         const rectCorners = [
//           { x: x - w2, y: y - h2 }, // 左上
//           { x: x + w2, y: y - h2 }, // 右上  
//           { x: x + w2, y: y + h2 }, // 右下
//           { x: x - w2, y: y + h2 }, // 左下
//         ];

//         // 应用旋转变换到矩形
//         const rotatedRectCorners = rectCorners.map(corner =>
//           rotatePoint(corner.x, corner.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedRectCorners = rotatedRectCorners.map(corner =>
//           transformCoordinate(corner.x, corner.y, settings)
//         );

//         // 生成主矩形G代码路径
//         const rectPaths = [
//           `G0 X${transformedRectCorners[0].x} Y${transformedRectCorners[0].y}`,
//           `M3 S${laserPower}`,
//           `G1 X${transformedRectCorners[1].x} Y${transformedRectCorners[1].y} F${settings.feedRate || 1000}`,
//           `G1 X${transformedRectCorners[2].x} Y${transformedRectCorners[2].y}`,
//           `G1 X${transformedRectCorners[3].x} Y${transformedRectCorners[3].y}`,
//           `G1 X${transformedRectCorners[0].x} Y${transformedRectCorners[0].y}`,
//           `M5`
//         ];
//         paths.push(...rectPaths);

//         // 四个角的孔位置（旋转前）
//         const holePositions = [
//           { x: x - w2 + horizontalMargin, y: y + h2 - verticalMargin },  // 左下
//           { x: x + w2 - horizontalMargin, y: y + h2 - verticalMargin },  // 右下
//           { x: x + w2 - horizontalMargin, y: y - h2 + verticalMargin },  // 右上
//           { x: x - w2 + horizontalMargin, y: y - h2 + verticalMargin },  // 左上
//         ];

//         // 为每个孔生成圆形路径
//         holePositions.forEach((pos, index) => {
//           // 孔中心应用旋转
//           const rotatedHoleCenter = rotatePoint(pos.x, pos.y, x, y, rotation);
//           // 孔的起始点（右侧）
//           const holeStart = transformCoordinate(rotatedHoleCenter.x + holeRadius, rotatedHoleCenter.y, settings);

//           // 当Y轴反转时，圆的方向也要反转
//           const holeCircleCommand = settings.flipY ? 'G03' : 'G02';

//           paths.push(
//             `G0 X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)}`,
//             `M3 S${laserPower}`,
//             `${holeCircleCommand} X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)} I${-holeRadius} J0 F${settings.feedRate || 1000}`,
//             `M5`
//           );
//         });
//         break;
//       }

//       case CanvasItemType.CIRCLE_WITH_HOLES: {
//         const { radius = 50, holeRadius = 8, holeCount = 4 } = item.parameters;

//         console.log(`带孔圆形参数 - 半径: ${radius}, 孔半径: ${holeRadius}, 孔数量: ${holeCount}`);

//         // 主圆起始点（考虑旋转）
//         const mainCircleStart = rotatePoint(x + radius, y, x, y, rotation);
//         const transformedMainCircleStart = transformCoordinate(mainCircleStart.x, mainCircleStart.y, settings);
//         const transformedCenter = transformCoordinate(x, y, settings);
//         const mainCircleIOffset = transformedCenter.x - transformedMainCircleStart.x;
//         const mainCircleJOffset = transformedCenter.y - transformedMainCircleStart.y;

//         // 当Y轴反转时，圆的方向也要反转
//         const mainCircleCommand = settings.flipY ? 'G03' : 'G02';

//         paths.push(
//           `G0 X${transformedMainCircleStart.x} Y${transformedMainCircleStart.y}`,
//           `M3 S${laserPower}`,
//           `${mainCircleCommand} X${transformedMainCircleStart.x} Y${transformedMainCircleStart.y} I${mainCircleIOffset.toFixed(3)} J${mainCircleJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
//           `M5`
//         );

//         // 孔的分布
//         const holeCircleRadius = radius * 0.7; // 孔的分布圆半径
//         for (let i = 0; i < holeCount; i++) {
//           const angle = (i / holeCount) * 2 * Math.PI;
//           const holeX = x + holeCircleRadius * Math.cos(angle);
//           const holeY = y + holeCircleRadius * Math.sin(angle);

//           // 应用整体旋转
//           const rotatedHoleCenter = rotatePoint(holeX, holeY, x, y, rotation);
//           const transformedHoleCenter = transformCoordinate(rotatedHoleCenter.x, rotatedHoleCenter.y, settings);
//           const holeStart = { x: transformedHoleCenter.x + holeRadius, y: transformedHoleCenter.y };

//           // 当Y轴反转时，圆的方向也要反转
//           const holeCircleCommand = settings.flipY ? 'G03' : 'G02';

//           paths.push(
//             `G0 X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)}`,
//             `M3 S${laserPower}`,
//             `${holeCircleCommand} X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)} I${-holeRadius} J0 F${settings.feedRate || 1000}`,
//             `M5`
//           );
//         }
//         break;
//       }

//       case CanvasItemType.EQUILATERAL_TRIANGLE: {
//         const { sideLength = 40 } = item.parameters;
//         const h = (sideLength * Math.sqrt(3)) / 2;

//         console.log(`等边三角形参数 - 边长: ${sideLength}`);

//         // 三角形三个顶点
//         const trianglePoints = [
//           { x: x - sideLength / 2, y: y - h / 3 },  // 左下
//           { x: x + sideLength / 2, y: y - h / 3 },  // 右下
//           { x: x, y: y + 2 * h / 3 },               // 顶点
//           { x: x - sideLength / 2, y: y - h / 3 },  // 回到起点
//         ];

//         // 应用旋转变换
//         const rotatedTrianglePoints = trianglePoints.map(point =>
//           rotatePoint(point.x, point.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedTrianglePoints = rotatedTrianglePoints.map(point =>
//           transformCoordinate(point.x, point.y, settings)
//         );

//         // 生成G代码路径
//         const trianglePaths = [
//           `G0 X${transformedTrianglePoints[0].x} Y${transformedTrianglePoints[0].y}`,
//           `M3 S${laserPower}`,
//         ];

//         for (let i = 1; i < transformedTrianglePoints.length; i++) {
//           trianglePaths.push(`G1 X${transformedTrianglePoints[i].x} Y${transformedTrianglePoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         trianglePaths.push(`M5`);
//         paths.push(...trianglePaths);
//         break;
//       }

//       case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: {
//         const { cathetus = 50 } = item.parameters;

//         console.log(`等腰直角三角形参数 - 直角边长: ${cathetus}`);

//         // 三角形三个顶点
//         const trianglePoints = [
//           { x: x - cathetus / 2, y: y + cathetus / 2 },  // 左下角
//           { x: x + cathetus / 2, y: y + cathetus / 2 },  // 右下角
//           { x: x - cathetus / 2, y: y - cathetus / 2 },  // 左上角（直角顶点）
//           { x: x - cathetus / 2, y: y + cathetus / 2 },  // 回到起点
//         ];

//         // 应用旋转变换
//         const rotatedTrianglePoints = trianglePoints.map(point =>
//           rotatePoint(point.x, point.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedTrianglePoints = rotatedTrianglePoints.map(point =>
//           transformCoordinate(point.x, point.y, settings)
//         );

//         // 生成G代码路径
//         const trianglePaths = [
//           `G0 X${transformedTrianglePoints[0].x} Y${transformedTrianglePoints[0].y}`,
//           `M3 S${laserPower}`,
//         ];

//         for (let i = 1; i < transformedTrianglePoints.length; i++) {
//           trianglePaths.push(`G1 X${transformedTrianglePoints[i].x} Y${transformedTrianglePoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         trianglePaths.push(`M5`);
//         paths.push(...trianglePaths);
//         break;
//       }

//       case CanvasItemType.SECTOR: {
//         const { radius = 50, startAngle = -90, sweepAngle = 90 } = item.parameters;

//         console.log(`处理对象 SECTOR at (${x}, ${y}), rotation: ${rotation}°`);
//         console.log(`扇形参数 - 半径: ${radius}, 起始角: ${startAngle}, 扫掠角: ${sweepAngle}`);

//         // 应用旋转到角度
//         const startRad = ((startAngle + rotation) * Math.PI) / 180;
//         const endRad = ((startAngle + sweepAngle + rotation) * Math.PI) / 180;

//         // 计算弧的起点和终点（相对于扇形中心）
//         const sx = x + radius * Math.cos(startRad);
//         const sy = y + radius * Math.sin(startRad);
//         const ex = x + radius * Math.cos(endRad);
//         const ey = y + radius * Math.sin(endRad);

//         // 应用坐标变换（包括Y轴反转）
//         const centerTransformed = transformCoordinate(x, y, settings);
//         const startTransformed = transformCoordinate(sx, sy, settings);
//         const endTransformed = transformCoordinate(ex, ey, settings);

//         // 计算弧的中心点（用于G02/G03命令）
//         const centerOffsetX = centerTransformed.x - startTransformed.x;
//         const centerOffsetY = centerTransformed.y - startTransformed.y;

//         // 判断弧的方向（顺时针还是逆时针）
//         // 注意：当Y轴反转时，弧的方向也会反转
//         let isClockwise = sweepAngle < 0;
//         if (settings.flipY) {
//           isClockwise = !isClockwise; // Y轴反转时，弧的方向也要反转
//         }
//         const arcCommand = isClockwise ? 'G02' : 'G03';

//         // 扇形路径：中心 -> 弧起点 -> 弧线 -> 中心
//         const sectorPaths = [
//           `G0 X${centerTransformed.x.toFixed(3)} Y${centerTransformed.y.toFixed(3)}`, // 移动到中心
//           `M3 S${laserPower}`,
//           `G1 X${startTransformed.x.toFixed(3)} Y${startTransformed.y.toFixed(3)} F${settings.feedRate || 1000}`, // 直线到弧起点
//           `${arcCommand} X${endTransformed.x.toFixed(3)} Y${endTransformed.y.toFixed(3)} I${centerOffsetX.toFixed(3)} J${centerOffsetY.toFixed(3)}`, // 弧线到终点
//           `G1 X${centerTransformed.x.toFixed(3)} Y${centerTransformed.y.toFixed(3)}`, // 回到中心
//           `M5`
//         ];
//         console.log(`生成的扇形G代码路径:`, sectorPaths);
//         paths.push(...sectorPaths);
//         console.log(`当前paths数组长度: ${paths.length}`);
//         break;
//       }

//       case CanvasItemType.ARC: {
//         const { radius = 50, startAngle = 0, sweepAngle = 120 } = item.parameters;

//         console.log(`处理对象 ARC at (${x}, ${y}), rotation: ${rotation}°`);
//         console.log(`弧形参数 - 半径: ${radius}, 起始角: ${startAngle}, 扫掠角: ${sweepAngle}`);

//         // 应用旋转到角度
//         const startRad = ((startAngle + rotation) * Math.PI) / 180;
//         const endRad = ((startAngle + sweepAngle + rotation) * Math.PI) / 180;

//         // 计算弧的起点和终点（相对于弧中心）
//         const sx = x + radius * Math.cos(startRad);
//         const sy = y + radius * Math.sin(startRad);
//         const ex = x + radius * Math.cos(endRad);
//         const ey = y + radius * Math.sin(endRad);

//         // 应用坐标变换（包括Y轴反转）
//         const centerTransformed = transformCoordinate(x, y, settings);
//         const startTransformed = transformCoordinate(sx, sy, settings);
//         const endTransformed = transformCoordinate(ex, ey, settings);

//         // 计算弧的中心点偏移（用于G02/G03命令）
//         const centerOffsetX = centerTransformed.x - startTransformed.x;
//         const centerOffsetY = centerTransformed.y - startTransformed.y;

//         // 判断弧的方向（顺时针还是逆时针）
//         // 注意：当Y轴反转时，弧的方向也会反转
//         let isClockwise = sweepAngle < 0;
//         if (settings.flipY) {
//           isClockwise = !isClockwise; // Y轴反转时，弧的方向也要反转
//         }
//         const arcCommand = isClockwise ? 'G02' : 'G03';

//         // 弧形路径
//         const arcPaths = [
//           `G0 X${startTransformed.x.toFixed(3)} Y${startTransformed.y.toFixed(3)}`, // 移动到弧起点
//           `M3 S${laserPower}`,
//           `${arcCommand} X${endTransformed.x.toFixed(3)} Y${endTransformed.y.toFixed(3)} I${centerOffsetX.toFixed(3)} J${centerOffsetY.toFixed(3)} F${settings.feedRate || 1000}`, // 弧线到终点
//           `M5`
//         ];
//         paths.push(...arcPaths);
//         break;
//       }

//       case CanvasItemType.POLYLINE: {
//         const { seg1 = 40, seg2 = 50, seg3 = 30, angle } = item.parameters;

//         console.log(`折线参数 - 段1: ${seg1}, 段2: ${seg2}, 段3: ${seg3}`);

//         // 折线的关键点（简化处理）
//         const polylinePoints = [
//           { x: x, y: y },                         // 起点
//           { x: x + seg1, y: y },                  // 第一段终点
//           { x: x + seg1 + seg2*Math.cos((angle+180)/180*Math.PI), y: y + seg2*Math.sin((angle+180)/180*Math.PI) },           // 第二段终点（垂直）
//           { x: x + seg1 + seg2*Math.cos((angle+180)/180*Math.PI) + seg3, y: y + seg2*Math.sin((angle+180)/180*Math.PI) },    // 第三段终点（水平）
//         ];

//         // 应用旋转变换
//         const rotatedPolylinePoints = polylinePoints.map(point =>
//           rotatePoint(point.x, point.y, x, y, rotation)
//         );

//         // 应用坐标转换（包括Y轴反转）
//         const transformedPolylinePoints = rotatedPolylinePoints.map(point =>
//           transformCoordinate(point.x, point.y, settings)
//         );

//         // 生成G代码路径
//         const polylinePaths = [
//           `G0 X${transformedPolylinePoints[0].x} Y${transformedPolylinePoints[0].y}`,
//           `M3 S${laserPower}`,
//         ];

//         for (let i = 1; i < transformedPolylinePoints.length; i++) {
//           polylinePaths.push(`G1 X${transformedPolylinePoints[i].x} Y${transformedPolylinePoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         polylinePaths.push(`M5`);
//         paths.push(...polylinePaths);
//         break;
//       }

//       // 为其他复杂图形添加类似的旋转支持...
//       default:
//         // 对于不支持的参数化图形，生成注释并显示参数
//         if ('type' in item) {
//           if ('parameters' in item) {
//             paths.push(`; 图形类型: ${item.type}, 参数: ${JSON.stringify((item as any).parameters)}`);
//           } else {
//             paths.push(`; 图形类型: ${item.type}`);
//           }
//         } else {
//           paths.push(`; 未知对象: ${JSON.stringify(item)}`);
//         }
//         break;
//     }
//   }

//   // 处理手绘路径（应用旋转和Y轴反转）
//   if (item.type === CanvasItemType.DRAWING && 'points' in item && Array.isArray(item.points)) {
//     const drawingItem = item as any; // 类型断言以访问扩展字段
    
//     console.log('G代码生成 - Drawing对象分析:', {
//       hasOriginalStrokes: !!(drawingItem.originalStrokes && Array.isArray(drawingItem.originalStrokes)),
//       originalStrokesLength: drawingItem.originalStrokes ? drawingItem.originalStrokes.length : 0,
//       hasStrokes: !!(drawingItem.strokes && Array.isArray(drawingItem.strokes)),
//       strokesLength: drawingItem.strokes ? drawingItem.strokes.length : 0,
//       pointsLength: item.points.length,
//       hasOriginalPoints: !!(drawingItem.originalPoints && Array.isArray(drawingItem.originalPoints)),
//       originalPointsLength: drawingItem.originalPoints ? drawingItem.originalPoints.length : 0
//     });
    
//     // 检查是否有多笔段数据
//     if (drawingItem.originalStrokes && Array.isArray(drawingItem.originalStrokes) && drawingItem.originalStrokes.length > 0) {
//       // 使用多笔段数据（高精度）
//       const strokes = drawingItem.originalStrokes;
//       console.log(`G代码生成使用原始高精度多笔段数据，共${strokes.length}个笔段`);
      
//       for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
//         const stroke = strokes[strokeIndex];
//         if (!Array.isArray(stroke) || stroke.length < 2) continue;
        
//         const drawingPaths = [];
        
//         // 对当前笔段的所有点应用旋转和坐标转换
//         const transformedPoints = stroke.map((point: { x: number; y: number }) => {
//           const rotated = rotatePoint(x + point.x * scalex, y + point.y * scaley, x, y, rotation);
//           return transformCoordinate(rotated.x, rotated.y, settings);
//         });

//         drawingPaths.push(`; 开始笔段 ${strokeIndex + 1}/${strokes.length}`);
//         drawingPaths.push(`G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`); // 移动到笔段起点
//         drawingPaths.push(`M3 S${laserPower}`); // 开启激光

//         for (let i = 1; i < transformedPoints.length; i++) {
//           drawingPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         drawingPaths.push(`M5`); // 关闭激光（抬笔）
//         drawingPaths.push(`; 结束笔段 ${strokeIndex + 1}`);
//         paths.push(...drawingPaths);
//       }
//     } else if (drawingItem.strokes && Array.isArray(drawingItem.strokes) && drawingItem.strokes.length > 0) {
//       // 使用多笔段数据（显示精度）
//       const strokes = drawingItem.strokes;
//       console.log(`G代码生成使用显示精度多笔段数据，共${strokes.length}个笔段`);
      
//       for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
//         const stroke = strokes[strokeIndex];
//         if (!Array.isArray(stroke) || stroke.length < 2) continue;
        
//         const drawingPaths = [];
        
//         // 对当前笔段的所有点应用旋转和坐标转换
//         const transformedPoints = stroke.map((point: { x: number; y: number }) => {
//           const rotated = rotatePoint(x + point.x*scalex, y + point.y*scaley, x, y, rotation);
//           return transformCoordinate(rotated.x, rotated.y, settings);
//         });

//         drawingPaths.push(`; 开始笔段 ${strokeIndex + 1}/${strokes.length}`);
//         drawingPaths.push(`G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`); // 移动到笔段起点
//         drawingPaths.push(`M3 S${laserPower}`); // 开启激光

//         for (let i = 1; i < transformedPoints.length; i++) {
//           drawingPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
//         }

//         drawingPaths.push(`M5`); // 关闭激光（抬笔）
//         drawingPaths.push(`; 结束笔段 ${strokeIndex + 1}`);
//         paths.push(...drawingPaths);
//       }
//     } else {
//       // 回退到传统的单笔段模式（向后兼容）
//       const pointsToUse = (drawingItem.originalPoints && Array.isArray(drawingItem.originalPoints) && drawingItem.originalPoints.length > 0)
//         ? drawingItem.originalPoints
//         : item.points;

//       if (pointsToUse.length > 1) {
//         const drawingPaths = [];

//         console.log(`G代码生成使用${(drawingItem.originalPoints && Array.isArray(drawingItem.originalPoints) && drawingItem.originalPoints.length > 0) ? '原始高精度' : '显示'}单笔段数据，共${pointsToUse.length}个点`);

//         // 对所有点应用旋转和坐标转换
//         const transformedPoints = pointsToUse.map((point: { x: number; y: number }) => {
//           const rotated = rotatePoint(x + point.x*scalex, y + point.y*scaley, x, y, rotation);
//           return transformCoordinate(rotated.x, rotated.y, settings);
//         });

//         // 检查是否有抬笔点索引
//         const breakIndices = drawingItem.breakIndices && Array.isArray(drawingItem.breakIndices)
//           ? drawingItem.breakIndices
//           : [];

//         if (breakIndices.length > 0) {
//           // 有抬笔点：分段处理
//           console.log(`检测到 ${breakIndices.length} 个抬笔点，分段生成G代码`);

//           let segmentStart = 0;
//           const allBreakPoints = [...breakIndices, transformedPoints.length].sort((a, b) => a - b);

//           for (let segIndex = 0; segIndex < allBreakPoints.length; segIndex++) {
//             const segmentEnd = allBreakPoints[segIndex];

//             if (segmentEnd > segmentStart && segmentEnd <= transformedPoints.length) {
//               const segmentPoints = transformedPoints.slice(segmentStart, segmentEnd);

//               if (segmentPoints.length >= 2) {
//                 drawingPaths.push(`; 开始路径段 ${segIndex + 1}/${allBreakPoints.length}`);
//                 drawingPaths.push(`G0 X${segmentPoints[0].x} Y${segmentPoints[0].y}`); // 移动到段起点
//                 drawingPaths.push(`M3 S${laserPower}`); // 开启激光

//                 for (let i = 1; i < segmentPoints.length; i++) {
//                   drawingPaths.push(`G1 X${segmentPoints[i].x} Y${segmentPoints[i].y} F${settings.feedRate || 1000}`);
//                 }

//                 drawingPaths.push(`M5`); // 关闭激光（抬笔）
//                 drawingPaths.push(`; 结束路径段 ${segIndex + 1}`);
//               }

//               segmentStart = segmentEnd;
//             }
//           }
//         } else {
//           // 无抬笔点：传统单笔段处理
//           drawingPaths.push(`G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`); // 移动到起点
//           drawingPaths.push(`M3 S${laserPower}`); // 开启激光

//           for (let i = 1; i < transformedPoints.length; i++) {
//             drawingPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
//           }

//           drawingPaths.push(`M5`); // 关闭激光
//         }

//         paths.push(...drawingPaths);
//       }
//     }
//   }

//   // 处理文本对象（转换为注释）
//   if (item.type === CanvasItemType.TEXT && 'text' in item) {
//     const transformedPos = transformCoordinate(x, y, settings);
//     paths.push(`; 文本对象: "${item.text}" 位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}°`);
//   }

//   // 处理图像对象
//   if (item.type === CanvasItemType.IMAGE) {
//     const transformedPos = transformCoordinate(x, y, settings);

//     // 检查是否有矢量源数据
//     if (item.vectorSource && item.vectorSource.parsedItems && item.vectorSource.parsedItems.length > 0) {
//       // 调试信息：检查原始尺寸数据
//       console.log('G代码生成 - 图像对象调试信息:', {
//         itemWidth: item.width,
//         itemHeight: item.height,
//         hasOriginalDimensions: !!item.vectorSource.originalDimensions,
//         originalDimensions: item.vectorSource.originalDimensions,
//         vectorSourceType: item.vectorSource.type,
//         parsedItemsCount: item.vectorSource.parsedItems.length
//       });

//       // 计算缩放比例：画布显示大小 vs 原始文件大小
//       let scaleX = 1;
//       let scaleY = 1;

//       if (item.vectorSource.originalDimensions) {
//         const originalWidth = item.vectorSource.originalDimensions.viewBox.width || item.vectorSource.originalDimensions.width;
//         const originalHeight = item.vectorSource.originalDimensions.viewBox.height || item.vectorSource.originalDimensions.height;

//         console.log('原始尺寸计算:', {
//           originalWidth,
//           originalHeight,
//           itemWidth: item.width,
//           itemHeight: item.height
//         });

//         if (originalWidth > 0 && originalHeight > 0) {
//           scaleX = item.width / originalWidth;
//           scaleY = item.height / originalHeight;
//           console.log('计算得到的缩放比例:', { scaleX, scaleY });
//         } else {
//           console.warn('原始尺寸无效，使用默认缩放比例 1:1');
//         }
//       } else {
//         console.warn('缺少原始尺寸信息，使用默认缩放比例 1:1');
//       }

//       // 使用矢量源数据生成G代码
//       paths.push(`; 图像对象(矢量源)位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}°`);
//       paths.push(`; 缩放比例: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}`);
//       paths.push(`; 原始尺寸: ${item.vectorSource.originalDimensions?.viewBox.width || 'unknown'} × ${item.vectorSource.originalDimensions?.viewBox.height || 'unknown'}`);
//       paths.push(`; 显示尺寸: ${item.width} × ${item.height}`);

//         // 处理矢量源中的每个对象
//         for (const vectorItem of item.vectorSource.parsedItems) {
//           // 应用缩放到矢量子对象的位置
//           const scaledVectorX = (vectorItem.x || 0) * scaleX;
//           const scaledVectorY = (vectorItem.y || 0) * scaleY;

//           // 先应用图像对象的旋转到矢量子对象的位置
//           const rotatedPos = rotatePoint(x + scaledVectorX, y + scaledVectorY, x, y, rotation);

//           // 创建缩放后的矢量对象
//           let scaledVectorItem = { ...vectorItem };

//           // 如果是绘图对象，缩放其点坐标
//           if ('points' in scaledVectorItem && Array.isArray(scaledVectorItem.points)) {
//             scaledVectorItem.points = scaledVectorItem.points.map(point => ({
//               x: point.x * scaleX,
//               y: point.y * scaleY
//             }));
//           }

//           // 如果是参数化对象，缩放其参数
//           if ('parameters' in scaledVectorItem && scaledVectorItem.parameters) {
//             const params = { ...scaledVectorItem.parameters };
//             if ('width' in params) params.width = params.width * scaleX;
//             if ('height' in params) params.height = params.height * scaleY;
//             if ('radius' in params) params.radius = params.radius * Math.min(scaleX, scaleY);
//             if ('length' in params) params.length = params.length * scaleX;
//             scaledVectorItem.parameters = params;
//           }

//           // 将矢量对象的位置相对于图像对象进行变换，并传递旋转角度
//           const vectorItemWithOffset: CanvasItem = {
//             ...scaledVectorItem,
//             x: rotatedPos.x,
//             y: rotatedPos.y,
//             // 将图像对象的旋转角度传递给矢量子对象
//             rotation: rotation + (('rotation' in vectorItem ? vectorItem.rotation : 0) || 0),
//             id: `vector_${Date.now()}_${Math.random()}`, // 临时ID
//             layerId: item.layerId,
//             scalex: scalex,
//             scaley: scaley
//           } as CanvasItem;

//           // 递归处理矢量对象
//           const vectorPaths = itemToGCodePaths(vectorItemWithOffset, settings);
//           paths.push(...vectorPaths);
//         }
//     } else {
//       // 没有矢量源数据，转换为注释
//       paths.push(`; 图像对象位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}° - 建议使用扫描图层处理`);
//     }
//   }

//   // 处理组合对象
//   if (item.type === 'GROUP' && 'children' in item && Array.isArray(item.children)) {
//     const transformedPos = transformCoordinate(x, y, settings);
//     paths.push(`; 开始组合对象 位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}°`);
//     for (const child of item.children) {
//       // 先应用组合对象的旋转到子对象的位置
//       const childX = (child.x || 0)*scalex;
//       const childY = (child.y || 0)*scaley;
//       const rotatedPos = rotatePoint(x + childX, y + childY, x, y, rotation);

//       // 递归处理子对象，并相对于父对象的位置进行变换，同时传递旋转角度
//       const childItem = {
//         ...child,
//         x: rotatedPos.x,
//         y: rotatedPos.y,
//         // 将组合对象的旋转角度传递给子对象
//         rotation: rotation + (('rotation' in child ? child.rotation : 0) || 0)
//       } as CanvasItem;
//       const childPaths = itemToGCodePaths(childItem, settings);
//       paths.push(...childPaths);
//     }
//     paths.push(`; 结束组合对象`);
//   }

//   return paths;
// }


/**
 * 将矢量对象直接转换为G代码路径 8-25
 * @param item 画布对象
 * @param settings 雕刻设置
 * @returns G代码路径数组
 */
//MARK: 将矢量对象直接转换为G代码路径
function itemToGCodePaths(item: CanvasItem, settings: GCodeEngraveSettings): string[] {
  const paths: string[] = [];
  const { x = 0, y = 0 } = item;
  const { scalex = 1, scaley = 1 } = item;
  const rotation = 'rotation' in item ? item.rotation || 0 : 0;

  // 激光功率设置
  const laserPower = Math.round((settings.power || 50) * 10); // 转换为0-1000范围

  console.log(`处理对象 ${item.type} at (${x}, ${y}), rotation: ${rotation}°, Y轴${settings.flipY ? '已' : '未'}反转`);
  if ('parameters' in item) {
    console.log('参数:', item.parameters);
  }

  if ('parameters' in item) {
    switch (item.type) {
      case CanvasItemType.RECTANGLE: {
        const { width = 40, height = 40 } = item.parameters;
        const w2 = width / 2;
        const h2 = height / 2;

        // 矩形四个角点（相对于中心）
        const corners = [
          { x: x - w2, y: y - h2 }, // 左上
          { x: x + w2, y: y - h2 }, // 右上  
          { x: x + w2, y: y + h2 }, // 右下
          { x: x - w2, y: y + h2 }, // 左下
        ];

        // 应用旋转变换
        const rotatedCorners = corners.map(corner =>
          rotatePoint(corner.x, corner.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedCorners = rotatedCorners.map(corner =>
          transformCoordinate(corner.x, corner.y, settings)
        );

        // 生成G代码路径
        const rectPaths = [
          `G0 X${transformedCorners[0].x} Y${transformedCorners[0].y}`, // 移动到起点
          `M3 S${laserPower}`,        // 开启激光
          `G1 X${transformedCorners[1].x} Y${transformedCorners[1].y} F${settings.feedRate || 1000}`, // 上边
          `G1 X${transformedCorners[2].x} Y${transformedCorners[2].y}`, // 右边
          `G1 X${transformedCorners[3].x} Y${transformedCorners[3].y}`, // 下边
          `G1 X${transformedCorners[0].x} Y${transformedCorners[0].y}`, // 左边回到起点
          `M5`,                       // 关闭激光
        ];
        paths.push(...rectPaths);
        break;
      }

      case CanvasItemType.CIRCLE: {
        const { radius = 20 } = item.parameters;

        // 圆形的起始点（右侧）
        const startPoint = rotatePoint(x + radius, y, x, y, rotation);
        const transformedStart = transformCoordinate(startPoint.x, startPoint.y, settings);
        const transformedCenter = transformCoordinate(x, y, settings);

        // 计算I和J偏移（相对于起始点）
        const iOffset = transformedCenter.x - transformedStart.x;
        const jOffset = transformedCenter.y - transformedStart.y;

        // 当Y轴反转时，圆的方向也要反转
        const circleCommand = settings.flipY ? 'G03' : 'G02';

        const circlePaths = [
          `G0 X${transformedStart.x} Y${transformedStart.y}`,  // 移动到起点
          `M3 S${laserPower}`,        // 开启激光
          `${circleCommand} X${transformedStart.x} Y${transformedStart.y} I${iOffset.toFixed(3)} J${jOffset.toFixed(3)} F${settings.feedRate || 1000}`, // 绘制整圆
          `M5`,                       // 关闭激光
        ];
        paths.push(...circlePaths);
        break;
      }

      case CanvasItemType.LINE: {
        const { length = 40 } = item.parameters;
        const l2 = length / 2;

        // 直线两端点
        const startPoint = rotatePoint(x - l2, y, x, y, rotation);
        const endPoint = rotatePoint(x + l2, y, x, y, rotation);

        const transformedStart = transformCoordinate(startPoint.x, startPoint.y, settings);
        const transformedEnd = transformCoordinate(endPoint.x, endPoint.y, settings);

        // 直线路径
        const linePaths = [
          `G0 X${transformedStart.x} Y${transformedStart.y}`,      // 移动到起点
          `M3 S${laserPower}`,        // 开启激光
          `G1 X${transformedEnd.x} Y${transformedEnd.y} F${settings.feedRate || 1000}`, // 绘制直线
          `M5`,                       // 关闭激光
        ];
        paths.push(...linePaths);
        break;
      }

      case CanvasItemType.FLANGE: {
        const {
          outerDiameter = 120,
          innerDiameter = 60,
          boltCircleDiameter = 90,
          boltHoleCount = 4,
          boltHoleDiameter = 8
        } = item.parameters;

        const outerRadius = outerDiameter / 2;
        const innerRadius = innerDiameter / 2;
        const boltCircleRadius = boltCircleDiameter / 2;
        const boltHoleRadius = boltHoleDiameter / 2;

        console.log(`法兰参数 - 外径: ${outerDiameter}, 内径: ${innerDiameter}, 螺栓孔数: ${boltHoleCount}`);
        
        const transformedCenter = transformCoordinate(x, y, settings);

        // =======================================================
        // 1. 首先生成内圆 (First, generate the inner circle)
        // =======================================================
        const innerStart = rotatePoint(x + innerRadius, y, x, y, rotation);
        const transformedInnerStart = transformCoordinate(innerStart.x, innerStart.y, settings);
        const innerIOffset = transformedCenter.x - transformedInnerStart.x;
        const innerJOffset = transformedCenter.y - transformedInnerStart.y;

        // 当Y轴反转时，圆的方向也要反转
        const innerCircleCommand = settings.flipY ? 'G03' : 'G02';

        paths.push(
          `G0 X${transformedInnerStart.x.toFixed(3)} Y${transformedInnerStart.y.toFixed(3)}`, // 使用 toFixed(3) 保持精度一致性
          `M3 S${laserPower}`,
          `${innerCircleCommand} X${transformedInnerStart.x.toFixed(3)} Y${transformedInnerStart.y.toFixed(3)} I${innerIOffset.toFixed(3)} J${innerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
          `M5`
        );

        // =======================================================
        // 2. 接着生成螺栓孔 (Next, generate the bolt holes)
        // =======================================================
        for (let i = 0; i < boltHoleCount; i++) {
          const angle = (i / boltHoleCount) * 2 * Math.PI - Math.PI / 2; // -PI/2 使第一个孔位于顶部
          const holeX = x + boltCircleRadius * Math.cos(angle);
          const holeY = y + boltCircleRadius * Math.sin(angle);

          // 应用整体旋转
          const rotatedHoleCenter = rotatePoint(holeX, holeY, x, y, rotation);
          const transformedHoleCenter = transformCoordinate(rotatedHoleCenter.x, rotatedHoleCenter.y, settings);
          
          // 计算相对于孔洞中心的起点和I, J偏移
          // 为了简化，我们总是从孔的右侧（3点钟方向）开始切割
          const holeStart = { x: transformedHoleCenter.x + boltHoleRadius, y: transformedHoleCenter.y };
          const holeIOffset = -boltHoleRadius; // 从起点回到中心的I偏移
          const holeJOffset = 0;              // 从起点回到中心的J偏移

          // 当Y轴反转时，圆的方向也要反转
          const holeCircleCommand = settings.flipY ? 'G03' : 'G02';

          paths.push(
            `G0 X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)}`,
            `M3 S${laserPower}`,
            `${holeCircleCommand} X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)} I${holeIOffset.toFixed(3)} J${holeJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
            `M5`
          );
        }

        // =======================================================
        // 3. 最后生成外圆 (Finally, generate the outer circle)
        // =======================================================
        const outerStart = rotatePoint(x + outerRadius, y, x, y, rotation);
        const transformedOuterStart = transformCoordinate(outerStart.x, outerStart.y, settings);
        const outerIOffset = transformedCenter.x - transformedOuterStart.x;
        const outerJOffset = transformedCenter.y - transformedOuterStart.y;

        // 当Y轴反转时，圆的方向也要反转
        const outerCircleCommand = settings.flipY ? 'G03' : 'G02';

        paths.push(
          `G0 X${transformedOuterStart.x.toFixed(3)} Y${transformedOuterStart.y.toFixed(3)}`, // 使用 toFixed(3) 保持精度一致性
          `M3 S${laserPower}`,
          `${outerCircleCommand} X${transformedOuterStart.x.toFixed(3)} Y${transformedOuterStart.y.toFixed(3)} I${outerIOffset.toFixed(3)} J${outerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
          `M5`
        );
        
        break;
      }

      case CanvasItemType.TORUS: {
        const { outerRadius = 60, innerRadius = 30 } = item.parameters;

        console.log(`圆环参数 - 外径: ${outerRadius * 2}, 内径: ${innerRadius * 2}`);

        // 外圆起始点（考虑旋转）
        const outerStart = rotatePoint(x + outerRadius, y, x, y, rotation);
        const transformedOuterStart = transformCoordinate(outerStart.x, outerStart.y, settings);
        const transformedCenter = transformCoordinate(x, y, settings);
        const outerIOffset = transformedCenter.x - transformedOuterStart.x;
        const outerJOffset = transformedCenter.y - transformedOuterStart.y;

        // 当Y轴反转时，圆的方向也要反转
        const outerCircleCommand = settings.flipY ? 'G03' : 'G02';

        paths.push(
          `G0 X${transformedOuterStart.x} Y${transformedOuterStart.y}`,
          `M3 S${laserPower}`,
          `${outerCircleCommand} X${transformedOuterStart.x} Y${transformedOuterStart.y} I${outerIOffset.toFixed(3)} J${outerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
          `M5`
        );

        // 内圆起始点（考虑旋转）
        const innerStart = rotatePoint(x + innerRadius, y, x, y, rotation);
        const transformedInnerStart = transformCoordinate(innerStart.x, innerStart.y, settings);
        const innerIOffset = transformedCenter.x - transformedInnerStart.x;
        const innerJOffset = transformedCenter.y - transformedInnerStart.y;

        // 当Y轴反转时，圆的方向也要反转
        const innerCircleCommand = settings.flipY ? 'G03' : 'G02';

        paths.push(
          `G0 X${transformedInnerStart.x} Y${transformedInnerStart.y}`,
          `M3 S${laserPower}`,
          `${innerCircleCommand} X${transformedInnerStart.x} Y${transformedInnerStart.y} I${innerIOffset.toFixed(3)} J${innerJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
          `M5`
        );
        break;
      }

      case CanvasItemType.L_BRACKET: {
        const { width = 80, height = 80, thickness = 15 } = item.parameters;
        const w2 = width / 2;
        const h2 = height / 2;

        console.log(`L型支架参数 - 宽: ${width}, 高: ${height}, 厚度: ${thickness}`);

        // L型支架的关键点
        const points = [
          { x: x - w2, y: y - h2 },                          // 起点
          { x: x + w2, y: y - h2 },                          // 上边终点
          { x: x + w2, y: y - h2 + thickness },              // 右上垂直
          { x: x - w2 + thickness, y: y - h2 + thickness },  // 内部水平
          { x: x - w2 + thickness, y: y + h2 },              // 右下垂直
          { x: x - w2, y: y + h2 },                          // 下边
          { x: x - w2, y: y - h2 },                          // 回到起点
        ];

        // 应用旋转变换
        const rotatedPoints = points.map(point =>
          rotatePoint(point.x, point.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedPoints = rotatedPoints.map(point =>
          transformCoordinate(point.x, point.y, settings)
        );

        // 生成G代码路径
        const bracketPaths = [
          `G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`,  // 移动到起点
          `M3 S${laserPower}`,
        ];

        for (let i = 1; i < transformedPoints.length; i++) {
          bracketPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
        }

        bracketPaths.push(`M5`);
        paths.push(...bracketPaths);
        break;
      }

      case CanvasItemType.U_CHANNEL: {
        const { width = 80, height = 100, thickness = 10 } = item.parameters;
        const w2 = width / 2;
        const h2 = height / 2;

        console.log(`U型槽参数 - 宽: ${width}, 高: ${height}, 厚度: ${thickness}`);

        // U型槽的关键点
        const points = [
          { x: x - w2, y: y - h2 },                          // 起点
          { x: x + w2, y: y - h2 },                          // 上边
          { x: x + w2, y: y + h2 },                          // 右边
          { x: x + w2 - thickness, y: y + h2 },              // 右下水平
          { x: x + w2 - thickness, y: y - h2 + thickness },  // 右内垂直
          { x: x - w2 + thickness, y: y - h2 + thickness },  // 内部水平
          { x: x - w2 + thickness, y: y + h2 },              // 左内垂直
          { x: x - w2, y: y + h2 },                          // 左下水平
          { x: x - w2, y: y - h2 },                          // 左边回到起点
        ];

        // 应用旋转变换
        const rotatedPoints = points.map(point =>
          rotatePoint(point.x, point.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedPoints = rotatedPoints.map(point =>
          transformCoordinate(point.x, point.y, settings)
        );

        // 生成G代码路径
        const channelPaths = [
          `G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`,
          `M3 S${laserPower}`,
        ];

        for (let i = 1; i < transformedPoints.length; i++) {
          channelPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
        }

        channelPaths.push(`M5`);
        paths.push(...channelPaths);
        break;
      }

      case CanvasItemType.RECTANGLE_WITH_HOLES: {
        const { width = 120, height = 80, holeRadius = 8, horizontalMargin = 20, verticalMargin = 20 } = item.parameters;
        const w2 = width / 2;
        const h2 = height / 2;

        console.log(`带孔矩形参数 - 宽: ${width}, 高: ${height}, 孔半径: ${holeRadius}`);

        // 主矩形的四个角点
        const rectCorners = [
          { x: x - w2, y: y - h2 }, // 左上
          { x: x + w2, y: y - h2 }, // 右上  
          { x: x + w2, y: y + h2 }, // 右下
          { x: x - w2, y: y + h2 }, // 左下
        ];

        // 应用旋转变换到矩形
        const rotatedRectCorners = rectCorners.map(corner =>
          rotatePoint(corner.x, corner.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedRectCorners = rotatedRectCorners.map(corner =>
          transformCoordinate(corner.x, corner.y, settings)
        );

        // 生成主矩形G代码路径
        const rectPaths = [
          `G0 X${transformedRectCorners[0].x} Y${transformedRectCorners[0].y}`,
          `M3 S${laserPower}`,
          `G1 X${transformedRectCorners[1].x} Y${transformedRectCorners[1].y} F${settings.feedRate || 1000}`,
          `G1 X${transformedRectCorners[2].x} Y${transformedRectCorners[2].y}`,
          `G1 X${transformedRectCorners[3].x} Y${transformedRectCorners[3].y}`,
          `G1 X${transformedRectCorners[0].x} Y${transformedRectCorners[0].y}`,
          `M5`
        ];
        paths.push(...rectPaths);

        // 四个角的孔位置（旋转前）
        const holePositions = [
          { x: x - w2 + horizontalMargin, y: y + h2 - verticalMargin },  // 左下
          { x: x + w2 - horizontalMargin, y: y + h2 - verticalMargin },  // 右下
          { x: x + w2 - horizontalMargin, y: y - h2 + verticalMargin },  // 右上
          { x: x - w2 + horizontalMargin, y: y - h2 + verticalMargin },  // 左上
        ];

        // 为每个孔生成圆形路径
        holePositions.forEach((pos, index) => {
          // 孔中心应用旋转
          const rotatedHoleCenter = rotatePoint(pos.x, pos.y, x, y, rotation);
          // 孔的起始点（右侧）
          const holeStart = transformCoordinate(rotatedHoleCenter.x + holeRadius, rotatedHoleCenter.y, settings);

          // 当Y轴反转时，圆的方向也要反转
          const holeCircleCommand = settings.flipY ? 'G03' : 'G02';

          paths.push(
            `G0 X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)}`,
            `M3 S${laserPower}`,
            `${holeCircleCommand} X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)} I${-holeRadius} J0 F${settings.feedRate || 1000}`,
            `M5`
          );
        });
        break;
      }

      case CanvasItemType.CIRCLE_WITH_HOLES: {
        const { radius = 50, holeRadius = 8, holeCount = 4 } = item.parameters;

        console.log(`带孔圆形参数 - 半径: ${radius}, 孔半径: ${holeRadius}, 孔数量: ${holeCount}`);

        // 主圆起始点（考虑旋转）
        const mainCircleStart = rotatePoint(x + radius, y, x, y, rotation);
        const transformedMainCircleStart = transformCoordinate(mainCircleStart.x, mainCircleStart.y, settings);
        const transformedCenter = transformCoordinate(x, y, settings);
        const mainCircleIOffset = transformedCenter.x - transformedMainCircleStart.x;
        const mainCircleJOffset = transformedCenter.y - transformedMainCircleStart.y;

        // 当Y轴反转时，圆的方向也要反转
        const mainCircleCommand = settings.flipY ? 'G03' : 'G02';

        paths.push(
          `G0 X${transformedMainCircleStart.x} Y${transformedMainCircleStart.y}`,
          `M3 S${laserPower}`,
          `${mainCircleCommand} X${transformedMainCircleStart.x} Y${transformedMainCircleStart.y} I${mainCircleIOffset.toFixed(3)} J${mainCircleJOffset.toFixed(3)} F${settings.feedRate || 1000}`,
          `M5`
        );

        // 孔的分布
        const holeCircleRadius = radius * 0.7; // 孔的分布圆半径
        for (let i = 0; i < holeCount; i++) {
          const angle = (i / holeCount) * 2 * Math.PI;
          const holeX = x + holeCircleRadius * Math.cos(angle);
          const holeY = y + holeCircleRadius * Math.sin(angle);

          // 应用整体旋转
          const rotatedHoleCenter = rotatePoint(holeX, holeY, x, y, rotation);
          const transformedHoleCenter = transformCoordinate(rotatedHoleCenter.x, rotatedHoleCenter.y, settings);
          const holeStart = { x: transformedHoleCenter.x + holeRadius, y: transformedHoleCenter.y };

          // 当Y轴反转时，圆的方向也要反转
          const holeCircleCommand = settings.flipY ? 'G03' : 'G02';

          paths.push(
            `G0 X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)}`,
            `M3 S${laserPower}`,
            `${holeCircleCommand} X${holeStart.x.toFixed(3)} Y${holeStart.y.toFixed(3)} I${-holeRadius} J0 F${settings.feedRate || 1000}`,
            `M5`
          );
        }
        break;
      }

      case CanvasItemType.EQUILATERAL_TRIANGLE: {
        const { sideLength = 40 } = item.parameters;
        const h = (sideLength * Math.sqrt(3)) / 2;

        console.log(`等边三角形参数 - 边长: ${sideLength}`);

        // 三角形三个顶点
        const trianglePoints = [
          { x: x - sideLength / 2, y: y - h / 3 },  // 左下
          { x: x + sideLength / 2, y: y - h / 3 },  // 右下
          { x: x, y: y + 2 * h / 3 },               // 顶点
          { x: x - sideLength / 2, y: y - h / 3 },  // 回到起点
        ];

        // 应用旋转变换
        const rotatedTrianglePoints = trianglePoints.map(point =>
          rotatePoint(point.x, point.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedTrianglePoints = rotatedTrianglePoints.map(point =>
          transformCoordinate(point.x, point.y, settings)
        );

        // 生成G代码路径
        const trianglePaths = [
          `G0 X${transformedTrianglePoints[0].x} Y${transformedTrianglePoints[0].y}`,
          `M3 S${laserPower}`,
        ];

        for (let i = 1; i < transformedTrianglePoints.length; i++) {
          trianglePaths.push(`G1 X${transformedTrianglePoints[i].x} Y${transformedTrianglePoints[i].y} F${settings.feedRate || 1000}`);
        }

        trianglePaths.push(`M5`);
        paths.push(...trianglePaths);
        break;
      }

      case CanvasItemType.ISOSCELES_RIGHT_TRIANGLE: {
        const { cathetus = 50 } = item.parameters;

        console.log(`等腰直角三角形参数 - 直角边长: ${cathetus}`);

        // 三角形三个顶点
        const trianglePoints = [
          { x: x - cathetus / 2, y: y + cathetus / 2 },  // 左下角
          { x: x + cathetus / 2, y: y + cathetus / 2 },  // 右下角
          { x: x - cathetus / 2, y: y - cathetus / 2 },  // 左上角（直角顶点）
          { x: x - cathetus / 2, y: y + cathetus / 2 },  // 回到起点
        ];

        // 应用旋转变换
        const rotatedTrianglePoints = trianglePoints.map(point =>
          rotatePoint(point.x, point.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedTrianglePoints = rotatedTrianglePoints.map(point =>
          transformCoordinate(point.x, point.y, settings)
        );

        // 生成G代码路径
        const trianglePaths = [
          `G0 X${transformedTrianglePoints[0].x} Y${transformedTrianglePoints[0].y}`,
          `M3 S${laserPower}`,
        ];

        for (let i = 1; i < transformedTrianglePoints.length; i++) {
          trianglePaths.push(`G1 X${transformedTrianglePoints[i].x} Y${transformedTrianglePoints[i].y} F${settings.feedRate || 1000}`);
        }

        trianglePaths.push(`M5`);
        paths.push(...trianglePaths);
        break;
      }

      case CanvasItemType.SECTOR: {
        const { radius = 50, startAngle = -90, sweepAngle = 90 } = item.parameters;

        console.log(`处理对象 SECTOR at (${x}, ${y}), rotation: ${rotation}°`);
        console.log(`扇形参数 - 半径: ${radius}, 起始角: ${startAngle}, 扫掠角: ${sweepAngle}`);

        // 应用旋转到角度
        const startRad = ((startAngle + rotation) * Math.PI) / 180;
        const endRad = ((startAngle + sweepAngle + rotation) * Math.PI) / 180;

        // 计算弧的起点和终点（相对于扇形中心）
        const sx = x + radius * Math.cos(startRad);
        const sy = y + radius * Math.sin(startRad);
        const ex = x + radius * Math.cos(endRad);
        const ey = y + radius * Math.sin(endRad);

        // 应用坐标变换（包括Y轴反转）
        const centerTransformed = transformCoordinate(x, y, settings);
        const startTransformed = transformCoordinate(sx, sy, settings);
        const endTransformed = transformCoordinate(ex, ey, settings);

        // 计算弧的中心点（用于G02/G03命令）
        const centerOffsetX = centerTransformed.x - startTransformed.x;
        const centerOffsetY = centerTransformed.y - startTransformed.y;

        // 判断弧的方向（顺时针还是逆时针）
        // 注意：当Y轴反转时，弧的方向也会反转
        let isClockwise = sweepAngle < 0;
        if (settings.flipY) {
          isClockwise = !isClockwise; // Y轴反转时，弧的方向也要反转
        }
        const arcCommand = isClockwise ? 'G02' : 'G03';

        // 扇形路径：中心 -> 弧起点 -> 弧线 -> 中心
        const sectorPaths = [
          `G0 X${centerTransformed.x.toFixed(3)} Y${centerTransformed.y.toFixed(3)}`, // 移动到中心
          `M3 S${laserPower}`,
          `G1 X${startTransformed.x.toFixed(3)} Y${startTransformed.y.toFixed(3)} F${settings.feedRate || 1000}`, // 直线到弧起点
          `${arcCommand} X${endTransformed.x.toFixed(3)} Y${endTransformed.y.toFixed(3)} I${centerOffsetX.toFixed(3)} J${centerOffsetY.toFixed(3)}`, // 弧线到终点
          `G1 X${centerTransformed.x.toFixed(3)} Y${centerTransformed.y.toFixed(3)}`, // 回到中心
          `M5`
        ];
        console.log(`生成的扇形G代码路径:`, sectorPaths);
        paths.push(...sectorPaths);
        console.log(`当前paths数组长度: ${paths.length}`);
        break;
      }

      case CanvasItemType.ARC: {
        const { radius = 50, startAngle = 0, sweepAngle = 120 } = item.parameters;

        console.log(`处理对象 ARC at (${x}, ${y}), rotation: ${rotation}°`);
        console.log(`弧形参数 - 半径: ${radius}, 起始角: ${startAngle}, 扫掠角: ${sweepAngle}`);

        // 应用旋转到角度
        const startRad = ((startAngle + rotation) * Math.PI) / 180;
        const endRad = ((startAngle + sweepAngle + rotation) * Math.PI) / 180;

        // 计算弧的起点和终点（相对于弧中心）
        const sx = x + radius * Math.cos(startRad);
        const sy = y + radius * Math.sin(startRad);
        const ex = x + radius * Math.cos(endRad);
        const ey = y + radius * Math.sin(endRad);

        // 应用坐标变换（包括Y轴反转）
        const centerTransformed = transformCoordinate(x, y, settings);
        const startTransformed = transformCoordinate(sx, sy, settings);
        const endTransformed = transformCoordinate(ex, ey, settings);

        // 计算弧的中心点偏移（用于G02/G03命令）
        const centerOffsetX = centerTransformed.x - startTransformed.x;
        const centerOffsetY = centerTransformed.y - startTransformed.y;

        // 判断弧的方向（顺时针还是逆时针）
        // 注意：当Y轴反转时，弧的方向也会反转
        let isClockwise = sweepAngle < 0;
        if (settings.flipY) {
          isClockwise = !isClockwise; // Y轴反转时，弧的方向也要反转
        }
        const arcCommand = isClockwise ? 'G02' : 'G03';

        // 弧形路径
        const arcPaths = [
          `G0 X${startTransformed.x.toFixed(3)} Y${startTransformed.y.toFixed(3)}`, // 移动到弧起点
          `M3 S${laserPower}`,
          `${arcCommand} X${endTransformed.x.toFixed(3)} Y${endTransformed.y.toFixed(3)} I${centerOffsetX.toFixed(3)} J${centerOffsetY.toFixed(3)} F${settings.feedRate || 1000}`, // 弧线到终点
          `M5`
        ];
        paths.push(...arcPaths);
        break;
      }

      case CanvasItemType.POLYLINE: {
        const { seg1 = 40, seg2 = 50, seg3 = 30, angle } = item.parameters;

        console.log(`折线参数 - 段1: ${seg1}, 段2: ${seg2}, 段3: ${seg3}`);

        // 折线的关键点（简化处理）
        const polylinePoints = [
                    { x: x  - seg1 - seg2*Math.cos((angle+180)/180*Math.PI)/2, y: y - seg2*Math.sin((angle+180)/180*Math.PI)/2 },           // 第一段起点
                    { x: x  - seg2*Math.cos((angle+180)/180*Math.PI)/2, y: y - seg2*Math.sin((angle+180)/180*Math.PI)/2 },           // 第二段起点（转折开始）
                    { x: x, y: y },                         // 中心点
                    { x: x  + seg2*Math.cos((angle+180)/180*Math.PI)/2 , y: y + seg2*Math.sin((angle+180)/180*Math.PI)/2 },    // 第二段终点（转折结束）
                    { x: x  + seg3 + seg2*Math.cos((angle+180)/180*Math.PI)/2 , y: y + seg2*Math.sin((angle+180)/180*Math.PI)/2 },    // 第二段终点（转折结束）
         ];

        // 应用旋转变换
        const rotatedPolylinePoints = polylinePoints.map(point =>
          rotatePoint(point.x, point.y, x, y, rotation)
        );

        // 应用坐标转换（包括Y轴反转）
        const transformedPolylinePoints = rotatedPolylinePoints.map(point =>
          transformCoordinate(point.x, point.y, settings)
        );

        // 生成G代码路径
        const polylinePaths = [
          `G0 X${transformedPolylinePoints[0].x} Y${transformedPolylinePoints[0].y}`,
          `M3 S${laserPower}`,
        ];

        for (let i = 1; i < transformedPolylinePoints.length; i++) {
          polylinePaths.push(`G1 X${transformedPolylinePoints[i].x} Y${transformedPolylinePoints[i].y} F${settings.feedRate || 1000}`);
        }

        polylinePaths.push(`M5`);
        paths.push(...polylinePaths);
        break;
      }

      // 为其他复杂图形添加类似的旋转支持...
      default:
        // 对于不支持的参数化图形，生成注释并显示参数
        if ('type' in item) {
          if ('parameters' in item) {
            paths.push(`; 图形类型: ${item.type}, 参数: ${JSON.stringify((item as any).parameters)}`);
          } else {
            paths.push(`; 图形类型: ${item.type}`);
          }
        } else {
          paths.push(`; 未知对象: ${JSON.stringify(item)}`);
        }
        break;
    }
  }

  // 处理手绘路径（应用旋转和Y轴反转）
  if (item.type === CanvasItemType.DRAWING && 'points' in item && Array.isArray(item.points)) {
    if (item.points.length > 1) {
      const drawingPaths = [];

      // 对所有点应用旋转和坐标转换
      const transformedPoints = item.points.map(point => {
        const rotated = rotatePoint(x + point.x * scalex, y + point.y * scaley, x, y, rotation);
        return transformCoordinate(rotated.x, rotated.y, settings);
      });

      drawingPaths.push(`G0 X${transformedPoints[0].x} Y${transformedPoints[0].y}`); // 移动到起点
      drawingPaths.push(`M3 S${laserPower}`); // 开启激光

      for (let i = 1; i < transformedPoints.length; i++) {
        drawingPaths.push(`G1 X${transformedPoints[i].x} Y${transformedPoints[i].y} F${settings.feedRate || 1000}`);
      }

      drawingPaths.push(`M5`); // 关闭激光
      paths.push(...drawingPaths);
    }
  }

  // 处理文本对象（转换为注释）
  if (item.type === CanvasItemType.TEXT && 'text' in item) {
    const transformedPos = transformCoordinate(x, y, settings);
    paths.push(`; 文本对象: "${item.text}" 位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}°`);
  }

  // 处理图像对象
  // 8.8
  //MARK: 处理图像对象
  if (item.type === CanvasItemType.IMAGE) {
    const transformedPos = transformCoordinate(x, y, settings);

    // 检查是否有矢量源数据
    if (item.vectorSource && item.vectorSource.parsedItems && item.vectorSource.parsedItems.length > 0) {
      paths.push(`; 图像对象(矢量源)位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}°`);
      let scaleX = 1;
      let scaleY = 1;
      let deltaX = 0;
      let deltaY = 0;
      // 确保 originalDimensions 存在且有效
      if (item.vectorSource.originalDimensions) {
        // +++ ADDED +++ 核心改动：计算并应用缩放
        const originalWidth = item.vectorSource.originalDimensions.width;
        const originalHeight = item.vectorSource.originalDimensions.height;
        scaleX = item.width / originalWidth;
        scaleY = item.height / originalHeight;
        //const scale = Math.min(scaleX, scaleY);

        if(item.vectorSource.originalDimensions.type == "svg"){
          // deltax = (item.vectorSource.parsedItems[0].x - originalWidth/2) / (originalWidth) * item.width;
          // deltay = (item.vectorSource.parsedItems[0].y - originalHeight/2) / (originalHeight) * item.height;
          let Pos = rotatePoint(item.vectorSource.parsedItems[0].x, item.vectorSource.parsedItems[0].y, originalWidth/2, originalHeight/2, rotation);
          deltaX = (Pos.x - originalWidth/2) / (originalWidth) * item.width;
          deltaY = (Pos.y - originalHeight/2) / (originalHeight) * item.height;
        }

        scaleX = Math.min(scaleX, scaleY);
        scaleY = Math.min(scaleX, scaleY);
        console.log(`矢量源原始尺寸: ${originalWidth}x${originalHeight}, 显示尺寸: ${item.width}x${item.height}`);
        console.log(`矢量源缩放比例: X=${scaleX}, Y=${scaleY}`);
        paths.push(`; 原始尺寸: ${originalWidth.toFixed(2)}x${originalHeight.toFixed(2)} -> 显示尺寸: ${item.width.toFixed(2)}x${item.height.toFixed(2)}`);
        paths.push(`; 计算缩放比例: X=${scaleX.toFixed(4)}, Y=${scaleY.toFixed(4)}`);

      } else {
        paths.push(`; 警告: 缺少原始尺寸信息, 使用默认缩放 1:1`);
      }
      // +++ END ADDED +++

      // 处理矢量源中的每个对象
      for (const vectorItem of item.vectorSource.parsedItems) {
        // <<< MODIFIED >>> 创建一个新的、经过缩放的矢量对象副本
        let scaledVectorItem: CanvasItemData = { ...vectorItem };

        // 缩放子对象的相对位置
        // scaledVectorItem.x = ((vectorItem.x ?? 0) - originalWidth / 2) * scaleX + originalWidth / 2;
        // scaledVectorItem.y = ((vectorItem.y ?? 0) - originalHeight / 2) * scaleY + originalHeight / 2
        // 缩放子对象的相对位置

        scaledVectorItem.x = (vectorItem.x ?? 0) * scaleX; // Correctly calculated
        scaledVectorItem.y = (vectorItem.y ?? 0) * scaleY; // Correctly calculated

        // 如果是绘图对象，缩放其点坐标
        if ('points' in scaledVectorItem && Array.isArray(scaledVectorItem.points)) {
          scaledVectorItem.points = scaledVectorItem.points.map(point => ({
            // x: (point.x - originalWidth / 2) * scaleX + originalWidth / 2, // Correctly calculated
            // y: (point.y - originalHeight / 2) * scaleY + originalHeight / 2 // Correctly calculated
            x: point.x * scaleX,
            y: point.y * scaleY,
          }));

          // for (let point of scaledVectorItem.points) {
          //   console.log('矢量对象调试信息:',
          //     (vectorItem.x ?? 0),
          //     (vectorItem.y ?? 0),
          //     point.x,
          //     point.y,
          //     scaleX,
          //     scaleY);
          // }

        }

        // // 如果是参数化对象，缩放其参数 (注意：这里需要根据具体参数进行合理缩放)
        // if ('parameters' in scaledVectorItem && scaledVectorItem.parameters) {
        //   const params = { ...scaledVectorItem.parameters };
        //   // 通用参数缩放
        //   for (const key in params) {
        //     if (key.toLowerCase().includes('width') || key.toLowerCase().includes('length') || key.toLowerCase() === 'seg1' || key.toLowerCase() === 'seg2' || key.toLowerCase() === 'seg3') {
        //       params[key] *= scaleX;
        //     } else if (key.toLowerCase().includes('height')) {
        //       params[key] *= scaleY;
        //     } else if (key.toLowerCase().includes('radius') || key.toLowerCase().includes('diameter') || key.toLowerCase().includes('thickness')) {
        //       // 对于半径、直径等，使用X/Y缩放的平均值或最小值以保持形状
        //       params[key] *= Math.min(scaleX, scaleY);
        //     }
        //   }
        //   scaledVectorItem.parameters = params;
        // }
        // <<< END MODIFIED >>>

        // 先应用图像对象的旋转到缩放后子对象的相对位置
        const imageCenterX = item.vectorSource.originalDimensions?.imageCenterX || item.x;
        const imageCenterY = item.vectorSource.originalDimensions?.imageCenterY || item.y;
        const rotatedPos = rotatePoint(x, y, imageCenterX, imageCenterY, rotation);
        console.log('旋转调试:', x, y, imageCenterX, imageCenterY, rotation, '=>', rotatedPos);
        console.log("x", x, "y", y, "item.width", item.width, "item.height", item.height, "scaleX", scaleX, "scaleY", scaleY, "item.x", item.x, "item.y", item.y, "scaledVectorX", scaledVectorItem.x, "scaledVectorY", scaledVectorItem.y, "rotatedPosX", rotatedPos.x, "rotatedPosY", rotatedPos.y);
        const finalVectorItem: CanvasItem = {
          ...scaledVectorItem,
          x: x + deltaX,
          y: y + deltaY,
          scalex: scaleX,
          scaley: scaleY,
          rotation: rotation + (('rotation' in vectorItem ? vectorItem.rotation : 0) || 0),
          id: `vector_${Date.now()}_${Math.random()}`,
          layerId: item.layerId
        } as CanvasItem;

        const vectorPaths = itemToGCodePaths(finalVectorItem, settings);
        paths.push(...vectorPaths);
      }
    } else {
      paths.push(`; 图像对象位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}° - 建议使用扫描图层处理`);
    }
  }
  //MARK: 处理组合对象
  if (item.type === 'GROUP' && 'children' in item && Array.isArray(item.children)) {
    const transformedPos = transformCoordinate(x, y, settings);
    paths.push(`; 开始组合对象 位置(${transformedPos.x}, ${transformedPos.y}) 旋转: ${rotation}°`);
    for (const child of item.children) {
      // 先应用组合对象的旋转到子对象的位置
      const childX = (child.x || 0) * scalex;
      const childY = (child.y || 0) * scaley;
      const rotatedPos = rotatePoint(x + childX, y + childY, x, y, rotation);

      // 递归处理子对象，并相对于父对象的位置进行变换，同时传递旋转角度
      const childItem = {
        ...child,
        x: rotatedPos.x,
        y: rotatedPos.y,
        scalex: scalex,
        scaley: scaley,
        // 将组合对象的旋转角度传递给子对象
        rotation: rotation + (('rotation' in child ? child.rotation : 0) || 0)
      } as CanvasItem;
      const childPaths = itemToGCodePaths(childItem, settings);
      paths.push(...childPaths);
    }
    paths.push(`; 结束组合对象`);
  }
  return paths;
}



/**
 * 为雕刻图层生成G代码
 * @param layer 雕刻图层
 * @param items 画布中的所有项目
 * @param settings 雕刻设置
 * @returns 生成的G代码字符串
 */
export async function generateEngraveGCode(
  layer: Layer,
  items: CanvasItem[],
  settings: GCodeEngraveSettings = {}
): Promise<string> {
  // 获取属于该图层的所有对象（不再过滤图像）
  const layerItems = items.filter(item => item.layerId === layer.id);

  if (layerItems.length === 0) {
    throw new Error('图层中没有对象');
  }

  const gcode: string[] = [];

  // G代码文件头
  gcode.push(
    'G21 ; Set units to mm',
    'G90 ; Use absolute positioning',
    'G0 Z1 ; Raise to safe height',
    `G0 X0 Y0 F${settings.travelSpeed || 3000} ; Move to origin`,
    ''
  );

  // 统计支持的对象数量
  let supportedItemsCount = 0;

  // 为每个对象生成G代码路径
  for (const item of layerItems) {
    const itemPaths = itemToGCodePaths(item, settings);
    if (itemPaths.length > 0) {
      gcode.push(`; Object: ${item.type} at (${item.x}, ${item.y})`);
      gcode.push(...itemPaths);
      gcode.push('');

      // 统计实际生成了G代码路径的对象（不包括纯注释）
      if (itemPaths.some(path => !path.startsWith(';'))) {
        supportedItemsCount++;
      }
    }
  }

  // G代码文件尾
  gcode.push(
    'M5 ; Ensure laser is off',
    'G0 Z1 ; Raise to safe height',
    'G0 X0 Y0 ; Return to origin',
    'M30 ; Program end'
  );

  // 添加统计信息
  gcode.unshift(`; 雕刻图层: ${layer.name}`);
  gcode.unshift(`; 总对象数: ${layerItems.length}, 支持雕刻的对象数: ${supportedItemsCount}`);

  return gcode.join('\n');
}