import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const CropPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { image, original } = (location.state || {}) as { image: string, original: string };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [imageRect, setImageRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<'move' | 'resize' | null>(null);
  const [resizeCorner, setResizeCorner] = useState<string>('');

  // 调试信息
  useEffect(() => {
    console.log('=== CropPage 初始化 ===');
    console.log('location.state:', location.state);
    console.log('image:', image ? '有图片' : '无图片');
    console.log('original:', original ? '有原图' : '无原图');
    console.log('图片长度:', image?.length || 0);
  }, [image, original, location.state]);

  // Canvas初始化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (window.webkit && window.webkit.messageHandlers.jsBridge) {
        window.webkit?.messageHandlers.jsBridge.postMessage({
        action: "removeEdgePan",
        });
      }
  
    if (canvas) {
      const resizeCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        console.log('Canvas尺寸已更新:', canvas.width, 'x', canvas.height);
      };

      // 初始设置
      resizeCanvas();

      // 监听窗口大小变化
      window.addEventListener('resize', resizeCanvas);
      window.addEventListener('orientationchange', () => {
        setTimeout(resizeCanvas, 100);
      });

      return () => {
        window.removeEventListener('resize', resizeCanvas);
        window.removeEventListener('orientationchange', resizeCanvas);
      };
    }
  }, []);

  // 加载图片
  useEffect(() => {
    if (!image) return;

    const img = new Image();
    img.onload = () => {
      console.log('图片加载成功:', img.width, 'x', img.height);
      setIsLoading(false);
      setIsReady(true);
      
      // 计算图片在Canvas中的位置和尺寸（适配移动端）
      const canvas = canvasRef.current;
      if (canvas) {
        // 获取Canvas的实际显示尺寸
        const rect = canvas.getBoundingClientRect();
        const canvasWidth = rect.width;
        const canvasHeight = rect.height;
        
        console.log('Canvas尺寸:', canvasWidth, 'x', canvasHeight);
        console.log('图片原始尺寸:', img.width, 'x', img.height);
        
        // 计算适配移动端的图片尺寸
        const padding = 40; // 移动端留出更多边距
        const maxWidth = canvasWidth - padding * 2;
        const maxHeight = canvasHeight - padding * 2;
        
        // 计算缩放比例，确保图片完全显示在Canvas内
        const scaleX = maxWidth / img.width;
        const scaleY = maxHeight / img.height;
        const scale = Math.min(scaleX, scaleY, 1); // 限制最大缩放为1
        
        const imageWidth = img.width * scale;
        const imageHeight = img.height * scale;
        const imageX = (canvasWidth - imageWidth) / 2;
        const imageY = (canvasHeight - imageHeight) / 2;
        
        console.log('图片显示尺寸:', imageWidth, 'x', imageHeight);
        console.log('图片位置:', imageX, imageY);
        
        setImageRect({ x: imageX, y: imageY, width: imageWidth, height: imageHeight });
        
        // 初始化裁剪框覆盖整个图片
        setCropBox({ x: imageX, y: imageY, width: imageWidth, height: imageHeight });
      }
    };
    img.onerror = () => {
      console.error('图片加载失败');
      setError('图片加载失败');
      setIsLoading(false);
    };
    img.src = image;
    imageRef.current = img;
  }, [image]);

  // 绘制Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !isReady) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 获取Canvas的实际显示尺寸
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    console.log('绘制Canvas - 尺寸:', canvas.width, 'x', canvas.height);
    console.log('绘制图片 - 位置:', imageRect.x, imageRect.y, '尺寸:', imageRect.width, 'x', imageRect.height);

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制白色背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 绘制图片（适配移动端尺寸）
    ctx.drawImage(img, imageRect.x, imageRect.y, imageRect.width, imageRect.height);

    // 遮罩：裁剪框外半透明黑色
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.moveTo(cropBox.x, cropBox.y);
    ctx.lineTo(cropBox.x + cropBox.width, cropBox.y);
    ctx.lineTo(cropBox.x + cropBox.width, cropBox.y + cropBox.height);
    ctx.lineTo(cropBox.x, cropBox.y + cropBox.height);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();

    // 绘制裁剪框边框（蓝色边框）
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height);

    // 绘制四个角的控制点
    const cornerSize = 16;
    ctx.fillStyle = '#007bff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const drawCorner = (x: number, y: number, size: number) => {
      ctx.fillRect(x, y, size, size);
      ctx.strokeRect(x, y, size, size);
    };
    drawCorner(cropBox.x - cornerSize/2, cropBox.y - cornerSize/2, cornerSize);
    drawCorner(cropBox.x + cropBox.width - cornerSize/2, cropBox.y - cornerSize/2, cornerSize);
    drawCorner(cropBox.x - cornerSize/2, cropBox.y + cropBox.height - cornerSize/2, cornerSize);
    drawCorner(cropBox.x + cropBox.width - cornerSize/2, cropBox.y + cropBox.height - cornerSize/2, cornerSize);

  }, [cropBox, isReady, imageRect]);

  // 检测点击位置
  const getClickInfo = (x: number, y: number) => {
    const cornerSize = 16; // 与绘制时的尺寸保持一致
    const cornerHalf = cornerSize / 2;
    
    // 检查四个角
    const corners = [
      { name: 'topLeft', x: cropBox.x - cornerHalf, y: cropBox.y - cornerHalf },
      { name: 'topRight', x: cropBox.x + cropBox.width - cornerHalf, y: cropBox.y - cornerHalf },
      { name: 'bottomLeft', x: cropBox.x - cornerHalf, y: cropBox.y + cropBox.height - cornerHalf },
      { name: 'bottomRight', x: cropBox.x + cropBox.width - cornerHalf, y: cropBox.y + cropBox.height - cornerHalf }
    ];
    
    for (const corner of corners) {
      if (x >= corner.x && x <= corner.x + cornerSize && 
          y >= corner.y && y <= corner.y + cornerSize) {
        return { mode: 'resize' as const, corner: corner.name };
      }
    }
    
    // 检查是否在裁剪框内
    if (x >= cropBox.x && x <= cropBox.x + cropBox.width &&
        y >= cropBox.y && y <= cropBox.y + cropBox.height) {
      return { mode: 'move' as const, corner: '' };
    }
    
    return { mode: null, corner: '' };
  };

  // 鼠标事件处理
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const clickInfo = getClickInfo(x, y);
    if (clickInfo.mode) {
      setIsDragging(true);
      setDragMode(clickInfo.mode);
      setResizeCorner(clickInfo.corner);
      setDragStart({ x: x - cropBox.x, y: y - cropBox.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragMode === 'move') {
      // 移动裁剪框
      const newX = Math.max(imageRect.x, Math.min(imageRect.x + imageRect.width - cropBox.width, x - dragStart.x));
      const newY = Math.max(imageRect.y, Math.min(imageRect.y + imageRect.height - cropBox.height, y - dragStart.y));
      setCropBox(prev => ({ ...prev, x: newX, y: newY }));
    } else if (dragMode === 'resize') {
      // 调整裁剪框大小
      let newCropBox = { ...cropBox };
      
      switch (resizeCorner) {
        case 'topLeft':
          newCropBox.x = Math.min(x, cropBox.x + cropBox.width - 50);
          newCropBox.y = Math.min(y, cropBox.y + cropBox.height - 50);
          newCropBox.width = cropBox.x + cropBox.width - newCropBox.x;
          newCropBox.height = cropBox.y + cropBox.height - newCropBox.y;
          break;
        case 'topRight':
          newCropBox.y = Math.min(y, cropBox.y + cropBox.height - 50);
          newCropBox.width = Math.max(x - cropBox.x, 50);
          newCropBox.height = cropBox.y + cropBox.height - newCropBox.y;
          break;
        case 'bottomLeft':
          newCropBox.x = Math.min(x, cropBox.x + cropBox.width - 50);
          newCropBox.width = cropBox.x + cropBox.width - newCropBox.x;
          newCropBox.height = Math.max(y - cropBox.y, 50);
          break;
        case 'bottomRight':
          newCropBox.width = Math.max(x - cropBox.x, 50);
          newCropBox.height = Math.max(y - cropBox.y, 50);
          break;
      }
      
      // 确保裁剪框不超出图片边界
      newCropBox.x = Math.max(imageRect.x, newCropBox.x);
      newCropBox.y = Math.max(imageRect.y, newCropBox.y);
      newCropBox.width = Math.min(imageRect.x + imageRect.width - newCropBox.x, newCropBox.width);
      newCropBox.height = Math.min(imageRect.y + imageRect.height - newCropBox.y, newCropBox.height);
      
      setCropBox(newCropBox);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragMode(null);
    setResizeCorner('');
  };

  // 触摸事件处理
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const clickInfo = getClickInfo(x, y);
    if (clickInfo.mode) {
      setIsDragging(true);
      setDragMode(clickInfo.mode);
      setResizeCorner(clickInfo.corner);
      setDragStart({ x: x - cropBox.x, y: y - cropBox.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (!isDragging) return;

    const touch = e.touches[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (dragMode === 'move') {
      const newX = Math.max(imageRect.x, Math.min(imageRect.x + imageRect.width - cropBox.width, x - dragStart.x));
      const newY = Math.max(imageRect.y, Math.min(imageRect.y + imageRect.height - cropBox.height, y - dragStart.y));
      setCropBox(prev => ({ ...prev, x: newX, y: newY }));
    } else if (dragMode === 'resize') {
      let newCropBox = { ...cropBox };
      
      switch (resizeCorner) {
        case 'topLeft':
          newCropBox.x = Math.min(x, cropBox.x + cropBox.width - 50);
          newCropBox.y = Math.min(y, cropBox.y + cropBox.height - 50);
          newCropBox.width = cropBox.x + cropBox.width - newCropBox.x;
          newCropBox.height = cropBox.y + cropBox.height - newCropBox.y;
          break;
        case 'topRight':
          newCropBox.y = Math.min(y, cropBox.y + cropBox.height - 50);
          newCropBox.width = Math.max(x - cropBox.x, 50);
          newCropBox.height = cropBox.y + cropBox.height - newCropBox.y;
          break;
        case 'bottomLeft':
          newCropBox.x = Math.min(x, cropBox.x + cropBox.width - 50);
          newCropBox.width = cropBox.x + cropBox.width - newCropBox.x;
          newCropBox.height = Math.max(y - cropBox.y, 50);
          break;
        case 'bottomRight':
          newCropBox.width = Math.max(x - cropBox.x, 50);
          newCropBox.height = Math.max(y - cropBox.y, 50);
          break;
      }
      
      newCropBox.x = Math.max(imageRect.x, newCropBox.x);
      newCropBox.y = Math.max(imageRect.y, newCropBox.y);
      newCropBox.width = Math.min(imageRect.x + imageRect.width - newCropBox.x, newCropBox.width);
      newCropBox.height = Math.min(imageRect.y + imageRect.height - newCropBox.y, newCropBox.height);
      
      setCropBox(newCropBox);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setDragMode(null);
    setResizeCorner('');
  };

  const handleOk = () => {
    try {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (!canvas || !img) {
        setError('无法获取图片数据');
        return;
      }

      // 创建临时canvas进行裁剪
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        setError('无法创建裁剪画布');
        return;
      }

      // 计算裁剪区域（考虑图片缩放）
      const scaleX = img.naturalWidth / imageRect.width;
      const scaleY = img.naturalHeight / imageRect.height;
      
      const cropX = (cropBox.x - imageRect.x) * scaleX;
      const cropY = (cropBox.y - imageRect.y) * scaleY;
      const cropWidth = cropBox.width * scaleX;
      const cropHeight = cropBox.height * scaleY;

      console.log('裁剪参数:', {
        cropX, cropY, cropWidth, cropHeight,
        imageRect: imageRect,
        cropBox: cropBox,
        scaleX, scaleY
      });

      // 设置临时canvas尺寸
      tempCanvas.width = cropWidth;
      tempCanvas.height = cropHeight;

      // 绘制裁剪区域
      tempCtx.drawImage(
        img,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      );

      // 转换为base64
      const croppedImg = tempCanvas.toDataURL('image/jpeg', 0.9);
      console.log('裁剪成功，返回首页');
      navigate('/', { state: { croppedImg } });

    } catch (err) {
      console.error('裁剪出错:', err);
      setError('裁剪过程中出现错误');
    }
  };

  const handleCancel = () => {
    console.log('取消按钮点击，返回首页');
    navigate('/', { state: { croppedImg: original } });
  };

  if (!image) {
    console.log('无图片数据，显示错误界面');
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col items-center justify-center z-50">
        <div className="bg-white bg-opacity-95 backdrop-blur-sm p-8 rounded-2xl shadow-2xl text-center max-w-md mx-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">无图片数据</h3>
          <p className="text-sm text-gray-500 mb-6">请从首页选择图片后再进行裁剪</p>
          <button
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl shadow-lg hover:from-blue-600 hover:to-blue-700 font-medium transition-all duration-200 transform hover:scale-105"
            onClick={() => navigate('/')}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    console.log('显示错误界面:', error);
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col items-center justify-center z-50">
        <div className="bg-white bg-opacity-95 backdrop-blur-sm p-8 rounded-2xl shadow-2xl text-center max-w-md mx-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">操作失败</h3>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl shadow-lg hover:from-blue-600 hover:to-blue-700 font-medium transition-all duration-200 transform hover:scale-105"
              onClick={() => setError('')}
            >
              重试
            </button>
            <button
              className="px-6 py-3 bg-gradient-to-r from-gray-400 to-gray-500 text-white rounded-xl shadow-lg hover:from-gray-500 hover:to-gray-600 font-medium transition-all duration-200 transform hover:scale-105"
              onClick={handleCancel}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  console.log('渲染主界面');

  return (
    <div className="fixed inset-0 bg-gray-100 flex flex-col z-50" style={{ height: '100vh', width: '100vw' }}>
      {/* 加载状态 */}
      {isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-95 flex items-center justify-center z-10 backdrop-blur-sm">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 font-medium">正在加载图片...</p>
            <p className="text-xs text-gray-400 mt-2">图片大小: {image.length} 字符</p>
          </div>
        </div>
      )}
      
      {/* 图片裁剪区域 - 白色面板 */}
      <div className="flex-1 relative bg-white" style={{ minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: 'none', display: 'block' }}
        />
      </div>
      
      {/* 底部按钮区域 */}
      <div className="bg-gray-100 p-4 flex gap-4 justify-center" style={{ flexShrink: 0 }}>
        <button
          className="px-8 py-3 bg-blue-500 text-white rounded-lg shadow-sm hover:bg-blue-600 text-base font-medium disabled:opacity-50 transition-colors duration-200"
          onClick={handleOk}
          disabled={!isReady}
          style={{ minWidth: '100px', minHeight: '44px', fontSize: '16px' }}
        >
          {isReady ? '确定' : '加载中...'}
        </button>
        <button
          className="px-8 py-3 bg-gray-400 text-white rounded-lg shadow-sm hover:bg-gray-500 text-base font-medium transition-colors duration-200"
          onClick={handleCancel}
          style={{ minWidth: '100px', minHeight: '44px', fontSize: '16px' }}
        >
          取消
        </button>
      </div>
    </div>
  );
};

export default CropPage; 