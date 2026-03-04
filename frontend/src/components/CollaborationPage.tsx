import { useState, useEffect, useRef } from 'react';
import { X, Send, Copy, CheckCircle, User, Eye, Code } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface CollaborationPageProps {
  user: any;
  session: any;
  onEndSession: () => void;
}

export function CollaborationPage({ user, session, onEndSession }: CollaborationPageProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [code, setCode] = useState(`// ${session.question.title}\n// Starter template\n\nfunction solution(input) {\n  // Write your code here\n  \n  return result;\n}\n\n// Test cases\nconsole.log(solution(testInput));`);
  const [messages, setMessages] = useState<Array<{ sender: string; text: string; time: string }>>([
    {
      sender: 'System',
      text: `You've been matched with @${session.partner.username}. Good luck!`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [newMessage, setNewMessage] = useState('');
  const [sessionTime, setSessionTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const questionMarkdown = `## Problem Description\n\n${session.question.description}\n\n### Constraints\n- Time complexity: O(n)\n- Space complexity: O(1) preferred\n\n### Example\nInput: [1, 2, 3, 4, 5]\nOutput: [result]\n\n### Hints\n1. Consider using a two-pointer approach\n2. Edge cases: empty arrays, single elements`;

  // --- 1. CONNECT TO BACKEND VIA NGINX ---
  useEffect(() => {
    // We point to Port 80 (Nginx). Nginx handles the path '/socket.io/' 
    // and forwards it to the Node.js container internally.
    const newSocket = io('http://localhost', {
      path: '/socket.io/',
      transports: ['websocket'],
      auth: {
        token: user.accessToken // Assuming user object has the Firebase JWT
      }
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join-session', {
        sessionId: session.id,
        username: user.username
      });
    });

    newSocket.on('code-update', (newCode: string) => setCode(newCode));
    newSocket.on('receive-message', (msg: any) => setMessages((prev) => [...prev, msg]));

    return () => {
      newSocket.disconnect();
    };
  }, [session.id, user.username]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- 2. HANDLE SENDING CHAT ---
  const handleSendMessage = () => {
    if (newMessage.trim() && socket) {
      const sanitizedMessage = newMessage.replace(/[<>]/g, '');
      const msgObj = {
        sender: user.username,
        text: sanitizedMessage,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      // Update local UI immediately
      setMessages((prev) => [...prev, msgObj]);
      setNewMessage('');

      // Send to backend to broadcast to partner
      socket.emit('send-message', {
        sessionId: session.id,
        message: msgObj
      });
    }
  };

  // --- 3. HANDLE CODE CHANGES ---
  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode); // Update local UI

    // Emit to partner instantly
    if (socket) {
      socket.emit('code-change', {
        sessionId: session.id,
        code: newCode
      });
    }
  };

  const handleCopySessionId = () => {
    navigator.clipboard.writeText(session.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    let inHintsSection = false;

    return lines.map((line, i) => {
      if (line.startsWith('### Hints')) {
        inHintsSection = true;
        return (
          <div key={i} className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Hints</h3>
              <button
                onClick={() => setShowHints(!showHints)}
                className="bg-[#4A4563] text-white px-4 py-1 rounded-full text-sm hover:bg-[#5A5573] transition-all"
              >
                {showHints ? 'Hide Hints' : 'Reveal Hints'}
              </button>
            </div>
          </div>
        );
      }
      if (inHintsSection && !showHints) {
        if (line.match(/^\d+\./)) return <div key={i} className="ml-4 mb-1 text-gray-400 blur-sm select-none">{i}. ████████████████</div>;
        return null;
      }
      if (line.startsWith('###') && !line.startsWith('### Hints')) inHintsSection = false;

      if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold mt-4 mb-2">{line.replace('## ', '')}</h2>;
      if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-semibold mt-3 mb-2">{line.replace('### ', '')}</h3>;
      if (line.match(/^\d+\./)) return <li key={i} className="ml-4 mb-1">{line}</li>;
      if (line.startsWith('-')) return <li key={i} className="ml-4 mb-1">{line.replace('- ', '')}</li>;
      if (line.trim()) return <p key={i} className="mb-2">{line}</p>;
      return <br key={i} />;
    });
  };

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
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
                  {copied ? <><CheckCircle className="w-4 h-4" /><span>Copied!</span></> : <><Copy className="w-4 h-4" /><span>Session ID: {session.id}</span></>}
                </button>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-300" />
                  <span className="text-gray-300 text-sm">Partner: @{session.partner.username}</span>
                </div>
              </div>
            </div>
            <button onClick={onEndSession} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-full font-semibold transition-all flex items-center gap-2">
              <X className="w-4 h-4" /> End Session
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4 lg:gap-6">
          <div className="lg:col-span-2 space-y-4 lg:space-y-6">
            <div className="card-peach">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[#4A4563] font-bold text-lg">{session.question.title}</h3>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${session.question.difficulty === 'easy' ? 'bg-green-100 text-green-700' : session.question.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                    {session.question.difficulty.charAt(0).toUpperCase() + session.question.difficulty.slice(1)}
                  </span>
                  <button onClick={() => setShowMarkdown(!showMarkdown)} className="bg-[#4A4563] p-2 rounded-full hover:bg-[#5A5573] transition-all" title="Toggle detailed view">
                    {showMarkdown ? <Code className="w-4 h-4 text-white" /> : <Eye className="w-4 h-4 text-white" />}
                  </button>
                </div>
              </div>
              {showMarkdown ? <div className="text-gray-700 prose max-w-none">{renderMarkdown(questionMarkdown)}</div> : <p className="text-gray-700">{session.question.description}</p>}
            </div>

            <div className="card-purple">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">Code Editor (JavaScript)</h3>
                <div className="flex gap-2">
                  <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                </div>
              </div>
              <div className="bg-[#1e1e1e] rounded-xl p-4 min-h-[400px] syntax-highlight">
                <textarea
                  value={code}
                  onChange={handleCodeChange}
                  className="w-full h-[380px] bg-transparent text-white font-mono text-sm resize-none focus:outline-none"
                  spellCheck={false}
                  placeholder="// Start coding here..."
                  style={{ lineHeight: '1.5', tabSize: 2 }}
                />
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span>Live - Changes are synced in real-time</span>
              </div>
            </div>
          </div>

          <div className="space-y-4 lg:space-y-6">
            <div className="card-peach">
              <h3 className="text-[#4A4563] font-bold mb-4">Your Partner</h3>
              <div className="flex items-center gap-3">
                <img src={session.partner.avatar} alt={session.partner.username} className="w-16 h-16 rounded-full border-2 border-[#4A4563]" />
                <div>
                  <p className="text-[#4A4563] font-semibold">@{session.partner.username}</p>
                  <p className="text-sm text-gray-600">Active now</p>
                </div>
              </div>
            </div>

            <div className="card-purple flex flex-col h-[500px]">
              <h3 className="text-white font-bold mb-4">Chat</h3>
              <div className="flex-1 bg-[#3A3552] rounded-xl p-4 overflow-y-auto mb-4 custom-scrollbar">
                {messages.map((msg, index) => (
                  <div key={index} className={`mb-4 ${msg.sender === user.username ? 'text-right' : ''}`}>
                    <div className={`inline-block max-w-[80%] ${msg.sender === 'System' ? 'bg-[#2D2838] text-gray-300 text-center w-full' : msg.sender === user.username ? 'bg-[#E8B995] text-[#4A4563]' : 'bg-[#4A4563] text-white'} rounded-2xl px-4 py-2`}>
                      {msg.sender !== 'System' && <p className="text-xs opacity-70 mb-1">@{msg.sender}</p>}
                      <p className="text-sm">{msg.text}</p>
                      <p className="text-xs opacity-70 mt-1">{msg.time}</p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #2D2838; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E8B995; border-radius: 10px; }
        .syntax-highlight textarea { color: #d4d4d4; }
        .syntax-highlight textarea::selection { background: #264f78; }
      `}</style>
    </div>
  );
}