import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Banner from './assets/banner.png'
const ImagePage = ()=> {
    var saveImage = ()=>{
        onSaveImage();
    };
    var onSaveImage: ()=>void;
    useEffect(() => {
    },[])
    return (
        <>
            <div style={{
                width: "100%", height: "100%", padding: "8px",
                display: "flex", flexDirection: "column", justifyContent: "space-between"
            }}>
                <div style={{
                    height: "50px", width: "100%"
                }}>
                    <TopBar saveEditImage={()=>{saveImage()}}/>
                </div>
                <div style={{
                    flex: 1, width: "100%"
                }}>
                    <Content onSaveImage={
                        (callback: ()=>void)=>{
                            onSaveImage = callback
                        }
                        }/>
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

// content
interface ChildProps2 {
    onSaveImage: (callback: ()=>void) => void;
}
const Content:React.FC<ChildProps2> = ({onSaveImage})=>{
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loaded, setLoaded] = useState(0);
    const MAX_WIDTH = 200;
    const navigate = useNavigate();


    function saveFile(){
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;

        if (window.webkit && window.webkit.messageHandlers.jsBridge) {
            (async () => {
            try {
                console.log("to save File")
                const filename = await saveEditedImage(canvas.toDataURL("image/png"));
                console.log(filename)
            
                localStorage.setItem('from', 'l/o/g/i/n');
                navigate('/App', {replace: false}); 

                //  { state: { from: 'login', age: 18 } }
            } catch (e) {
                console.error(e);
            }
            })();
        } else {
            // localStorage.setItem('from', 'l/o/g/i/n');
            // console.log(localStorage.getItem("from"))
            navigate('/App', {state: {from: "/l/o/g/i/n"}}); 
        }
    }
    onSaveImage(saveFile);

    useEffect(() => {
        if (window.cv) {
            console.log("opencv.js is ready")
        } else {
            console.log('OpenCV.js 尚未加载');
        }

        const img = new Image();
        img.onload = () => {
            const canvas = canvasRef.current!;
            const ctx = canvas.getContext('2d')!;
            
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            // canvas.style.width = MAX_WIDTH;
            // canvas.style.height = (img.height / img.width) * MAX_WIDTH;

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            console.log("draw");
        }
    
        if (window.webkit && window.webkit.messageHandlers.jsBridge) {
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
            img.src = "/banner.png";
        } else {
            img.src = Banner;
        }
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
                    <canvas ref={canvasRef} style={{
                        width: "200px",
                        height: "auto"
                    }}/>
                    
                    {/* <img src={"./assets/大象2.jpg"} alt="logo" style={{ width: '200px', height: 'auto' }} /> */}
                </div>
            </div>
            <div style={{
                height: "40px", width: "100%"
            }}>
                <div style={{
                    display: 'flex', flexDirection: "row",
                    // justifyContent: 'space-around', // 水平居中
                    alignItems: 'center',     // 垂直居中
                    height: '100%', width: "100%",
                    gap: "50px",
                    overflowX: "auto",
                    whiteSpace: "nowrap",
                }}>
                    <div style={{
                        width: "100px"
                    }}>
                        <button onClick={()=>onOpenCV("gray")}>灰度</button> 
                    </div><div style={{
                        width: "100px"
                    }}>
                        <button onClick={()=>onOpenCV("canny")}>线框</button>
                    </div>
                    <div style={{
                        width: "100px"
                    }}>
                        <button onClick={()=>onOpenCV("blur")}>模糊</button> 
                    </div>
                    <div style={{
                        width: "100px"
                    }}>
                        <button onClick={()=>{setLoaded(loaded + 1)}} >撤销</button> 
                    </div><div style={{
                        width: "100px"
                    }}>
                        <button >灰度</button> 
                    </div><div style={{
                        width: "100px"
                    }}>
                        <button >灰度</button> 
                    </div><div style={{
                        width: "100px"
                    }}>
                        <button >灰度</button> 
                    </div>
                </div>
            </div>
        </div>
    )
}


interface ChildProps {
    saveEditImage: () => void;
}
const TopBar: React.FC<ChildProps> = ({saveEditImage}) => {
    const handleLogin = () => {
        saveEditImage()
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

//js请求原生的图片数据，输入无，输出图片ImageData
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

//js向原生保存图片， 输入ImageData， 输出URL
function saveEditedImage(imageData: String): Promise<String>{
  return new Promise<String>((resolve) => {
    const id = Math.random().toString(36).slice(2);
    window[`__cb_${id}`] = resolve; // Swift 回传时调用

    window.webkit?.messageHandlers.jsBridge.postMessage({
        action: "saveEditedImage",
        id: id,
        imageData: imageData
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
