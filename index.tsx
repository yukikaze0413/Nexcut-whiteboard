import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 在应用启动时设置全局的setWhiteboardImage函数
// 确保在HomePage组件加载前就能处理Android的调用
(window as any).setWhiteboardImage = (base64Data?: string) => {
  console.log('[全局] setWhiteboardImage被调用，但HomePage还未加载，延迟处理');
  // 存储调用信息，等HomePage加载后再处理
  (window as any).__pendingWhiteboardImage = { base64Data, timestamp: Date.now() };
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
      <App />
  </React.StrictMode>
);
