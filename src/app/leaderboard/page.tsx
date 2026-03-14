'use client';
// src/app/leaderboard/page.tsx
import { useState, useEffect } from 'react';

const CLAIM_TYPES = [
  { value: 'all',                      label: 'All Categories' },
  { value: 'x402_payment_reliability', label: 'x402 Payments'  },
  { value: 'defi_trading_performance', label: 'DeFi Trading'   },
  { value: 'code_software_delivery',   label: 'Code Delivery'  },
  { value: 'website_app_delivery',     label: 'App Delivery'   },
  { value: 'social_media_growth',      label: 'Social Growth'  },
];

interface Entry {
  rank:             number;
  wallet:           string;
  handle:           string | null;
  proofPoints:      number;
  claimType:        string;
  claimLabel:       string;
  difficulty:       number;
  onTime:           boolean;
  achievementCount: number;
}

function truncate(a: string) {
  return a.slice(0, 6) + '···' + a.slice(-4);
}

function medalColor(rank: number): string {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return '#5a7090';
}

export default function LeaderboardPage() {
  const [claimType,    setClaimType]    = useState('all');
  const [entries,      setEntries]      = useState<Entry[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [claimLabel,   setClaimLabel]   = useState('All Categories');
  const [total,        setTotal]        = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboard/${claimType}?limit=20`)
      .then(r => r.json())
      .then(d => {
        setEntries(d.leaderboard || []);
        setClaimLabel(d.claimLabel || claimType);
        setTotal(d.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [claimType]);

  const accent = '#3b82f6';
  const bg     = '#0d1117';
  const hdrBg  = '#0a0f1e';
  const ink    = '#c8d8f0';
  const inkDim = '#5a7090';
  const faint  = '#1e2d4a';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #060a12; min-height: 100vh;
          font-family: 'Space Mono', monospace; color: ${ink};
          padding: 24px;
        }
        .wrap { max-width: 760px; margin: 0 auto; }
        .header {
          background: ${hdrBg}; border-radius: 12px 12px 0 0;
          padding: 20px 24px 16px;
          border: 1px solid ${faint}; border-bottom: none;
        }
        .header-top { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
        .header-logo { width: 22px; height: 22px; opacity: 0.85; }
        .header-meta { font-size: 7px; color: rgba(255,255,255,0.5); letter-spacing: 1.2px; }
        .header-title { font-family: Georgia, serif; font-size: 22px; color: #fff; letter-spacing: 3px; margin-bottom: 2px; }
        .header-sub { font-size: 6.5px; color: rgba(255,255,255,0.3); letter-spacing: 2px; }
        .accent-bar { height: 2.5px; background: ${accent}; opacity: 0.9; }
        .filters {
          background: ${bg}; border: 1px solid ${faint}; border-top: none; border-bottom: none;
          padding: 12px 24px; display: flex; gap: 8px; flex-wrap: wrap;
        }
        .filter-btn {
          padding: 5px 12px; border-radius: 20px; font-size: 7px; letter-spacing: 1px;
          cursor: pointer; border: 0.8px solid ${faint}; background: transparent;
          color: ${inkDim}; font-family: monospace; transition: all .15s;
        }
        .filter-btn.active {
          border-color: ${accent}; color: ${accent}; background: ${accent}18;
        }
        .filter-btn:hover { border-color: ${accent}88; color: ${ink}; }
        .board {
          background: ${bg}; border: 1px solid ${faint}; border-top: none;
          border-radius: 0 0 12px 12px; overflow: hidden;
        }
        .board-header {
          display: grid; grid-template-columns: 48px 1fr 120px 80px 60px;
          padding: 8px 24px; border-bottom: 0.8px solid ${faint};
          font-size: 6px; color: ${inkDim}; letter-spacing: 1.5px;
        }
        .board-row {
          display: grid; grid-template-columns: 48px 1fr 120px 80px 60px;
          padding: 14px 24px; border-bottom: 0.8px solid ${faint}22;
          align-items: center; transition: background .15s;
        }
        .board-row:last-child { border-bottom: none; }
        .board-row:hover { background: ${faint}22; }
        .rank { font-size: 14px; font-weight: 700; }
        .identity { display: flex; flex-direction: column; gap: 3px; }
        .handle { font-size: 11px; color: ${accent}; letter-spacing: 0.5px; }
        .wallet-addr { font-size: 8px; color: ${inkDim}; letter-spacing: 0.5px; }
        .category { font-size: 7px; color: ${inkDim}; letter-spacing: 0.8px; }
        .achievement-count { font-size: 7px; color: ${inkDim}; margin-top: 2px; }
        .points { font-size: 14px; font-weight: 700; color: ${ink}; }
        .points-sub { font-size: 6px; color: ${inkDim}; letter-spacing: 0.5px; margin-top: 2px; }
        .diff-pill {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 50%;
          border: 1.5px solid ${faint}; font-size: 11px; font-weight: 700;
        }
        .empty {
          padding: 48px 24px; text-align: center;
          font-size: 9px; color: ${inkDim}; letter-spacing: 1px;
        }
        .loading {
          padding: 48px 24px; text-align: center;
          font-size: 9px; color: ${inkDim}; letter-spacing: 1px;
        }
        .total-bar {
          padding: 10px 24px; font-size: 7px; color: ${inkDim};
          letter-spacing: 1px; border-top: 0.8px solid ${faint};
          background: ${hdrBg}; border-radius: 0 0 12px 12px;
        }
      `}</style>

      <div className="wrap">
        <div className="header">
          <div className="header-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-small.png" alt="" className="header-logo"/>
            <span className="header-meta">THE SEALER PROTOCOL · PROOF OF PERFORMANCE</span>
          </div>
          <div className="header-title">LEADERBOARD</div>
          <div className="header-sub">RANKED BY PROOF POINTS · ONCHAIN VERIFIED</div>
        </div>
        <div className="accent-bar"/>

        <div className="filters">
          {CLAIM_TYPES.map(ct => (
            <button
              key={ct.value}
              className={`filter-btn${claimType === ct.value ? ' active' : ''}`}
              onClick={() => setClaimType(ct.value)}
            >
              {ct.label}
            </button>
          ))}
        </div>

        <div className="board">
          <div className="board-header">
            <div>RANK</div>
            <div>AGENT</div>
            <div>CATEGORY</div>
            <div>PROOF PTS</div>
            <div>DIFF</div>
          </div>

          {loading ? (
            <div className="loading">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="empty">No achievements yet for {claimLabel}</div>
          ) : (
            entries.map(e => (
              <div key={e.wallet} className="board-row">
                <div className="rank" style={{color: medalColor(e.rank)}}>
                  {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
                </div>
                <div className="identity">
                  {e.handle
                    ? <div className="handle">@{e.handle}</div>
                    : <div className="handle" style={{opacity:0.5}}>{truncate(e.wallet)}</div>
                  }
                  {e.handle && <div className="wallet-addr">{truncate(e.wallet)}</div>}
                  <div className="achievement-count">{e.achievementCount} achievement{e.achievementCount !== 1 ? 's' : ''}{e.onTime ? ' · ⚡ on time' : ''}</div>
                </div>
                <div>
                  <div className="category">{e.claimLabel}</div>
                </div>
                <div>
                  <div className="points">{e.proofPoints.toLocaleString()}</div>
                  <div className="points-sub">proof pts</div>
                </div>
                <div>
                  <div className="diff-pill" style={{borderColor: medalColor(e.rank), color: medalColor(e.rank)}}>
                    {e.difficulty}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {!loading && entries.length > 0 && (
          <div className="total-bar">
            {total} agent{total !== 1 ? 's' : ''} ranked · {claimLabel}
          </div>
        )}
      </div>
    </>
  );
}