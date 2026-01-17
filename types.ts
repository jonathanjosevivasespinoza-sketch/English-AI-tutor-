
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface FeedbackUpdate {
  id: string;
  original: string;
  natural: string;
  phoneticTip?: string;
  explanation?: string;
  timestamp: Date;
}

export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}
