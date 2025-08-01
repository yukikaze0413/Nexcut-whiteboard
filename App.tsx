import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import WhiteboardPage from './WhiteboardPage';
import CropPage from './CropPage';

(window as any).__pendingHomePageImage = null;
(window as any).setHomePageImage = (base64Data: string) => {
  console.log('[全局] setHomePageImage 被调用，但当前页面未处理', base64Data?.length);
  (window as any).__pendingHomePageImage = base64Data;
};

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/whiteboard" element={<WhiteboardPage />} />
        <Route path="/crop" element={<CropPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;