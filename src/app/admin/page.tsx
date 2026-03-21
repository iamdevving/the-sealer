'use client';
// src/app/admin/page.tsx
import { useState } from 'react';
import SocialQueuePanel from '@/components/SocialQueuePanel';
import FeedbackPanel    from '@/components/FeedbackPanel';

const colors = {
  bg:      '#0a0a0f',
  surface: '#12121a',
  border:  '#1e1e2e',
  accent:  '#3b82f6',
  ink:     '#e2e8f0',
  inkDim:  '#64748b',
  danger:  '#ef4444',
};

export default function AdminPage() {
  const [authed,   setAuthed]   = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput,  setPwInput]  = useState('');
  const [error,    setError]    = useState('');

  async function handleLogin() {
    try {
      const res = await fetch('/api/admin/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: pwInput }),
      });
      if (res.ok) {
        setAuthed(true);
        setPassword(pwInput); // keep password in state for panel auth
        setError('');
      } else {
        setError('Invalid password');
      }
    } catch { setError('Auth error'); }
  }

  if (!authed) {
    return (
      <div style={{
        minHeight:      '100vh',
        background:     colors.bg,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontFamily:     'Space Mono, monospace',
      }}>
        <div style={{
          background:    colors.surface,
          border:        `0.8px solid ${colors.border}`,
          borderRadius:  12,
          padding:       40,
          width:         320,
          display:       'flex',
          flexDirection: 'column',
          gap:           16,
        }}>
          <div style={{ fontSize: 11, letterSpacing: '3px', color: colors.inkDim }}>SEALER ADMIN</div>
          <div style={{ fontSize: 9,  color: colors.inkDim }}>Internal tools — restricted access</div>
          <input
            type="password"
            placeholder="Password"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            autoFocus
            style={{
              background:   colors.bg,
              border:       `0.8px solid ${error ? colors.danger : colors.border}`,
              borderRadius: 6,
              color:        colors.ink,
              fontFamily:   'Space Mono, monospace',
              fontSize:     11,
              padding:      '10px 14px',
              outline:      'none',
            }}
          />
          {error && <div style={{ fontSize: 8, color: colors.danger }}>{error}</div>}
          <button
            onClick={handleLogin}
            style={{
              background:    colors.accent,
              border:        'none',
              borderRadius:  6,
              color:         '#fff',
              fontFamily:    'Space Mono, monospace',
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: '1.5px',
              padding:       '10px',
              cursor:        'pointer',
            }}
          >
            ENTER
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight:  '100vh',
      background: colors.bg,
      fontFamily: 'Space Mono, monospace',
      padding:    32,
    }}>
      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   32,
        paddingBottom:  16,
        borderBottom:   `0.8px solid ${colors.border}`,
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '3px', color: colors.ink }}>SEALER ADMIN</div>
          <div style={{ fontSize: 8,  color: colors.inkDim, marginTop: 4 }}>THE SEALER PROTOCOL · INTERNAL TOOLS</div>
        </div>
        <button
          onClick={() => { setAuthed(false); setPassword(''); setPwInput(''); }}
          style={{
            background:    'transparent',
            border:        `0.8px solid ${colors.border}`,
            borderRadius:  6,
            color:         colors.inkDim,
            fontFamily:    'Space Mono, monospace',
            fontSize:      8,
            letterSpacing: '1px',
            padding:       '6px 12px',
            cursor:        'pointer',
          }}
        >
          LOCK
        </button>
      </div>

      {/* Panels */}
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 40 }}>

        {/* Social Queue */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: '2px', color: colors.inkDim, marginBottom: 12 }}>
            SOCIAL MEDIA
          </div>
          <SocialQueuePanel />
        </div>

        {/* Agent Feedback */}
        <div>
          <div style={{ fontSize: 9, letterSpacing: '2px', color: colors.inkDim, marginBottom: 12 }}>
            SEALER AGENT FEEDBACK
          </div>
          <FeedbackPanel password={password} />
        </div>

      </div>
    </div>
  );
}