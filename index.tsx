import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ImagePage from './ImagePage';
import { BrowserRouter, HashRouter, Router } from 'react-router-dom';
import { Routes, Route } from 'react-router-dom';
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/App" element={<App />} />
        <Route path="/" element={<ImagePage />} />
      </Routes>
      {/* <App /> */}
    </BrowserRouter>
  </React.StrictMode>
);
