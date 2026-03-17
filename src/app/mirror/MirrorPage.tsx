'use client';
// src/app/mirror/MirrorPage.tsx
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARK_BLACK } from '@/lib/assets';

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function truncateHash(h: string) {
  return h ? '0x' + h.slice(2, 6) + '…' + h.slice(-4) : '0x????…????';
}

export default function MirrorPage() {
  const searchParams = useSearchParams();

  const imageUrl         = searchParams.get('imageUrl') || '';
  const txHash           = searchParams.get('txHash') || '';
  const chain            = searchParams.get('chain') || 'Base';
  const originalChain    = searchParams.get('originalChain') || 'ethereum';
  const originalTokenId  = searchParams.get('originalTokenId') || '';
  const nftName          = searchParams.get('nftName') || (originalTokenId ? `#${originalTokenId}` : 'Mirror NFT');
  const mirrorTokenId    = searchParams.get('mirrorTokenId') || '';
  const forceInvalidated = searchParams.get('forceInvalidated') === 'true' || searchParams.get('invalidated') === 'true';

  const isSolana    = chain === 'Solana';
  const uid         = isSolana ? txHash.slice(0, 8) + '…' : truncateHash(txHash);
  const dateStr     = formatDate(new Date());
  const chainLabel  = originalChain === 'ethereum' ? 'ETH' : originalChain.toUpperCase();

  // Dynamic explorer URL based on target chain
  const explorerUrl = isSolana
    ? (mirrorTokenId ? `https://solscan.io/token/${mirrorTokenId}` : `https://solscan.io/tx/${txHash}`)
    : (txHash ? `https://basescan.org/tx/${txHash}` : '#');
  const explorerLabel = isSolana ? '◎ Solscan' : '⬡ Basescan';

  const [invalidated, setInvalidated] = useState(forceInvalidated);
  const [uidCopied, setUidCopied]     = useState(false);
  const [imgError, setImgError]       = useState(false);
  const [localImage, setLocalImage]   = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setInvalidated(forceInvalidated); }, [forceInvalidated]);

  const displayImage = localImage || imageUrl;
  const svgUrl = `/api/mirror/card?chain=${encodeURIComponent(chain)}&originalChain=${encodeURIComponent(originalChain)}&nftName=${encodeURIComponent(nftName)}&txHash=${txHash}${displayImage ? `&imageUrl=${encodeURIComponent(displayImage)}` : ''}${mirrorTokenId ? `&mirrorTokenId=${mirrorTokenId}` : ''}`;

  function handleImport() { fileRef.current?.click(); }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setLocalImage(ev.target?.result as string); setImgError(false); };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleCopyUid() {
    navigator.clipboard.writeText(txHash || uid);
    setUidCopied(true);
    setTimeout(() => setUidCopied(false), 2000);
  }

  const showImage = displayImage && !invalidated && !imgError;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #8090b0;
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
          padding: 24px;
        }
        .page-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 400px; }
        .mirror-card {
          width: 315px;
          background: linear-gradient(160deg, rgba(240,244,255,0.92) 0%, rgba(232,238,255,0.88) 50%, rgba(221,228,248,0.94) 100%);
          border-radius: 16px; overflow: hidden; position: relative;
          box-shadow: 0 8px 32px rgba(60,80,140,0.18), 0 2px 8px rgba(60,80,140,0.10), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(100,120,180,0.12);
          border: 1px solid rgba(180,195,230,0.7);
        }
        .mirror-card::before {
          content: ''; position: absolute; inset: 1.5px; border-radius: 14.5px;
          border: 0.5px solid rgba(255,255,255,0.5); pointer-events: none; z-index: 10;
        }
        .frost-overlay { position: absolute; inset: 0; border-radius: 16px; pointer-events: none; z-index: 1; opacity: 0.4; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E"); }
        .sheen { position: absolute; top: 0; left: 0; right: 0; height: 50%; border-radius: 16px 16px 0 0; pointer-events: none; z-index: 2; background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 100%); }
        .image-wrap { margin: 8px 8px 0; border-radius: 6px; overflow: hidden; position: relative; background: rgba(255,255,255,0.18); min-height: 180px; display: flex; align-items: center; justify-content: center; z-index: 3; }
        .image-wrap img { width: 100%; display: block; border-radius: 6px; }
        .image-vignette { position: absolute; inset: 0; border-radius: 6px; pointer-events: none; background: radial-gradient(ellipse at 50% 50%, transparent 0%, rgba(0,0,20,0.25) 100%); }
        .glass-stripe1 { position: absolute; inset: 0; border-radius: 6px; pointer-events: none; background: linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.35) 18%, rgba(255,255,255,0.02) 32%, rgba(255,255,255,0) 100%); opacity: 0.9; }
        .glass-stripe2 { position: absolute; inset: 0; border-radius: 6px; pointer-events: none; background: linear-gradient(145deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,1) 36%, rgba(255,255,255,1) 39%, rgba(255,255,255,0) 45%, rgba(255,255,255,0) 100%); opacity: 0.35; }
        .glass-stripe3 { position: absolute; inset: 0; border-radius: 6px; pointer-events: none; background: linear-gradient(315deg, rgba(26,26,58,0.22) 0%, rgba(26,26,58,0.06) 30%, rgba(26,26,58,0) 100%); }
        .image-border { position: absolute; inset: 0; border-radius: 6px; pointer-events: none; border: 1px solid rgba(255,255,255,0.75); box-sizing: border-box; }
        .image-border-inner { position: absolute; inset: 1px; border-radius: 5px; pointer-events: none; border: 1px solid rgba(20,20,60,0.12); box-sizing: border-box; }
        .mirror-watermark { position: absolute; top: 13px; right: 8px; font-size: 6px; color: rgba(255,255,255,0.35); letter-spacing: 2px; pointer-events: none; z-index: 4; }
        .void-area { position: absolute; inset: 0; border-radius: 6px; background: rgba(8,8,18,0.92); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; z-index: 4; }
        .void-title { font-size: 7px; color: rgba(255,255,255,0.22); letter-spacing: 4px; }
        .void-sub { font-size: 5.5px; color: rgba(255,255,255,0.12); letter-spacing: 1.5px; }
        .void-cta { margin-top: 8px; padding: 5px 16px; border: 0.5px solid rgba(255,255,255,0.12); border-radius: 3px; background: rgba(255,255,255,0.04); font-size: 5.5px; color: rgba(255,255,255,0.28); letter-spacing: 1.5px; cursor: pointer; transition: all .2s; }
        .void-cta:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.5); }
        .crack-svg { position: absolute; inset: 0; border-radius: 6px; pointer-events: none; }
        .no-image { text-align: center; padding: 60px 20px; }
        .no-image p { font-size: 8px; color: rgba(100,120,180,0.4); letter-spacing: 3px; }
        .no-image small { font-size: 6.5px; color: rgba(100,120,180,0.25); display: block; margin-top: 6px; }
        .name-bar { margin: 0 8px; height: 30px; background: rgba(255,255,255,0.22); border-top: 0.5px solid rgba(255,255,255,0.5); display: flex; align-items: center; padding: 0 12px; z-index: 3; position: relative; }
        .name-text { font-size: 11px; font-weight: 700; color: rgba(20,40,100,0.9); letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mirror-footer { margin: 0 8px 6px; height: 26px; background: rgba(255,255,255,0.1); border-top: 0.5px solid rgba(255,255,255,0.2); display: flex; align-items: center; padding: 0 6px; z-index: 3; position: relative; gap: 4px; }
        .footer-chain { display: flex; align-items: center; flex-shrink: 0; opacity: 0.45; }
        .footer-tx { font-size: 5.5px; color: rgba(40,60,120,0.4); letter-spacing: 0.5px; flex: 1; margin-left: 4px; cursor: pointer; transition: color .2s; white-space: nowrap; }
        .footer-tx:hover { color: rgba(40,60,120,0.7); }
        .footer-right { font-size: 5.5px; color: rgba(40,60,120,0.38); letter-spacing: 0.3px; text-align: right; flex-shrink: 0; }
        .footer-mark { flex-shrink: 0; margin-left: 6px; opacity: 0.65; }
        .actions { display: flex; gap: 10px; width: 315px; }
        .btn { flex: 1; padding: 11px 10px; border-radius: 8px; font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer; border: 1px solid rgba(100,130,220,0.6); transition: all .2s; text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; background: transparent; }
        .btn-primary { background: rgba(80,110,200,0.85); color: #fff; border-color: rgba(80,110,200,0.85); }
        .btn-primary:hover { box-shadow: 0 0 20px rgba(80,110,200,0.4); transform: translateY(-1px); }
        .btn-ghost { color: rgba(40,60,140,0.8); background: rgba(255,255,255,0.4); backdrop-filter: blur(4px); }
        .btn-ghost:hover { background: rgba(255,255,255,0.6); transform: translateY(-1px); }
        .btn-warn { background: rgba(220,60,60,0.15); color: rgba(200,40,40,0.9); border-color: rgba(200,40,40,0.3); }
        .btn-warn:hover { background: rgba(220,60,60,0.25); transform: translateY(-1px); }
        @media (max-width: 380px) { body { padding: 12px; } .actions { flex-wrap: wrap; } }
      `}</style>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFileChange} />

      <div className="page-wrap">
        <div className="mirror-card">
          <div className="frost-overlay"/>
          <div className="sheen"/>

          <div className="image-wrap" style={{minHeight: showImage ? 'auto' : 220}}>
            {invalidated ? (
              <div className="void-area">
                <svg className="crack-svg" viewBox="0 0 299 220" preserveAspectRatio="none">
                  <g stroke="rgba(255,255,255,0.18)" strokeWidth="0.75" fill="none">
                    <line x1="149" y1="110" x2="20" y2="10"/>
                    <line x1="149" y1="110" x2="284" y2="8"/>
                    <line x1="149" y1="110" x2="8" y2="200"/>
                    <line x1="149" y1="110" x2="289" y2="205"/>
                    <line x1="149" y1="110" x2="109" y2="220"/>
                    <line x1="149" y1="110" x2="199" y2="220"/>
                    <line x1="149" y1="110" x2="8" y2="130"/>
                    <line x1="149" y1="110" x2="289" y2="80"/>
                  </g>
                  <g stroke="rgba(255,255,255,0.09)" strokeWidth="0.5" fill="none">
                    <line x1="20" y1="10" x2="5" y2="35"/>
                    <line x1="284" y1="8" x2="294" y2="40"/>
                    <line x1="109" y1="220" x2="30" y2="190"/>
                  </g>
                  <circle cx="149" cy="110" r="3" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"/>
                  <circle cx="149" cy="110" r="8" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
                </svg>
                <div className="void-title">MIRROR VOID</div>
                <div className="void-sub">original nft transferred</div>
                <div className="void-cta">FIX MIRROR →</div>
              </div>
            ) : showImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displayImage} alt={nftName} onError={() => setImgError(true)}/>
                <div className="image-vignette"/>
              </>
            ) : (
              <div className="no-image">
                <p>NO IMAGE</p>
                <small>Import an image below</small>
              </div>
            )}

            {!invalidated && (
              <>
                <div className="glass-stripe1"/>
                <div className="glass-stripe2"/>
                <div className="glass-stripe3"/>
                <div className="image-border"/>
                <div className="image-border-inner"/>
              </>
            )}
            <div className="mirror-watermark">MIRROR</div>
          </div>

          <div className="name-bar">
            <span className="name-text">{nftName}</span>
          </div>

          <div className="mirror-footer">
            <div className="footer-chain">
              {chain === 'Solana' ? (
                <svg width="12" height="9" viewBox="0 0 101 88">
                  <defs>
                    <linearGradient id="sol2" x1="8.5" y1="90.1" x2="89" y2="-3" gradientUnits="userSpaceOnUse">
                      <stop offset="0.08" stopColor="#9945FF"/>
                      <stop offset="0.5"  stopColor="#5497D5"/>
                      <stop offset="0.97" stopColor="#19FB9B"/>
                    </linearGradient>
                  </defs>
                  <path fill="url(#sol2)" d="M100.48 69.38L83.81 86.8C83.44 87.18 83.01 87.48 82.52 87.69C82.03 87.89 81.51 88 80.97 88H1.94C1.56 88 1.19 87.89 0.87 87.69C0.56 87.49 0.31 87.2 0.16 86.87C0.01 86.53-0.04 86.16 0.03 85.79C0.09 85.43 0.26 85.1 0.52 84.83L17.21 67.41C17.57 67.03 18 66.73 18.49 66.52C18.98 66.32 19.5 66.21 20.03 66.21H99.06C99.44 66.21 99.81 66.32 100.13 66.52C100.44 66.72 100.69 67.01 100.84 67.34C100.99 67.68 101.04 68.05 100.97 68.42C100.91 68.78 100.74 69.11 100.48 69.38ZM83.81 34.3C83.44 33.92 83.01 33.62 82.52 33.42C82.03 33.21 81.51 33.1 80.97 33.1H1.94C1.56 33.1 1.19 33.21 0.87 33.41C0.56 33.62 0.31 33.9 0.16 34.24C0.01 34.58-0.04 34.95 0.03 35.31C0.09 35.67 0.26 36.01 0.52 36.28L17.21 53.7C17.57 54.07 18 54.38 18.49 54.58C18.98 54.79 19.5 54.89 20.03 54.9H99.06C99.44 54.9 99.81 54.79 100.13 54.59C100.44 54.38 100.69 54.1 100.84 53.76C100.99 53.42 101.04 53.05 100.97 52.69C100.91 52.33 100.74 51.99 100.48 51.72L83.81 34.3ZM1.94 21.79H80.97C81.51 21.79 82.03 21.68 82.52 21.48C83.01 21.27 83.44 20.97 83.81 20.59L100.48 3.17C100.74 2.9 100.91 2.57 100.97 2.21C101.04 1.84 100.99 1.47 100.84 1.13C100.69 0.8 100.44 0.51 100.13 0.31C99.81 0.11 99.44 0 99.06 0L20.03 0C19.5 0 18.98 0.11 18.49 0.31C18 0.52 17.57 0.82 17.21 1.2L0.52 18.62C0.27 18.89 0.1 19.22 0.03 19.58C-0.03 19.95 0.01 20.32 0.16 20.65C0.31 20.99 0.56 21.28 0.87 21.48C1.19 21.68 1.56 21.79 1.94 21.79Z"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 111 111">
                  <rect width="111" height="111" rx="20" fill="#0052FF"/>
                  <path d="M55.5 24C38.103 24 24 38.103 24 55.5S38.103 87 55.5 87c15.977 0 29.2-11.714 31.145-27.158H63.931v9.272h-8.43V55.5h31.644C87.145 38.714 72.977 24 55.5 24z" fill="white"/>
                </svg>
              )}
            </div>

            <div className="footer-tx" onClick={handleCopyUid}>
              TX&nbsp;&nbsp;{uidCopied ? '✓ Copied!' : uid}
            </div>

            <div className="footer-right">
              {chainLabel} · {dateStr}
            </div>

            <div className="footer-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARK_BLACK} alt="" width={14} height={14}/>
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={handleImport}>
            ↑ Import Image
          </button>
          <a className="btn btn-ghost" href={explorerUrl} target="_blank" rel="noopener noreferrer">
            {explorerLabel}
          </a>
          {invalidated ? (
            <button className="btn btn-warn">
              ⚠ Fix Mirror
            </button>
          ) : (
            <a className="btn btn-ghost" href={svgUrl} target="_blank" rel="noopener noreferrer">
              ↓ SVG
            </a>
          )}
        </div>
      </div>
    </>
  );
}