# G代码生成进度弹窗实现说明

## 功能概述

在 `WhiteboardPage.tsx` 中实现了G代码生成进度弹窗功能，当用户点击"生成G代码"按钮后，会在白板界面弹出一个模态弹窗，显示G代码生成的进度，并在文件生成并保存后自动关闭弹窗。

## 实现细节

### 1. 状态管理

在 `WhiteboardPage` 组件中添加了两个新的状态变量：

```typescript
// 添加G代码生成进度弹窗状态
const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);
const [generationProgress, setGenerationProgress] = useState('');
```

- `isGeneratingGCode`: 控制弹窗的显示/隐藏
- `generationProgress`: 存储当前生成进度的文本信息

### 2. 修改生成函数

#### `generateSingleLayerGCode` 函数

在生成单个图层G代码的函数中添加了进度提示：

```typescript
const generateSingleLayerGCode = async (layer: Layer, fileName: string) => {
  // 显示生成进度弹窗
  setIsGeneratingGCode(true);
  setGenerationProgress('正在生成G代码...');

  try {
    if (layer.printingMethod === PrintingMethod.SCAN) {
      // 扫描模式
      setGenerationProgress('正在生成平台扫描G代码...');
      // ... 生成逻辑 ...
      setGenerationProgress('正在保存文件...');
      downloadGCode(gcode, fileName);
      setIsGeneratingGCode(false);
    } else {
      // 雕刻模式
      setGenerationProgress('正在生成雕刻G代码...');
      // ... 生成逻辑 ...
      setGenerationProgress('正在保存文件...');
      downloadGCode(gcode, fileName);
      setIsGeneratingGCode(false);
    }
  } catch (error) {
    setIsGeneratingGCode(false);
    // 错误处理
  }
};
```

#### `generateMergedGCode` 函数

在合并所有图层G代码的函数中也添加了进度提示：

```typescript
const generateMergedGCode = async (fileName: string) => {
  setIsGeneratingGCode(true);
  setGenerationProgress('正在生成合并G代码...');

  try {
    // 遍历所有图层
    for (const layer of layers) {
      setGenerationProgress(`正在处理图层: ${layer.name}...`);
      // ... 处理每个图层 ...
    }
    
    setGenerationProgress('正在保存文件...');
    downloadGCode(mergedGCode, fileName);
    setIsGeneratingGCode(false);
  } catch (error) {
    setIsGeneratingGCode(false);
    // 错误处理
  }
};
```

### 3. UI弹窗组件

在组件的返回部分添加了弹窗UI：

```typescript
{/* G代码生成进度弹窗 */}
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

## 进度阶段

弹窗会显示以下进度信息：

1. **初始化**: "正在生成G代码..."
2. **扫描模式**: "正在生成平台扫描G代码..."
3. **雕刻模式**: "正在生成雕刻G代码..."
4. **图层处理**: "正在处理图层: [图层名称]..."
5. **文件保存**: "正在保存文件..."

## 特性

### 用户体验
- ✅ **实时进度反馈**: 显示当前生成阶段
- ✅ **加载动画**: 旋转的加载图标提供视觉反馈
- ✅ **模态弹窗**: 防止用户在生成过程中进行其他操作
- ✅ **自动关闭**: 生成完成后自动关闭弹窗

### 技术特性
- ✅ **响应式设计**: 适配桌面和移动设备
- ✅ **现代化UI**: 使用Tailwind CSS样式
- ✅ **错误处理**: 在出错时自动关闭弹窗并显示错误信息
- ✅ **跨平台兼容**: 在所有支持的平台上正常工作

### 视觉效果
- 🎨 半透明黑色背景遮罩
- 🎨 白色圆角弹窗
- 🎨 旋转的加载动画
- 🎨 清晰的文字提示
- 🎨 阴影效果增强层次感

## 使用流程

1. 用户在白板界面点击"生成G代码"按钮
2. 弹窗立即显示，显示"正在生成G代码..."
3. 根据选择的图层类型，显示相应的进度信息
4. 生成完成后显示"正在保存文件..."
5. 文件保存完成后弹窗自动关闭
6. 不再显示额外的完成提示，避免重复信息

## 错误处理

- 如果生成过程中出现错误，弹窗会自动关闭
- 错误信息会通过 `alert` 显示给用户（仅错误情况）
- 确保弹窗状态在所有情况下都能正确重置
- 成功完成时不再显示额外的 `alert` 提示，避免与进度弹窗重复

## 兼容性

- ✅ 桌面浏览器
- ✅ 移动端浏览器
- ✅ Android WebView
- ✅ iOS WebView

这个实现提供了良好的用户体验，让用户清楚地知道G代码生成的进度，避免了用户等待过程中的困惑。 