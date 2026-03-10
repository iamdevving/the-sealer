'use client';
// src/app/sleeve/SleevePage.tsx
import { useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARK_BLACK } from '@/lib/assets';

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function truncateHash(h: string) {
  return h ? '0x' + h.slice(2, 6) + '…' + h.slice(-4) : '0x????…????';
}

export default function SleevePage() {
  const searchParams = useSearchParams();
  const imageUrl  = searchParams.get('imageUrl') || '';
  const txHash    = searchParams.get('txHash') || '';
  const chain     = searchParams.get('chain') || 'Base';

  const uid     = truncateHash(txHash);
  const dateStr = formatDate(new Date());
  const basescanUrl = txHash ? `https://basescan.org/tx/${txHash}` : '#';

  // Local file import state (overrides imageUrl param when set)
  const [localImage, setLocalImage] = useState<string>('');
  const [uidCopied, setUidCopied]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const displayImage = localImage || imageUrl;
  const svgUrl = `/api/sleeve?chain=${encodeURIComponent(chain)}&txHash=${txHash}${displayImage ? `&imageUrl=${encodeURIComponent(displayImage)}` : ''}`;

  function handleImport() {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLocalImage(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleCopyUid() {
    navigator.clipboard.writeText(txHash || uid);
    setUidCopied(true);
    setTimeout(() => setUidCopied(false), 2000);
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #c8d0da;
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
          padding: 24px;
        }
        .page-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 400px; }

        .sleeve {
          width: 315px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(0,0,0,0.1);
          border-radius: 10px;
          overflow: hidden;
          position: relative;
          box-shadow:
            inset 2px 2px 6px rgba(255,255,255,0.18),
            inset -1px -1px 4px rgba(0,0,0,0.08),
            0 20px 60px rgba(0,0,0,0.25),
            0 4px 16px rgba(0,0,0,0.15);
        }
        .sleeve-sheen {
          position: absolute; inset: 0; border-radius: 10px; pointer-events: none; z-index: 2;
          background: linear-gradient(135deg,
            rgba(232,240,255,0.18) 0%, rgba(255,255,255,0.08) 30%,
            rgba(192,208,240,0.06) 60%, rgba(255,255,255,0.14) 100%);
        }
        .sleeve-edge-top {
          position: absolute; left: 12px; right: 12px; top: 8px; height: 6px; pointer-events: none; z-index: 3;
          background: linear-gradient(180deg, rgba(255,255,255,0.3), transparent);
          opacity: 0.5;
        }
        .image-area {
          margin: 12px 12px 0; border-radius: 3px; overflow: hidden; position: relative;
          background: #f0f2f5; min-height: 200px;
          display: flex; align-items: center; justify-content: center;
        }
        .image-area img { width: 100%; display: block; border-radius: 3px; }
        .image-vignette {
          position: absolute; inset: 0; border-radius: 3px; pointer-events: none;
          background: radial-gradient(ellipse at 50% 50%, transparent 0%, rgba(0,0,0,0.4) 100%);
        }
        .no-image { text-align: center; padding: 60px 20px; }
        .no-image p { font-size: 10px; color: #aaa; letter-spacing: 2px; }
        .no-image small { font-size: 8px; color: #bbb; letter-spacing: 1px; display: block; margin-top: 6px; }

        .sleeve-footer {
          margin: 0 12px; height: 28px;
          background: linear-gradient(180deg, #f8f9fc 0%, #eef0f5 100%);
          display: flex; align-items: center;
          border-top: 1px solid rgba(0,0,0,0.08);
          padding: 0 8px;
        }
        .footer-chain { display: flex; align-items: center; flex-shrink: 0; }
        .footer-meta { display: flex; flex-direction: column; justify-content: center; margin-left: 8px; flex: 1; }
        .footer-label { font-size: 6px; color: #999; letter-spacing: 1px; line-height: 1; }
        .footer-value { font-size: 6.5px; color: #555; letter-spacing: 0.5px; line-height: 1.4; cursor: pointer; transition: color .2s; }
        .footer-value:hover { color: #0052ff; }
        .footer-date { text-align: right; flex-shrink: 0; }
        .footer-date .footer-value { cursor: default; font-size: 7px; }
        .footer-date .footer-value:hover { color: #555; }
        .footer-mark { flex-shrink: 0; margin-left: 8px; opacity: 0.65; }
        .sleeve-bottom { height: 12px; }

        .actions { display: flex; gap: 10px; width: 315px; }
        .btn {
          flex: 1; padding: 11px 10px; border-radius: 8px;
          font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer;
          border: 1px solid #0052ff; transition: all .2s;
          text-decoration: none; text-align: center;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          background: transparent;
        }
        .btn-primary { background: #0052ff; color: #fff; border-color: #0052ff; }
        .btn-primary:hover { box-shadow: 0 0 20px rgba(0,82,255,0.4); transform: translateY(-1px); }
        .btn-ghost { color: #0052ff; }
        .btn-ghost:hover { background: rgba(0,82,255,0.06); transform: translateY(-1px); }

        @media (max-width: 380px) { body { padding: 12px; } .actions { flex-wrap: wrap; } }
      `}</style>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="page-wrap">
        <div className="sleeve">
          <div className="sleeve-sheen"/>
          <div className="sleeve-edge-top"/>

          <div className="image-area">
            {displayImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displayImage} alt="NFT"/>
                <div className="image-vignette"/>
              </>
            ) : (
              <div className="no-image">
                <p>NO IMAGE</p>
                <small>Import an image below</small>
              </div>
            )}
          </div>

          <div className="sleeve-footer">
            <div className="footer-chain">
              {chain === 'Solana' ? (
                <svg width="14" height="10" viewBox="0 0 101 88" style={{display:'block'}}>
                  <defs>
                    <linearGradient id="sol" x1="8.5" y1="90.1" x2="89" y2="-3" gradientUnits="userSpaceOnUse">
                      <stop offset="0.08" stopColor="#9945FF"/>
                      <stop offset="0.3"  stopColor="#8752F3"/>
                      <stop offset="0.5"  stopColor="#5497D5"/>
                      <stop offset="0.6"  stopColor="#43B4CA"/>
                      <stop offset="0.72" stopColor="#28E0B9"/>
                      <stop offset="0.97" stopColor="#19FB9B"/>
                    </linearGradient>
                  </defs>
                  <path fill="url(#sol)" d="M100.48 69.38L83.81 86.8C83.44 87.18 83.01 87.48 82.52 87.69C82.03 87.89 81.51 88 80.97 88H1.94C1.56 88 1.19 87.89 0.87 87.69C0.56 87.49 0.31 87.2 0.16 86.87C0.01 86.53-0.04 86.16 0.03 85.79C0.09 85.43 0.26 85.1 0.52 84.83L17.21 67.41C17.57 67.03 18 66.73 18.49 66.52C18.98 66.32 19.5 66.21 20.03 66.21H99.06C99.44 66.21 99.81 66.32 100.13 66.52C100.44 66.72 100.69 67.01 100.84 67.34C100.99 67.68 101.04 68.05 100.97 68.42C100.91 68.78 100.74 69.11 100.48 69.38ZM83.81 34.3C83.44 33.92 83.01 33.62 82.52 33.42C82.03 33.21 81.51 33.1 80.97 33.1H1.94C1.56 33.1 1.19 33.21 0.87 33.41C0.56 33.62 0.31 33.9 0.16 34.24C0.01 34.58-0.04 34.95 0.03 35.31C0.09 35.67 0.26 36.01 0.52 36.28L17.21 53.7C17.57 54.07 18 54.38 18.49 54.58C18.98 54.79 19.5 54.89 20.03 54.9H99.06C99.44 54.9 99.81 54.79 100.13 54.59C100.44 54.38 100.69 54.1 100.84 53.76C100.99 53.42 101.04 53.05 100.97 52.69C100.91 52.33 100.74 51.99 100.48 51.72L83.81 34.3ZM1.94 21.79H80.97C81.51 21.79 82.03 21.68 82.52 21.48C83.01 21.27 83.44 20.97 83.81 20.59L100.48 3.17C100.74 2.9 100.91 2.57 100.97 2.21C101.04 1.84 100.99 1.47 100.84 1.13C100.69 0.8 100.44 0.51 100.13 0.31C99.81 0.11 99.44 0 99.06 0L20.03 0C19.5 0 18.98 0.11 18.49 0.31C18 0.52 17.57 0.82 17.21 1.2L0.52 18.62C0.27 18.89 0.1 19.22 0.03 19.58C-0.03 19.95 0.01 20.32 0.16 20.65C0.31 20.99 0.56 21.28 0.87 21.48C1.19 21.68 1.56 21.79 1.94 21.79Z"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 111 111" style={{display:'block'}}>
                  <rect width="111" height="111" rx="20" fill="#0052FF"/>
                  <path d="M55.5 24C38.103 24 24 38.103 24 55.5S38.103 87 55.5 87c15.977 0 29.2-11.714 31.145-27.158H63.931v9.272h-8.43V55.5h31.644C87.145 38.714 72.977 24 55.5 24z" fill="white"/>
                </svg>
              )}
            </div>

            <div className="footer-meta">
              <div className="footer-label">TX HASH</div>
              <div className="footer-value" onClick={handleCopyUid}>
                {uidCopied ? '✓ Copied!' : uid}
              </div>
            </div>

            <div className="footer-date">
              <div className="footer-label">ISSUE DATE</div>
              <div className="footer-value">{dateStr}</div>
            </div>

            <div className="footer-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARK_BLACK} alt="" width={18} height={18}/>
            </div>
          </div>

          <div className="sleeve-bottom"/>
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={handleImport}>
            ↑ Import Image
          </button>
          <a className="btn btn-ghost" href={basescanUrl} target="_blank" rel="noopener noreferrer">
            ⬡ Basescan
          </a>
          <a className="btn btn-ghost" href={svgUrl} target="_blank" rel="noopener noreferrer">
            ↓ SVG
          </a>
        </div>
      </div>
    </>
  );
}