'use client';
// src/app/card/CardPage.tsx
import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARK_WHITE, MARK_BLACK } from '@/lib/assets';

const THEMES: Record<string, {
  bg: string; headerBg: string; headerText: string;
  accent: string; accentDim: string; accentRgb: string;
  bodyText: string; bodyTextDim: string;
  statBg: string; statBorder: string;
  bandBg: string; border: string; uploadBg: string; dark: boolean;
}> = {
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', accentRgb:'0,229,255', bodyText:'#d0eef5', bodyTextDim:'#7ab8cc', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', border:'#0d3040', uploadBg:'#04090f', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', accentRgb:'0,188,212', bodyText:'#cce8ee', bodyTextDim:'#5a9aa8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', border:'#0d3040', uploadBg:'#030a12', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', accentRgb:'139,26,26', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#f2ead8', border:'#c9b882', uploadBg:'#ede6d4', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', accentRgb:'167,139,250', bodyText:'#ddd6fe', bodyTextDim:'#7060a0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', border:'#201840', uploadBg:'#04030e', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#93b4f5', accentRgb:'0,82,255', bodyText:'#0d1b2a', bodyTextDim:'#3a5080', statBg:'#d8e4ff', statBorder:'#93b4f5', bandBg:'#dce8ff', border:'#93b4f5', uploadBg:'#dce8ff', dark:false },
  'gold':         { bg:'#0e0b06', headerBg:'#070503', headerText:'#d4af37', accent:'#d4af37', accentDim:'#3a2e10', accentRgb:'212,175,55', bodyText:'#e8ddc0', bodyTextDim:'#8a7a50', statBg:'#120e07', statBorder:'#2a2010', bandBg:'#050300', border:'#2a2010', uploadBg:'#070503', dark:true },
  'silver':       { bg:'#0c0c10', headerBg:'#070709', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#2a3040', accentRgb:'192,200,216', bodyText:'#e0e8f0', bodyTextDim:'#6070a0', statBg:'#101018', statBorder:'#2a3040', bandBg:'#070709', border:'#2a3040', uploadBg:'#070709', dark:true },
  'bronze':       { bg:'#0e0803', headerBg:'#080400', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#3a2010', accentRgb:'205,127,50', bodyText:'#e8d0b0', bodyTextDim:'#806040', statBg:'#120a04', statBorder:'#2a1808', bandBg:'#050200', border:'#2a1808', uploadBg:'#080400', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#c97a10', headerText:'#ffffff', accent:'#ffffff', accentDim:'rgba(255,255,255,0.4)', accentRgb:'255,255,255', bodyText:'#1a0800', bodyTextDim:'#5a3010', statBg:'rgba(0,0,0,0.15)', statBorder:'rgba(255,255,255,0.2)', bandBg:'#c97a10', border:'rgba(255,255,255,0.25)', uploadBg:'rgba(0,0,0,0.1)', dark:false },
};

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function truncateHash(h: string) {
  return h ? '0x' + h.slice(2, 6) + '…' + h.slice(-4) : '0x????…????';
}

export default function CardPage() {
  const searchParams = useSearchParams();
  const theme      = searchParams.get('theme') || 'circuit-anim';
  const statement  = searchParams.get('statement') || searchParams.get('achievement') || 'Verified Statement';
  const agentId    = searchParams.get('agentId') || '????';
  const txHash     = searchParams.get('txHash') || '';
  const chain      = searchParams.get('chain') || 'Base';

  const t          = THEMES[theme] ?? THEMES['circuit-anim'];
  const uid        = truncateHash(txHash);
  const dateStr    = formatDate(new Date());
  const basescanUrl = txHash ? `https://basescan.org/tx/${txHash}` : '#';

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const [uidCopied, setUidCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist upload per TX hash
  useEffect(() => {
    if (txHash) {
      try {
        const saved = localStorage.getItem(`sealer-card-img-${txHash}`);
        if (saved) setUploadedImage(saved);
      } catch { /* storage unavailable */ }
    }
  }, [txHash]);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setUploadedImage(result);
      if (txHash) {
        try { localStorage.setItem(`sealer-card-img-${txHash}`, result); } catch { /* ok */ }
      }
    };
    reader.readAsDataURL(file);
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyUid() {
    navigator.clipboard.writeText(txHash || uid);
    setUidCopied(true);
    setTimeout(() => setUidCopied(false), 2000);
  }

  // SVG download URL — passes imageUrl if we have one uploaded (can't pass base64 in URL,
  // so for downloaded SVG we omit the image; the interactive page shows it instead)
  const svgUrl = `/api/card?theme=${theme}&statement=${encodeURIComponent(statement)}&agentId=${agentId}&txHash=${txHash}&chain=${chain}`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Cormorant+Garamond:ital,wght@0,600;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: ${t.dark ? '#020408' : '#c8d0da'};
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
          padding: 24px;
        }
        .page-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 600px; }

        /* Card shell */
        .card {
          width: 100%; max-width: 560px;
          background: ${t.bg}; border: 1px solid ${t.border}; border-radius: 14px;
          overflow: hidden; position: relative;
          box-shadow: 0 0 60px rgba(${t.accentRgb},0.08), 0 20px 60px rgba(0,0,0,0.4);
        }

        /* Circuit animation */
        ${theme === 'circuit-anim' ? `
        .trace { stroke-dasharray: 120; stroke-dashoffset: 120; animation: drawTrace 1.8s ease forwards; }
        .trace:nth-child(2){animation-delay:.15s} .trace:nth-child(3){animation-delay:.3s}
        .trace:nth-child(4){animation-delay:.45s} .trace:nth-child(5){animation-delay:.6s}
        .trace:nth-child(6){animation-delay:.75s} .trace:nth-child(7){animation-delay:.9s}
        .trace:nth-child(8){animation-delay:1.05s}
        @keyframes drawTrace { to { stroke-dashoffset: 0; } }
        .node { opacity: 0; animation: fadeNode 0.3s ease forwards; }
        .node:nth-child(1){animation-delay:1.2s} .node:nth-child(2){animation-delay:1.3s}
        .node:nth-child(3){animation-delay:1.4s} .node:nth-child(4){animation-delay:1.5s}
        .node:nth-child(5){animation-delay:1.6s} .node:nth-child(6){animation-delay:1.7s}
        .node:nth-child(7){animation-delay:1.8s}
        @keyframes fadeNode { to { opacity: 0.6; } }
        ` : ''}

        /* Header */
        .card-header {
          background: ${t.headerBg}; padding: 10px 22px;
          display: flex; justify-content: space-between; align-items: center;
          border-bottom: 1px solid ${t.border};
        }
        .header-title { font-size: 10px; font-weight: 700; color: ${t.headerText}; letter-spacing: 2.5px; }
        .header-uid { font-size: 9px; color: ${t.accentDim}; cursor: pointer; transition: color .2s; }
        .header-uid:hover { color: ${t.accent}; }
        .dashes { height: 3px; background: repeating-linear-gradient(90deg,${t.accent} 0,${t.accent} 7px,transparent 7px,transparent 11px); opacity:.5; }

        /* Upper: stamp col + upload */
        .upper { display: flex; min-height: 216px; }
        .stamp-col {
          width: 150px; flex-shrink: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 16px 12px; gap: 8px;
        }
        .stamp-img { width: 92px; height: 92px; filter: drop-shadow(0 4px 16px rgba(${t.accentRgb},.2)); }
        .stamp-label { font-size: 7px; font-weight: 700; color: ${t.accent}; letter-spacing: 2px; text-align: center; }
        .chain-pill {
          background: ${t.statBg}; border: .8px solid ${t.accent}; border-radius: 10px;
          padding: 3px 10px; font-size: 7px; font-weight: 700; color: ${t.accent}; letter-spacing: 1px;
        }

        /* Upload zone */
        .upload-zone {
          flex: 1; margin: 12px 12px 12px 0;
          border: 1.2px dashed ${t.accentDim}; border-radius: 8px;
          background: ${t.uploadBg}; display: flex; align-items: center; justify-content: center;
          cursor: pointer; overflow: hidden; transition: border-color .2s, box-shadow .2s; position: relative;
        }
        .upload-zone:hover { border-color: ${t.accent}; box-shadow: inset 0 0 20px rgba(${t.accentRgb},.05); }
        .upload-placeholder { text-align: center; pointer-events: none; }
        .upload-placeholder p { font-size: 9px; color: ${t.accentDim}; opacity: .5; letter-spacing: 1px; }
        .upload-placeholder small { font-size: 7px; color: ${t.accentDim}; opacity: .28; letter-spacing: .5px; }
        .upload-zone img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
        .upload-overlay {
          position: absolute; inset: 0; background: rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity .2s; border-radius: 6px;
        }
        .upload-zone:hover .upload-overlay { opacity: 1; }
        .upload-overlay span { font-size: 8px; color: #fff; letter-spacing: 1.5px; font-weight: 700; }

        /* Divider */
        .divider { padding: 0 22px; display: flex; align-items: center; gap: 12px; }
        .div-line { flex: 1; height: 1px; background: linear-gradient(90deg,transparent,${t.accentDim},transparent); opacity:.5; }
        .div-ornament { font-size: 10px; color: ${t.accentDim}; letter-spacing: 10px; opacity:.6; padding: 8px 0; }

        /* Statement text */
        .statement-section { padding: 16px 22px 24px; text-align: center; }
        .statement-label { font-size: 8px; font-weight: 700; color: ${t.accent}; letter-spacing: 4px; margin-bottom: 14px; }
        .statement-text {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 18px; font-style: italic; color: ${t.bodyText};
          line-height: 1.6; max-width: 480px; margin: 0 auto;
        }

        /* Stats row */
        .stats-bar {
          margin: 0 22px 16px; border: 1px solid ${t.statBorder}; border-radius: 4px;
          background: ${t.statBg}; display: grid; grid-template-columns: 1fr 1fr 1fr; overflow: hidden;
        }
        .stat-cell { padding: 10px 14px; text-align: center; border-right: 1px solid ${t.statBorder}; }
        .stat-cell:last-child { border-right: none; }
        .stat-label { font-size: 7px; font-weight: 700; color: ${t.accent}; letter-spacing: 2px; margin-bottom: 4px; }
        .stat-value { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 14px; font-weight: 700; color: ${t.bodyText}; }
        .stat-value.mono { font-family: 'Space Mono', monospace; font-size: 10px; cursor: pointer; transition: color .2s; }
        .stat-value.mono:hover { color: ${t.accent}; }

        /* Footer */
        .footer-verified {
          padding: 10px 22px; border-top: 1px solid ${t.statBorder};
          display: flex; justify-content: space-between; align-items: center;
        }
        .verified-text { font-size: 8px; font-weight: 700; color: ${t.accent}; letter-spacing: 2px; }
        .basescan-link a { font-size: 7px; color: ${t.accentDim}; text-decoration: none; display: block; transition: color .2s; text-align: right; }
        .basescan-link a:hover { color: ${t.accent}; }
        .bottom-band {
          background: ${t.bandBg}; border-top: 1px solid ${t.statBorder};
          padding: 8px 22px; display: flex; justify-content: space-between; align-items: center;
        }
        .band-text { font-size: 7.5px; color: ${t.accent}; opacity: .3; letter-spacing: 2px; }

        /* Actions */
        .actions { display: flex; gap: 10px; width: 100%; max-width: 560px; }
        .btn {
          flex: 1; padding: 11px 16px; border-radius: 8px;
          font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer;
          border: 1px solid ${t.accent}; transition: all .2s;
          text-decoration: none; text-align: center;
          display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .btn-primary { background: ${t.accent}; color: ${t.dark ? t.bg : '#fff'}; }
        .btn-primary:hover { box-shadow: 0 0 20px rgba(${t.accentRgb},.4); transform: translateY(-1px); }
        .btn-ghost { background: transparent; color: ${t.accent}; }
        .btn-ghost:hover { background: rgba(${t.accentRgb},.08); transform: translateY(-1px); }

        @media (max-width: 520px) {
          body { padding: 12px; }
          .stamp-col { width: 120px; padding: 12px 8px; }
          .stamp-img { width: 76px; height: 76px; }
          .statement-text { font-size: 15px; }
          .actions { flex-wrap: wrap; }
        }
      `}</style>

      <div className="page-wrap">
        <div className="card">

          {/* Circuit animation overlay */}
          {(theme === 'circuit-anim' || theme === 'circuit') && (
            <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',overflow:'hidden'}}
              viewBox="0 0 560 530" preserveAspectRatio="none">
              <g stroke={theme==='circuit-anim'?'#00e5ff':'#00bcd4'} strokeWidth="0.8" fill="none"
                opacity={theme==='circuit-anim'?'0.28':'0.18'}>
                {/* Left side — stamp column, extends below stamp */}
                <polyline className="trace" points="0,70 42,70 56,84 56,180"/>
                <polyline className="trace" points="0,200 35,200 48,213 48,280"/>
                <polyline className="trace" points="0,330 52,330 52,310 70,310"/>
                {/* Left stamp extension — goes down past stamp area */}
                <polyline className="trace" points="56,180 56,240 72,240"/>
                {/* Right side — beyond upload zone */}
                <polyline className="trace" points="560,80 518,80 504,94 504,160"/>
                <polyline className="trace" points="560,200 525,200 512,213 512,280"/>
                <polyline className="trace" points="560,340 508,340 494,320 476,320"/>
                {/* Top deco from header */}
                <polyline className="trace" points="200,0 200,36 184,52 140,52"/>
                <polyline className="trace" points="360,0 360,36 376,52 420,52"/>
              </g>
              <g fill={theme==='circuit-anim'?'#00e5ff':'#00bcd4'}>
                <circle className="node" cx="56" cy="180" r="3"/>
                <circle className="node" cx="72" cy="240" r="2.5"/>
                <circle className="node" cx="48" cy="280" r="2.5"/>
                <circle className="node" cx="70" cy="310" r="3"/>
                <circle className="node" cx="504" cy="160" r="3"/>
                <circle className="node" cx="512" cy="280" r="2.5"/>
                <circle className="node" cx="476" cy="320" r="3"/>
                <circle className="node" cx="140" cy="52" r="3"/>
              </g>
            </svg>
          )}

          {/* Header */}
          <div className="card-header">
            <span className="header-title">THE SEALER PROTOCOL · ONCHAIN STATEMENT</span>
            <span className="header-uid" onClick={handleCopyUid}>
              {uidCopied ? '✓ Copied!' : `UID: ${uid}`}
            </span>
          </div>
          <div className="dashes"/>

          {/* Upper: stamp + upload */}
          <div className="upper">
            <div className="stamp-col">
              <div style={{
                width: 92, height: 92,
                backgroundImage: `url(/api/stamp?theme=${theme})`,
                backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
                filter: `drop-shadow(0 4px 16px rgba(${t.accentRgb},.25))`,
              }}/>
              <div className="chain-pill">{chain} · EAS</div>
            </div>

            <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
              {uploadedImage ? (
                <>
                  <img src={uploadedImage} alt="Attachment"/>
                  <div className="upload-overlay"><span>Change Image</span></div>
                </>
              ) : (
                <div className="upload-placeholder">
                  <p>NO ATTACHMENT</p>
                  <small>PNL CARD · SCREENSHOT · CHART</small>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*"
              style={{display:'none'}} onChange={handleUpload}/>
          </div>

          {/* Statement — no divider, label sits directly above text */}
          <div className="statement-section">
            <div className="statement-label">STATEMENT</div>
            <div className="statement-text">{statement}</div>
          </div>

          {/* Stats */}
          <div className="stats-bar">
            <div className="stat-cell">
              <div className="stat-label">Date Issued</div>
              <div className="stat-value">{dateStr}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Agent ID</div>
              <div className="stat-value">#{agentId}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">TX Hash</div>
              <div className="stat-value mono" onClick={handleCopyUid}>{uidCopied ? '✓ Copied!' : uid}</div>
            </div>
          </div>

          {/* Footer */}
          <div className="footer-verified">
            <span className="verified-text">CRYPTOGRAPHICALLY VERIFIED</span>
            <div className="basescan-link">
              <a href={basescanUrl} target="_blank" rel="noopener noreferrer">EAS Attestation · basescan.org ↗</a>
            </div>
          </div>

          <div className="bottom-band">
            <span className="band-text">THESEALER.XYZ · CRYPTOGRAPHICALLY VERIFIED</span>
            <img src={t.dark ? MARK_WHITE : MARK_BLACK} alt="" style={{width:18,height:18,opacity:0.55}}/>
          </div>
        </div>

        {/* Actions */}
        <div className="actions">
          <button className="btn btn-primary" onClick={handleShare}>
            {copied ? '✓ Link Copied!' : '⇧ Share Card'}
          </button>
          <a className="btn btn-ghost" href={basescanUrl} target="_blank" rel="noopener noreferrer">
            ⬡ View on Basescan
          </a>
          <a className="btn btn-ghost" href={svgUrl} target="_blank" rel="noopener noreferrer">
            ↓ Download SVG
          </a>
        </div>
      </div>
    </>
  );
}