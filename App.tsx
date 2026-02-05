
import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, Upload, FileText, AlertCircle, CheckCircle, Zap, 
  Copy, Mail, Search, Trash2, Lock, Camera, X, BarChart3, 
  BookOpen, ShieldCheck, ChevronRight, Info, ImageIcon,
  Mic, MicOff, Volume2, Loader2
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { redactText } from './utils/redactor';
import { analyzeContract } from './services/geminiService';
import { SAMPLE_CONTRACTS } from './constants';
import { ContractAnalysis, RedactionResult } from './types';

// Audio Encoding & Decoding Utilities
function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  // UI State
  const [activeTab, setActiveTab] = useState<'clauses' | 'flags' | 'negotiation' | 'privacy' | 'performance'>('clauses');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  
  // Voice State
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string>('Ready');
  const [isResponding, setIsResponding] = useState(false);
  
  // Data State
  const [inputText, setInputText] = useState('');
  const [redactedData, setRedactedData] = useState<RedactionResult | null>(null);
  const [analysis, setAnalysis] = useState<ContractAnalysis | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [scannedImages, setScannedImages] = useState<string[]>([]);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  // Live API Refs
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    if (inputText) {
      setRedactedData(redactText(inputText));
    } else {
      setRedactedData(null);
    }
  }, [inputText]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      // @ts-ignore
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(" ") + "\n";
      }
      setInputText(text);
    } else if (file.type.includes('word') || file.name.endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer();
      // @ts-ignore
      const result = await window.mammoth.extractRawText({ arrayBuffer });
      setInputText(result.value);
    } else {
      const text = await file.text();
      setInputText(text);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = (e.target?.result as string).split(',')[1];
      setScannedImages(prev => [...prev, b64]);
    };
    reader.readAsDataURL(file);
  };

  const startScanner = async () => {
    setShowScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera access denied.");
      setShowScanner(false);
    }
  };

  const stopScanner = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setShowScanner(false);
  };

  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context?.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvasRef.current.toDataURL('image/jpeg');
      setScannedImages(prev => [...prev, dataUrl.split(',')[1]]);
    }
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const textToAnalyze = redactedData?.redactedText || inputText;
      const result = await analyzeContract(textToAnalyze, scannedImages);
      setAnalysis(result.data);
      setLatency(result.latency);
      setActiveTab('clauses');
    } catch (err: any) {
      alert(err.message || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleVoice = async () => {
    if (isVoiceActive) {
      sessionRef.current?.close();
      audioContextRef.current?.input.close();
      audioContextRef.current?.output.close();
      setIsVoiceActive(false);
      setIsResponding(false);
      setVoiceStatus('Ready');
      return;
    }

    if (!analysis) {
      alert("Please run an AI audit first to give the Guardian context.");
      return;
    }

    setIsConnecting(true);
    setVoiceStatus('Connecting...');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      await inputCtx.resume();
      await outputCtx.resume();
      
      audioContextRef.current = { input: inputCtx, output: outputCtx };

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setVoiceStatus('Listening...');
            setIsConnecting(false);
            setIsVoiceActive(true);
            
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const parts = message.serverContent?.modelTurn?.parts || [];
            if (parts.length > 0) setIsResponding(true);
            
            for (const part of parts) {
              const base64Audio = part.inlineData?.data;
              if (base64Audio) {
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputCtx.destination);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) setIsResponding(false);
                };
              }
            }
            
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsResponding(false);
            }
          },
          onclose: () => {
            setIsVoiceActive(false);
            setIsResponding(false);
            setVoiceStatus('Ready');
          },
          onerror: (e) => {
            console.error("Voice Error:", e);
            setIsVoiceActive(false);
            setIsConnecting(false);
            setVoiceStatus('Error');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          systemInstruction: `You are the "Contract Guardian". The user has analyzed a ${analysis.contract_type}. 
          Summary: ${analysis.summary}. Risk Score: ${analysis.overall_risk_score}/10. 
          Context of Red Flags: ${analysis.red_flags.map(f => f.category + " (" + f.severity + ")").join(', ')}.
          
          YOUR RULES:
          1. Answer any question about this document.
          2. YOU MUST SPEAK ONLY IN URDU (اردو).
          3. Use professional legal Urdu but explain simply.
          4. If asked to repeat, repeat the last point clearly.
          5. Stay focused on the contract content.`
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start voice:", err);
      setIsConnecting(false);
      setVoiceStatus('Error');
    }
  };

  const generateEmailDraft = () => {
    if (!analysis) return "";
    const items = analysis.red_flags.map((f, i) => `[${i+1}] ${f.category}\nIssue: ${f.plain_english}\nRequested Change: ${f.suggested_alternative}`).join('\n\n');
    return `Subject: Proposal for ${analysis.contract_type}\n\nHi [Name],\n\nI've reviewed the agreement and have some proposed adjustments to ensure clarity:\n\n${items}\n\nBest regards,\n[Your Name]`;
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="p-4 border-b border-slate-800 bg-[#020617]/80 backdrop-blur-md flex items-center justify-between z-40">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-xl shadow-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-black tracking-tighter uppercase">CONTRACT GUARDIAN</h1>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Input Sidebar */}
        <aside className="w-[380px] border-r border-slate-800 p-6 flex flex-col gap-6 bg-[#020617]/30 overflow-y-auto">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Upload Contract</label>
              <button onClick={() => { setInputText(''); setAnalysis(null); setScannedImages([]); }} className="text-[10px] font-bold text-slate-600 hover:text-red-400 uppercase flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Reset
              </button>
            </div>
            
            <select onChange={(e) => setInputText(SAMPLE_CONTRACTS[e.target.value] || '')} className="w-full bg-slate-900 border border-slate-800 text-xs rounded-xl p-3 text-slate-300 outline-none">
              <option value="">Choose Sample Template</option>
              {Object.keys(SAMPLE_CONTRACTS).map(k => <option key={k} value={k}>{k}</option>)}
            </select>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded-2xl border border-slate-800 transition-all">
                <FileText className="w-5 h-5" />
                <span className="text-[9px] font-black uppercase">Docs</span>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf,.doc,.docx,.txt" className="hidden" />
              </button>
              <button onClick={() => imageInputRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded-2xl border border-slate-800 transition-all">
                <ImageIcon className="w-5 h-5" />
                <span className="text-[9px] font-black uppercase">Image</span>
                <input type="file" ref={imageInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
              </button>
              <button onClick={startScanner} className="flex flex-col items-center justify-center gap-2 p-4 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded-2xl border border-slate-800 transition-all">
                <Camera className="w-5 h-5" />
                <span className="text-[9px] font-black uppercase">Scan</span>
              </button>
            </div>

            {scannedImages.length > 0 && (
              <div className="flex gap-2 overflow-x-auto p-2 bg-slate-900 rounded-xl border border-slate-800">
                {scannedImages.map((img, i) => (
                  <div key={i} className="relative w-14 h-18 rounded-lg overflow-hidden shrink-0 border border-slate-700">
                    <img src={`data:image/jpeg;base64,${img}`} className="w-full h-full object-cover" />
                    <button onClick={() => setScannedImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-bl-lg"><X className="w-2 h-2" /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3 pt-2">
              <button onClick={runAnalysis} disabled={isAnalyzing || (!inputText && scannedImages.length === 0)} className="w-full py-5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-2xl font-black text-sm shadow-xl disabled:opacity-30 flex items-center justify-center gap-3 transition-all">
                {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Zap className="w-5 h-5 fill-white" /> <span>START AUDIT</span></>}
              </button>

              <button 
                onClick={toggleVoice}
                disabled={isConnecting || !analysis}
                className={`w-full py-4 rounded-2xl font-black text-sm border flex flex-col items-center justify-center gap-1 transition-all ${!analysis ? 'opacity-30 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-600' : isVoiceActive ? 'bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white shadow-lg'}`}
              >
                <div className="flex items-center gap-3">
                  {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : isVoiceActive ? <Mic className="w-4 h-4 animate-pulse" /> : <MicOff className="w-4 h-4" />}
                  <span>{isVoiceActive ? 'STOP RECORDING' : 'ASK ANY QUESTION'}</span>
                </div>
                {isResponding && <span className="text-[8px] text-red-400 animate-pulse tracking-widest uppercase mt-1">Guardian is responding...</span>}
              </button>
              
              {isVoiceActive && !isResponding && (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex gap-1 h-3 items-end">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="w-0.5 bg-red-500 rounded-full animate-bounce" style={{ height: `${Math.random() * 100}%`, animationDuration: `${0.5 + Math.random()}s` }} />
                    ))}
                  </div>
                  <p className="text-[10px] text-center font-black text-red-500 uppercase tracking-widest">
                     Listening... Ask in Urdu
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Right Output Area */}
        <main className="flex-1 flex flex-col bg-[#020617]">
          {/* Nav */}
          <nav className="flex gap-8 px-8 pt-6 border-b border-slate-900 bg-[#020617]/50">
            {[
              { id: 'clauses', label: 'Explanations', icon: BookOpen },
              { id: 'flags', label: 'Red Flags', icon: AlertCircle },
              { id: 'negotiation', label: 'Negotiation', icon: Mail },
              { id: 'privacy', label: 'Privacy', icon: Lock },
              { id: 'performance', label: 'Metrics', icon: BarChart3 }
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-2 pb-4 text-xs font-black transition-all relative ${activeTab === tab.id ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>
                <tab.icon className="w-3.5 h-3.5" />
                <span className="uppercase tracking-widest">{tab.label}</span>
                {activeTab === tab.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-indigo-500 shadow-[0_0_15px_#6366f1]" />}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            {!analysis && !isAnalyzing ? (
              <div className="h-full flex flex-col items-center justify-center opacity-20">
                <Shield className="w-16 h-16 mb-4" />
                <p className="text-sm font-black uppercase tracking-widest">Waiting for Document Analysis</p>
              </div>
            ) : isAnalyzing ? (
              <div className="space-y-12 animate-pulse">
                <div className="h-8 bg-slate-900 rounded-xl w-1/4" />
                <div className="grid grid-cols-2 gap-8"><div className="h-64 bg-slate-900 rounded-3xl" /><div className="h-64 bg-slate-900 rounded-3xl" /></div>
              </div>
            ) : (
              <div className="animate-in fade-in duration-700">
                {activeTab === 'clauses' && (
                  <div className="space-y-10">
                    <div className="space-y-2">
                       <h2 className="text-3xl font-black uppercase tracking-tight">{analysis?.contract_type} Report</h2>
                       <p className="text-slate-400 text-sm max-w-2xl">{analysis?.summary}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-6">
                      {analysis?.clause_explanations?.map((exp, i) => (
                        <div key={i} className="p-8 rounded-[40px] bg-slate-900/40 border border-slate-800 space-y-6">
                           <div className="flex justify-between items-center">
                              <h4 className="text-xl font-bold">{exp.section_title}</h4>
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black border uppercase ${exp.risk_level === 'High' ? 'text-red-400 border-red-500/20' : exp.risk_level === 'Medium' ? 'text-amber-400 border-amber-500/20' : 'text-emerald-400 border-emerald-500/20'}`}>{exp.risk_level} Risk</span>
                           </div>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <div className="text-xs font-mono text-slate-500 bg-black/40 p-6 rounded-3xl border border-slate-900 max-h-40 overflow-y-auto">{exp.original_text}</div>
                              <div className="space-y-4">
                                 <p className="text-sm text-slate-200 leading-relaxed font-medium">"{exp.plain_english}"</p>
                                 <div className="flex gap-2 items-start opacity-60"><Info className="w-4 h-4 mt-0.5 shrink-0" /><p className="text-xs italic">{exp.why_it_matters}</p></div>
                              </div>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'flags' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {analysis?.red_flags.map((flag) => (
                      <div key={flag.id} className="p-8 rounded-[48px] bg-red-500/5 border border-red-500/10 space-y-6">
                        <div className="flex justify-between items-start">
                           <h4 className="text-lg font-black uppercase">{flag.category}</h4>
                           <span className="text-[10px] font-black px-3 py-1 rounded-lg bg-red-500/20 text-red-500 uppercase">{flag.severity}</span>
                        </div>
                        <p className="text-sm text-slate-300">{flag.why_risky}</p>
                        <div className="p-5 bg-slate-950/80 rounded-[32px] border border-slate-800">
                           <p className="text-[10px] font-black text-emerald-400 uppercase mb-2">Suggested Replacement</p>
                           <p className="text-xs font-mono text-slate-400 italic">"{flag.suggested_alternative}"</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'negotiation' && (
                  <div className="max-w-4xl space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {analysis?.action_items.map((item, i) => (
                        <div key={i} className="p-6 rounded-3xl bg-indigo-500/5 border border-indigo-500/10 flex gap-4 items-center">
                          <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-[11px] font-black text-indigo-400">{i+1}</div>
                          <p className="text-xs text-slate-300 font-medium">{item}</p>
                        </div>
                      ))}
                    </div>
                    <div className="p-10 rounded-[48px] bg-slate-900/40 border border-slate-800 space-y-6">
                       <div className="flex justify-between items-center">
                          <h3 className="text-lg font-black uppercase tracking-tight">Email Template</h3>
                          <button onClick={() => { navigator.clipboard.writeText(generateEmailDraft()); alert("Copied!"); }} className="px-6 py-3 bg-indigo-600 rounded-2xl text-[10px] font-black uppercase shadow-lg hover:bg-indigo-500 transition-all">Copy Draft</button>
                       </div>
                       <div className="bg-black/50 p-8 rounded-[32px] font-mono text-[13px] text-slate-400 leading-relaxed whitespace-pre-wrap">{generateEmailDraft()}</div>
                    </div>
                  </div>
                )}

                {activeTab === 'privacy' && (
                   <div className="grid grid-cols-2 gap-8 h-[600px]">
                      <div className="flex flex-col gap-4">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Your Private Doc</span>
                        <div className="flex-1 bg-slate-950 rounded-[32px] p-8 font-mono text-[11px] text-slate-600 overflow-y-auto">{inputText}</div>
                      </div>
                      <div className="flex flex-col gap-4">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Anonymized Doc (Sent to AI)</span>
                        <div className="flex-1 bg-slate-900/50 rounded-[32px] p-8 font-mono text-[11px] text-slate-300 overflow-y-auto">
                          {redactedData?.redactedText.split(/(\[.*?\])/).map((p, i) => p.startsWith('[') ? <span key={i} className="text-indigo-400 font-bold">{p}</span> : p)}
                        </div>
                      </div>
                   </div>
                )}

                {activeTab === 'performance' && (
                  <div className="grid grid-cols-3 gap-8">
                    <div className="p-10 rounded-[40px] bg-slate-900/50 border border-slate-800 text-center space-y-4">
                       <Zap className="w-8 h-8 text-indigo-400 mx-auto" />
                       <p className="text-4xl font-black">{latency}ms</p>
                       <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Latency</p>
                    </div>
                    <div className="p-10 rounded-[40px] bg-slate-900/50 border border-slate-800 text-center space-y-4">
                       <ShieldCheck className="w-8 h-8 text-violet-400 mx-auto" />
                       <p className="text-xl font-black">Local Regex</p>
                       <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Privacy Engine</p>
                    </div>
                    <div className="p-10 rounded-[40px] bg-slate-900/50 border border-slate-800 text-center space-y-4">
                       <Volume2 className="w-8 h-8 text-emerald-400 mx-auto" />
                       <p className="text-xl font-black">Urdu Link</p>
                       <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Guardian Voice</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Scanner */}
      {showScanner && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-xl">
          <div className="relative w-full max-w-2xl bg-slate-900 rounded-[48px] overflow-hidden border-8 border-slate-800">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            <button onClick={stopScanner} className="absolute top-10 right-10 p-4 bg-black/60 rounded-full text-white"><X className="w-6 h-6" /></button>
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-6">
              <button onClick={captureFrame} className="w-20 h-20 bg-white rounded-full border-[8px] border-white/20" />
              <p className="text-[10px] font-black uppercase text-white tracking-widest">{scannedImages.length} Ready &bull; <span onClick={stopScanner} className="cursor-pointer underline">Finish</span></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
