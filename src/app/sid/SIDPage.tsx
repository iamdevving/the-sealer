'use client';
// src/app/sid/SIDPage.tsx
import { useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARK_BLACK } from '@/lib/assets';

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

export default function SIDPage() {
  const searchParams = useSearchParams();

  const agentId    = searchParams.get('agentId') || '????';
  const name       = searchParams.get('name') || 'UNNAMED AGENT';
  const owner      = searchParams.get('owner') || '';
  const chain      = searchParams.get('chain') || 'Base';
  const entityType = searchParams.get('entityType') || 'UNKNOWN';
  const firstSeen  = searchParams.get('firstSeen') || '-';
  const imageUrl   = searchParams.get('imageUrl') || '';
  const llm        = searchParams.get('llm') || '';
  const socials    = (searchParams.get('social') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
  const tags       = (searchParams.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const themeName  = searchParams.get('theme') === 'light' ? 'light' : 'dark';

  const year      = new Date().getFullYear().toString();
  const issueDate = formatDate(new Date());
  const ser       = makeSerial(agentId, year);

  const ENTITY_LBL  = entityType === 'AI_AGENT' ? 'AI AGENT' : entityType === 'HUMAN' ? 'HUMAN' : 'UNKNOWN';
  const isDark      = themeName === 'dark';

  // Local file import state (overrides imageUrl param when set)
  const [localImage, setLocalImage] = useState<string>('');
  const [copied, setCopied]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const displayImage = localImage || imageUrl;

  // Build SVG API URL — if localImage is a data: URL it's too long for a GET param,
  // so we only pass imageUrl param when it's a remote URL
  const svgImageParam = (!localImage && imageUrl) ? `&imageUrl=${encodeURIComponent(imageUrl)}` : '';
  const svgUrl = `/api/sid?agentId=${encodeURIComponent(agentId)}&name=${encodeURIComponent(name)}&chain=${encodeURIComponent(chain)}&entityType=${encodeURIComponent(entityType)}&theme=${themeName}${owner ? `&owner=${encodeURIComponent(owner)}` : ''}${firstSeen !== '-' ? `&firstSeen=${encodeURIComponent(firstSeen)}` : ''}${llm ? `&llm=${encodeURIComponent(llm)}` : ''}${socials.length ? `&social=${encodeURIComponent(socials.join(','))}` : ''}${tags.length ? `&tags=${encodeURIComponent(tags.join(','))}` : ''}${svgImageParam}`;

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

  function handleCopyId() {
    navigator.clipboard.writeText(agentId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const bg        = isDark ? '#0d1117' : '#f5f0e8';
  const hdrBg     = isDark ? '#0a0f1e' : '#1a1f3a';
  const ink       = isDark ? '#c8d8f0' : '#1a1f3a';
  const inkDim    = isDark ? '#5a7090' : '#6b7280';
  const accent    = isDark ? '#3b82f6' : '#2563eb';
  const eAccent   = entityType === 'AI_AGENT' ? accent : entityType === 'HUMAN' ? '#9ca3af' : '#f59e0b';
  const mrzBg     = isDark ? '#070c14' : '#e8e0cc';
  const faint     = isDark ? '#1e2d4a' : '#d4c9a8';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Georgia&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: ${isDark ? '#060a12' : '#d8d0c0'};
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
          padding: 24px;
        }
        .page-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 460px; }

        /* ── SID Card ── */
        .sid-card {
          width: 428px;
          border-radius: 12px;
          overflow: hidden;
          background: ${bg};
          border: 1px solid ${faint};
          box-shadow: 0 24px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2);
        }

        /* Header */
        .sid-header {
          background: ${hdrBg};
          padding: 12px 20px 10px;
          position: relative;
        }
        .sid-header-top {
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
        }
        .sid-header-top span {
          font-size: 7px; color: rgba(255,255,255,0.6); letter-spacing: 1.2px;
        }
        .sid-header-date {
          margin-left: auto; font-size: 6px; color: rgba(255,255,255,0.35); letter-spacing: 1px;
        }
        .sid-title {
          font-family: Georgia, serif; font-size: 24px; color: #fff; letter-spacing: 3px;
        }
        .sid-subtitle {
          font-size: 6.5px; color: rgba(255,255,255,0.3); letter-spacing: 2px; margin-top: 2px;
        }
        .sid-accent-bar {
          height: 2.5px; background: ${accent}; opacity: 0.9;
        }

        /* Body */
        .sid-body { display: flex; padding: 20px 20px 0; gap: 28px; }

        /* Photo column */
        .photo-col { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .photo-frame {
          width: 110px; height: 134px; border-radius: 4px; overflow: hidden;
          background: ${faint}; position: relative;
          border: 0.8px solid ${faint};
          display: flex; align-items: center; justify-content: center;
        }
        .photo-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .no-photo {
          text-align: center;
        }
        .no-photo p { font-size: 7px; color: ${inkDim}; letter-spacing: 2px; }
        .entity-pill {
          width: 110px; height: 18px; border-radius: 3px;
          display: flex; align-items: center; justify-content: center;
          background: ${eAccent}1e; border: 0.8px solid ${eAccent}80;
        }
        .entity-pill span {
          font-size: 7.5px; color: ${eAccent}; letter-spacing: 2px;
        }

        /* Fields column */
        .fields-col { flex: 1; display: flex; flex-direction: column; gap: 14px; }
        .field-lbl {
          font-size: 6px; color: ${inkDim}; letter-spacing: 1.5px; line-height: 1;
        }
        .field-val {
          font-size: 9px; color: ${ink}; letter-spacing: 0.5px; line-height: 1.4;
          margin-top: 3px;
        }
        .field-val-name {
          font-family: Georgia, serif; font-size: 13px; color: ${ink};
          margin-top: 3px;
        }

        /* Divider */
        .sid-div {
          height: 1px; background: ${faint}; opacity: 0.6; margin: 16px 20px 0;
        }

        /* Tags section */
        .sid-tags { padding: 12px 20px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
        .tag-lbl { font-size: 6px; color: ${inkDim}; letter-spacing: 1.5px; width: 100%; }
        .pill {
          height: 16px; padding: 0 8px; border-radius: 8px;
          display: flex; align-items: center;
          font-size: 7px; letter-spacing: 0.8px;
        }

        /* Serial */
        .sid-serial {
          text-align: right; padding: 8px 20px 0;
          font-size: 9px; color: ${accent}; letter-spacing: 2px;
        }

        /* MRZ */
        .sid-mrz {
          margin-top: 16px;
          background: ${mrzBg};
          border-top: 0.8px solid ${faint};
          padding: 10px 20px 14px;
        }
        .mrz-lbl { font-size: 5.5px; color: ${inkDim}; letter-spacing: 1px; margin-bottom: 6px; }
        .mrz-line {
          font-size: 9px; color: ${ink}; letter-spacing: 1.8px;
          font-family: monospace; line-height: 1.6;
          word-break: break-all;
        }

        /* Actions */
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

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="page-wrap">
        <div className="sid-card">

          {/* Header */}
          <div className="sid-header">
            <div className="sid-header-top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARK_BLACK} alt="" width={14} height={14} style={{opacity: 0.85, filter: 'invert(1)'}}/>
              <span>THE SEALER PROTOCOL · ONCHAIN IDENTITY REGISTRY</span>
              <span className="sid-header-date">ISSUED {issueDate}</span>
            </div>
            <div className="sid-title">SEALER ID</div>
            <div className="sid-subtitle">AGENT IDENTITY DOCUMENT · ERC-8004</div>
          </div>
          <div className="sid-accent-bar"/>

          {/* Body */}
          <div className="sid-body">
            <div className="photo-col">
              <div className="photo-frame">
                {displayImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImage} alt={name}/>
                ) : (
                  <div className="no-photo">
                    <p>NO<br/>PHOTO</p>
                  </div>
                )}
              </div>
              <div className="entity-pill">
                <span>{ENTITY_LBL}</span>
              </div>
            </div>

            <div className="fields-col">
              <div>
                <div className="field-lbl">NAME</div>
                <div className="field-val-name">{name.slice(0, 18)}</div>
              </div>
              <div>
                <div className="field-lbl">AGENT ID</div>
                <div
                  className="field-val"
                  style={{cursor: 'pointer'}}
                  onClick={handleCopyId}
                  title={agentId}
                >
                  {copied ? '✓ Copied!' : truncateAddr(agentId)}
                </div>
              </div>
              <div>
                <div className="field-lbl">OWNER</div>
                <div className="field-val">{owner ? truncateAddr(owner) : '—'}</div>
              </div>
              <div>
                <div className="field-lbl">PRIMARY CHAIN</div>
                <div className="field-val">{chain.toUpperCase()}</div>
              </div>
              <div>
                <div className="field-lbl">FIRST SEEN</div>
                <div className="field-val">{firstSeen}</div>
              </div>
            </div>
          </div>

          <div className="sid-div"/>

          {/* Tags / socials / LLM */}
          {(socials.length > 0 || tags.length > 0 || llm) && (
            <div className="sid-tags">
              {socials.length > 0 && (
                <>
                  <div className="tag-lbl">SOCIAL</div>
                  {socials.map((s, i) => (
                    <div key={i} className="pill" style={{background: `${accent}1e`, border: `0.8px solid ${accent}99`, color: accent}}>
                      {s.slice(0, 16)}
                    </div>
                  ))}
                </>
              )}
              {tags.length > 0 && (
                <>
                  <div className="tag-lbl" style={{width:'100%', marginTop: socials.length ? 8 : 0}}>SPECIALIZATION</div>
                  {tags.map((t, i) => (
                    <div key={i} className="pill" style={{background: '#14b8a61e', border: '0.8px solid #14b8a699', color: '#14b8a6'}}>
                      {t.slice(0, 14)}
                    </div>
                  ))}
                </>
              )}
              {llm && (
                <>
                  <div className="tag-lbl" style={{width:'100%', marginTop: 8}}>PREFERRED MODEL</div>
                  <div className="pill" style={{background: '#a855f71e', border: '0.8px solid #a855f799', color: '#a855f7'}}>
                    {llm.slice(0, 22)}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Serial */}
          <div className="sid-serial">{ser}</div>

          {/* MRZ */}
          <div className="sid-mrz">
            <div className="mrz-lbl">MACHINE READABLE ZONE</div>
            <div className="mrz-line">
              {'AGENT<' + name.replace(/[^A-Z0-9]/gi, '<').toUpperCase().padEnd(19, '<').slice(0, 19) + '<<<<<<<<<<<<<<<<<<<<'}
            </div>
            <div className="mrz-line">
              {(agentId.replace('0x', '').replace(/[^A-Z0-9]/gi, '<').toUpperCase().padEnd(20, '<').slice(0, 20)) + '<<' + chain.replace(/[^A-Z0-9]/gi, '<').toUpperCase().padEnd(5, '<').slice(0, 5) + '<' + entityType.replace('_', '').toUpperCase().padEnd(8, '<').slice(0, 8) + '<' + year + '<<'}
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={handleImport}>
            ↑ Import Image
          </button>
          <a className="btn btn-ghost" href={svgUrl} target="_blank" rel="noopener noreferrer">
            ↓ SVG
          </a>
        </div>
      </div>
    </>
  );
}
