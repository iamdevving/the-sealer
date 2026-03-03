/**
 * /c/[uid]
 * Permalink for any minted credential.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSnapshot } from '@/lib/snapshot'

export const runtime = 'nodejs'

const DIMS: Record<string, { w: number; h: number }> = {
  badge:  { w: 240,  h: 80  },
  card:   { w: 560,  h: 530 },
  sealed: { w: 315,  h: 440 },
  sid:    { w: 428,  h: 620 },
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const { uid } = await params
  const snapshot = await getSnapshot(uid)

  if (!snapshot) {
    return new NextResponse(notFoundHTML(uid), {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const dims = DIMS[snapshot.product] ?? { w: 400, h: 400 }
  const easUrl = `https://base.easscan.org/attestation/view/${snapshot.attestationUID}`
  const permalink = `https://thesealer.xyz/c/${uid}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sealed Credential · ${uid}</title>
  <meta property="og:type" content="website">
  <meta property="og:url" content="${permalink}">
  <meta property="og:title" content="Sealed Credential · The Sealer">
  <meta property="og:description" content="Verifiable onchain credential · EAS attested on Base">
  <meta property="og:image" content="${snapshot.url}">
  <meta property="og:image:width" content="${dims.w}">
  <meta property="og:image:height" content="${dims.h}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@thesealerxyz">
  <meta name="twitter:title" content="Sealed Credential">
  <meta name="twitter:description" content="Verifiable onchain credential · EAS attested on Base">
  <meta name="twitter:image" content="${snapshot.url}">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f; --surface: #12121a; --border: rgba(255,255,255,0.08);
      --text: #e2e8f0; --muted: #64748b; --accent: #3b82f6; --green: #10b981;
    }
    body {
      background: var(--bg); color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 40px 20px; gap: 32px;
    }
    .credential-frame {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 16px; padding: 32px;
      display: flex; align-items: center; justify-content: center; max-width: 100%;
    }
    .credential-frame img { max-width: 100%; height: auto; display: block; }
    .meta { width: 100%; max-width: ${Math.max(dims.w, 400)}px; display: flex; flex-direction: column; gap: 12px; }
    .meta-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; font-size: 13px; gap: 12px;
    }
    .meta-label { color: var(--muted); white-space: nowrap; }
    .meta-value { color: var(--text); font-family: monospace; font-size: 12px; word-break: break-all; text-align: right; }
    .meta-value a { color: var(--accent); text-decoration: none; }
    .meta-value a:hover { text-decoration: underline; }
    .badge-verified {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--green); font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
    }
    .badge-verified::before { content: ''; width: 8px; height: 8px; background: var(--green); border-radius: 50%; }
    .wordmark { font-size: 13px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
    .wordmark a { color: var(--muted); text-decoration: none; }
    .wordmark a:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="credential-frame">
    <img src="${snapshot.url}" alt="Sealed credential ${uid}" width="${dims.w}" height="${dims.h}">
  </div>
  <div class="meta">
    <div class="meta-row">
      <span class="meta-label">Status</span>
      <span class="meta-value"><span class="badge-verified">EAS Attested on Base</span></span>
    </div>
    <div class="meta-row">
      <span class="meta-label">UID</span>
      <span class="meta-value">${uid}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Attestation</span>
      <span class="meta-value">
        <a href="${easUrl}" target="_blank" rel="noopener">
          ${snapshot.attestationUID.slice(0, 10)}…${snapshot.attestationUID.slice(-8)}
        </a>
      </span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Product</span>
      <span class="meta-value">${snapshot.product}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Minted</span>
      <span class="meta-value">${new Date(snapshot.mintedAt).toUTCString()}</span>
    </div>
    ${snapshot.paymentChain ? `
    <div class="meta-row">
      <span class="meta-label">Paid via</span>
      <span class="meta-value">${snapshot.paymentChain} · USDC</span>
    </div>` : ''}
    <div class="meta-row">
      <span class="meta-label">Static SVG</span>
      <span class="meta-value"><a href="${snapshot.url}" target="_blank" rel="noopener">View raw SVG ↗</a></span>
    </div>
  </div>
  <div class="wordmark"><a href="https://thesealer.xyz">The Sealer Protocol</a></div>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

function notFoundHTML(uid: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Not Found · The Sealer</title>
  <style>
    body { background: #0a0a0f; color: #64748b; font-family: monospace;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; flex-direction: column; gap: 16px; }
    a { color: #3b82f6; }
  </style>
</head>
<body>
  <div>credential not found</div>
  <div style="font-size:12px">${uid}</div>
  <a href="https://thesealer.xyz">← thesealer.xyz</a>
</body>
</html>`
}