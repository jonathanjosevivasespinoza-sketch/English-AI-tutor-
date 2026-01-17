
import React from 'react';

interface VoiceIndicatorProps {
  isActive: boolean;
  status: string;
}

const VoiceIndicator: React.FC<VoiceIndicatorProps> = ({ isActive, status }) => {
  return (
    <div className="flex items-center space-x-2">
      <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
      <span className="text-sm font-medium text-slate-600">{status}</span>
    </div>
  );
};

export default VoiceIndicator;
