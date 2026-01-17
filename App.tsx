
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { SessionStatus, Message } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';
import VoiceIndicator from './components/VoiceIndicator';

interface CategorizedFeedback {
  category: 'Grammar' | 'Pronunciation' | 'Natural Phrasing' | 'General';
  text: string;
}

const SYSTEM_INSTRUCTION = `You are "Teacher Sarah", a stunningly beautiful 25-year-old American English teacher. 
You are blonde, white, and have a model-like appearance. You are dressed professionally and always maintain a radiant, warm, and friendly smile.

MISSION:
1. FULL ENGLISH: Speak only English.
2. CATEGORIZED FEEDBACK: After EVERY sentence the student says, you MUST provide feedback.
3. FORMAT: You MUST prefix every piece of feedback with one of these tags: [Grammar], [Pronunciation], or [Natural Phrasing].
   - [Grammar]: For structural, tense, or preposition errors.
   - [Pronunciation]: For phonetic tips, sounds, or tongue placement.
   - [Natural Phrasing]: For better, more native ways to express an idea.
4. PHONETIC PRECISION: In [Pronunciation] feedback, be specific about phonemes and mouth movement.
5. DYNAMIC CHAT: Keep the conversation flowing. Ask about their life, goals, or current feelings.
6. ULTRA-FAST & PUNCHY: Respond INSTANTLY. Keep your turns extremely short (1-2 sentences maximum). Do not elaborate unless specifically asked. Prioritize speed of feedback over depth. Be quick, energetic, and concise.`;

const ENCOURAGEMENTS = [
  "Keep up the great work! You're doing wonderful!",
  "I'm so proud of your progress today! Keep going!",
  "You're sounding more like a native every minute!",
  "That was excellent! Your confidence is growing!",
  "I love your energy! Let's keep practicing!"
];

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcription, setTranscription] = useState<{ user: string; model: string }>({ user: '', model: '' });
  const [latestFeedback, setLatestFeedback] = useState<CategorizedFeedback | null>(null);
  const [isLanding, setIsLanding] = useState<boolean>(true);
  const [isAvatarReacting, setIsAvatarReacting] = useState<boolean>(false);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentUserTextRef = useRef('');
  const currentModelTextRef = useRef('');

  const cleanupAudio = useCallback(() => {
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    scriptProcessorRef.current = null;
    nextStartTimeRef.current = 0;
  }, []);

  const resetConversation = () => {
    setMessages([]);
    setTranscription({ user: '', model: '' });
    setLatestFeedback(null);
    currentUserTextRef.current = '';
    currentModelTextRef.current = '';
  };

  const triggerEncouragement = async () => {
    if (isAvatarReacting) return;
    setIsAvatarReacting(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const text = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say warmly and cheerfully: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!outputAudioContextRef.current) {
          outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = outputAudioContextRef.current;
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
        source.onended = () => setIsAvatarReacting(false);
      } else {
        setIsAvatarReacting(false);
      }
    } catch (error) {
      console.error("Failed to trigger encouragement:", error);
      setIsAvatarReacting(false);
    }
  };

  const startSession = async () => {
    try {
      setIsLanding(false);
      setStatus(SessionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, 
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.ACTIVE);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (e) => {
              if (sessionPromiseRef.current) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createPcmBlob(inputData);
                sessionPromiseRef.current.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            
            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentUserTextRef.current += text;
              setTranscription(prev => ({ ...prev, user: currentUserTextRef.current }));
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentModelTextRef.current += text;
              setTranscription(prev => ({ ...prev, model: currentModelTextRef.current }));
              
              const fullModelText = currentModelTextRef.current;
              const grammarMatch = fullModelText.match(/\[Grammar\](.*?)(?=\[|$)/i);
              const pronunciationMatch = fullModelText.match(/\[Pronunciation\](.*?)(?=\[|$)/i);
              const naturalMatch = fullModelText.match(/\[Natural Phrasing\](.*?)(?=\[|$)/i);

              if (grammarMatch) {
                setLatestFeedback({ category: 'Grammar', text: grammarMatch[1].trim() });
              } else if (pronunciationMatch) {
                setLatestFeedback({ category: 'Pronunciation', text: pronunciationMatch[1].trim() });
              } else if (naturalMatch) {
                setLatestFeedback({ category: 'Natural Phrasing', text: naturalMatch[1].trim() });
              }
            }

            if (message.serverContent?.turnComplete) {
              const uText = currentUserTextRef.current;
              const mText = currentModelTextRef.current;
              
              if (uText || mText) {
                setMessages(prev => [
                  ...prev,
                  { id: Date.now().toString() + '-user', role: 'user', text: uText || "...", timestamp: new Date() },
                  { id: Date.now().toString() + '-model', role: 'model', text: mText || "...", timestamp: new Date() }
                ]);
              }
              
              currentUserTextRef.current = '';
              currentModelTextRef.current = '';
              setTranscription({ user: '', model: '' });
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => {
                try { s.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (err) => {
            console.error('Session error:', err);
            setStatus(SessionStatus.ERROR);
            cleanupAudio();
          },
          onclose: () => {
            setStatus(SessionStatus.IDLE);
            cleanupAudio();
          }
        }
      });
    } catch (err) {
      console.error('Failed to start session:', err);
      setStatus(SessionStatus.ERROR);
      cleanupAudio();
    }
  };

  const stopSession = () => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => session.close());
      sessionPromiseRef.current = null;
    }
    cleanupAudio();
    setStatus(SessionStatus.IDLE);
    setIsLanding(true);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, transcription]);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Grammar': return 'bg-orange-400 text-orange-950';
      case 'Pronunciation': return 'bg-cyan-400 text-cyan-950';
      case 'Natural Phrasing': return 'bg-emerald-400 text-emerald-950';
      default: return 'bg-white/20 text-white';
    }
  };

  if (isLanding) {
    return (
      <div className="min-h-screen bg-indigo-900 flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=2000')] bg-cover opacity-20"></div>
        <div className="relative z-10 max-w-4xl w-full bg-white rounded-[4rem] shadow-2xl flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in duration-700">
          <div className="md:w-1/2 relative min-h-[500px] h-auto overflow-hidden group">
            <img 
              src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=800" 
              className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
              alt="Teacher Sarah"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            <div className="absolute bottom-12 left-12 text-white drop-shadow-lg">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] mb-3 opacity-80">Native American Coach</p>
              <h2 className="text-5xl font-black tracking-tighter">Teacher Sarah</h2>
            </div>
          </div>
          <div className="md:w-1/2 p-12 md:p-20 flex flex-col justify-center space-y-10 bg-white">
            <div className="space-y-5">
              <h1 className="text-6xl font-black text-slate-900 leading-[1] tracking-tighter">
                Master English <br/>
                <span className="text-indigo-600">Instantly.</span>
              </h1>
              <p className="text-slate-500 font-semibold leading-relaxed text-lg max-w-md">
                Experience full immersion with a native coach. Get instant, categorized corrections as you speak.
              </p>
            </div>
            <div className="space-y-6">
               <button 
                onClick={startSession}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-6 rounded-[2rem] font-black text-xl shadow-2xl shadow-indigo-200 transition-all hover:translate-y-[-2px] active:translate-y-0 flex items-center justify-center space-x-4 group"
               >
                 <span>Start Private Lesson</span>
                 <svg className="w-6 h-6 transform group-hover:translate-x-2 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
               </button>
               <div className="flex items-center justify-center space-x-3 opacity-40">
                  <div className="h-px w-8 bg-slate-300"></div>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-[0.3em]">AI-Powered Real-time Engine</p>
                  <div className="h-px w-8 bg-slate-300"></div>
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-100">S</div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Teacher Sarah</h1>
            <p className="text-[10px] text-indigo-500 font-black uppercase tracking-[0.2em]">Live Immersion Hub</p>
          </div>
        </div>
        <div className="flex items-center space-x-4 md:space-x-6">
          <VoiceIndicator 
            status={status === SessionStatus.ACTIVE ? 'Sarah is Listening...' : (status === SessionStatus.CONNECTING ? 'Connecting...' : (status === SessionStatus.ERROR ? 'Session Error' : 'Idle'))} 
            isActive={status === SessionStatus.ACTIVE} 
          />
          <button 
            onClick={resetConversation}
            className="hidden md:flex bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 px-5 py-2 rounded-full text-[10px] font-black transition-all border border-slate-200 uppercase tracking-widest active:scale-95 items-center space-x-2"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>New Conversation</span>
          </button>
          <button 
            onClick={stopSession} 
            className="bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 px-6 py-2 rounded-full text-xs font-black transition-all border border-slate-200 uppercase tracking-widest active:scale-95"
          >
            End Lesson
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-6 md:p-10 flex flex-col space-y-8 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
          <div className="lg:col-span-7 flex flex-col space-y-6 min-h-0">
            <div className="bg-white rounded-[3rem] p-8 border border-slate-100 shadow-sm flex items-center space-x-8 transition-all hover:shadow-lg">
              <div className="relative flex-shrink-0">
                <button 
                  onClick={triggerEncouragement}
                  className={`relative w-32 h-32 md:w-48 md:h-48 rounded-[2.5rem] overflow-hidden border-4 border-white shadow-2xl bg-slate-50 group transition-all transform active:scale-95 focus:outline-none ${isAvatarReacting ? 'ring-4 ring-indigo-400 animate-pulse' : 'hover:ring-4 hover:ring-indigo-200'}`}
                >
                  <img 
                    src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=800" 
                    className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-110" 
                    alt="Sarah"
                  />
                  <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/10 transition-colors flex items-center justify-center">
                    <span className={`text-white text-3xl transition-opacity duration-300 ${isAvatarReacting ? 'opacity-100' : 'opacity-0'}`}>💖</span>
                  </div>
                </button>
                <div className={`absolute bottom-2 right-2 w-8 h-8 rounded-full border-4 border-white shadow-lg ${status === SessionStatus.ACTIVE ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
              </div>
              <div className="flex-1">
                <h3 className="text-3xl font-black text-slate-900 tracking-tighter mb-2">"Ask me anything! I'm here to help."</h3>
                <div className="flex space-x-2">
                  <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest italic">Lightning Fast</span>
                  <span className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Real-time Coach</span>
                </div>
              </div>
            </div>

            <div className="flex-1 bg-white rounded-[3rem] border border-slate-200/60 shadow-sm flex flex-col overflow-hidden">
              <div className="px-10 py-5 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Live Transcript</span>
                  <button onClick={resetConversation} className="md:hidden text-indigo-600 font-black text-[9px] uppercase tracking-widest">Reset Chat</button>
                </div>
                <div className="flex items-center space-x-1">
                   <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                   <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                   <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar bg-white min-h-[200px]">
                {messages.length === 0 && !transcription.user && (
                  <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
                    <div className="text-6xl grayscale">🎙️</div>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Speak to Sarah now...</p>
                  </div>
                )}
                
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-6 py-4 rounded-[2rem] text-[15px] leading-relaxed font-semibold transition-all shadow-sm ${
                      msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-slate-100 text-slate-700 rounded-tl-none border border-slate-200/40'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}

                {transcription.user && (
                  <div className="flex justify-end animate-in fade-in duration-300">
                    <div className="max-w-[85%] px-6 py-4 rounded-[2rem] text-[15px] bg-indigo-50 text-indigo-700 border border-indigo-100 italic rounded-tr-none shadow-sm">
                      {transcription.user}
                    </div>
                  </div>
                )}
                {transcription.model && (
                  <div className="flex justify-start animate-in fade-in duration-300">
                    <div className="max-w-[85%] px-6 py-4 rounded-[2rem] text-[15px] bg-slate-50 text-slate-500 border border-slate-100 italic rounded-tl-none shadow-sm">
                      {transcription.model}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col min-h-0">
             <div className="h-full bg-indigo-600 rounded-[4rem] shadow-2xl flex flex-col overflow-hidden text-white relative">
                <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                  <svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                </div>

                <div className="px-10 py-8 border-b border-white/10 flex items-center justify-between bg-black/5">
                   <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center">
                        <span className="text-xl">⚡</span>
                      </div>
                      <span className="text-[12px] font-black uppercase tracking-[0.25em]">Smart Correction Engine</span>
                   </div>
                   <div className="bg-white/10 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-white/20">LIVE</div>
                </div>

                <div className="flex-1 p-12 flex flex-col justify-center text-center space-y-10 overflow-hidden relative">
                   {latestFeedback ? (
                     <div className="space-y-6 animate-in zoom-in slide-in-from-bottom duration-500 max-h-full overflow-y-auto custom-scrollbar-white">
                        <div className={`inline-block px-5 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.15em] border border-white/10 shadow-xl ${getCategoryColor(latestFeedback.category)}`}>
                           {latestFeedback.category}
                        </div>
                        <p className="text-2xl md:text-3xl lg:text-4xl font-black leading-[1.2] tracking-tighter drop-shadow-md">
                           "{latestFeedback.text}"
                        </p>
                        <div className="pt-4 flex flex-col items-center space-y-4">
                           <p className="text-indigo-200 text-sm font-bold uppercase tracking-widest opacity-80">Instant Analysis</p>
                           <div className="w-16 h-1 bg-white/20 rounded-full"></div>
                        </div>
                     </div>
                   ) : (
                     <div className="space-y-8 opacity-40">
                        <div className="w-24 h-24 bg-white/10 rounded-full mx-auto flex items-center justify-center">
                           <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                        <p className="text-2xl font-black italic tracking-tight leading-relaxed text-balance">
                          Categorized tips for <br/>
                          Grammar, Sounds, and <br/>
                          Native Flow appear here.
                        </p>
                     </div>
                   )}
                </div>

                <div className="p-10 bg-black/10 border-t border-white/5 backdrop-blur-sm">
                   <div className="flex items-start space-x-5 text-indigo-50">
                      <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl">🧠</div>
                      <div className="space-y-1">
                         <h4 className="text-[10px] font-black uppercase tracking-widest text-white/60">AI Categorization</h4>
                         <p className="text-xs leading-relaxed font-bold">
                           Sarah sorts every tip to keep your learning fast and focused.
                         </p>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </main>

      <footer className="bg-white px-10 py-6 border-t border-slate-100 flex items-center justify-between text-slate-400 text-[9px] font-black uppercase tracking-[0.3em]">
         <div className="flex items-center space-x-6">
           <span className="flex items-center">
             <span className="w-2 h-2 bg-green-500 rounded-full mr-3 shadow-md"></span> 
             Categorized Correction v5.2
           </span>
           <span className="opacity-20 font-light">|</span>
           <span>Ultra-Fast Mode Active</span>
         </div>
         <div className="hidden md:block">Real-time Grammar & Phonetics Mastery</div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #F1F5F9;
          border-radius: 20px;
          border: 2px solid white;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #E2E8F0;
        }

        .custom-scrollbar-white::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar-white::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 20px;
        }
        .custom-scrollbar-white::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 20px;
        }
      `}</style>
    </div>
  );
};

export default App;
