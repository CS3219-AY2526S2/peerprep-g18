import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Send, Copy, CheckCircle, User } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { dracula } from '@uiw/codemirror-theme-dracula';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { toast } from 'sonner';
import { GATEWAY_URL } from '../constants';
import { useUser } from '../contexts/UserContext';
import { auth } from '../firebase';
import { avatarUrl } from '../utils/avatar';
import { DynamicArrayInput } from './ui/DynamicArrayInput';

interface SessionMeta {
  user1_id: string;
  user2_id: string;
  questionId: string;
  topic: string;
  difficulty: string;
  startedAt: string;
}

interface PartnerInfo {
  username: string;
  email: string;
  avatar_id?: number;
}

interface Question {
  question_id: string;
  title: string;
  statement: string;
  difficulty: string;
  topic: string;
  template?: string;
  examples?: string[];
  constraints?: string[];
  hints?: string[];
}

interface ChatMessage {
  sender: string;
  text: string;
  time: string;
}

async function getToken(): Promise<string> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Not authenticated');
  return firebaseUser.getIdToken();
}

async function fetchTicket(sessionId: string): Promise<string> {
  const token = await getToken();
  const res = await fetch(`${GATEWAY_URL}/collab/join`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sessionId })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.detail === 'ACCOUNT_DELETED') {
      window.dispatchEvent(new Event('auth:account_deleted'));
      throw new Error('ACCOUNT_DELETED');
    }
    if (res.status === 403 && data.detail === 'TOKEN_STALE') {
      window.dispatchEvent(new Event('auth:token_stale'));
      throw new Error('TOKEN_STALE');
    }
    if (res.status === 410) {
      throw new Error('SESSION_ENDED');
    }
    throw new Error(`Ticket fetch failed: ${res.status}`);
  }
  const data = await res.json();
  return data.ticket;
}

export function CollaborationPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useUser();

  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'root';

  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerStatus, setPartnerStatus] = useState<string>('Connecting...');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sessionTime, setSessionTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPartnerEndedModal, setShowPartnerEndedModal] = useState(false);

  const editorSocketRef = useRef<Socket | null>(null);
  const chatSocketRef = useRef<Socket | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const [ytext, setYtext] = useState<Y.Text | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const partnerRef = useRef<PartnerInfo | null>(null);
  const questionRef = useRef<Question | null>(null);
  const partnerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerEndedRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());

  // Keep refs in sync for use in socket handlers
  useEffect(() => {
    partnerRef.current = partner;
  }, [partner]);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  // --- 3a. Session Data Fetching ---
  useEffect(() => {
    if (!sessionId || !user) return;
    let cancelled = false;

    const fetchSessionData = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const headers = { 'Authorization': `Bearer ${token}` };

        // Fetch session metadata
        const sessionRes = await fetch(`${GATEWAY_URL}/collab/session/${sessionId}`, { headers });
        if (cancelled) return;
        if (!sessionRes.ok) {
          const errData = await sessionRes.json().catch(() => ({}));
          if (sessionRes.status === 401 && errData.detail === 'ACCOUNT_DELETED') {
            window.dispatchEvent(new Event('auth:account_deleted'));
            return;
          }
          if (sessionRes.status === 403 && errData.detail === 'TOKEN_STALE') {
            window.dispatchEvent(new Event('auth:token_stale'));
            return;
          }
          if (sessionRes.status === 410) {
            toast.error('This session has ended.');
            navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
            return;
          }
          throw new Error('Failed to fetch session');
        }
        const meta: SessionMeta = await sessionRes.json();
        setSessionMeta(meta);
        startedAtRef.current = new Date(meta.startedAt).getTime();

        // Determine partner UID
        const partnerUid = meta.user1_id === user.uid ? meta.user2_id : meta.user1_id;

        // Fetch question and partner in parallel
        const [questionRes, partnerRes] = await Promise.all([
          fetch(`${GATEWAY_URL}/question/${meta.questionId}`, { headers }),
          fetch(`${GATEWAY_URL}/users/${partnerUid}`, { headers })
        ]);
        if (cancelled) return;

        if (questionRes.ok) {
          setQuestion(await questionRes.json());
        }
        if (partnerRes.ok) {
          setPartner(await partnerRes.json());
        }

        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error('Session data fetch error:', err);
        toast.error('Failed to load session data');
        navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
      }
    };

    fetchSessionData();
    return () => { cancelled = true; };
  }, [sessionId, user, navigate]);

  // --- 3b/3c. Editor Socket + Yjs ---
  useEffect(() => {
    if (loading || !sessionId) return;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('code');
    ydocRef.current = ydoc;
    setYtext(ytext);

    let editorSocket: Socket;
    let cleaned = false;

    const connectEditor = async () => {
      if (cleaned) return;
      try {
        const ticket = await fetchTicket(sessionId);
        if (cleaned) return;

        editorSocket = io('http://localhost/editor', {
          path: '/socket.io',
          query: { ticket },
          transports: ['websocket'],
          reconnection: false,
          forceNew: true
        });

        editorSocketRef.current = editorSocket;

        editorSocket.on('connect', () => {
          toast.success('Editor connected');
        });

        editorSocket.on('yjs-sync', (data: ArrayBuffer) => {
          Y.applyUpdate(ydoc, new Uint8Array(data));
          
          // Template initialization: Only if the doc is truly empty after sync
          // We check a small delay to ensure other potential updates have settled
          setTimeout(() => {
            if (ytext.length === 0 && questionRef.current?.template) {
              ytext.insert(0, questionRef.current.template);
            }
          }, 500);
        });

        editorSocket.on('yjs-update', (data: ArrayBuffer) => {
          Y.applyUpdate(ydoc, new Uint8Array(data), 'remote');
        });

        editorSocket.on('user-joined', () => {
          if (partnerTimeoutRef.current) {
            clearTimeout(partnerTimeoutRef.current);
            partnerTimeoutRef.current = null;
          }
          setPartnerOnline(true);
          setPartnerStatus('Active now');
        });

        editorSocket.on('user-left', () => {
          // If partner already explicitly ended, don't show reconnecting
          if (partnerEndedRef.current) return;
          setPartnerOnline(false);
          setPartnerStatus('Reconnecting...');
        });

        editorSocket.on('partner-ended', () => {
          partnerEndedRef.current = true;
          setPartnerOnline(false);
          setPartnerStatus('Partner has left');
          if (partnerTimeoutRef.current) {
            clearTimeout(partnerTimeoutRef.current);
            partnerTimeoutRef.current = null;
          }
          setShowPartnerEndedModal(true);
        });

        editorSocket.on('disconnect', async () => {
          if (cleaned || sessionEndedRef.current) return;
          try {
            const newTicket = await fetchTicket(sessionId);
            if (cleaned || sessionEndedRef.current) return;
            editorSocket.io.opts.query = { ticket: newTicket };
            editorSocket.connect();
            toast('Reconnecting editor...');
          } catch (err: any) {
            if (err?.message === 'SESSION_ENDED') {
              toast.error('This session has ended.');
              navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
              return;
            }
            toast.error('Failed to reconnect editor');
          }
        });

        // On local Yjs changes, emit to server
        ydoc.on('update', (update: Uint8Array, origin: any) => {
          if (origin !== 'remote') {
            editorSocket.emit('yjs-update', update);
          }
        });
      } catch (err: any) {
        if (cleaned) return;
        if (err?.message === 'SESSION_ENDED') {
          toast.error('This session has ended.');
          navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
          return;
        }
        console.error('Editor connect error:', err);
        toast.error('Failed to connect to editor. Retrying...');
        setTimeout(connectEditor, 3000);
      }
    };

    connectEditor();

    return () => {
      cleaned = true;
      editorSocket?.disconnect();
      setYtext(null);
      ydoc.destroy();
      if (partnerTimeoutRef.current) clearTimeout(partnerTimeoutRef.current);
    };
  }, [loading, sessionId]);

  // --- 4a/4b. Chat Socket ---
  useEffect(() => {
    if (loading || !sessionId || !user) return;

    let chatSocket: Socket;
    let cleaned = false;

    const connectChat = async () => {
      if (cleaned) return;
      try {
        const ticket = await fetchTicket(sessionId);
        if (cleaned) return;

        chatSocket = io('http://localhost/chat', {
          path: '/socket.io',
          query: { ticket },
          transports: ['websocket'],
          reconnection: false,
          forceNew: true
        });

        chatSocketRef.current = chatSocket;

        chatSocket.on('chat-history', (history: Array<{ sender: string; text: string; time: string }>) => {
          const mapped = history.map(msg => ({
            ...msg,
            sender: msg.sender === user.uid
              ? (user.username || user.Username)
              : (partnerRef.current?.username || 'Partner')
          }));
          setMessages(mapped);
        });

        chatSocket.on('receive-message', (msg: { sender: string; text: string; time: string }) => {
          const displayName = msg.sender === user.uid
            ? (user.username || user.Username)
            : (partnerRef.current?.username || 'Partner');
          setMessages(prev => [...prev, { ...msg, sender: displayName }]);
        });

        chatSocket.on('disconnect', async () => {
          if (cleaned || sessionEndedRef.current) return;
          try {
            const newTicket = await fetchTicket(sessionId);
            if (cleaned || sessionEndedRef.current) return;
            chatSocket.io.opts.query = { ticket: newTicket };
            chatSocket.connect();
          } catch (err: any) {
            if (err?.message === 'SESSION_ENDED') return; // editor handler already redirects
            toast.error('Failed to reconnect chat');
          }
        });
      } catch (err: any) {
        if (cleaned) return;
        if (err?.message === 'SESSION_ENDED') {
          toast.error('This session has ended.');
          navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
          return;
        }
        console.error('Chat connect error:', err);
        setTimeout(connectChat, 3000);
      }
    };

    connectChat();

    return () => {
      cleaned = true;
      chatSocket?.disconnect();
    };
  }, [loading, sessionId, user]);

  // Auto-scroll chat only when messages change (and not on initial load if possible)
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages]);

  // Force scroll to top on initial mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Session timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionTime(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Chat send ---
  const handleSendMessage = useCallback(() => {
    if (!newMessage.trim() || !chatSocketRef.current) return;
    const sanitizedMessage = newMessage.replace(/[<>]/g, '');
    chatSocketRef.current.emit('send-message', { text: sanitizedMessage });
    setNewMessage('');
  }, [newMessage]);

  // --- 5a. End Session ---
  const handleEndSession = useCallback(async () => {
    sessionEndedRef.current = true;
    // Emit end-session and wait for server acknowledgement before disconnecting —
    // otherwise disconnect fires before the event is handled
    await new Promise<void>((resolve) => {
      const socket = editorSocketRef.current;
      if (socket?.connected) {
        socket.emit('end-session', resolve);
        // Fallback: disconnect anyway after 2s if server never acknowledges
        setTimeout(resolve, 2000);
      } else {
        resolve();
      }
    });
    editorSocketRef.current?.disconnect();
    chatSocketRef.current?.disconnect();
    ydocRef.current?.destroy();

    // Clear active session in backend BEFORE navigating,
    // so ActiveSessionRedirect won't redirect back to this session
    try {
      const token = await getToken();
      await fetch(`${GATEWAY_URL}/collab/end-session/${sessionId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch {
      // Navigate anyway even if this fails
    }

    navigate(isAdmin ? '/admin' : '/dashboard', { replace: true });
  }, [navigate, sessionId, isAdmin]);

  const handleCopySessionId = () => {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Yjs CodeMirror extensions
  const editorExtensions = ytext
    ? [python(), dracula, yCollab(ytext, null)]
    : [python(), dracula];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2D2942] flex items-center justify-center text-white">
        Loading session...
      </div>
    );
  }

  const displayUsername = user?.username || user?.Username || 'You';
  const partnerUsername = partner?.username || 'Partner';

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="card-purple mb-4 lg:mb-6">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-white font-bold text-xl">Collaborative Session</h2>
                <div className="bg-[#E8B995] px-3 py-1 rounded-full">
                  <span className="text-[#4A4563] text-sm font-semibold">{formatTime(sessionTime)}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <button onClick={handleCopySessionId} className="flex items-center gap-2 text-gray-300 hover:text-white text-sm">
                  {copied ? <><CheckCircle className="w-4 h-4" /><span>Copied!</span></> : <><Copy className="w-4 h-4" /><span>Session ID: {sessionId}</span></>}
                </button>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-300" />
                  <span className="text-gray-300 text-sm">Partner: @{partnerUsername}</span>
                </div>
              </div>
            </div>
            <button onClick={handleEndSession} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-full font-semibold transition-all flex items-center gap-2">
              <X className="w-4 h-4" /> End Session
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4 lg:gap-6">
          {/* Left: Question + Editor */}
          <div className="lg:col-span-2 space-y-4 lg:space-y-6">
            {/* Question Panel */}
            {question && (
              <div className="card-peach space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[#4A4563] font-bold text-xl">{question.title}</h3>
                    <div className="flex gap-2">
                       <span className="bg-[#4A4563] text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                        {question.topic}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        question.difficulty?.toLowerCase() === 'easy' ? 'bg-green-100 text-green-700' :
                        question.difficulty?.toLowerCase() === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {question.difficulty}
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[#4A4563]/60 text-xs font-bold uppercase tracking-wider ml-1">Problem Statement</label>
                    <div className="prose prose-invert prose-sm max-w-none text-white bg-[#2D2942]/40 p-6 rounded-[20px] border border-white/5">
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {question.statement}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <DynamicArrayInput 
                    label="Examples" 
                    items={question.examples?.filter((e: string) => e.trim() !== '') || []}
                    isEditing={false}
                    emptyMessage="No examples provided."
                    labelClassName="text-[#4A4563]/60"
                  />
                  <DynamicArrayInput 
                    label="Constraints" 
                    items={question.constraints?.filter((c: string) => c.trim() !== '') || []}
                    isEditing={false}
                    emptyMessage="No constraints defined."
                    labelClassName="text-[#4A4563]/60"
                  />
                   <DynamicArrayInput 
                    label="Hints" 
                    items={question.hints?.filter((h: string) => h.trim() !== '') || []}
                    isEditing={false}
                    isSpoiler={true}
                    emptyMessage="No hints available for this question."
                    labelClassName="text-[#4A4563]/60"
                  />
                </div>
              </div>
            )}

            {/* Code Editor */}
            <div className="card-purple">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">Code Editor (Python)</h3>
                <div className="flex gap-2">
                  <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden">
                {ytext ? (
                  <CodeMirror
                    minHeight="400px"
                    theme={dracula}
                    extensions={editorExtensions}
                    basicSetup={{
                      lineNumbers: true,
                      indentOnInput: true,
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[400px] text-gray-400">
                    Initializing editor...
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
                <div className={`w-2 h-2 rounded-full animate-pulse ${partnerOnline ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                <span>Live - Changes are synced in real-time</span>
              </div>
            </div>
          </div>

          {/* Right: Partner + Chat */}
          <div className="lg:sticky lg:top-6 space-y-4 lg:space-y-6 self-start">
            {/* Partner Card */}
            <div className="card-peach">
              <h3 className="text-[#4A4563] font-bold mb-4">Your Partner</h3>
              <div className="flex items-center gap-3">
                <img
                  src={avatarUrl(partner?.avatar_id ?? 1)}
                  alt={partnerUsername}
                  className="w-16 h-16 rounded-full border-2 border-[#4A4563]"
                />
                <div>
                  <p className="text-[#4A4563] font-semibold">@{partnerUsername}</p>
                  <p className={`text-sm ${partnerOnline ? 'text-green-600' : 'text-gray-600'}`}>{partnerStatus}</p>
                </div>
              </div>
            </div>

            {/* Chat */}
            <div className="card-purple flex flex-col h-[500px]">
              <h3 className="text-white font-bold mb-4">Chat</h3>
              <div className="flex-1 bg-[#3A3552] rounded-xl p-4 overflow-y-auto mb-4 custom-scrollbar">
                {messages.map((msg, index) => {
                  const isOwn = msg.sender === displayUsername;
                  const isSystem = msg.sender === 'System';
                  const avatarSrc = isOwn
                    ? user.avatar
                    : avatarUrl(partner?.avatar_id ?? 1);

                  if (isSystem) {
                    return (
                      <div key={index} className="mb-4">
                        <div className="bg-[#2D2838] text-gray-300 text-center w-full rounded-2xl px-4 py-2">
                          <p className="text-sm">{msg.text}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={index} className={`mb-4 flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                      <img
                        src={avatarSrc}
                        alt={msg.sender}
                        className="w-7 h-7 rounded-full flex-shrink-0"
                      />
                      <div className={`max-w-[75%] ${isOwn ? 'bg-[#E8B995] text-[#4A4563]' : 'bg-[#4A4563] text-white'} rounded-2xl px-4 py-2`}>
                        <p className="text-xs opacity-70 mb-1">@{msg.sender}</p>
                        <p className="text-sm">{msg.text}</p>
                        <p className="text-xs opacity-70 mt-1">{msg.time}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 bg-[#3A3552] border-none rounded-full px-5 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E8B995]"
                />
                <button onClick={handleSendMessage} className="bg-[#E8B995] p-3 rounded-full hover:bg-[#F0C5A5] transition-all">
                  <Send className="w-5 h-5 text-[#4A4563]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Partner Ended Modal */}
      {showPartnerEndedModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card-purple max-w-md w-full mx-4 text-center">
            <h3 className="text-white text-xl font-bold mb-3">Partner Left</h3>
            <p className="text-gray-300 mb-6">
              @{partnerUsername} has ended the session. Would you like to continue working on the code or end your session too?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowPartnerEndedModal(false)}
                className="bg-[#E8B995] hover:bg-[#F0C5A5] text-[#4A4563] px-6 py-2 rounded-full font-semibold transition-all"
              >
                Continue Coding
              </button>
              <button
                onClick={() => {
                  setShowPartnerEndedModal(false);
                  handleEndSession();
                }}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-full font-semibold transition-all"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #2D2838; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E8B995; border-radius: 10px; }
      `}</style>
    </div>
  );
}
