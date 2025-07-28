import React, { useEffect } from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const BottomSheet: React.FC<BottomSheetProps> = ({ isOpen, onClose, title, children }) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity" 
        onClick={onClose}
        aria-hidden="true"
      ></div>

      {/* Sheet Content */}
      <div 
        className={`relative w-full bg-white rounded-t-2xl shadow-xl transition-transform transform ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ transitionDuration: '300ms', maxHeight: '80vh' }}
      >
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
             <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
             <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
             </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 65px)' }}>
            {children}
        </div>
      </div>
    </div>
  );
};

export default BottomSheet;