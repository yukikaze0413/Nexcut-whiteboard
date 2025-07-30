import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

declare global {
  interface Window { 
    cv: any;
    setWhiteboardImage?: (base64Data: string) => void;
    setHomePageImage?: (base64Data: string) => void;
    setCanvasSize?: (width: number, height: number) => void;
  }
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [image, setImage] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [hasAndroidImage, setHasAndroidImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [clipAreaId, setClipAreaId] = useState<string>("");

  // 监听Android传递的图片
  // useEffect(() => {
  //   // 检查是否有Android传递的图片数据
  //   if (window.setWhiteboardImage) {
  //     console.log('[首页] 检测到Android setWhiteboardImage接口已挂载');
  //     setHasAndroidImage(true);
  //   }
    
  //   // 监听Android可能通过其他方式传递的图片
  //   const checkAndroidImage = () => {
  //     // 这里可以添加其他检查Android传递图片的逻辑
  //     console.log('[首页] 检查Android传递的图片数据');
  //   };
    
  //   // 页面加载完成后检查
  //   checkAndroidImage();
  // }, []);

  
  // 提供给Android调用的图片设置接口
  useEffect(() => {
    (window as any).setHomePageImage = (base64Data: string) => {
      console.log('[首页] Android调用setHomePageImage，base64长度:', base64Data.length);
      console.log('[首页] base64Data前100:', base64Data.slice(0, 100));
      // 自动补全base64格式
      if (base64Data && !base64Data.startsWith('data:image')) {
        base64Data = 'data:image/png;base64,' + base64Data;
        console.log('[首页] 自动补全base64格式:', base64Data.slice(0, 30));
      }
      setImage(base64Data);
      setOriginalImage(base64Data);
      setHasAndroidImage(true); // 标记有Android传递的图片
    };
    // 检查是否有缓存图片
    if ((window as any).__pendingHomePageImage) {
      (window as any).setHomePageImage((window as any).__pendingHomePageImage);
      (window as any).__pendingHomePageImage = null;
    }
    // 清理函数
    return () => {
      (window as any).setHomePageImage = (base64Data: string) => {
        console.log('[全局] setHomePageImage 被调用，但当前页面未处理', base64Data?.length);
        (window as any).__pendingHomePageImage = base64Data;
      };
    };
  }, []);

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

  const handleSelectImage = () => {
    fileInputRef.current?.click();
  };

  const handleCapturePhoto = () => {
    // 检查是否支持getUserMedia
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
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
      
      // 创建遮罩
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
      overlay.style.zIndex = '9998';
      
      // 添加到页面
      document.body.appendChild(overlay);
      document.body.appendChild(video);
      document.body.appendChild(captureBtn);
      document.body.appendChild(cancelBtn);
      
      // 获取摄像头权限
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
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
          alert('无法访问摄像头，请检查权限设置');
          document.body.removeChild(overlay);
          document.body.removeChild(video);
          document.body.removeChild(captureBtn);
          document.body.removeChild(cancelBtn);
        });
    } else {
      alert('您的设备不支持摄像头功能');
    }
  };

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
        
        switch (filterType) {
          case 'grayscale':
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

  // base64转cv.Mat
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

  // cv.Mat转base64
  function matToBase64(mat: any, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    window.cv.imshow(canvas, mat);
    return canvas.toDataURL();
  }

  // OpenCV.js高斯模糊
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

  // OpenCV.js Canny边缘检测
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

  // OpenCV.js 90度旋转
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

  // OpenCV.js 水平翻转
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

  // OpenCV.js 垂直翻转
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

  const resetToOriginal = () => {
    if (originalImage) {
      setImage(originalImage);
      setBrightness(0);
      setContrast(0);
    }
  };

  const handleNextStep = () => {
    if (image) {
      navigate('/whiteboard', { state: { image } });
    } else {
      navigate('/whiteboard');
    }
  };

  const handleMainPage = () => {
    navigate('/');
  };

  const handleSetting = () => {
    alert('设置功能');
  };

  const openCrop = () => {
    setClipAreaId(`clipArea-${Date.now()}`);
    setShowCrop(true);
  };

  // photoClip初始化
  useEffect(() => {
    if (showCrop && (window as any).PhotoClip && image && clipAreaId) {
      if ((window as any)._clipper) {
        (window as any)._clipper.destroy();
        (window as any)._clipper = null;
      }
      (window as any)._clipper = new (window as any).PhotoClip(`#${clipAreaId}`, {
        size: 250,
        outputSize: 250,
        file: '',
        view: '',
        img: image,
        ok: (dataUrl: string) => {
          setImage(dataUrl);
          setShowCrop(false);
        },
        loadStart: () => {},
        loadComplete: () => {},
        clipFinish: () => {}
      });
    }
    return () => {
      if ((window as any)._clipper) {
        (window as any)._clipper.destroy();
        (window as any)._clipper = null;
      }
    };
  }, [showCrop, image, clipAreaId]);

  // 页面加载时根据路由state显示裁剪结果
  useEffect(() => {
    if (location.state && (location.state as any).croppedImg) {
      setImage((location.state as any).croppedImg);
      setOriginalImage((location.state as any).croppedImg);
      // 清除state避免回退时重复
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* 顶部工具栏 */}
      <div className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-semibold text-center">CAD零件参数化白板</h1>
      </div>

      {/* 主要内容区域 */}
      <div className="flex-1 flex flex-col p-4">
        {/* 图片显示区域 */}
        <div
          className="flex-1 bg-gray-300 rounded-lg mb-4 flex items-center justify-center overflow-hidden relative"
          style={{ minHeight: 200, maxHeight: 400 }}
        >
          {image ? (
            <div className="relative w-full h-full">
              <img 
                src={image} 
                alt="编辑图片" 
                className="w-full h-full object-contain"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  filter: `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})`
                }}
                onError={(e) => {
                  console.error('图片加载失败:', e, image?.slice(0, 100));
                }}
              />
              {/* 重新选择图片按钮 */}
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={handleSelectImage}
                  className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors duration-200"
                  title="重新选择图片"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  onClick={handleCapturePhoto}
                  className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors duration-200"
                  title="拍照"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : hasAndroidImage ? (
            <div className="text-gray-500 text-center">
              <p>正在加载Android传递的图片...</p>
            </div>
          ) : (
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

        {/* 亮度调节 */}
        <div className="flex items-center mb-4">
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

        {/* 对比度调节 */}
        <div className="flex items-center mb-4">
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

        {/* 编辑操作按钮 */}
        <div className="overflow-x-auto">
          <div className="flex space-x-2 min-w-max">
            <button
              onClick={() => applyFilter('grayscale')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              灰度
            </button>
            <button
              onClick={() => applyFilter('binary')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              二值化
            </button>
            <button
              onClick={() => applyFilter('invert')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              反色
            </button>
            <button
              onClick={() => {
                if (!image) return;
                if (window.cv && window.cv.GaussianBlur) {
                  applyGaussianBlurOpenCV(image, 15, setImage);
                } else {
                  alert('OpenCV.js 正在加载，请稍后重试');
                }
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              高斯模糊
            </button>
            <button
              onClick={() => {
                if (!image) return;
                if (window.cv && window.cv.Canny) {
                  applyCannyEdgeDetectionOpenCV(image, 120, 250, setImage);
                } else {
                  alert('OpenCV.js 正在加载，请稍后重试');
                }
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              线框提取
            </button>
            <button
              onClick={() => {
                if (!image) return;
                if (window.cv && window.cv.rotate) {
                  applyRotate90OpenCV(image, setImage);
                } else {
                  alert('OpenCV.js 正在加载，请稍后重试');
                }
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              旋转
            </button>
            <button
              onClick={() => {
                if (!image) return;
                navigate('/crop', { state: { image, original: originalImage } });
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              裁剪
            </button>
            <button
              onClick={() => {
                if (!image) return;
                if (window.cv && window.cv.flip) {
                  applyFlipHorizontalOpenCV(image, setImage);
                } else {
                  alert('OpenCV.js 正在加载，请稍后重试');
                }
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              水平翻转
            </button>
            <button
              onClick={() => {
                if (!image) return;
                if (window.cv && window.cv.flip) {
                  applyFlipVerticalOpenCV(image, setImage);
                } else {
                  alert('OpenCV.js 正在加载，请稍后重试');
                }
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              垂直翻转
            </button>
            <button
              onClick={resetToOriginal}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              撤销操作
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

      {/* 底部导航栏 */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex justify-between items-center">
          <button
            onClick={handleMainPage}
            className="flex flex-col items-center"
          >
            <div className="w-8 h-8 bg-blue-500 rounded-full mb-1"></div>
            <span className="text-xs">首页</span>
          </button>
          
          <button
            onClick={handleNextStep}
            className="flex flex-col items-center"
          >
            <div className="w-8 h-8 bg-green-500 rounded-full mb-1"></div>
            <span className="text-xs">下一步</span>
          </button>
          
          <button
            onClick={handleSetting}
            className="flex flex-col items-center"
          >
            <div className="w-8 h-8 bg-gray-500 rounded-full mb-1"></div>
            <span className="text-xs">设置</span>
          </button>
        </div>
      </div>

      {/* 裁剪弹窗组件 */}
      {showCrop && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4">
            <div id={clipAreaId} style={{ width: 300, height: 300 }}></div>
            <div className="flex justify-end mt-4">
              <button
                className="px-4 py-2 bg-gray-400 text-white rounded mr-2"
                onClick={() => setShowCrop(false)}
              >取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage; 