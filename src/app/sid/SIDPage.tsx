'use client';
// src/app/sid/SIDPage.tsx
import { useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function truncateAddr(a: string) {
  if (!a || a === '????') return '—';
  return a.slice(0, 6) + '···' + a.slice(-4);
}
function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}
function makeSerial(id: string, yr: string) {
  const f = id.startsWith('0x') ? id.slice(2, 6).toUpperCase() : '????';
  return 'SID-' + yr + '-' + f;
}

function SolanaLogo() {
  return (
    <svg width="20" height="18" viewBox="0 0 102 88" fill="none">
      <defs>
        <linearGradient id="solGrad" x1="8.5" y1="90" x2="89" y2="-3" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor="#9945FF"/>
          <stop offset="0.5" stopColor="#5497D5"/>
          <stop offset="0.97" stopColor="#19FB9B"/>
        </linearGradient>
      </defs>
      <path d="M100.48 69.38L83.81 86.8c-.36.38-.8.68-1.29.89-.49.21-1.01.31-1.54.31H1.94c-.38 0-.75-.11-1.06-.31-.32-.2-.56-.49-.71-.83-.15-.34-.18-.71-.11-1.07.06-.36.23-.7.48-.97L17.21 67.41c.36-.38.8-.68 1.29-.89.49-.21 1.01-.31 1.54-.31h79.03c.38 0 .75.11 1.06.31.32.2.56.49.71.83.15.34.18.71.11 1.07-.06.36-.23.7-.48.97zM83.81 34.3c-.36-.38-.8-.68-1.29-.89-.49-.21-1.01-.31-1.54-.31H1.94c-.38 0-.75.11-1.06.31-.32.2-.56.49-.71.83-.15.34-.18.71-.11 1.07.06.36.23.7.48.97l16.69 17.42c.36.38.8.68 1.29.89.49.21 1.01.31 1.54.31h79.03c.38 0 .75-.11 1.06-.31.32-.2.56-.49.71-.83.15-.34.18-.71.11-1.07-.06-.36-.23-.7-.48-.97L83.81 34.3zM1.94 21.79h79.03c.53 0 1.05-.11 1.54-.31.49-.21.93-.51 1.29-.89L100.48 3.17c.26-.27.43-.61.49-.97.06-.36.02-.73-.11-1.07-.15-.34-.39-.62-.71-.83C99.82.11 99.44 0 99.06 0H20.03c-.53 0-1.05.11-1.54.31-.49.21-.93.51-1.29.89L.52 18.62c-.26.27-.43.61-.49.97-.06.36-.02.73.11 1.07.15.34.39.62.71.83.32.2.69.31 1.09.31z" fill="url(#solGrad)"/>
    </svg>
  );
}

function BaseLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 111 111" fill="none">
      <rect width="111" height="111" rx="20" fill="#0052FF"/>
      <path d="M55.5 24C38.1 24 24 38.1 24 55.5S38.1 87 55.5 87c16 0 29.2-11.7 31.1-27.2H64v9.3h-8.4V55.5h31.6C87.1 38.7 73 24 55.5 24z" fill="white"/>
    </svg>
  );
}

export default function SIDPage() {
  const searchParams = useSearchParams();

  const agentId    = searchParams.get('agentId')    || '????';
  const name       = searchParams.get('name')       || 'UNNAMED AGENT';
  const owner      = searchParams.get('owner')      || '';
  const chain      = searchParams.get('chain')      || 'Base';
  const entityType = searchParams.get('entityType') || 'UNKNOWN';
  const firstSeen  = searchParams.get('firstSeen')  || '-';
  const imageUrl   = searchParams.get('imageUrl')   || '';
  const llm        = searchParams.get('llm')        || '';
  const socials    = (searchParams.get('social') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
  const tags       = (searchParams.get('tags')   || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const themeName  = searchParams.get('theme') === 'light' ? 'light' : 'dark';

  const year      = new Date().getFullYear().toString();
  const issueDate = formatDate(new Date());
  const ser       = makeSerial(agentId, year);

  const ENTITY_LBL = entityType === 'AI_AGENT' ? 'AI AGENT' : entityType === 'HUMAN' ? 'HUMAN' : 'UNKNOWN';
  const isDark     = themeName === 'dark';

  const [localImage, setLocalImage] = useState<string>('');
  const [copied, setCopied]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const displayImage = localImage || imageUrl;

  const svgImageParam = (!localImage && imageUrl) ? `&imageUrl=${encodeURIComponent(imageUrl)}` : '';
  const svgUrl = `/api/sid?agentId=${encodeURIComponent(agentId)}&name=${encodeURIComponent(name)}&chain=${encodeURIComponent(chain)}&entityType=${encodeURIComponent(entityType)}&theme=${themeName}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}${firstSeen !== '-' ? `&firstSeen=${encodeURIComponent(firstSeen)}` : ''}${llm ? `&llm=${encodeURIComponent(llm)}` : ''}${socials.length ? `&social=${encodeURIComponent(socials.join(','))}` : ''}${tags.length ? `&tags=${encodeURIComponent(tags.join(','))}` : ''}${svgImageParam}`;

  function handleImport() { fileRef.current?.click(); }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLocalImage(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleCopyId() {
    navigator.clipboard.writeText(agentId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const bg      = isDark ? '#0d1117' : '#f5f0e8';
  const hdrBg   = isDark ? '#0a0f1e' : '#1a1f3a';
  const ink     = isDark ? '#c8d8f0' : '#1a1f3a';
  const inkDim  = isDark ? '#5a7090' : '#6b7280';
  const accent  = isDark ? '#3b82f6' : '#2563eb';
  const eAccent = entityType === 'AI_AGENT' ? accent : entityType === 'HUMAN' ? '#9ca3af' : '#f59e0b';
  const mrzBg   = isDark ? '#070c14' : '#e8e0cc';
  const faint   = isDark ? '#1e2d4a' : '#d4c9a8';

  // URL references — no base64
  const stampSrc = isDark ? '/assets/stamp-blue.png' : '/assets/stamp-committed.png';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: ${isDark ? '#060a12' : '#d8d0c0'};
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
          padding: 24px;
        }
        .page-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 460px; }
        .sid-card {
          width: 428px; border-radius: 12px; overflow: hidden;
          background: ${bg}; border: 1px solid ${faint};
          box-shadow: 0 24px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2);
          position: relative;
        }
        .sid-card::before {
          content: ''; position: absolute; inset: 0;
          background-image: repeating-linear-gradient(0deg, transparent, transparent 19px, ${faint}40 20px),
            repeating-linear-gradient(90deg, transparent, transparent 19px, ${faint}20 20px);
          pointer-events: none; z-index: 0;
        }
        .sid-header { background: ${hdrBg}; padding: 12px 20px 10px; position: relative; z-index: 1; }
        .sid-header-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .sid-header-meta { font-size: 7px; color: rgba(255,255,255,0.6); letter-spacing: 1.2px; }
        .sid-header-date { margin-left: auto; font-size: 6px; color: rgba(255,255,255,0.35); letter-spacing: 1px; white-space: nowrap; }
        .sid-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .sid-title { font-family: Georgia, serif; font-size: 24px; color: #fff; letter-spacing: 3px; }
        .sid-subtitle { font-size: 6.5px; color: rgba(255,255,255,0.3); letter-spacing: 2px; margin-top: 2px; }
        .sid-accent-bar { height: 2.5px; background: ${accent}; opacity: 0.9; position: relative; z-index: 1; }
        .sid-body { display: flex; padding: 20px 20px 0; gap: 28px; position: relative; z-index: 1; }
        .photo-col { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .photo-frame {
          width: 110px; height: 134px; border-radius: 4px; overflow: hidden;
          background: ${faint}; position: relative; border: 0.8px solid ${faint};
          display: flex; align-items: center; justify-content: center;
        }
        .photo-frame img.photo { width: 100%; height: 100%; object-fit: cover; display: block; }
        .photo-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
        .photo-placeholder img { width: 60px; height: 60px; opacity: 0.15; }
        .entity-pill {
          width: 110px; height: 18px; border-radius: 3px;
          display: flex; align-items: center; justify-content: center;
          background: ${eAccent}1e; border: 0.8px solid ${eAccent}80;
        }
        .entity-pill span { font-size: 7.5px; color: ${eAccent}; letter-spacing: 2px; }
        .fields-col { flex: 1; display: flex; flex-direction: column; gap: 14px; }
        .field-lbl { font-size: 6px; color: ${inkDim}; letter-spacing: 1.5px; line-height: 1; }
        .field-val { font-size: 9px; color: ${ink}; letter-spacing: 0.5px; line-height: 1.4; margin-top: 3px; }
        .field-val-name { font-family: Georgia, serif; font-size: 13px; color: ${ink}; margin-top: 3px; }
        .sid-div { height: 1px; background: ${faint}; opacity: 0.6; margin: 16px 20px 0; position: relative; z-index: 1; }
        .sid-tags { padding: 12px 20px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; position: relative; z-index: 1; }
        .tag-lbl { font-size: 6px; color: ${inkDim}; letter-spacing: 1.5px; width: 100%; }
        .pill { height: 16px; padding: 0 8px; border-radius: 8px; display: flex; align-items: center; font-size: 7px; letter-spacing: 0.8px; }
        .sid-serial-row { display: flex; flex-direction: column; align-items: flex-end; padding: 8px 20px 16px; position: relative; z-index: 1; }
        .sid-serial { font-size: 9px; color: ${accent}; letter-spacing: 2px; margin-bottom: 6px; }
        .stamp-wrap { width: 90px; height: 90px; display: flex; align-items: center; justify-content: center; transform: rotate(-12deg); flex-shrink: 0; }
        .stamp-wrap img { width: 90px; height: 90px; object-fit: contain; }
        .sid-mrz { background: ${mrzBg}; border-top: 0.8px solid ${faint}; padding: 10px 20px 14px; position: relative; z-index: 1; }
        .mrz-lbl { font-size: 5.5px; color: ${inkDim}; letter-spacing: 1px; margin-bottom: 6px; }
        .mrz-line { font-size: 9px; color: ${ink}; letter-spacing: 1.8px; font-family: monospace; line-height: 1.6; word-break: break-all; }
        .actions { display: flex; gap: 10px; width: 428px; }
        .btn {
          flex: 1; padding: 11px 10px; border-radius: 8px;
          font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer;
          border: 1px solid ${accent}; transition: all .2s;
          text-decoration: none; text-align: center;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          background: transparent;
        }
        .btn-primary { background: ${accent}; color: #fff; }
        .btn-primary:hover { box-shadow: 0 0 20px ${accent}66; transform: translateY(-1px); }
        .btn-ghost { color: ${accent}; }
        .btn-ghost:hover { background: ${accent}11; transform: translateY(-1px); }
        @media (max-width: 480px) {
          body { padding: 12px; }
          .sid-card, .actions { width: 100%; }
          .actions { flex-wrap: wrap; }
        }
      `}</style>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFileChange} />

      <div className="page-wrap">
        <div className="sid-card">

          {/* Header */}
          <div className="sid-header">
            <div className="sid-header-top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-small.png" alt="" width={22} height={22} style={{ opacity: 0.85 }}/>
              <span className="sid-header-meta">THE SEALER PROTOCOL · ONCHAIN IDENTITY REGISTRY</span>
              <span className="sid-header-date">ISSUED {issueDate}</span>
            </div>
            <div className="sid-title-row">
              <div>
                <div className="sid-title">SEALER ID</div>
                <div className="sid-subtitle">AGENT IDENTITY DOCUMENT · ERC-8004</div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {chain === 'Solana' ? <SolanaLogo /> : <BaseLogo />}
              </div>
            </div>
          </div>
          <div className="sid-accent-bar"/>

          {/* Body */}
          <div className="sid-body">
            <div className="photo-col">
              <div className="photo-frame">
                {displayImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="photo" src={displayImage} alt={name}/>
                ) : (
                  <div className="photo-placeholder">
                    <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
                      <circle cx="30" cy="30" r="28" stroke={faint} strokeWidth="1.5"/>
                      <circle cx="30" cy="24" r="10" fill={faint} opacity="0.4"/>
                      <ellipse cx="30" cy="46" rx="16" ry="10" fill={faint} opacity="0.4"/>
                    </svg>
                  </div>
                )}
              </div>
              <div className="entity-pill"><span>{ENTITY_LBL}</span></div>
            </div>

            <div className="fields-col">
              <div><div className="field-lbl">NAME</div><div className="field-val-name">{name.slice(0, 18)}</div></div>
              <div>
                <div className="field-lbl">AGENT ID</div>
                <div className="field-val" style={{cursor:'pointer'}} onClick={handleCopyId} title={agentId}>
                  {copied ? '✓ Copied!' : truncateAddr(agentId)}
                </div>
              </div>
              <div><div className="field-lbl">OWNER</div><div className="field-val">{owner ? truncateAddr(owner) : '—'}</div></div>
              <div><div className="field-lbl">PRIMARY CHAIN</div><div className="field-val">{chain.toUpperCase()}</div></div>
              <div><div className="field-lbl">FIRST SEEN</div><div className="field-val">{firstSeen}</div></div>
            </div>
          </div>

          <div className="sid-div"/>

          {(socials.length > 0 || tags.length > 0 || llm) && (
            <div className="sid-tags">
              {socials.length > 0 && (
                <><div className="tag-lbl">SOCIAL</div>
                  {socials.map((s, i) => (
                    <div key={i} className="pill" style={{background:`${accent}1e`, border:`0.8px solid ${accent}99`, color: accent}}>{s.slice(0, 16)}</div>
                  ))}</>
              )}
              {tags.length > 0 && (
                <><div className="tag-lbl" style={{width:'100%', marginTop: socials.length ? 8 : 0}}>SPECIALIZATION</div>
                  {tags.map((t, i) => (
                    <div key={i} className="pill" style={{background:'#14b8a61e', border:'0.8px solid #14b8a699', color:'#14b8a6'}}>{t.slice(0, 14)}</div>
                  ))}</>
              )}
              {llm && (
                <><div className="tag-lbl" style={{width:'100%', marginTop: 8}}>PREFERRED MODEL</div>
                  <div className="pill" style={{background:'#a855f71e', border:'0.8px solid #a855f799', color:'#a855f7'}}>{llm.slice(0, 22)}</div></>
              )}
            </div>
          )}

          {/* Serial + Stamp */}
          <div className="sid-serial-row">
            <div className="sid-serial">{ser}</div>
            <div className="stamp-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stampSrc} alt="seal stamp" />
            </div>
          </div>

          {/* MRZ */}
          <div className="sid-mrz">
            <div className="mrz-lbl">MACHINE READABLE ZONE</div>
            <div className="mrz-line">
              {'AGENT<' + name.replace(/[^A-Z0-9]/gi, '<').toUpperCase().padEnd(19, '<').slice(0, 19) + '<<<<<<<<<<<<<<<<<<<<'}
            </div>
            <div className="mrz-line">
              {agentId.replace('0x', '').replace(/[^A-Z0-9]/gi, '<').toUpperCase().padEnd(20, '<').slice(0, 20) + '<<' + chain.replace(/[^A-Z0-9]/gi, '<').toUpperCase().padEnd(5, '<').slice(0, 5) + '<' + entityType.replace('_', '').toUpperCase().padEnd(8, '<').slice(0, 8) + '<' + year + '<<'}
            </div>
          </div>

        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={handleImport}>↑ Import Image</button>
          <a className="btn btn-ghost" href={svgUrl} target="_blank" rel="noopener noreferrer">↓ SVG</a>
        </div>
      </div>
    </>
  );
}