'use client';
// src/app/agent/[handleOrWallet]/page.tsx
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

function truncate(a: string) {
  if (!a) return '—';
  return a.slice(0, 6) + '···' + a.slice(-4);
}
function medalColor(rank: number): string {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return '#5a7090';
}
const STATUS_COLORS: Record<string, string> = {
  achieved: '#22c55e', failed: '#ef4444', pending: '#f59e0b',
  verifying: '#3b82f6', expired: '#6b7280', amended:   '#e09020',
};
const STATUS_LABELS: Record<string, string> = {
  achieved: '✓ Achieved', failed: '✗ Failed', pending: '⏳ Pending',
  verifying: '🔍 Verifying', expired: '— Expired', amended:   '✎ Amended',
};

export default function AgentProfilePage() {
  const params         = useParams();
  const router         = useRouter();
  const handleOrWallet = params.handleOrWallet as string;

  const [profile,  setProfile]  = useState<any>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    if (!handleOrWallet) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    fetch(`/api/agent/${encodeURIComponent(handleOrWallet)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setProfile(d);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load profile'); setLoading(false); });
  }, [handleOrWallet]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const val = search.trim();
    if (!val) return;
    router.push(`/agent/${encodeURIComponent(val)}`);
    setSearch('');
  }

  const accent    = '#3b82f6';
  const bg        = '#0d1117';
  const hdrBg     = '#0a0f1e';
  const ink       = '#c8d8f0';
  const inkDim    = '#5a7090';
  const faint     = '#1e2d4a';

  const hasSID       = !!profile?.sid;
  const displayName  = hasSID && profile.sid.name && profile.sid.name !== 'UNNAMED AGENT'
    ? profile.sid.name
    : null;
  const entityType   = profile?.sid?.entityType || null;
  const entityColor  = entityType === 'AI_AGENT' ? accent
    : entityType === 'HUMAN' ? '#9ca3af' : '#f59e0b';

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
        .wrap { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
        .nav {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 0 8px;
        }
        .nav-left { display: flex; align-items: center; gap: 12px; }
        .nav-logo { width: 22px; height: 22px; opacity: 0.85; }
        .back-link {
          font-size: 8px; color: ${inkDim}; letter-spacing: 1px;
          text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
        }
        .back-link:hover { color: ${accent}; }
        .search-form { display: flex; gap: 8px; align-items: center; }
        .search-input {
          background: ${faint}22; border: 0.8px solid ${faint};
          border-radius: 20px; padding: 6px 14px;
          font-family: monospace; font-size: 9px; color: ${ink};
          outline: none; width: 200px;
        }
        .search-input::placeholder { color: ${inkDim}; }
        .search-input:focus { border-color: ${accent}; }
        .search-btn {
          padding: 6px 14px; border-radius: 20px; font-size: 8px; font-weight: 700;
          letter-spacing: 1px; cursor: pointer; border: 0.8px solid ${accent};
          background: transparent; color: ${accent}; font-family: monospace;
        }
        .search-btn:hover { background: ${accent}18; }

        .profile-header {
          background: ${hdrBg}; border-radius: 12px;
          border: 1px solid ${faint}; overflow: hidden;
        }
        .accent-bar { height: 2.5px; background: ${accent}; opacity: 0.9; }
        .header-inner { padding: 20px 24px; display: flex; gap: 20px; align-items: flex-start; }
        .avatar {
          width: 80px; height: 80px; border-radius: 8px; flex-shrink: 0;
          background: ${faint}; overflow: hidden; border: 0.8px solid ${faint};
          display: flex; align-items: center; justify-content: center;
        }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        .header-info { flex: 1; min-width: 0; }
        .header-handle { font-size: 20px; color: ${accent}; letter-spacing: 1px; margin-bottom: 4px; }
        .header-name { font-family: Georgia, serif; font-size: 14px; color: ${ink}; margin-bottom: 6px; }
        .header-wallet { font-size: 8px; color: ${inkDim}; letter-spacing: 0.5px; margin-bottom: 10px; word-break: break-all; }
        .header-pills { display: flex; gap: 8px; flex-wrap: wrap; }
        .pill {
          height: 18px; padding: 0 10px; border-radius: 9px;
          display: flex; align-items: center;
          font-size: 7px; letter-spacing: 1px;
        }
        .header-stats { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .stat-pts { font-size: 28px; font-weight: 700; color: ${ink}; line-height: 1; }
        .stat-lbl { font-size: 6px; color: ${inkDim}; letter-spacing: 1px; }
        .rank-badge {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          border: 1.5px solid; font-size: 13px; font-weight: 700; margin-top: 4px;
        }
        .section { background: ${bg}; border-radius: 12px; border: 1px solid ${faint}; overflow: hidden; }
        .section-header {
          padding: 12px 20px; border-bottom: 0.8px solid ${faint};
          font-size: 7px; color: ${inkDim}; letter-spacing: 1.5px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .commitment-row {
          padding: 14px 20px; border-bottom: 0.8px solid ${faint}22;
          display: flex; align-items: center; gap: 16px; transition: background .15s;
        }
        .commitment-row:last-child { border-bottom: none; }
        .commitment-row:hover { background: ${faint}22; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .commitment-info { flex: 1; min-width: 0; }
        .commitment-type { font-size: 7px; color: ${inkDim}; letter-spacing: 1px; margin-bottom: 3px; }
        .commitment-statement { font-size: 9px; color: ${ink}; line-height: 1.4; }
        .commitment-deadline { font-size: 7px; color: ${inkDim}; margin-top: 3px; }
        .commitment-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .commitment-pts { font-size: 13px; font-weight: 700; }
        .commitment-status { font-size: 7px; letter-spacing: 0.5px; }
        .commitment-diff {
          width: 26px; height: 26px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          border: 1px solid ${faint}; font-size: 9px; font-weight: 700; color: ${inkDim};
        }
        .empty { padding: 32px 20px; text-align: center; font-size: 9px; color: ${inkDim}; letter-spacing: 1px; }
        .loading { padding: 60px 24px; text-align: center; font-size: 9px; color: ${inkDim}; letter-spacing: 1px; }
        .error-msg { padding: 60px 24px; text-align: center; font-size: 9px; color: #ef4444; letter-spacing: 1px; }
      `}</style>

      <div className="wrap">
        {/* Nav */}
        <div className="nav">
          <div className="nav-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-small.png" alt="" className="nav-logo"/>
            <a className="back-link" href="/leaderboard">← LEADERBOARD</a>
          </div>
          <form className="search-form" onSubmit={handleSearch}>
            <input
              className="search-input"
              placeholder="Search handle or wallet..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="search-btn" type="submit">SEARCH</button>
          </form>
        </div>

        {loading && <div className="loading">Loading agent profile...</div>}
        {error   && <div className="error-msg">{error}</div>}

        {!loading && !error && profile && (
          <>
            {/* Header */}
            <div className="profile-header">
              <div className="accent-bar"/>
              <div className="header-inner">
                <div className="avatar">
                  {profile.sid?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.sid.imageUrl} alt={displayName || profile.wallet}/>
                  ) : (
                    <svg width="40" height="40" viewBox="0 0 60 60" fill="none">
                      <circle cx="30" cy="30" r="28" stroke="#5a7090" strokeWidth="1.5" opacity="0.5"/>
                      <circle cx="30" cy="24" r="10" fill="#5a7090" opacity="0.3"/>
                      <ellipse cx="30" cy="46" rx="16" ry="10" fill="#5a7090" opacity="0.3"/>
                    </svg>
                  )}
                </div>

                <div className="header-info">
                  {profile.handle
                    ? <div className="header-handle">@{profile.handle}</div>
                    : <div className="header-handle" style={{opacity:0.5, fontSize:14}}>{truncate(profile.wallet)}</div>
                  }
                  {displayName && <div className="header-name">{displayName}</div>}
                  <div className="header-wallet">{profile.wallet}</div>
                  <div className="header-pills">
                    {entityType && (
                      <div className="pill" style={{background:`${entityColor}18`, border:`0.8px solid ${entityColor}80`, color: entityColor}}>
                        {entityType === 'AI_AGENT' ? 'AI AGENT' : entityType}
                      </div>
                    )}
                    {profile.sid?.chain && (
                      <div className="pill" style={{background:`${accent}18`, border:`0.8px solid ${accent}80`, color: accent}}>
                        {profile.sid.chain.toUpperCase()}
                      </div>
                    )}
                    {hasSID && profile.sid?.tokenId !== undefined && (
                      <div className="pill" style={{background:faint, border:`0.8px solid ${faint}`, color: inkDim}}>
                        SID #{profile.sid.tokenId}
                      </div>
                    )}
                  </div>
                </div>

                <div className="header-stats">
                  <div className="stat-pts">{profile.totalProofPoints.toLocaleString()}</div>
                  <div className="stat-lbl">PROOF POINTS</div>
                  <div className="stat-lbl" style={{marginTop:4}}>
                    {profile.achievementCount} ACHIEVEMENT{profile.achievementCount !== 1 ? 'S' : ''}
                  </div>
                  {profile.rank && (
                    <div className="rank-badge" style={{borderColor: medalColor(profile.rank), color: medalColor(profile.rank)}}>
                      {profile.rank <= 3 ? ['🥇','🥈','🥉'][profile.rank - 1] : `#${profile.rank}`}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Commitments */}
            <div className="section">
              <div className="section-header">
                <span>COMMITMENTS & ACHIEVEMENTS</span>
                <span>{profile.commitments.length} total</span>
              </div>
              {profile.commitments.length === 0 ? (
                <div className="empty">No commitments yet</div>
              ) : (
                profile.commitments.map((c: any, i: number) => (
                  <div key={i} className="commitment-row">
                    <div className="status-dot" style={{background: STATUS_COLORS[c.status] || '#5a7090'}}/>
                    <div className="commitment-info">
                      <div className="commitment-type">{c.claimLabel}</div>
                      <div className="commitment-statement">
                        {c.statement?.slice(0, 100)}{c.statement?.length > 100 ? '…' : ''}
                      </div>
                      {c.deadline && (
                        <div className="commitment-deadline">
                          Deadline: {new Date(c.deadline).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}
                        </div>
                      )}
                    </div>
                    <div className="commitment-right">
                      <div className="commitment-pts" style={{color: STATUS_COLORS[c.status] || inkDim}}>
                        {c.proofPoints > 0 ? c.proofPoints.toLocaleString() : '—'}
                      </div>
                      <div className="commitment-status" style={{color: STATUS_COLORS[c.status] || inkDim}}>
                        {STATUS_LABELS[c.status] || c.status}
                      </div>
                      {c.difficulty > 0 && (
                        <div className="commitment-diff">{c.difficulty}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}