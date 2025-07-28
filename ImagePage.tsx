import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ImagePage = ()=> {
    return (
        <>
            <div style={{
                width: "100%", height: "100%", padding: "8px",
                display: "flex", flexDirection: "column", justifyContent: "space-between"
            }}>
                <div style={{
                    height: "50px", width: "100%"
                }}>
                    <TopBar />
                </div>
                <div style={{
                    flex: 1, width: "100%"
                }}>
                    <Content />
                </div>
                <div style={{
                    height: "50px", width: "100%"
                }}>
                    BottomBar    
                </div>
            </div>
        </>
    )
};

const Content = ()=>{
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loaded, setLoaded] = useState(0);
    const MAX_WIDTH = 200;
    
    useEffect(() => {

        if (window.cv) {
            console.log("opencv.js is ready")
        } else {
            console.log('OpenCV.js 尚未加载');
        }

        // img.src = "./assets/banner.png";
        const img = new Image();
        img.onload = () => {
            const canvas = canvasRef.current!;
            const ctx = canvas.getContext('2d')!;
            
            canvas.width = MAX_WIDTH;
            canvas.height = (img.height / img.width) * MAX_WIDTH;

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            console.log("draw");
        }
    
        (async () => {
        try {
            const result = await getOriginImage();
            console.log('原生返回：', result);
            alert(result);
            img.src = `data:image/jpeg;base64,${result}`
        } catch (e) {
            console.error(e);
        }
        })();
    },[loaded]);

    const onOpenCV = (type: String)=> {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)        
        const src = window.cv.matFromImageData(imageData)
        const dst = new window.cv.Mat()

        try{
            switch(type){
                case "gray":
                    window.cv.cvtColor(src, dst, window.cv.COLOR_RGBA2GRAY);
                    window.cv.cvtColor(dst, dst, window.cv.COLOR_GRAY2RGBA);  
                    console.log("gray");
                    break;
                case "canny":
                    window.cv.cvtColor(src, dst, window.cv.COLOR_RGBA2GRAY);
                    const lowThresh = 50;
                    const highThresh = 150;
                    window.cv.Canny(dst, dst, lowThresh, highThresh, 3, false);
                    window.cv.cvtColor(dst, dst, window.cv.COLOR_GRAY2RGBA);
                    console.log("canny");  
                    break;
                case "blur":
                    const ksize = new window.cv.Size(5, 5)
                    window.cv.GaussianBlur(src, dst, ksize, 0);  
                    console.log("blur");
                    alert("blur");
                    break;
            }
            const resultImageData = new ImageData(
                new Uint8ClampedArray(dst.data), dst.cols, dst.rows
            )

            ctx.putImageData(resultImageData, 0, 0);
        }catch(error){
            console.error(error);
        }finally{
            src.delete();
            dst.delete();
        }
    }

    return(
        <div style={{
            width: "100%", height: "100%",
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center"
        }}>
            <div style={{
                flex: 1
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'center', // 水平居中
                    alignItems: 'center',     // 垂直居中
                    height: '100%', width: "100%"
                }}>
                    <canvas ref={canvasRef} />
                    
                    {/* <img src={"./assets/大象2.jpg"} alt="logo" style={{ width: '200px', height: 'auto' }} /> */}
                </div>
            </div>
            <div style={{
                height: "40px", width: "100%"
            }}>
                <div style={{
                    display: 'flex', flexDirection: "row",
                    justifyContent: 'space-around', // 水平居中
                    alignItems: 'center',     // 垂直居中
                    height: '100%', width: "100%"
                }}>
                    <button onClick={()=>onOpenCV("gray")}>灰度</button> 
                    <button onClick={()=>onOpenCV("canny")}>线框</button>
                    <button onClick={()=>onOpenCV("blur")}>模糊</button> 
                    <button onClick={()=>{setLoaded(loaded + 1)}} >撤销</button> 
                </div>
            </div>
        </div>
    )
}

const TopBar = () => {
    const navigate = useNavigate();
    const handleLogin = () => {
        navigate('/App', { replace: false }); 
    };
    return(
        <div style={{
            width: "100%", height: "100%",
            display: "flex", flexDirection: "row", justifyContent:"space-between", alignItems: "center"
        }}>
            <h2>NexCut-Space</h2>
            <button onClick={handleLogin}>Login</button>    
        </div>
    )
}
export default ImagePage;

function getOriginImage(): Promise<string>{
  return new Promise<string>((resolve) => {
    // 临时挂一个一次性回调
    const id = Math.random().toString(36).slice(2);
    window[`__cb_${id}`] = resolve; // Swift 回传时调用
    window.webkit?.messageHandlers.jsBridge.postMessage({
        action: "getOriginImage",
        id: id
        });
  });
}

declare global {
  interface Window {
    cv: any;
  }
}
declare global {
  interface Window {
    // 允许任意以 __cb_ 开头的属性，值是接收 string 的函数
    [key: `__cb_${string}`]: (result: string) => void;
  }
}
