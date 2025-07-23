// src/utils/DxfUtils.ts

import DxfParser from 'dxf-parser';

// 一个简单的颜色映射表，用于将 AutoCAD 颜色索引 (ACI) 转换为 CSS 颜色
// 完整列表很长，这里只列出几个常用颜色
const ACI_COLORS: { [key: number]: string } = {
    1: '#ff0000', // Red
    2: '#ffff00', // Yellow
    3: '#00ff00', // Green
    4: '#00ffff', // Cyan
    5: '#0000ff', // Blue
    6: '#ff00ff', // Magenta
    7: '#ffffff', // White/Black
};

/**
 * 将 DXF 的 ARC（圆弧）实体转换为 SVG 的 <path> 元素。
 * 这是最复杂的部分，需要进行三角函数计算。
 * @param arc - 从 dxf-parser 解析出的 ARC 实体。
 * @returns 返回 SVG path 的 'd' 属性字符串。
 */
function convertArcToPathD(arc: any): string {
    const { centerX, centerY, radius, startAngle, endAngle } = arc;

    // 将角度从度转换为弧度
    const startAngleRad = (startAngle * Math.PI) / 180;
    const endAngleRad = (endAngle * Math.PI) / 180;

    // 计算圆弧的起点和终点坐标
    const startX = centerX + radius * Math.cos(startAngleRad);
    const startY = centerY + radius * Math.sin(startAngleRad);
    const endX = centerX + radius * Math.cos(endAngleRad);
    const endY = centerY + radius * Math.sin(endAngleRad);

    // 计算 large-arc-flag 和 sweep-flag
    let angleDiff = endAngle - startAngle;
    if (angleDiff < 0) {
        angleDiff += 360;
    }
    const largeArcFlag = angleDiff > 180 ? 1 : 0;
    const sweepFlag = 1; // DXF 弧线通常是逆时针方向

    // 格式化为 SVG path d 属性
    return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`;
}


export class DxfUtils {

    /**
     * 将 DXF 文件内容的字符串异步转换为 SVG 格式的字符串。
     * 此实现不依赖 dxf-to-svg，而是手动转换实体。
     * 
     * @param dxfContent - 从 FileReader 读取到的 DXF 文件字符串内容。
     * @returns 返回一个 Promise，该 Promise 解析为包含 SVG 内容的字符串。
     */
    public static async dxfToSvg(dxfContent: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!dxfContent || typeof dxfContent !== 'string' || dxfContent.trim() === '') {
                return reject(new Error('DXF content is empty or invalid.'));
            }

            try {
                // 步骤 1: 解析 DXF
                const parser = new DxfParser();
                const dxf = parser.parseSync(dxfContent);

                if (!dxf || !dxf.entities) {
                    return reject(new Error('Failed to parse DXF or DXF has no entities.'));
                }

                // 步骤 2: 计算 ViewBox
                const header = dxf.header || {};
                const extMin = header.$EXTMIN || { x: 0, y: 0 };
                const extMax = header.$EXTMAX || { x: 100, y: 100 };
                const width = extMax.x - extMin.x;
                const height = extMax.y - extMin.y;

                // 如果范围无效，则拒绝
                if (width <= 0 || height <= 0) {
                    return reject(new Error('Invalid DXF extents. Cannot determine viewBox.'));
                }

                // 步骤 3: 遍历实体并转换为 SVG 标签
                const svgElements = dxf.entities.map(entity => {
                    const color = ACI_COLORS[entity.color] || '#ffffff'; // 默认为白色

                    switch (entity.type) {
                        case 'LINE':
                            return `<line x1="${entity.vertices[0].x}" y1="${entity.vertices[0].y}" x2="${entity.vertices[1].x}" y2="${entity.vertices[1].y}" stroke="${color}" fill="none" />`;

                        case 'CIRCLE':
                            return `<circle cx="${entity.center.x}" cy="${entity.center.y}" r="${entity.radius}" stroke="${color}" fill="none" />`;

                        case 'ARC':
                            const pathD = convertArcToPathD(entity);
                            return `<path d="${pathD}" stroke="${color}" fill="none" />`;

                        case 'LWPOLYLINE':
                            const points = entity.vertices.map((v: { x: number, y: number }) => `${v.x},${v.y}`).join(' ');
                            if (entity.closed) {
                                return `<polygon points="${points}" stroke="${color}" fill="none" />`;
                            } else {
                                return `<polyline points="${points}" stroke="${color}" fill="none" />`;
                            }

                        // 可以根据需要添加对其他实体（如 TEXT, SPLINE, ELLIPSE）的支持
                        // default:
                        //   console.warn('Unsupported entity type:', entity.type);
                        //   return '';
                    }
                    return '';
                }).join('\n  ');

                // 步骤 4: 组装成完整的 SVG 字符串
                // 注意：SVG 的 y 轴向下为正，而 DXF 通常向上为正。
                // 我们使用 transform="matrix(1 0 0 -1 0 height)" 来翻转 Y 轴以匹配坐标系。
                const finalSvg = `
<svg xmlns="http://www.w3.org/2000/svg" 
     width="100%" 
     height="100%" 
     viewBox="${extMin.x} ${extMin.y} ${width} ${height}">
  <g transform="matrix(1 0 0 -1 0 ${extMax.y + extMin.y})">
    ${svgElements}
  </g>
</svg>`;

                resolve(finalSvg.trim());

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error('Error during DXF to SVG conversion:', errorMessage);
                reject(new Error(`DXF to SVG conversion failed: ${errorMessage}`));
            }
        });
    }
}