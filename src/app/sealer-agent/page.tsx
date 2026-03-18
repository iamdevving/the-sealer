'use client';
// src/app/sealer-agent/page.tsx
import { useState, useRef, useEffect } from 'react';
import SocialQueuePanel from '@/components/SocialQueuePanel';

interface Message {
  role:    'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'How do I register as an agent?',
  'What claim types are available?',
  'How are proof points calculated?',
  'How much does a commitment cost?',
  'How does verification work?',
  'What is a Sealer ID?',
];

export default function SealerAgentPage() {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [turns,     setTurns]     = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text?: string) {
    const content = (text || input).trim();
    if (!content || loading) return;
    if (turns >= 10) { setError('Conversation limit reached. Please refresh to start a new chat.'); return; }

    const userMsg: Message = { role: 'user', content };
    const newMessages      = [...messages, userMsg];

    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);
    setTurns(t => t + 1);

    try {
      const res = await fetch('/api/sealer-agent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: newMessages }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setTurns(t => t - 1);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
      }
    } catch {
      setError('Connection failed. Try again.');
      setTurns(t => t - 1);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const accent  = '#3b82f6';
  const bg      = '#0d1117';
  const hdrBg   = '#0a0f1e';
  const ink     = '#c8d8f0';
  const inkDim  = '#5a7090';
  const faint   = '#1e2d4a';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        body {
          background: #060a12; height: 100%;
          font-family: 'Space Mono', monospace; color: ${ink};
          display: flex; flex-direction: column;
        }
        .page { display: flex; flex-direction: column; height: 100vh; max-width: 760px; margin: 0 auto; width: 100%; padding: 0 16px; }

        /* Header */
        .header {
          background: ${hdrBg}; border-bottom: 0.8px solid ${faint};
          padding: 12px 20px; display: flex; align-items: center; gap: 12px;
          flex-shrink: 0;
        }
        .header-logo { width: 22px; height: 22px; opacity: 0.85; }
        .header-info { flex: 1; }
        .header-title { font-size: 11px; color: ${ink}; letter-spacing: 2px; }
        .header-sub { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; margin-top: 2px; }
        .header-status { display: flex; align-items: center; gap: 6px; font-size: 7px; color: ${inkDim}; letter-spacing: 1px; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .turns-count { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; }

        /* Messages */
        .messages { flex: 1; overflow-y: auto; padding: 20px 0; display: flex; flex-direction: column; gap: 16px; }
        .messages::-webkit-scrollbar { width: 4px; }
        .messages::-webkit-scrollbar-track { background: transparent; }
        .messages::-webkit-scrollbar-thumb { background: ${faint}; border-radius: 2px; }

        /* Welcome */
        .welcome { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 40px 20px; text-align: center; }
        .welcome-logo { width: 48px; height: 48px; opacity: 0.9; }
        .welcome-title { font-family: Georgia, serif; font-size: 20px; color: ${ink}; letter-spacing: 2px; }
        .welcome-sub { font-size: 9px; color: ${inkDim}; letter-spacing: 1px; line-height: 1.6; max-width: 400px; }
        .suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px; }
        .suggestion {
          padding: 7px 14px; border-radius: 20px; font-size: 8px; letter-spacing: 0.5px;
          cursor: pointer; border: 0.8px solid ${faint}; background: transparent;
          color: ${inkDim}; font-family: monospace; transition: all .15s;
        }
        .suggestion:hover { border-color: ${accent}; color: ${ink}; background: ${accent}10; }

        /* Message bubbles */
        .msg { display: flex; gap: 10px; align-items: flex-start; }
        .msg.user { flex-direction: row-reverse; }
        .msg-avatar {
          width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700;
        }
        .msg-avatar.agent { background: ${accent}22; border: 0.8px solid ${accent}60; }
        .msg-avatar.user  { background: ${faint}; border: 0.8px solid ${faint}; color: ${inkDim}; }
        .msg-bubble {
          max-width: 80%; padding: 10px 14px; border-radius: 12px;
          font-size: 9px; line-height: 1.7; letter-spacing: 0.3px;
        }
        .msg-bubble.agent { background: ${hdrBg}; border: 0.8px solid ${faint}; color: ${ink}; border-radius: 2px 12px 12px 12px; }
        .msg-bubble.user  { background: ${accent}22; border: 0.8px solid ${accent}40; color: ${ink}; border-radius: 12px 2px 12px 12px; }
        .msg-bubble pre { background: #0a0f1e; padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; font-size: 8px; border: 0.8px solid ${faint}; }
        .msg-bubble code { font-family: monospace; font-size: 8px; background: #0a0f1e; padding: 1px 4px; border-radius: 3px; }

        /* Typing indicator */
        .typing { display: flex; gap: 4px; padding: 12px 14px; align-items: center; }
        .typing-dot { width: 6px; height: 6px; border-radius: 50%; background: ${inkDim}; animation: bounce 1.2s infinite; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

        /* Error */
        .error-bar { padding: 8px 16px; background: #ef444422; border: 0.8px solid #ef444440; border-radius: 8px; font-size: 8px; color: #ef4444; letter-spacing: 0.5px; margin: 0 0 8px; }

        /* Input area */
        .input-area { flex-shrink: 0; padding: 12px 0 20px; }
        .input-wrap {
          display: flex; gap: 10px; align-items: flex-end;
          background: ${hdrBg}; border: 0.8px solid ${faint};
          border-radius: 12px; padding: 10px 14px;
          transition: border-color .15s;
        }
        .input-wrap:focus-within { border-color: ${accent}; }
        .input-textarea {
          flex: 1; background: transparent; border: none; outline: none;
          font-family: monospace; font-size: 9px; color: ${ink};
          resize: none; min-height: 20px; max-height: 120px; line-height: 1.6;
        }
        .input-textarea::placeholder { color: ${inkDim}; }
        .send-btn {
          width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
          background: ${accent}; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: opacity .15s;
        }
        .send-btn:disabled { opacity: 0.3; cursor: default; }
        .send-btn svg { width: 14px; height: 14px; fill: white; }
        .input-hint { font-size: 7px; color: ${inkDim}; letter-spacing: 0.5px; margin-top: 6px; text-align: center; }

        @media (max-width: 480px) {
          .page { padding: 0 8px; }
          .msg-bubble { max-width: 90%; }
        }
      `}</style>

      <div className="page">
        {/* Header */}
        <div className="header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-small.png" alt="" className="header-logo"/>
          <div className="header-info">
            <div className="header-title">SEALER AGENT</div>
            <div className="header-sub">THE SEALER PROTOCOL · PROTOCOL ASSISTANT</div>
          </div>
          <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
            <div className="header-status">
              <div className="status-dot"/>
              <span>ONLINE</span>
            </div>
            <div className="turns-count">{turns}/10 turns</div>
          </div>
        </div>

        {/* Messages */}
        <div className="messages">
          {messages.length === 0 ? (
            <div className="welcome">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-small.png" alt="" className="welcome-logo"/>
              <div className="welcome-title">SEALER AGENT</div>
              <div className="welcome-sub">
                Your guide to The Sealer Protocol. Ask me anything about registering,
                making commitments, verification, proof points, or how to get started.
              </div>
              <div className="suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="suggestion" onClick={() => sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.role}`}>
                <div className={`msg-avatar ${msg.role === 'assistant' ? 'agent' : 'user'}`}>
                  {msg.role === 'assistant' ? '🦭' : 'A'}
                </div>
                <div className={`msg-bubble ${msg.role === 'assistant' ? 'agent' : 'user'}`}>
                  {msg.content.split('\n').map((line, j) => (
                    <span key={j}>{line}{j < msg.content.split('\n').length - 1 ? <br/> : ''}</span>
                  ))}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="msg">
              <div className="msg-avatar agent">🦭</div>
              <div className="msg-bubble agent">
                <div className="typing">
                  <div className="typing-dot"/>
                  <div className="typing-dot"/>
                  <div className="typing-dot"/>
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-bar">{error}</div>}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div className="input-area">
          <div className="input-wrap">
            <textarea
              ref={inputRef}
              className="input-textarea"
              placeholder="Ask about the protocol, or type /feedback to leave feedback..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={500}
            />
            <button
              className="send-btn"
              disabled={!input.trim() || loading || turns >= 10}
              onClick={() => sendMessage()}
            >
              <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
            </button>
          </div>
          <div className="input-hint">Enter to send · Shift+Enter for new line · /feedback to leave feedback</div>
        </div>
        <SocialQueuePanel />
      </div>
    </>
  );
}