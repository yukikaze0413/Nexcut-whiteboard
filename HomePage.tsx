import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// 全局类型声明，用于Android WebView接口
declare global {
  interface Window {
    cv: any; // OpenCV.js库
    setWhiteboardImage?: (base64Data?: string) => void; // Android设置白板图片接口
    setHomePageImage?: (base64Data: string) => void; // Android设置首页图片接口
    setCanvasSize?: (width: number, height: number) => void; // Android设置画布尺寸接口
    __pendingHomePageImage?: string; // 缓存首页图片数据
    __pendingWhiteboardImage?: { base64Data?: string; timestamp: number }; // 缓存白板图片数据
  }
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 状态管理
  const [image, setImage] = useState<string | null>(null); // 当前显示的图片
  const [brightness, setBrightness] = useState(0); // 亮度调节值
  const [contrast, setContrast] = useState(0); // 对比度调节值
  const [originalImage, setOriginalImage] = useState<string | null>(null); // 原始图片（用于撤销操作）
  const [hasAndroidImage, setHasAndroidImage] = useState(false); // 标记是否有Android传递的图片
  const fileInputRef = useRef<HTMLInputElement>(null); // 文件输入框引用

  // 提供给Android调用的图片设置接口
  useEffect(() => {
    (window as any).setHomePageImage = (base64Data: string) => {
      console.log('[首页] Android调用setHomePageImage，base64长度:', base64Data.length);
      console.log('[首页] base64Data前100:', base64Data.substring(0, 100));
      setImage(base64Data);
      setOriginalImage(base64Data);
      setHasAndroidImage(true); // 标记有Android传递的图片
    };

    // 提供给Android调用的白板跳转接口
    (window as any).setWhiteboardImage = (base64Data?: string) => {
      if (base64Data) {
        // 有图片数据时，跳转到白板并传递图片
        console.log('[首页] setWhiteboardImage有参数，跳转到白板并传递图片');
        navigate('/whiteboard', { state: { image: base64Data } });
      } else {
        // 无参数时，直接跳转到白板界面
        console.log('[首页] setWhiteboardImage无参数，直接跳转到白板界面');
        navigate('/whiteboard');
      }
    };

    // 检查是否有缓存的图片数据
    if ((window as any).__pendingHomePageImage) {
      const cachedData = (window as any).__pendingHomePageImage;
      console.log('[首页] 发现缓存的图片数据，长度:', cachedData.length);
      setImage(cachedData);
      setOriginalImage(cachedData);
      delete (window as any).__pendingHomePageImage;
    }

    // 检查是否有缓存的setWhiteboardImage调用
    if ((window as any).__pendingWhiteboardImage) {
      const pendingCall = (window as any).__pendingWhiteboardImage;
      console.log('[首页] 发现缓存的setWhiteboardImage调用:', pendingCall);
      
      if (pendingCall.base64Data) {
        // 有图片数据时，跳转到白板并传递图片
        console.log('[首页] 处理缓存的setWhiteboardImage有参数，跳转到白板并传递图片');
        navigate('/whiteboard', { state: { image: pendingCall.base64Data } });
      } else {
        // 无参数时，直接跳转到白板界面
        console.log('[首页] 处理缓存的setWhiteboardImage无参数，直接跳转到白板界面');
        navigate('/whiteboard');
      }
      delete (window as any).__pendingWhiteboardImage;
    }

    // 清理函数：当组件卸载时，设置一个空的处理函数
    return () => {
      delete (window as any).setHomePageImage;
      delete (window as any).setWhiteboardImage;
    };
  }, [navigate]);

  // 检测图片尺寸并设置状态，不再手动调整图片显示尺寸
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    
    console.log('图片原始尺寸:', img.naturalWidth, 'x', img.naturalHeight);
    
    // 获取容器信息用于调试
    const container = img.parentElement;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      console.log('容器尺寸:', containerRect.width, 'x', containerRect.height);
      
      // 计算白框区域的实际尺寸
      const whiteBoxWidth = containerRect.width - 32;
      const whiteBoxHeight = containerRect.height - 32;
      console.log('白框区域尺寸:', whiteBoxWidth, 'x', whiteBoxHeight);
      
      // 计算白框内的内容区域（即padding以内的区域）
      const contentWidth = whiteBoxWidth - 16;
      const contentHeight = whiteBoxHeight - 16;
      console.log('白框内容区域尺寸:', contentWidth, 'x', contentHeight);
      
      const scaleX = img.offsetWidth / img.naturalWidth;
      const scaleY = img.offsetHeight / img.naturalHeight;
      console.log('缩放比例:', scaleX.toFixed(3), 'x', scaleY.toFixed(3));
      
      // 检查是否在白框内容区域内完整显示
      const isFullyVisibleInContent = img.offsetWidth <= contentWidth && img.offsetHeight <= contentHeight;
      console.log('图片是否在白框内容区域内完整显示:', isFullyVisibleInContent);
      
      // 检查是否需要滚动条
      const needsScroll = img.offsetWidth > contentWidth || img.offsetHeight > contentHeight;
      console.log('是否需要滚动条:', needsScroll);
      
      // 输出CSS属性信息
      console.log('CSS object-fit:', getComputedStyle(img).objectFit);
      console.log('CSS max-width:', getComputedStyle(img).maxWidth);
      console.log('CSS max-height:', getComputedStyle(img).maxHeight);
      console.log('CSS width:', getComputedStyle(img).width);
      console.log('CSS height:', getComputedStyle(img).height);
      
      // 检查图片是否超出白框内可用空间
      const isOverflowingContent = img.offsetWidth > contentWidth || img.offsetHeight > contentHeight;
      console.log('图片是否超出白框内可用空间:', isOverflowingContent);
      
      // 计算图片在白框内的显示比例
      const displayRatioX = img.offsetWidth / contentWidth;
      const displayRatioY = img.offsetHeight / contentHeight;
      console.log('图片在白框内的显示比例:', displayRatioX.toFixed(3), 'x', displayRatioY.toFixed(3));
      
      // 输出实际显示尺寸
      console.log('实际显示尺寸:', img.offsetWidth, 'x', img.offsetHeight);
    }
  };

  // 处理图片文件上传
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      console.log('选择的文件:', file.name, file.size, file.type);

      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
      }

      // 检查文件大小（限制为10MB）
      if (file.size > 10 * 1024 * 1024) {
        alert('图片文件过大，请选择小于10MB的图片');
        return;
      }

      // 读取文件为Data URL
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageUrl = e.target?.result as string;
        console.log('图片URL长度:', imageUrl.length);
        setImage(imageUrl);
        setOriginalImage(imageUrl);
      };
      reader.onerror = (e) => {
        console.error('文件读取失败:', e);
        alert('图片读取失败，请重试');
      };
      reader.readAsDataURL(file);
    }

    // 清空input值，允许重复选择同一文件
    event.target.value = '';
  };

  // 触发文件选择
  const handleSelectImage = () => {
    fileInputRef.current?.click();
  };

  // 处理拍照功能
  const handleCapturePhoto = () => {
    // 检查是否在HTTPS环境下
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      alert('拍照功能需要HTTPS环境才能使用。\n\n在移动端，摄像头访问需要安全连接。\n\n请使用HTTPS协议访问此页面，或者使用"从相册选择"功能。');
      return;
    }

    // 检查浏览器是否支持getUserMedia
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('您的浏览器不支持摄像头功能，请使用现代浏览器或尝试"从相册选择"功能。');
      return;
    }

    // 创建视频元素
    const video = document.createElement('video');
    video.style.position = 'fixed';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.zIndex = '9999';
    video.style.objectFit = 'cover';
    video.autoplay = true;
    video.muted = true;

    // 创建拍照按钮
    const captureBtn = document.createElement('button');
    captureBtn.textContent = '拍照';
    captureBtn.style.position = 'fixed';
    captureBtn.style.bottom = '20px';
    captureBtn.style.left = '50%';
    captureBtn.style.transform = 'translateX(-50%)';
    captureBtn.style.zIndex = '10000';
    captureBtn.style.padding = '12px 24px';
    captureBtn.style.backgroundColor = '#007bff';
    captureBtn.style.color = 'white';
    captureBtn.style.border = 'none';
    captureBtn.style.borderRadius = '8px';
    captureBtn.style.fontSize = '16px';
    captureBtn.style.fontWeight = 'bold';

    // 创建取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.position = 'fixed';
    cancelBtn.style.top = '20px';
    cancelBtn.style.right = '20px';
    cancelBtn.style.zIndex = '10000';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.backgroundColor = 'rgba(0,0,0,0.5)';
    cancelBtn.style.color = 'white';
    cancelBtn.style.border = 'none';
    cancelBtn.style.borderRadius = '4px';
    cancelBtn.style.fontSize = '14px';

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
    overlay.style.zIndex = '9998';

    // 将元素添加到页面
    document.body.appendChild(overlay);
    document.body.appendChild(video);
    document.body.appendChild(captureBtn);
    document.body.appendChild(cancelBtn);

    // 获取摄像头权限并启动视频流
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // 优先使用后置摄像头
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    })
      .then(stream => {
        video.srcObject = stream;

        // 拍照功能
        const capturePhoto = () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            const photoDataUrl = canvas.toDataURL('image/jpeg', 0.9);
            setImage(photoDataUrl);
            setOriginalImage(photoDataUrl);

            // 停止摄像头
            stream.getTracks().forEach(track => track.stop());

            // 清理界面
            document.body.removeChild(overlay);
            document.body.removeChild(video);
            document.body.removeChild(captureBtn);
            document.body.removeChild(cancelBtn);
          }
        };

        // 绑定按钮事件
        captureBtn.onclick = capturePhoto;
        cancelBtn.onclick = () => {
          stream.getTracks().forEach(track => track.stop());
          document.body.removeChild(overlay);
          document.body.removeChild(video);
          document.body.removeChild(captureBtn);
          document.body.removeChild(cancelBtn);
        };
      })
      .catch(err => {
        console.error('摄像头访问失败:', err);
        let errorMessage = '无法访问摄像头';

        // 根据错误类型提供具体的错误信息
        if (err.name === 'NotAllowedError') {
          errorMessage = '摄像头权限被拒绝，请在浏览器设置中允许摄像头访问';
        } else if (err.name === 'NotFoundError') {
          errorMessage = '未找到摄像头设备';
        } else if (err.name === 'NotSupportedError') {
          errorMessage = '您的设备不支持摄像头功能';
        } else if (err.name === 'NotReadableError') {
          errorMessage = '摄像头被其他应用占用，请关闭其他使用摄像头的应用';
        } else if (err.name === 'SecurityError') {
          errorMessage = '由于安全限制，摄像头访问被拒绝。请确保使用HTTPS协议访问此页面。';
        }

        alert(errorMessage);

        // 清理界面
        try {
          document.body.removeChild(overlay);
          document.body.removeChild(video);
          document.body.removeChild(captureBtn);
          document.body.removeChild(cancelBtn);
        } catch (e) {
          console.error('清理界面失败:', e);
        }
      });
  };

  // 应用图片滤镜效果
  const applyFilter = (filterType: string) => {
    if (!image) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      if (ctx) {
        ctx.drawImage(img, 0, 0);

        // 根据滤镜类型处理图片
        switch (filterType) {
          case 'grayscale':
            // 灰度滤镜：将RGB值转换为灰度值
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
              data[i] = gray;
              data[i + 1] = gray;
              data[i + 2] = gray;
            }
            ctx.putImageData(imageData, 0, 0);
            break;

          case 'binary':
            // 二值化滤镜：将图片转换为黑白两色
            const binaryData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const binaryArray = binaryData.data;
            for (let i = 0; i < binaryArray.length; i += 4) {
              const gray = binaryArray[i] * 0.299 + binaryArray[i + 1] * 0.587 + binaryArray[i + 2] * 0.114;
              const binary = gray > 128 ? 255 : 0;
              binaryArray[i] = binary;
              binaryArray[i + 1] = binary;
              binaryArray[i + 2] = binary;
            }
            ctx.putImageData(binaryData, 0, 0);
            break;

          case 'invert':
            // 反色滤镜：将颜色值反转
            const invertData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const invertArray = invertData.data;
            for (let i = 0; i < invertArray.length; i += 4) {
              invertArray[i] = 255 - invertArray[i];
              invertArray[i + 1] = 255 - invertArray[i + 1];
              invertArray[i + 2] = 255 - invertArray[i + 2];
            }
            ctx.putImageData(invertData, 0, 0);
            break;
        }

        setImage(canvas.toDataURL());
      }
    };

    img.src = image;
  };

  // base64转cv.Mat（OpenCV处理）
  function base64ToMat(base64: string, callback: (src: any, width: number, height: number) => void) {
    const img = new window.Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const src = window.cv.imread(canvas);
      callback(src, img.width, img.height);
    };
    img.src = base64;
  }

  // cv.Mat转base64（OpenCV处理）
  function matToBase64(mat: any, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    window.cv.imshow(canvas, mat);
    return canvas.toDataURL();
  }

  // OpenCV.js高斯模糊：使用高斯核进行图像平滑处理
  function applyGaussianBlurOpenCV(base64: string, kernelSize: number, callback: (result: string) => void) {
    base64ToMat(base64, (src, width, height) => {
      const dst = new window.cv.Mat();
      const ksize = new window.cv.Size(kernelSize, kernelSize);
      window.cv.GaussianBlur(src, dst, ksize, 0, 0, window.cv.BORDER_DEFAULT);
      const resultBase64 = matToBase64(dst, width, height);
      src.delete();
      dst.delete();
      callback(resultBase64);
    });
  }

  // OpenCV.js Canny边缘检测：检测图像中的边缘
  function applyCannyEdgeDetectionOpenCV(base64: string, threshold1: number, threshold2: number, callback: (result: string) => void) {
    base64ToMat(base64, (src, width, height) => {
      const gray = new window.cv.Mat();
      const edges = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
      window.cv.Canny(gray, edges, threshold1, threshold2);
      // 反色，让线条变白，背景变黑
      window.cv.bitwise_not(edges, edges);
      // Canny输出是单通道，需要转回4通道显示
      window.cv.cvtColor(edges, src, window.cv.COLOR_GRAY2RGBA, 0);
      const resultBase64 = matToBase64(src, width, height);
      src.delete();
      gray.delete();
      edges.delete();
      callback(resultBase64);
    });
  }

  // OpenCV.js 90度旋转：顺时针旋转图片90度
  function applyRotate90OpenCV(base64: string, callback: (result: string) => void) {
    base64ToMat(base64, (src, width, height) => {
      const dst = new window.cv.Mat();
      window.cv.rotate(src, dst, window.cv.ROTATE_90_CLOCKWISE);
      const resultBase64 = matToBase64(dst, height, width); // 旋转后宽高互换
      src.delete();
      dst.delete();
      callback(resultBase64);
    });
  }

  // OpenCV.js 水平翻转：左右翻转图片
  function applyFlipHorizontalOpenCV(base64: string, callback: (result: string) => void) {
    base64ToMat(base64, (src, width, height) => {
      const dst = new window.cv.Mat();
      window.cv.flip(src, dst, 1); // 1: 水平翻转
      const resultBase64 = matToBase64(dst, width, height);
      src.delete();
      dst.delete();
      callback(resultBase64);
    });
  }

  // OpenCV.js 垂直翻转：上下翻转图片
  function applyFlipVerticalOpenCV(base64: string, callback: (result: string) => void) {
    base64ToMat(base64, (src, width, height) => {
      const dst = new window.cv.Mat();
      window.cv.flip(src, dst, 0); // 0: 垂直翻转
      const resultBase64 = matToBase64(dst, width, height);
      src.delete();
      dst.delete();
      callback(resultBase64);
    });
  }

  // 重置到原始图片：恢复图片到最初状态
  const resetToOriginal = () => {
    if (originalImage) {
      setImage(originalImage);
      setBrightness(0);
      setContrast(0);
    }
  };

  // 处理下一步按钮点击：跳转到白板页面
  const handleNextStep = () => {
    if (image) {
      navigate('/whiteboard', { state: { image } });
    } else {
      navigate('/whiteboard');
    }
  };

  // 处理主页按钮点击：返回首页
  const handleMainPage = () => {
    navigate('/');
  };

  // 处理设置按钮点击：显示设置功能
  const handleSetting = () => {
    alert('设置功能');
  };

  // 页面加载时根据路由state显示裁剪结果
  useEffect(() => {
    console.log('HomePage useEffect: 检查图片');
    console.log('location.state:', location.state);
    console.log('location.state.image:', (location.state as any)?.image);
    
    let img = (location.state as any)?.image;
    console.log('从location.state获取的图片:', img ? '有图片' : '无图片');
    
    if (!img) {
      // 如果location.state中没有图片，尝试从localStorage获取
      const localStorageImg = localStorage.getItem('croppedImage');
      console.log('localStorage中的图片:', localStorageImg ? '有图片' : '无图片');
      img = localStorageImg;
      if (img) {
        localStorage.removeItem('croppedImage');
        console.log('已从localStorage移除图片');
      }
    }
    
    // 如果有图片，设置图片
    if (img) {
      console.log('HomePage: 有图片，设置图片并显示');
      console.log('图片长度:', img.length);
      console.log('图片前100字符:', img.slice(0, 100));
      setImage(img);
      setOriginalImage(img);
      window.history.replaceState({}, document.title);
      // 禁止 setHomePageImage 再次覆盖
      (window as any).setHomePageImage = () => {};
    } else {
      console.log('HomePage: 没有接收到图片');
    }
  }, [location.state]); // 只依赖location.state

  // 移除监听窗口大小变化以重新调整图片尺寸的 useEffect
  // 因为现在使用 CSS 的 object-fit: contain 来实现自适应，无需手动调整
  
  // 添加窗口大小变化时的调试信息
  useEffect(() => {
    const handleResize = () => {
      if (image) {
        const imgElement = document.querySelector('img[alt="编辑图片"]') as HTMLImageElement;
        if (imgElement) {
          setTimeout(() => {
            const adjustedWidth = imgElement.offsetWidth;
            const adjustedHeight = imgElement.offsetHeight;
            console.log('窗口大小变化后 - 调整后的图片尺寸:', adjustedWidth, 'x', adjustedHeight);
            
            const container = imgElement.parentElement;
            if (container) {
              const containerRect = container.getBoundingClientRect();
              console.log('窗口大小变化后 - 容器尺寸:', containerRect.width, 'x', containerRect.height);
              
              // 计算白框区域的实际尺寸
              const whiteBoxWidth = containerRect.width - 32;
              const whiteBoxHeight = containerRect.height - 32;
              console.log('窗口大小变化后 - 白框区域尺寸:', whiteBoxWidth, 'x', whiteBoxHeight);
              
              // 计算白框内的内容区域（即padding以内的区域）
              const contentWidth = whiteBoxWidth - 16;
              const contentHeight = whiteBoxHeight - 16;
              console.log('窗口大小变化后 - 白框内容区域尺寸:', contentWidth, 'x', contentHeight);
              
              const scaleX = adjustedWidth / imgElement.naturalWidth;
              const scaleY = adjustedHeight / imgElement.naturalHeight;
              console.log('窗口大小变化后 - 缩放比例:', scaleX.toFixed(3), 'x', scaleY.toFixed(3));
              
              // 检查是否在白框内容区域内完整显示
              const isFullyVisibleInContent = adjustedWidth <= contentWidth && adjustedHeight <= contentHeight;
              console.log('窗口大小变化后 - 图片是否在白框内容区域内完整显示:', isFullyVisibleInContent);
            }
          }, 100);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [image]);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* 标题区域 */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-800">图片编辑</h1>
      </div>

      {/* 图片显示区域 */}
      <div className="flex-1 flex items-center justify-center p-4" style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        margin: '16px',
        maxWidth: 'calc(100% - 32px)',
        maxHeight: 'calc(100% - 32px)',
        overflow: 'hidden'
      }}>
        {image ? (
          // 有图片时的显示
          <div className="w-full h-full flex items-center justify-center relative">
            <img
              src={image}
              alt="编辑图片"
              style={{
                filter: `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})`,
                display: 'block',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                objectPosition: 'center'
              }}
              onError={(e) => {
                console.error('图片加载失败:', e, image?.slice(0, 100));
              }}
              onLoad={handleImageLoad}
            />
          </div>
        ) : (
          // 无图片时的初始状态
          <div className="text-gray-500 text-center">
            <div className="mb-4">
              <svg className="w-16 h-16 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-lg font-medium mb-2">选择图片</p>
            <p className="text-sm text-gray-400 mb-4">从相册选择或拍摄照片</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleSelectImage}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors duration-200 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                从相册选择
              </button>
              <button
                onClick={handleCapturePhoto}
                className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors duration-200 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                拍照
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 亮度对比度调节区域 */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        {/* 亮度调节滑块 */}
        <div className="flex items-center mb-2">
          <span className="text-sm font-medium w-16">亮度</span>
          <input
            type="range"
            min="-100"
            max="100"
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="flex-1 mx-4"
          />
          <span className="text-sm text-gray-600 w-12">{brightness}</span>
        </div>
        {/* 对比度调节滑块 */}
        <div className="flex items-center mb-2">
          <span className="text-sm font-medium w-16">对比度</span>
          <input
            type="range"
            min="-100"
            max="100"
            value={contrast}
            onChange={(e) => setContrast(Number(e.target.value))}
            className="flex-1 mx-4"
          />
          <span className="text-sm text-gray-600 w-12">{contrast}</span>
        </div>
      </div>

      {/* 功能操作按钮区域 */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="overflow-x-auto">
          <div className="flex space-x-2 min-w-max">
            <button onClick={() => applyFilter('grayscale')} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">灰度</button>
            <button onClick={() => applyFilter('binary')} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">二值化</button>
            <button onClick={() => applyFilter('invert')} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">反色</button>
            <button onClick={() => { if (!image) return; if (window.cv && window.cv.GaussianBlur) { applyGaussianBlurOpenCV(image, 15, setImage); } else { alert('OpenCV.js 正在加载，请稍后重试'); } }} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">高斯模糊</button>
            <button onClick={() => { if (!image) return; if (window.cv && window.cv.Canny) { applyCannyEdgeDetectionOpenCV(image, 120, 250, setImage); } else { alert('OpenCV.js 正在加载，请稍后重试'); } }} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">线框提取</button>
            <button onClick={() => { if (!image) return; if (window.cv && window.cv.rotate) { applyRotate90OpenCV(image, setImage); } else { alert('OpenCV.js 正在加载，请稍后重试'); } }} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">旋转</button>
            <button onClick={() => { if (!image) return; navigate('/crop', { state: { image, original: originalImage } }); }} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">裁剪</button>
            <button onClick={() => { if (!image) return; if (window.cv && window.cv.flip) { applyFlipHorizontalOpenCV(image, setImage); } else { alert('OpenCV.js 正在加载，请稍后重试'); } }} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">水平翻转</button>
            <button onClick={() => { if (!image) return; if (window.cv && window.cv.flip) { applyFlipVerticalOpenCV(image, setImage); } else { alert('OpenCV.js 正在加载，请稍后重试'); } }} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">垂直翻转</button>
            <button onClick={resetToOriginal} className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">撤销操作</button>
          </div>
        </div>
      </div>

      {/* 下一步按钮区域 */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex justify-center items-center">
          <button onClick={handleNextStep} className="flex flex-col items-center">
            <div className="w-12 h-12 bg-green-500 rounded-full mb-1 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <span className="text-sm">下一步</span>
          </button>
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleImageUpload}
        className="hidden"
      />
    </div>
  );
};

export default HomePage;