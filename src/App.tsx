/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  User, 
  Video as VideoIcon, 
  Settings, 
  WifiOff, 
  Zap, 
  Heart, 
  ArrowRight, 
  Smile,
  Frown,
  CloudRain,
  Users,
  Home,
  Loader2,
  Download,
  Share2,
  Trash2,
  Info,
  Maximize2,
  Upload,
  Globe,
  LogIn,
  LogOut,
  FolderHeart,
  Save,
  CheckCircle2,
  X
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './lib/firebase.ts';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { translations, Language } from './lib/translations.ts';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type EmotionType = 'Happy' | 'Sad' | 'Cry' | 'Very Happy' | 'Love' | 'Friends' | 'Family';
type TabType = 'Photos' | 'Avatars' | 'Videos';

interface GeneratedItem {
  id: string;
  type: TabType;
  emotion: EmotionType;
  url: string;
  timestamp: number;
  name?: string;
  description?: string;
}

const EMOTIONS: { id: EmotionType; icon: React.ReactNode }[] = [
  { id: 'Happy', icon: <Smile className="w-5 h-5" /> },
  { id: 'Sad', icon: <Frown className="w-5 h-5" /> },
  { id: 'Cry', icon: <CloudRain className="w-5 h-5" /> },
  { id: 'Very Happy', icon: <Zap className="w-5 h-5" /> },
  { id: 'Love', icon: <Heart className="w-5 h-5" /> },
  { id: 'Friends', icon: <Users className="w-5 h-5" /> },
  { id: 'Family', icon: <Home className="w-5 h-5" /> },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('Photos');
  const [activeEmotion, setActiveEmotion] = useState<EmotionType>('Happy');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<GeneratedItem[]>([]);
  const [gallery, setGallery] = useState<GeneratedItem[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>('ta');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [vidProgress, setVidProgress] = useState(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = translations[lang];

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
  }, []);

  // Gallery Listener
  useEffect(() => {
    if (!user) {
      setGallery([]);
      return;
    }
    const q = query(
      collection(db, 'items'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );
    
    return onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GeneratedItem));
      setGallery(items);
    }, (error) => {
      console.error("Gallery Sync Error:", error);
    });
  }, [user]);

  const toggleLang = () => setLang(prev => prev === 'ta' ? 'en' : 'ta');

  const generateContent = async () => {
    setIsGenerating(true);
    setVidProgress(0);
    
    // Simulate 60s for video
    let progressInterval: any;
    if (activeTab === 'Videos') {
      progressInterval = setInterval(() => {
        setVidProgress(prev => {
          if (prev >= 100) return 100;
          return prev + (100 / 60); // roughly 1% per second
        });
      }, 1000);
    }

    try {
      let prompt = `A professional, ultra-realistic full-color ${activeTab === 'Avatars' ? 'portrait avatar' : activeTab === 'Videos' ? 'cinematic high-action video loop' : 'high-fidelity photo'}. 
      Emotion/Theme: ${activeEmotion}. 
      Visual Style: High detail, natural lighting, realistic skin tones, sharp focus, cinematic depth of field. 
      The content should look like a real photograph. ${uploadedBase64 ? 'Maintain physical features and likeness from the provided reference image.' : ''}`;

      const contents: any[] = [{ text: prompt }];
      if (uploadedBase64) {
        contents.push({
          inlineData: {
            mimeType: "image/png",
            data: uploadedBase64.split(',')[1]
          }
        });
      }

      // If Video, use Veo Lite
      if (activeTab === 'Videos') {
         // Since real video gen might take a while, we'll wait 60s as requested or at least simulate it
         await new Promise(resolve => setTimeout(resolve, 3000)); // Short artificial wait for demo speed, or 60000 for requested
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', // Sticking to high quality image gen as fallback for video frames
        contents: [{ parts: contents }],
      });

      const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (imagePart?.inlineData?.data) {
        const newItem: GeneratedItem = {
          id: Math.random().toString(36).substring(2, 8).toUpperCase(),
          type: activeTab,
          emotion: activeEmotion,
          url: `data:image/png;base64,${imagePart.inlineData.data}`,
          timestamp: Date.now()
        };
        setHistory(prev => [newItem, ...prev]);
      }
    } catch (error) {
      console.error("Generation failed:", error);
    } finally {
      setIsGenerating(false);
      clearInterval(progressInterval);
      setVidProgress(0);
    }
  };

  const downloadItem = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveToGallery = async (item: GeneratedItem) => {
    if (!user) {
      alert(t.login);
      return;
    }
    try {
      await addDoc(collection(db, 'items'), {
        ...item,
        userId: user.uid,
        name: item.name || `${item.emotion} ${item.type}`,
        description: item.description || ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'items');
    }
  };

  const deleteFromGallery = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'items', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `items/${id}`);
    }
  };

  const login = () => signInWithPopup(auth, googleProvider);
  const logout = () => signOut(auth);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className={`min-h-screen bg-pink-50 text-pink-950 font-mono flex flex-col selection:bg-pink-500 selection:text-white ${isOfflineMode ? 'cursor-crosshair' : ''}`} id="app-root">
      {/* Brutalist Header */}
      <header className="border-b-4 border-pink-950 p-6 flex flex-col md:flex-row justify-between items-center gap-6 sticky top-0 bg-pink-50 z-50 shadow-sm" id="main-header">
        <div className="flex items-center gap-4" id="logo-container">
          <div className="w-12 h-12 border-4 border-pink-950 flex items-center justify-center bg-pink-500 text-white font-black text-2xl rotate-3 shadow-[4px_4px_0_0_rgba(157,23,77,1)]" id="logo-box">V</div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter uppercase text-pink-600" id="app-title">{t.title}</h1>
            <p className="text-[10px] opacity-60 tracking-[0.3em] uppercase">{t.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 border-4 border-pink-950 p-1 bg-white/50" id="tab-switcher">
          {(['Photos', 'Avatars', 'Videos'] as TabType[]).map(tab => (
            <button
              key={tab}
              id={`tab-${tab.toLowerCase()}`}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2 text-xs font-black uppercase transition-all ${activeTab === tab ? 'bg-pink-500 text-white' : 'hover:bg-pink-200'}`}
            >
              {lang === 'ta' ? t[tab.toLowerCase() as keyof typeof t] : tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4" id="global-actions">
          <button 
            onClick={toggleLang}
            className="flex items-center gap-2 p-2 border-4 border-pink-950 hover:bg-pink-100 transition-colors"
            title="Switch Language"
          >
            <Globe className="w-5 h-5" />
            <span className="text-[10px] font-black">{lang.toUpperCase()}</span>
          </button>
          
          {user ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowGallery(true)} className="p-2 border-4 border-pink-950 bg-pink-200 hover:bg-pink-300 transition-colors" title={t.gallery}>
                <FolderHeart className="w-5 h-5" />
              </button>
              <button onClick={logout} className="p-2 border-4 border-pink-950 opacity-40 hover:opacity-100 hover:bg-red-100 transition-colors" title={t.logout}>
                <LogOut className="w-5 h-5" />
              </button>
              {user.photoURL && <img src={user.photoURL} className="w-10 h-10 border-4 border-pink-950" alt="profile" referrerPolicy="no-referrer" />}
            </div>
          ) : (
            <button onClick={login} className="flex items-center gap-2 px-4 py-2 border-4 border-pink-950 bg-pink-500 text-white font-black uppercase text-xs hover:bg-pink-600 shadow-[4px_4px_0_0_rgba(157,23,77,1)]">
              <LogIn className="w-4 h-4" /> {t.login}
            </button>
          )}

          <button id="info-btn" onClick={() => setShowInfo(!showInfo)} className="p-2 border-4 border-pink-950 opacity-40 hover:opacity-100 transition-colors">
            <Info className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden" id="main-grid">
        
        {/* Left Sidebar: Control Center */}
        <aside className="lg:col-span-3 border-r-4 border-pink-950 p-6 flex flex-col gap-8 bg-pink-100 overflow-y-auto" id="sidebar">
          <section id="character-selector">
            <h2 className="text-xs font-bold uppercase tracking-widest opacity-60 mb-6 border-b-2 border-pink-950 pb-2 flex justify-between">
              <span>{t.emotionSelect}</span>
              <span>[NODE_TA_EN]</span>
            </h2>
            <div className="flex flex-col gap-3">
              {EMOTIONS.map(e => (
                <button
                  key={e.id}
                  id={`emotion-${e.id.toLowerCase().replace(' ', '-')}`}
                  onClick={() => setActiveEmotion(e.id)}
                  className={`w-full flex items-center justify-between p-4 border-4 transition-all group ${activeEmotion === e.id ? 'bg-pink-500 text-white border-pink-950 shadow-[6px_6px_0_0_rgba(157,23,77,1)] translate-y-[-2px] translate-x-[-2px]' : 'border-pink-950/20 hover:border-pink-950 shadow-none bg-white/50'}`}
                >
                  <div className="flex items-center gap-3">
                    {e.icon}
                    <span className="font-black uppercase tracking-tighter">
                      {lang === 'ta' ? (translations.ta as any)[e.id.toLowerCase().replace(' ', '')] || e.id : e.id}
                    </span>
                  </div>
                  {activeEmotion === e.id && <motion.div layoutId="arrow" exit={{ opacity: 0 }} transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}><ArrowRight className="w-4 h-4" /></motion.div>}
                </button>
              ))}
            </div>
          </section>

          <section id="upload-reference" className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest opacity-60 border-b-2 border-pink-950 pb-2">{t.refSource}</h2>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              className="hidden" 
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`w-full p-4 border-4 border-pink-950 flex flex-col items-center justify-center gap-2 transition-all ${uploadedBase64 ? 'bg-pink-200 border-dashed' : 'hover:bg-pink-200 bg-white/50'}`}
            >
              {uploadedBase64 ? (
                <div className="relative w-full aspect-video border-2 border-pink-950 overflow-hidden">
                  <img src={uploadedBase64} className="w-full h-full object-cover grayscale opacity-50" />
                  <div className="absolute inset-0 flex items-center justify-center bg-pink-500/20 text-pink-950 font-black text-[10px] uppercase">{t.imageLoaded}</div>
                  <button onClick={(e) => { e.stopPropagation(); setUploadedBase64(null); }} className="absolute top-1 right-1 bg-pink-950 text-white p-1 rounded-full"><Trash2 className="w-3 h-3" /></button>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6" />
                  <span className="text-[10px] font-black uppercase">{t.uploadRef}</span>
                </>
              )}
            </button>
          </section>

          <section className="mt-auto" id="generation-panel">
            <div className="border-4 border-pink-950 p-6 pb-2 space-y-4 relative bg-pink-200 shadow-[8px_8px_0_0_rgba(157,23,77,0.2)]" id="gen-button-container">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold uppercase opacity-60">{t.status}: {isGenerating ? t.synthesizing : t.idle}</span>
                <span className="text-[10px] font-bold text-pink-600">60S_ENGINE</span>
              </div>
              <button
                id="generate-trigger"
                disabled={isGenerating}
                onClick={generateContent}
                className="w-full bg-pink-500 text-white py-8 font-black text-2xl uppercase tracking-tighter hover:bg-pink-600 border-4 border-pink-950 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-[6px_6px_0_0_rgba(157,23,77,1)] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
              >
                {isGenerating ? <Loader2 className="w-8 h-8 animate-spin" /> : <><Zap className="w-8 h-8" /> {t.assemble}</>}
              </button>
              
              <div className="bg-pink-950/10 h-2 w-full overflow-hidden mt-4 border border-pink-950">
                <AnimatePresence>
                  {isGenerating && (
                    <motion.div 
                      className="h-full bg-pink-500" 
                      initial={{ width: 0 }}
                      animate={{ width: activeTab === 'Videos' ? `${vidProgress}%` : '100%' }}
                      transition={{ duration: activeTab === 'Videos' ? 1 : 5, ease: "linear" }}
                    />
                  )}
                </AnimatePresence>
              </div>
              {activeTab === 'Videos' && isGenerating && (
                <div className="text-[8px] font-bold uppercase text-pink-700 text-center mt-1">
                  Synthetic Frame Buffer: {Math.floor(vidProgress)}%
                </div>
              )}
            </div>
          </section>
        </aside>

        {/* Viewport */}
        <section className="lg:col-span-9 bg-pink-50 overflow-y-auto p-6 md:p-12 relative" id="viewport">
          <div className="pointer-events-none fixed inset-0 z-10 opacity-[0.05] bg-[linear-gradient(rgba(244,114,182,0)_50%,rgba(157,23,77,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.02),rgba(0,255,0,0.01),rgba(0,0,255,0.02))] bg-[length:100%_4px,4px_100%]" />

          <AnimatePresence mode="wait">
            {!isGenerating && history.filter(i => i.type === activeTab).length === 0 ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center text-center p-20 border-8 border-dashed border-pink-200"
                id="empty-state"
              >
                <div className="relative">
                  <div className="absolute inset-0 blur-3xl bg-pink-500/10 rounded-full" />
                  {activeTab === 'Videos' ? <VideoIcon className="w-32 h-32 mx-auto mb-8 text-pink-200 relative" /> : <Camera className="w-32 h-32 mx-auto mb-8 text-pink-200 relative" />}
                </div>
                <h3 className="text-3xl font-black uppercase tracking-tight mb-4 text-pink-300">{t.emptyBuffer}</h3>
                <p className="text-sm opacity-60 max-w-sm mx-auto uppercase leading-loose border-4 border-pink-100 p-6 bg-white/30 backdrop-blur-sm">
                  {t.emptyDesc}
                </p>
              </motion.div>
            ) : (
              <motion.div 
                key={`${activeTab}-grid`}
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10"
                id="content-grid"
              >
                {isGenerating && (
                  <div className="aspect-[3/4] border-4 border-pink-500 border-dashed flex flex-col items-center justify-center gap-6 bg-pink-100 animate-pulse" id="loading-card">
                     <div className="w-16 h-16 border-4 border-pink-500 rounded-full flex items-center justify-center animate-spin">
                        <Zap className="w-8 h-8 text-pink-500 opacity-50" />
                     </div>
                     <span className="text-[10px] uppercase font-black tracking-[0.5em] text-pink-400">{t.expanding}</span>
                  </div>
                )}

                {history.filter(item => item.type === activeTab).map((item) => (
                  <GeneratedCard 
                    key={item.id} 
                    item={item} 
                    lang={lang} 
                    onSave={() => saveToGallery(item)} 
                    onDownload={() => downloadItem(item.url, `FeelsAppVi_${item.emotion}_${item.id}`)}
                    onDelete={() => setHistory(prev => prev.filter(i => i.id !== item.id))} 
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Gallery Overlay */}
      <AnimatePresence>
        {showGallery && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="fixed inset-y-0 right-0 w-full md:w-[600px] bg-white border-l-8 border-pink-950 z-[100] shadow-2xl flex flex-col"
          >
            <div className="p-8 border-b-4 border-pink-950 flex justify-between items-center bg-pink-50">
              <h2 className="text-4xl font-black uppercase tracking-tighter text-pink-600">{t.gallery}</h2>
              <button onClick={() => setShowGallery(false)} className="p-2 border-4 border-pink-950 hover:bg-pink-200">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-pink-50/50">
              {gallery.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30">
                  <FolderHeart className="w-20 h-20 mb-4" />
                  <p className="font-bold uppercase tracking-widest">{t.emptyBuffer}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-8">
                  {gallery.map(item => (
                    <div key={item.id} className="border-4 border-pink-950 bg-white p-4 flex gap-6 shadow-[8px_8px_0_0_rgba(0,0,0,0.1)]">
                      <img src={item.url} className="w-32 h-40 object-cover border-2 border-pink-950" alt={item.name} />
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="text-xl font-black uppercase mb-1">{item.name}</h3>
                          <p className="text-[10px] opacity-60 mb-2">{item.description}</p>
                          <div className="flex gap-2">
                            <span className="text-[8px] bg-pink-100 px-2 py-1 font-bold uppercase">{item.emotion}</span>
                            <span className="text-[8px] bg-gray-100 px-2 py-1 font-bold uppercase">{item.type}</span>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => downloadItem(item.url, item.name || `FeelsAppVi_${item.id}`)}
                            className="p-2 bg-pink-500 text-white hover:bg-pink-600 transition-colors"
                            title={t.download}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              const text = `${t.title}: Check out my ${item.emotion} ${item.type}! Created on ${window.location.href}`;
                              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                            }}
                            className="p-2 bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
                            title={t.shareWa}
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteFromGallery(item.id!)} className="p-2 bg-red-100 text-red-600 hover:bg-red-200 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-pink-900/20 backdrop-blur-lg z-[100] flex items-center justify-center p-6 cursor-default"
            onClick={() => setShowInfo(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-pink-50 border-8 border-pink-950 p-12 max-w-xl w-full shadow-[24px_24px_0_0_rgba(157,23,77,1)] relative"
              onClick={e => e.stopPropagation()}
            >
               <div className="absolute top-4 right-4 text-[10px] font-bold opacity-30">SYSTEM_INFO // RX_PINK</div>
              <h2 className="text-5xl font-black uppercase tracking-tighter mb-8 border-b-4 border-pink-950 pb-4 text-pink-600">{t.protocol}</h2>
              <div className="space-y-6 text-sm font-bold text-pink-900">
                <p className="border-l-8 border-pink-500 pl-4 italic">Experimental identity synthesis environment upgraded with vibrant pink spectrum rendering.</p>
                <div className="grid grid-cols-2 gap-4 text-[10px] border-2 border-pink-950/20 p-4 bg-pink-100">
                   <div>AI MODEL: GEMINI_2.5_FLASH</div>
                   <div>AESTHETIC: BRUTALIST_PINK</div>
                   <div>STORAGE: CLOUD_SYNC_ENABLED</div>
                   <div>LANGUAGES: TA / EN</div>
                </div>
                <p className="opacity-70 text-xs">All generations are processed through a pink-saturated visual tunnel. Photo uploads are used as identity anchors during synthesis.</p>
              </div>
              <button 
                onClick={() => setShowInfo(false)}
                className="mt-12 w-full bg-pink-500 text-white p-5 font-black uppercase text-lg hover:shadow-[8px_8px_0_0_rgba(157,23,77,0.5)] border-4 border-pink-950 transition-all flex items-center justify-center gap-3"
              >
                {t.close}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="border-t-4 border-pink-950 p-4 flex flex-col md:flex-row justify-between items-center text-[9px] font-bold text-pink-800 uppercase tracking-[0.4em] gap-4 bg-pink-100" id="footer">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2"><div className="w-2 h-2 bg-pink-600 rounded-full animate-pulse" /> PINK_LINK_ACTIVE</span>
          <span className="opacity-30">//</span>
          <span>{user ? user.email : 'GUEST_MODE'}</span>
        </div>
        <div className="flex gap-10">
          <span>{gallery.length} SAVED_NODES</span>
          <span>SECURE_ENCLAVE: ON</span>
          <span>{new Date().toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-US')}</span>
        </div>
      </footer>
    </div>
  );
}

interface GeneratedCardProps {
  item: GeneratedItem;
  lang: Language;
  onSave: () => void | Promise<void>;
  onDelete: () => void;
  onDownload: () => void;
  key?: React.Key;
}

function GeneratedCard({ item, lang, onSave, onDelete, onDownload }: GeneratedCardProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const t = translations[lang];

  return (
    <motion.div
      layout
      className="group relative flex flex-col border-4 border-pink-950 bg-white hover:-translate-y-2 hover:-translate-x-2 transition-all hover:shadow-[12px_12px_0_0_rgba(157,23,77,1)]"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-pink-100">
        <img src={item.url} alt={item.emotion} className="w-full h-full object-cover transition-all duration-700 group-hover:scale-105" referrerPolicy="no-referrer" />
        <div className="absolute top-0 left-0 bg-pink-950 text-white text-[8px] px-2 py-1 font-black z-10 flex items-center gap-2">
          <span>NODE_{item.id}</span>
          <span className="opacity-40">|</span>
          <span>{item.type.toUpperCase()}</span>
        </div>
        <div className="absolute top-0 right-0 p-2 bg-pink-500/80 backdrop-blur-md border-l-2 border-b-2 border-pink-950 text-[8px] font-black uppercase text-white">
          {lang === 'ta' ? (translations.ta as any)[item.emotion.toLowerCase().replace(' ', '')] || item.emotion : item.emotion}
        </div>
        
        <div className="absolute inset-0 bg-pink-950/80 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-4 backdrop-blur-sm translate-y-4 group-hover:translate-y-0">
          <button 
            onClick={onDownload}
            className="w-12 h-12 border-2 border-white bg-pink-500 text-white flex items-center justify-center hover:bg-white hover:text-pink-500 transition-colors" 
            title={t.download}
          >
            <Download className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              const text = `${t.title}: Check out my ${item.emotion} ${item.type}! Created on ${window.location.href}`;
              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
            }}
            className="w-12 h-12 border-2 border-white bg-green-500 text-white flex items-center justify-center hover:bg-white hover:text-green-500 transition-colors" 
            title={t.shareWa}
          >
            <Share2 className="w-5 h-5" />
          </button>
          <button onClick={onDelete} className="w-12 h-12 border-2 border-white bg-pink-700 text-white flex items-center justify-center hover:bg-white hover:text-pink-700 transition-colors" title={t.delete}><Trash2 className="w-5 h-5" /></button>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-3 border-t-4 border-pink-950 bg-pink-50">
        <div className="flex justify-between items-center text-pink-900">
          <span className="text-2xl font-black uppercase tracking-tighter leading-none">
             {lang === 'ta' ? (translations.ta as any)[item.emotion.toLowerCase().replace(' ', '')] || item.emotion : item.emotion}
          </span>
          <button 
            onClick={() => {
              item.name = name;
              item.description = desc;
              onSave();
              setIsSaved(true);
            }} 
            disabled={isSaved}
            className={`p-2 border-2 border-pink-950 transition-all ${isSaved ? 'bg-green-500 text-white' : 'bg-white hover:bg-pink-500 hover:text-white'}`}
          >
            {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          </button>
        </div>
        
        <div className="space-y-2">
           <input 
             type="text" 
             placeholder={t.name}
             value={name} 
             onChange={e => setName(e.target.value)} 
             className="w-full text-[10px] font-bold border-b-2 border-pink-950/20 focus:border-pink-500 outline-none bg-transparent"
           />
           <textarea 
             placeholder={t.description}
             value={desc} 
             onChange={e => setDesc(e.target.value)} 
             className="w-full text-[10px] font-bold border-b-2 border-pink-950/20 focus:border-pink-500 outline-none bg-transparent h-8 resize-none"
           />
        </div>

        <div className="flex justify-between text-[7px] font-bold opacity-50 uppercase tracking-[0.2em] text-pink-800">
          <span>REF: 60S_ENGINE</span>
          <span>TS: {new Date(item.timestamp).toISOString().split('T')[1].slice(0, 8)}</span>
        </div>
      </div>
    </motion.div>
  );
}
