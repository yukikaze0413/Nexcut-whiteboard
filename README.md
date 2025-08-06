# Nexcut Whiteboard

一个基于 React 的白板应用，支持绘图、图层管理和 G-code 生成。

## 功能特性

- 🎨 多种绘图工具（选择、橡皮擦、形状、涂鸦等）
- 📁 图层管理系统
- 🖼️ 图片导入和编辑
- 🔧 参数化零件库
- 📐 标尺和网格辅助
- ⚙️ G-code 生成和导出
- 📱 Android WebView 支持
- ⏳ G代码生成进度提示

## 跨平台下载支持

### 支持的平台
- ✅ **Web浏览器**: 使用传统的 blob URL 下载方式
- ✅ **Android WebView**: 通过 `Android.saveBlobFile` 接口直接保存文件
- ✅ **iOS WebView**: 通过 `iOS.saveBlobFile` 接口直接保存文件

### 问题解决
在移动端 WebView 环境中，blob URL 下载可能会遇到 "Can not handle uri:: blob:file:///..." 错误。为了解决这个问题，我们实现了跨平台优化：

### 解决方案
1. **平台检测**: 自动检测当前运行环境（Web/Android/iOS）
2. **原生接口调用**: 在移动端环境中，直接通过原生接口保存文件
3. **统一API**: 提供统一的 `saveBlobFile` 接口
4. **回退机制**: 如果原生接口不可用，自动回退到浏览器下载方式

### 代码实现
```typescript
// 检测当前运行平台
const detectPlatform = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  if (window.Android && typeof window.Android.saveBlobFile === 'function') {
    return 'android';
  } else if (window.iOS && typeof window.iOS.saveBlobFile === 'function') {
    return 'ios';
  } else if (/iphone|ipad|ipod/.test(userAgent)) {
    return 'ios_browser';
  } else if (/android/.test(userAgent)) {
    return 'android_browser';
  } else {
    return 'web';
  }
};

// 下载G代码文件的辅助函数
const downloadGCode = (gcode: string, fileName: string) => {
  const platform = detectPlatform();
  
  // 检查是否在原生移动应用环境中
  if (platform === 'android' && window.Android && typeof window.Android.saveBlobFile === 'function') {
    // 在 Android 原生环境中，直接通过 Android 接口保存文件
    try {
      const base64 = btoa(unescape(encodeURIComponent(gcode)));
      window.Android.saveBlobFile(base64, fileName, 'text/plain');
    } catch (error) {
      console.error('Android保存文件失败:', error);
      fallbackDownload(gcode, fileName);
    }
  } else if (platform === 'ios' && window.iOS && typeof window.iOS.saveBlobFile === 'function') {
    // 在 iOS 原生环境中，直接通过 iOS 接口保存文件
    try {
      const base64 = btoa(unescape(encodeURIComponent(gcode)));
      window.iOS.saveBlobFile(base64, fileName, 'text/plain');
    } catch (error) {
      console.error('iOS保存文件失败:', error);
      fallbackDownload(gcode, fileName);
    }
  } else {
    // 在浏览器环境中，使用传统的 blob URL 方式
    fallbackDownload(gcode, fileName);
  }
};
```

### 优势
- ✅ 避免 blob URL 错误
- ✅ 跨平台兼容性
- ✅ 更好的文件管理
- ✅ 自动保存到指定目录
- ✅ 错误处理和回退机制
- ✅ 统一的API接口

## G代码生成进度提示

### 功能说明
在生成G代码时，系统会显示一个进度弹窗，实时更新生成状态，提供更好的用户体验。

### 弹窗特性
- 🎯 **实时进度更新**: 显示当前生成阶段（正在生成G代码、正在保存文件等）
- ⏳ **加载动画**: 旋转的加载图标，提供视觉反馈
- 📱 **响应式设计**: 适配桌面和移动设备
- 🎨 **现代化UI**: 使用Tailwind CSS样式，美观简洁
- 🔒 **模态弹窗**: 防止用户在生成过程中进行其他操作

### 进度阶段
1. **初始化**: "正在生成G代码..."
2. **扫描模式**: "正在生成平台扫描G代码..."
3. **雕刻模式**: "正在生成雕刻G代码..."
4. **图层处理**: "正在处理图层: [图层名称]..."
5. **文件保存**: "正在保存文件..."

### 代码实现
```typescript
// 状态管理
const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);
const [generationProgress, setGenerationProgress] = useState('');

// 在生成函数中显示弹窗
const generateSingleLayerGCode = async (layer: Layer, fileName: string) => {
  // 显示生成进度弹窗
  setIsGeneratingGCode(true);
  setGenerationProgress('正在生成G代码...');

  try {
    // ... 生成逻辑 ...
    setGenerationProgress('正在保存文件...');
    downloadGCode(gcode, fileName);
    
    // 关闭弹窗
    setIsGeneratingGCode(false);
  } catch (error) {
    setIsGeneratingGCode(false);
    alert(`G代码生成失败: ${error.message}`);
  }
};

// 弹窗UI组件
{isGeneratingGCode && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
    <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
      <div className="flex items-center justify-center mb-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
      </div>
      <h3 className="text-lg font-semibold text-center mb-2">正在生成G代码</h3>
      <p className="text-gray-600 text-center text-sm">{generationProgress}</p>
    </div>
  </div>
)}
```

### 用户体验改进
- ✅ 清晰的进度反馈
- ✅ 防止重复操作
- ✅ 错误状态处理
- ✅ 自动关闭机制
- ✅ 跨平台兼容性

## 开发

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
```

## 技术栈

- React 18
- TypeScript
- Tailwind CSS
- Fabric.js
- SVG-to-GCode

## 许可证

MIT License 