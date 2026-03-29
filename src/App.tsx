import React, { Component, useState, useEffect, useRef, ErrorInfo, ReactNode } from 'react';
import { Search, Globe, Cpu, Shield, Zap, MessageSquare, ChevronRight, Menu, X, Terminal, Globe2, Ghost, LogIn, LogOut, Settings, Key, User as UserIcon, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { askGemini, askChatGPT, askClaude } from './lib/ai';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc, onSnapshot, collection, getDocs } from './firebase';
import { User } from 'firebase/auth';
import { serverTimestamp, Timestamp, getDocFromServer } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<any, any> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) message = `Security Error: ${parsed.error}`;
      } catch (e) {
        message = this.state.error?.message || message;
      }

      return (
        <div className="min-h-screen bg-maxsearch-bg flex items-center justify-center p-6">
          <div className="max-w-md w-full glass p-8 rounded-3xl text-center">
            <AlertCircle className="text-red-500 mx-auto mb-4" size={48} />
            <h2 className="text-xl font-bold mb-2">Application Error</h2>
            <p className="text-maxsearch-muted mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-maxsearch-accent text-black font-bold px-6 py-2 rounded-xl"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

type AIModel = 'gemini' | 'chatgpt' | 'claude';
// ... rest of the file

interface SearchResult {
  type: 'ai' | 'web';
  content: string;
  model?: AIModel;
  url?: string;
}

interface UserProfile {
  uid: string;
  email: string;
  role?: 'admin' | 'user';
  openaiKey?: string;
  anthropicKey?: string;
  createdAt: Timestamp;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [tempKeys, setTempKeys] = useState({ openai: '', anthropic: '' });

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedModel, setSelectedModel] = useState<AIModel>('gemini');
  const [isTorMode, setIsTorMode] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'ai' | 'browser' | 'admin'>('search');
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserContent, setBrowserContent] = useState<string | null>(null);

  // Dev Mode States
  const [isDevMode, setIsDevMode] = useState(false);
  const [showDevLogin, setShowDevLogin] = useState(false);
  const [devPassword, setDevPassword] = useState('');
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [isAdminLoading, setIsAdminLoading] = useState(false);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  useEffect(() => {
    let unsubDoc: (() => void) | null = null;
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthLoading(false);
      
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }

      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        // Initial fetch or create
        try {
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            const newProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              role: 'user',
              createdAt: serverTimestamp(),
            };
            await setDoc(userDocRef, newProfile);
          }
        } catch (error) {
          // If we get a permission error here, it might be because the rules haven't propagated yet
          // or there's a real issue. We'll log it but try to continue with the snapshot.
          console.error("Initial profile fetch error:", error);
          // Only throw if it's not a permission error, or if we want to be strict
          // handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }

        // Real-time listener
        unsubDoc = onSnapshot(userDocRef, (snapshot) => {
          if (snapshot.exists()) {
            setProfile(snapshot.data() as UserProfile);
            setTempKeys({
              openai: snapshot.data().openaiKey || '',
              anthropic: snapshot.data().anthropicKey || ''
            });
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        });
      } else {
        setProfile(null);
        setTempKeys({ openai: '', anthropic: '' });
      }
    });

    return () => {
      unsubscribe();
      if (unsubDoc) unsubDoc();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setResults([]);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const saveKeys = async () => {
    if (!user) return;
    const path = `users/${user.uid}`;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        openaiKey: tempKeys.openai,
        anthropicKey: tempKeys.anthropic
      }, { merge: true });
      setShowSettings(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    // Detect if it's a URL
    const urlPattern = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})(\/.*)?$/i;
    if (urlPattern.test(trimmedQuery) || trimmedQuery.startsWith('www.')) {
      handleBrowse(trimmedQuery);
      return;
    }

    setIsSearching(true);
    setResults([]);
    setActiveTab('search');

    try {
      let aiResponse = '';
      if (selectedModel === 'gemini') {
        aiResponse = await askGemini(trimmedQuery, true);
      } else if (selectedModel === 'chatgpt') {
        aiResponse = await askChatGPT(trimmedQuery, profile?.openaiKey);
      } else {
        aiResponse = await askClaude(trimmedQuery, profile?.anthropicKey);
      }

      setResults([
        { type: 'ai', content: aiResponse, model: selectedModel }
      ]);
    } catch (error: any) {
      console.error(error);
      setResults([{ type: 'ai', content: `Error: ${error.message}. Please ensure your API keys are set in Settings.` }]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDevLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (devPassword === 'TeamMarvel[C]') {
      setIsDevMode(true);
      setShowDevLogin(false);
      setDevPassword('');
    } else {
      alert('Incorrect Password');
    }
  };

  const fetchAllUsers = async () => {
    if (!isDevMode) return;
    setIsAdminLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      const users: UserProfile[] = [];
      querySnapshot.forEach((doc) => {
        users.push(doc.data() as UserProfile);
      });
      setAllUsers(users);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setIsAdminLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'admin') {
      fetchAllUsers();
    }
  }, [activeTab]);

  const handleBrowse = (url: string) => {
    let targetUrl = url.trim();
    if (!targetUrl) return;
    
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }
    
    setBrowserUrl(targetUrl);
    setActiveTab('browser');
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 ${isTorMode ? 'tor-mode' : ''}`}>
      {/* Header */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 glass sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-maxsearch-accent rounded-lg flex items-center justify-center neon-glow">
            <Globe className="text-black" size={24} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-display font-bold tracking-tighter text-white leading-none">MaxSearch</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[8px] md:text-[10px] uppercase tracking-[0.15em] text-maxsearch-accent font-bold opacity-80">Powered by Open World International</span>
              <button 
                onClick={() => setShowDevLogin(true)}
                className="text-[8px] uppercase tracking-widest text-white/40 hover:text-maxsearch-accent transition-colors"
              >
                [Developer Mode]
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <nav className="hidden md:flex items-center gap-6 mr-4">
            <button onClick={() => setActiveTab('search')} className={`text-sm font-medium transition-colors ${activeTab === 'search' ? 'text-maxsearch-accent' : 'text-maxsearch-muted hover:text-white'}`}>Search</button>
            <button onClick={() => setActiveTab('ai')} className={`text-sm font-medium transition-colors ${activeTab === 'ai' ? 'text-maxsearch-accent' : 'text-maxsearch-muted hover:text-white'}`}>AI Hub</button>
            <button onClick={() => setActiveTab('browser')} className={`text-sm font-medium transition-colors ${activeTab === 'browser' ? 'text-maxsearch-accent' : 'text-maxsearch-muted hover:text-white'}`}>Browser</button>
            {isDevMode && (
              <button onClick={() => setActiveTab('admin')} className={`text-sm font-medium transition-colors ${activeTab === 'admin' ? 'text-maxsearch-accent' : 'text-maxsearch-muted hover:text-white'}`}>Admin</button>
            )}
          </nav>

          <div className="h-8 w-[1px] bg-white/10 hidden md:block mx-2" />

          {isAuthLoading ? (
            <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-full bg-white/5 text-maxsearch-muted hover:text-maxsearch-accent hover:bg-white/10 transition-all"
                title="Settings"
              >
                <Settings size={18} />
              </button>
              <div className="flex items-center gap-2 bg-white/5 rounded-full pl-1 pr-3 py-1 border border-white/10">
                <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                <span className="text-xs font-bold text-white hidden sm:inline">{user.displayName?.split(' ')[0]}</span>
              </div>
              <button onClick={handleLogout} className="text-maxsearch-muted hover:text-red-400 transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 bg-maxsearch-accent text-black px-4 py-2 rounded-xl font-bold text-sm hover:opacity-90 transition-all neon-glow"
            >
              <LogIn size={16} />
              Login
            </button>
          )}

          <button 
            onClick={() => setIsTorMode(!isTorMode)}
            className={`p-2 rounded-full transition-all ${isTorMode ? 'bg-purple-600 text-white' : 'bg-white/5 text-maxsearch-muted hover:bg-white/10'}`}
          >
            {isTorMode ? <Ghost size={20} /> : <Shield size={20} />}
          </button>
          <button className="md:hidden text-white" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center p-6 max-w-6xl mx-auto w-full">
        {!user && !isAuthLoading && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md p-8 glass rounded-3xl text-center mt-20"
          >
            <div className="w-16 h-16 bg-maxsearch-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Shield className="text-maxsearch-accent" size={32} />
            </div>
            <h2 className="text-2xl font-display font-bold mb-4">Secure Access Required</h2>
            <p className="text-maxsearch-muted mb-8 leading-relaxed">
              Login with your Google account to access MaxSearch's AI features and browse securely. Your data and keys are encrypted and private.
            </p>
            <button 
              onClick={handleLogin}
              className="w-full bg-maxsearch-accent text-black font-bold py-4 rounded-2xl hover:opacity-90 transition-all text-lg flex items-center justify-center gap-3 neon-glow"
            >
              <LogIn size={20} />
              Continue with Google
            </button>
          </motion.div>
        )}

        {user && (
          <AnimatePresence mode="wait">
            {activeTab === 'search' && (
              <motion.div key="search" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full flex flex-col items-center pt-12">
                {!results.length && !isSearching && (
                  <div className="text-center mb-12">
                    <h2 className="text-5xl md:text-7xl font-display font-bold mb-4 tracking-tight">
                      Search the <span className="text-maxsearch-accent">Future</span>.
                    </h2>
                    <p className="text-maxsearch-muted text-lg max-w-xl mx-auto">
                      MaxSearch combines real-time browsing with the world's most powerful AI models.
                    </p>
                  </div>
                )}

                <form onSubmit={handleSearch} className="w-full max-w-3xl relative group">
                  <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-maxsearch-muted group-focus-within:text-maxsearch-accent transition-colors">
                    <Search size={20} />
                  </div>
                  <input 
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask anything or enter a URL..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-14 pr-32 focus:outline-none focus:border-maxsearch-accent focus:ring-1 focus:ring-maxsearch-accent transition-all text-lg font-medium"
                  />
                  <div className="absolute inset-y-2 right-2 flex items-center gap-2">
                    <select 
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value as AIModel)}
                      className="bg-white/10 border-none rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider focus:ring-0 cursor-pointer hover:bg-white/20 transition-colors"
                    >
                      <option value="gemini">Gemini</option>
                      <option value="chatgpt">GPT-4o</option>
                      <option value="claude">Claude</option>
                    </select>
                    <button type="submit" disabled={isSearching} className="bg-maxsearch-accent text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50">
                      {isSearching ? <Zap className="animate-pulse" size={18} /> : <ChevronRight size={18} />}
                    </button>
                  </div>
                </form>

                <div className="w-full max-w-3xl mt-12 space-y-6">
                  {isSearching && (
                    <div className="flex flex-col gap-4">
                      <div className="h-4 bg-white/5 rounded-full w-3/4 animate-pulse" />
                      <div className="h-4 bg-white/5 rounded-full w-1/2 animate-pulse" />
                    </div>
                  )}
                  {results.map((res, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="p-6 rounded-2xl glass border-l-4 border-maxsearch-accent">
                      <div className="flex items-center gap-2 mb-4 text-xs font-bold uppercase tracking-widest text-maxsearch-accent">
                        <Cpu size={14} />
                        {res.model} AI Response
                      </div>
                      <div className="prose prose-invert max-w-none text-maxsearch-text leading-relaxed whitespace-pre-wrap">
                        {res.content}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'ai' && (
              <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full grid md:grid-cols-3 gap-6 pt-12">
                {[
                  { name: 'Gemini', desc: 'Google\'s most capable model for reasoning and search.', icon: <Zap />, color: 'text-blue-400' },
                  { name: 'ChatGPT', desc: 'OpenAI\'s flagship model for creative and technical tasks.', icon: <MessageSquare />, color: 'text-green-400' },
                  { name: 'Claude', desc: 'Anthropic\'s model focused on safety and high-quality writing.', icon: <Cpu />, color: 'text-orange-400' }
                ].map((ai) => (
                  <div key={ai.name} className="p-8 rounded-3xl glass hover:border-maxsearch-accent transition-all cursor-pointer group">
                    <div className={`mb-6 ${ai.color} group-hover:scale-110 transition-transform`}>
                      {React.cloneElement(ai.icon as React.ReactElement, { size: 40 })}
                    </div>
                    <h3 className="text-2xl font-bold mb-3">{ai.name}</h3>
                    <p className="text-maxsearch-muted leading-relaxed">{ai.desc}</p>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === 'browser' && (
              <motion.div key="browser" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-[70vh] flex flex-col glass rounded-3xl overflow-hidden mt-8">
                <div className="p-4 border-b border-white/10 flex items-center gap-4 bg-white/5">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                    <div className="w-3 h-3 rounded-full bg-green-500/50" />
                  </div>
                  <div className="flex-1 bg-black/40 rounded-lg px-4 py-2 flex items-center gap-2 text-sm text-maxsearch-muted border border-white/5">
                    <Globe2 size={14} />
                    <input 
                      type="text" 
                      value={browserUrl} 
                      onChange={(e) => setBrowserUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleBrowse(browserUrl)}
                      className="bg-transparent border-none focus:ring-0 w-full text-white"
                      placeholder="Enter URL to browse..."
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-6 font-mono text-sm">
                  {browserContent ? (
                    browserContent.startsWith('<') ? (
                      <div dangerouslySetInnerHTML={{ __html: browserContent }} />
                    ) : (
                      <pre className="whitespace-pre-wrap">{browserContent}</pre>
                    )
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-maxsearch-muted">
                      <Globe size={48} className="mb-4 opacity-20" />
                      <p>Enter a URL above to start browsing via MaxSearch Proxy.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
            {activeTab === 'admin' && (
              <motion.div key="admin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full pt-12">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-display font-bold">Admin Dashboard</h2>
                  <button onClick={fetchAllUsers} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                    <Zap size={20} className={isAdminLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                
                <div className="grid gap-4">
                  {allUsers.map((u) => (
                    <div key={u.uid} className="p-6 glass rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <div className="text-lg font-bold text-white">{u.email}</div>
                        <div className="text-xs text-maxsearch-muted font-mono">{u.uid}</div>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <div className="flex flex-col">
                          <span className="text-maxsearch-muted uppercase tracking-widest mb-1">OpenAI</span>
                          <span className={u.openaiKey ? 'text-green-400' : 'text-red-400'}>{u.openaiKey ? 'SET' : 'NOT SET'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-maxsearch-muted uppercase tracking-widest mb-1">Anthropic</span>
                          <span className={u.anthropicKey ? 'text-green-400' : 'text-red-400'}>{u.anthropicKey ? 'SET' : 'NOT SET'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-maxsearch-muted uppercase tracking-widest mb-1">Role</span>
                          <span className="text-maxsearch-accent">{u.role || 'user'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Full Screen Browser Overlay */}
      <AnimatePresence>
        {activeTab === 'browser' && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[200] bg-maxsearch-bg flex flex-col"
          >
            {/* Browser Header / URL Bar (Brave-like) */}
            <div className="h-20 border-b border-white/10 flex items-center px-6 gap-6 glass">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-maxsearch-accent rounded-lg flex items-center justify-center">
                  <Globe className="text-black" size={24} />
                </div>
                <button 
                  onClick={() => setActiveTab('search')}
                  className="flex items-center gap-2 text-maxsearch-muted hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
                >
                  <X size={18} />
                  Leave Browser
                </button>
              </div>

              <div className="flex-1 max-w-4xl mx-auto w-full relative group">
                <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-maxsearch-muted group-focus-within:text-maxsearch-accent transition-colors">
                  <Globe2 size={20} />
                </div>
                <input 
                  type="text"
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBrowse(browserUrl)}
                  placeholder="Enter URL or search with Brave-like speed..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-14 pr-10 focus:outline-none focus:border-maxsearch-accent focus:ring-1 focus:ring-maxsearch-accent transition-all text-lg font-medium"
                />
                {browserUrl && (
                  <button 
                    onClick={() => setBrowserUrl('')}
                    className="absolute inset-y-0 right-4 flex items-center text-maxsearch-muted hover:text-white"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div className="hidden lg:flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-maxsearch-accent">
                  <Shield size={14} />
                  Secure Proxy
                </div>
              </div>
            </div>

            {/* Browser Content */}
            <div className="flex-1 overflow-hidden bg-black/20">
              {browserUrl ? (
                <iframe 
                  src={`/api/proxy?url=${encodeURIComponent(browserUrl)}`}
                  className="w-full h-full border-none bg-white"
                  title="MaxSearch Browser"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-maxsearch-muted">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    className="mb-8 opacity-10"
                  >
                    <Globe size={120} />
                  </motion.div>
                  <h2 className="text-3xl font-display font-bold mb-4 text-white">Ready to Explore</h2>
                  <p className="text-lg max-w-md text-center opacity-60">Enter a URL above to browse the web through MaxSearch's secure, high-speed proxy.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dev Login Modal */}
      <AnimatePresence>
        {showDevLogin && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDevLogin(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="w-full max-w-md glass rounded-3xl p-8 relative z-10 border border-maxsearch-accent/30">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-maxsearch-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Terminal className="text-maxsearch-accent" size={32} />
                </div>
                <h2 className="text-2xl font-display font-bold">Developer Access</h2>
                <p className="text-maxsearch-muted text-sm mt-2">Enter the administrative password to enable developer features.</p>
              </div>

              <form onSubmit={handleDevLogin} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-maxsearch-muted mb-3">Admin Password</label>
                  <input 
                    type="password"
                    autoFocus
                    value={devPassword}
                    onChange={(e) => setDevPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-5 focus:outline-none focus:border-maxsearch-accent transition-all text-center tracking-widest"
                  />
                </div>
                <button 
                  type="submit"
                  className="w-full bg-maxsearch-accent text-black font-bold py-4 rounded-2xl hover:opacity-90 transition-all neon-glow"
                >
                  Authenticate
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSettings(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="w-full max-w-lg glass rounded-3xl p-8 relative z-10">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-maxsearch-accent/20 rounded-lg text-maxsearch-accent">
                    <Settings size={20} />
                  </div>
                  <h2 className="text-2xl font-display font-bold">User Settings</h2>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-maxsearch-muted hover:text-white"><X /></button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-maxsearch-muted mb-3">
                    <Key size={14} />
                    OpenAI API Key
                  </label>
                  <input 
                    type="password"
                    value={tempKeys.openai}
                    onChange={(e) => setTempKeys({ ...tempKeys, openai: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-maxsearch-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-maxsearch-muted mb-3">
                    <Key size={14} />
                    Anthropic API Key
                  </label>
                  <input 
                    type="password"
                    value={tempKeys.anthropic}
                    onChange={(e) => setTempKeys({ ...tempKeys, anthropic: e.target.value })}
                    placeholder="x-api-key-..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-maxsearch-accent transition-colors"
                  />
                </div>

                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex gap-3">
                  <AlertCircle className="text-yellow-500 shrink-0" size={20} />
                  <p className="text-xs text-yellow-200/80 leading-relaxed">
                    Keys are stored securely in your private Firestore profile. They are only used to fulfill your AI requests and are never shared.
                  </p>
                </div>

                <button 
                  onClick={saveKeys}
                  className="w-full bg-maxsearch-accent text-black font-bold py-4 rounded-2xl hover:opacity-90 transition-all neon-glow"
                >
                  Save Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="p-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-bold uppercase tracking-widest text-maxsearch-muted">
        <div className="flex items-center gap-4">
          <span>&copy; 2026 MaxSearch Browser</span>
          <span className="w-1 h-1 bg-maxsearch-muted rounded-full" />
          <span className="text-maxsearch-accent">Quantum Core v2.4</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-white transition-colors">Privacy</a>
          <a href="#" className="hover:text-white transition-colors">Terms</a>
          <a href="#" className="hover:text-white transition-colors">Tor Status</a>
        </div>
      </footer>
    </div>
  );
}
