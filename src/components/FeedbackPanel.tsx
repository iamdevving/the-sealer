'use client';
// src/components/FeedbackPanel.tsx
// Displays Sealer Agent /feedback submissions from Redis.
// Auth via ADMIN_PASSWORD passed as Bearer token.

import { useState, useEffect, useCallback } from 'react';

interface FeedbackEntry {
  text:      string;
  ip:        string;
  timestamp: string;
}

const colors = {
  bg:      '#0a0a0f',
  surface: '#12121a',
  border:  '#1e1e2e',
  accent:  '#3b82f6',
  ink:     '#e2e8f0',
  inkDim:  '#64748b',
  danger:  '#ef4444',
  success: '#22c55e',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

interface FeedbackPanelProps {
  password: string; // admin password, passed down from admin page after auth
}

export default function FeedbackPanel({ password }: FeedbackPanelProps) {
  const [entries,  setEntries]  = useState<FeedbackEntry[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/feedback', {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setEntries(data.feedback ?? []);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(`Failed to load: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const s: React.CSSProperties = {
    background:   colors.surface,
    border:       `0.8px solid ${colors.border}`,
    borderRadius: 8,
    overflow:     'hidden',
  };

  return (
    <div style={s}>
      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '12px 16px',
        borderBottom:   `0.8px solid ${colors.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '2px', color: colors.ink }}>
            AGENT FEEDBACK
          </div>
          {entries.length > 0 && (
            <div style={{
              background:    `${colors.accent}22`,
              border:        `0.8px solid ${colors.accent}60`,
              borderRadius:  4,
              fontSize:      8,
              color:         colors.accent,
              padding:       '2px 8px',
              letterSpacing: '1px',
            }}>
              {entries.length}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastFetch && (
            <div style={{ fontSize: 7, color: colors.inkDim }}>
              updated {timeAgo(lastFetch.toISOString())}
            </div>
          )}
          <button
            onClick={load}
            disabled={loading}
            style={{
              background:    'transparent',
              border:        `0.8px solid ${colors.border}`,
              borderRadius:  4,
              color:         loading ? colors.inkDim : colors.ink,
              fontFamily:    'Space Mono, monospace',
              fontSize:      7,
              letterSpacing: '1px',
              padding:       '4px 10px',
              cursor:        loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'LOADING...' : 'REFRESH'}
          </button>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div style={{ padding: 16, fontSize: 9, color: colors.danger }}>{error}</div>
      ) : loading && entries.length === 0 ? (
        <div style={{ padding: 20, fontSize: 8, color: colors.inkDim, textAlign: 'center' }}>
          Loading feedback...
        </div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 20, fontSize: 8, color: colors.inkDim, textAlign: 'center' }}>
          No feedback yet. Users can submit via <code style={{ color: colors.accent }}>/feedback</code> in the Sealer Agent chat.
        </div>
      ) : (
        <div>
          {entries.map((e, i) => (
            <div
              key={i}
              style={{
                padding:      '14px 16px',
                borderBottom: i < entries.length - 1 ? `0.8px solid ${colors.border}22` : 'none',
              }}
            >
              {/* Message */}
              <div style={{
                fontSize:    10,
                color:       colors.ink,
                lineHeight:  1.6,
                marginBottom: 8,
              }}>
                {e.text}
              </div>
              {/* Meta */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 7, color: colors.inkDim, letterSpacing: '0.5px' }}>
                  {new Date(e.timestamp).toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
                <div style={{ fontSize: 7, color: colors.inkDim }}>
                  {timeAgo(e.timestamp)}
                </div>
                <div style={{
                  fontSize:      7,
                  color:         colors.inkDim,
                  fontFamily:    'monospace',
                  background:    `${colors.border}80`,
                  padding:       '1px 6px',
                  borderRadius:  3,
                }}>
                  {e.ip || '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
