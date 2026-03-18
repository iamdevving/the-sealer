// src/components/SocialQueuePanel.tsx
// Social post draft review panel — plugs into Sealer Agent page
'use client';
import { useState, useEffect, useCallback } from 'react';

type Platform    = 'x' | 'farcaster';
type DraftStatus = 'pending' | 'approved' | 'rejected' | 'posted';

interface SocialDraft {
  id:          string;
  text:        string;
  platforms:   Platform[];
  trigger:     string;
  triggerData: Record<string, any>;
  status:      DraftStatus;
  createdAt:   string;
  updatedAt:   string;
}

interface DiscussMessage { role: 'user' | 'assistant'; content: string; }

const colors = {
  bg:      '#0a0a0f',
  surface: '#12121a',
  border:  '#1e1e2e',
  accent:  '#3b82f6',
  ink:     '#e2e8f0',
  inkDim:  '#64748b',
  success: '#22c55e',
  warning: '#f59e0b',
  danger:  '#ef4444',
  x:       '#ffffff',
  fc:      '#8b5cf6',
};

function PlatformBadge({ platform }: { platform: Platform }) {
  const style: React.CSSProperties = {
    display:       'inline-flex',
    alignItems:    'center',
    gap:           4,
    padding:       '2px 8px',
    borderRadius:  4,
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: '1px',
    fontFamily:    'Space Mono, monospace',
    background:    platform === 'x' ? 'rgba(255,255,255,0.08)' : 'rgba(139,92,246,0.15)',
    color:         platform === 'x' ? colors.x : colors.fc,
    border:        `0.8px solid ${platform === 'x' ? 'rgba(255,255,255,0.2)' : 'rgba(139,92,246,0.4)'}`,
  };
  return <span style={style}>{platform === 'x' ? '𝕏 X' : '🟣 FARCASTER'}</span>;
}

function DraftCard({
  draft,
  onUpdate,
  onDelete,
}: {
  draft:    SocialDraft;
  onUpdate: (id: string, updates: Partial<SocialDraft>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editText,      setEditText]      = useState(draft.text);
  const [isEditing,     setIsEditing]     = useState(false);
  const [isDiscussing,  setIsDiscussing]  = useState(false);
  const [discussInput,  setDiscussInput]  = useState('');
  const [discussMsgs,   setDiscussMsgs]   = useState<DiscussMessage[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [copied,        setCopied]        = useState<Platform | null>(null);

  const charCount = editText.length;
  const overLimit = charCount > 280;

  async function handleApprove() {
    await onUpdate(draft.id, { status: 'approved', text: editText });
  }
  async function handleReject() {
    await onUpdate(draft.id, { status: 'rejected' });
  }
  async function handleMarkPosted(platform: Platform) {
    navigator.clipboard.writeText(editText);
    setCopied(platform);
    setTimeout(() => setCopied(null), 2000);
  }
  async function handleSaveEdit() {
    await onUpdate(draft.id, { text: editText });
    setIsEditing(false);
  }

  async function handleDiscuss() {
    if (!discussInput.trim() || loading) return;
    setLoading(true);
    const userMsg = discussInput.trim();
    setDiscussInput('');
    setDiscussMsgs(prev => [...prev, { role: 'user', content: userMsg }]);

    try {
      const res = await fetch('/api/social/refine', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          currentText: editText,
          instruction: userMsg,
          trigger:     draft.trigger,
          triggerData: draft.triggerData,
          platforms:   draft.platforms,
          history:     discussMsgs,
        }),
      });
      const data = await res.json();
      if (data.text) {
        setEditText(data.text);
        setDiscussMsgs(prev => [...prev, { role: 'assistant', content: `Updated: "${data.text}"` }]);
      } else {
        setDiscussMsgs(prev => [...prev, { role: 'assistant', content: data.message || 'Could not refine.' }]);
      }
    } catch (e) {
      setDiscussMsgs(prev => [...prev, { role: 'assistant', content: 'Error refining post.' }]);
    }
    setLoading(false);
  }

  const cardStyle: React.CSSProperties = {
    background:   colors.surface,
    border:       `0.8px solid ${colors.border}`,
    borderRadius: 8,
    padding:      16,
    display:      'flex',
    flexDirection: 'column',
    gap:          12,
  };

  const metaStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    flexWrap:   'wrap',
  };

  const triggerStyle: React.CSSProperties = {
    fontSize:      8,
    color:         colors.inkDim,
    letterSpacing: '0.5px',
    fontFamily:    'Space Mono, monospace',
    flex:          1,
  };

  const textareaStyle: React.CSSProperties = {
    width:       '100%',
    background:  colors.bg,
    border:      `0.8px solid ${overLimit ? colors.danger : colors.border}`,
    borderRadius: 6,
    color:       colors.ink,
    fontFamily:  'Space Mono, monospace',
    fontSize:    11,
    lineHeight:  1.6,
    padding:     10,
    resize:      'vertical',
    minHeight:   80,
    outline:     'none',
    boxSizing:   'border-box',
  };

  const btnStyle = (variant: 'primary' | 'ghost' | 'danger' | 'success'): React.CSSProperties => ({
    padding:       '7px 14px',
    borderRadius:  6,
    fontFamily:    'Space Mono, monospace',
    fontSize:      8,
    fontWeight:    700,
    letterSpacing: '1px',
    cursor:        'pointer',
    border:        '0.8px solid',
    background:    variant === 'primary' ? colors.accent
                 : variant === 'success' ? `${colors.success}18`
                 : variant === 'danger'  ? `${colors.danger}18`
                 : 'transparent',
    color:         variant === 'primary' ? '#fff'
                 : variant === 'success' ? colors.success
                 : variant === 'danger'  ? colors.danger
                 : colors.inkDim,
    borderColor:   variant === 'primary' ? colors.accent
                 : variant === 'success' ? `${colors.success}44`
                 : variant === 'danger'  ? `${colors.danger}44`
                 : colors.border,
  });

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={metaStyle}>
        {draft.platforms.map(p => <PlatformBadge key={p} platform={p}/>)}
        <span style={triggerStyle}>↳ {draft.trigger}</span>
        <span style={{fontSize:8, color:colors.inkDim, fontFamily:'Space Mono,monospace'}}>
          {new Date(draft.createdAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Text */}
      <div>
        {isEditing ? (
          <textarea
            style={textareaStyle}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            autoFocus
          />
        ) : (
          <div style={{
            background:   colors.bg,
            border:       `0.8px solid ${colors.border}`,
            borderRadius: 6,
            padding:      10,
            fontFamily:   'Space Mono, monospace',
            fontSize:     11,
            color:        colors.ink,
            lineHeight:   1.6,
            whiteSpace:   'pre-wrap',
          }}>
            {editText}
          </div>
        )}
        <div style={{
          display:       'flex',
          justifyContent: 'space-between',
          marginTop:     4,
          fontSize:      8,
          fontFamily:    'Space Mono, monospace',
          color:         overLimit ? colors.danger : colors.inkDim,
        }}>
          <span>{overLimit ? '⚠ Over X limit' : ''}</span>
          <span>{charCount}/280</span>
        </div>
      </div>

      {/* Discuss thread */}
      {isDiscussing && (
        <div style={{background:colors.bg, border:`0.8px solid ${colors.border}`, borderRadius:6, padding:10}}>
          {discussMsgs.map((m, i) => (
            <div key={i} style={{
              fontSize:   9,
              fontFamily: 'Space Mono, monospace',
              color:      m.role === 'user' ? colors.inkDim : colors.ink,
              marginBottom: 6,
              lineHeight: 1.5,
            }}>
              <span style={{color: m.role === 'user' ? colors.accent : colors.success, marginRight:6}}>
                {m.role === 'user' ? 'YOU' : 'AGENT'}
              </span>
              {m.content}
            </div>
          ))}
          <div style={{display:'flex', gap:6, marginTop:8}}>
            <input
              style={{
                flex:        1,
                background:  colors.surface,
                border:      `0.8px solid ${colors.border}`,
                borderRadius: 4,
                color:       colors.ink,
                fontFamily:  'Space Mono, monospace',
                fontSize:    9,
                padding:     '6px 10px',
                outline:     'none',
              }}
              placeholder="make it shorter / add more context..."
              value={discussInput}
              onChange={e => setDiscussInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDiscuss()}
              disabled={loading}
            />
            <button style={btnStyle('primary')} onClick={handleDiscuss} disabled={loading}>
              {loading ? '...' : 'SEND'}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {isEditing ? (
          <>
            <button style={btnStyle('success')} onClick={handleSaveEdit}>SAVE</button>
            <button style={btnStyle('ghost')} onClick={() => { setEditText(draft.text); setIsEditing(false); }}>CANCEL</button>
          </>
        ) : (
          <>
            <button style={btnStyle('success')} onClick={handleApprove}>✓ APPROVE</button>
            <button style={btnStyle('ghost')} onClick={() => setIsEditing(true)}>✎ EDIT</button>
            <button style={btnStyle('ghost')} onClick={() => setIsDiscussing(!isDiscussing)}>
              {isDiscussing ? 'CLOSE CHAT' : '💬 DISCUSS'}
            </button>
            {draft.platforms.map(p => (
              <button key={p} style={btnStyle('ghost')} onClick={() => handleMarkPosted(p)}>
                {copied === p ? '✓ COPIED' : `COPY FOR ${p.toUpperCase()}`}
              </button>
            ))}
            <button style={btnStyle('danger')} onClick={() => onDelete(draft.id)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SocialQueuePanel() {
  const [drafts,      setDrafts]      = useState<SocialDraft[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [isOpen,      setIsOpen]      = useState(false);
  const [filter,      setFilter]      = useState<DraftStatus | 'all'>('pending');

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/social/queue?status=${filter === 'all' ? '' : filter}`);
      const data = await res.json();
      setDrafts(data.drafts || []);
    } catch {}
    setLoading(false);
  }, [filter]);

  useEffect(() => { if (isOpen) fetchDrafts(); }, [isOpen, fetchDrafts]);

  async function handleUpdate(id: string, updates: Partial<SocialDraft>) {
    await fetch('/api/social/queue', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, ...updates }),
    });
    fetchDrafts();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/social/queue?id=${id}`, { method: 'DELETE' });
    fetchDrafts();
  }

  const pendingCount = drafts.filter(d => d.status === 'pending').length;

  return (
    <div style={{
      fontFamily:  'Space Mono, monospace',
      borderTop:   `0.8px solid ${colors.border}`,
      marginTop:   16,
    }}>
      {/* Toggle header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width:          '100%',
          background:     'transparent',
          border:         'none',
          borderBottom:   isOpen ? `0.8px solid ${colors.border}` : 'none',
          padding:        '12px 0',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          cursor:         'pointer',
          color:          colors.ink,
        }}
      >
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span style={{fontSize:9, letterSpacing:'2px', color:colors.inkDim}}>📬 SOCIAL QUEUE</span>
          {pendingCount > 0 && (
            <span style={{
              background:   colors.accent,
              color:        '#fff',
              borderRadius: 10,
              padding:      '1px 7px',
              fontSize:     8,
              fontWeight:   700,
            }}>
              {pendingCount}
            </span>
          )}
        </div>
        <span style={{fontSize:9, color:colors.inkDim}}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div style={{paddingTop:12, display:'flex', flexDirection:'column', gap:12}}>
          {/* Filter tabs */}
          <div style={{display:'flex', gap:6}}>
            {(['pending','approved','all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding:       '4px 10px',
                  borderRadius:  4,
                  fontFamily:    'Space Mono, monospace',
                  fontSize:      8,
                  fontWeight:    700,
                  letterSpacing: '1px',
                  cursor:        'pointer',
                  border:        '0.8px solid',
                  background:    filter === f ? colors.accent : 'transparent',
                  color:         filter === f ? '#fff' : colors.inkDim,
                  borderColor:   filter === f ? colors.accent : colors.border,
                }}
              >
                {f.toUpperCase()}
              </button>
            ))}
            <button
              onClick={fetchDrafts}
              style={{
                marginLeft:    'auto',
                padding:       '4px 10px',
                borderRadius:  4,
                fontFamily:    'Space Mono, monospace',
                fontSize:      8,
                cursor:        'pointer',
                border:        `0.8px solid ${colors.border}`,
                background:    'transparent',
                color:         colors.inkDim,
              }}
            >
              ↻ REFRESH
            </button>
          </div>

          {/* Drafts */}
          {loading ? (
            <div style={{fontSize:9, color:colors.inkDim, textAlign:'center', padding:20}}>LOADING...</div>
          ) : drafts.length === 0 ? (
            <div style={{fontSize:9, color:colors.inkDim, textAlign:'center', padding:20}}>
              No {filter === 'all' ? '' : filter} drafts
            </div>
          ) : (
            drafts.map(draft => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
