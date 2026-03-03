The Sealer — Session 13 Handoff
Date: March 2, 2026 | Stack: Next.js 16, TypeScript, viem, Alchemy, Base Sepolia, EAS
CRITICAL RULES
Base64: Never embed PNG larger than 50KB b64 in SVG. Resize to max 120x120px first. Check b64 length under 50000 chars. Use string concatenation for SVG, never template literals. Always escape < in SVG text with < — use safeMrzL1/safeMrzL2 not raw mrzL1/mrzL2.
Python scripts: Always write to .py files, never inline PowerShell. Delete before committing: Remove-Item *.py, public\*_b64.txt
Cache: If changes not showing: stop server, Remove-Item -Recurse -Force .next, restart.
LIVE ROUTES

/api/attest — POST only, working
/api/badge — working, circular wax seal
/api/card — working, imageUrl fetch added, circular wax seal
/api/sealed — working, Base + Solana logos
/api/sid — working, dark=blue stamp, light=original stamp
/api/infoproducts — working, full catalog
public/index.html — website

PUBLIC ASSETS

public/logo.png — white seal logo
public/stamp_nobg_lightblue.png — blue ink stamp
public/seal-wax-web.png — wax seal for website hero
public/seal-wax-circular.png — circular wax seal for card/badge

PRODUCTS
Badge $0.05 — GET /api/badge?uid={uid}&theme={theme} — SVG 240x80px, 9 themes
Card $0.10 — GET /api/card?uid={uid}&theme={theme}&imageUrl={url} — SVG 560x530px, 9 themes, upper right box shows image or NO ATTACHMENT
SEALed $0.15 — GET /api/sealed?imageUrl={url}&txHash={hash}&chain={chain} — SVG 315x440px, imageUrl IS the content, Base + Solana
Sealer ID $0.15 mint / $0.10 renewal (renewal not built) — GET /api/sid?agentId={id}&name={name}&entityType={type}&chain={chain}&theme={theme}&imageUrl={url}&owner={addr}&llm={model}&social={handles}&tags={tags}&firstSeen={date} — SVG 428x620px, dark/light, MRZ zone, stamp at DIV2_Y+67, serial at DIV2_Y+8
STATIC SVG DECISION — IMPORTANT
Sealer ID SVGs should be STATIC once minted. Currently dynamic (re-renders on every fetch). Proposed: generate once on mint, store on IPFS/db, permalink serves stored SVG, renewal = new mint. NOT YET BUILT — plan for v1.1. For launch SVGs are still dynamic.
LAUNCH PRIORITY ORDER
1. CRITICAL — Verify Solana end-to-end. Solana logos are in SVGs and website says it's live. BUT verify /api/attest actually submits attestations on Solana — check for Solana-specific logic in attest route. If only cosmetic, must be implemented before launch.
2. Mainnet schema registration. Register EAS schema on Base Mainnet, update .env.local with mainnet RPC + schema UID, test full flow. Need: ALCHEMY_MAINNET_API_KEY, EAS_SCHEMA_UID_MAINNET, USDC_CONTRACT_BASE=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
3. Agent route /api/agent — see spec below.
4. Test all products on mainnet — full USDC payment flow, verify permalinks and SVG rendering.
5. Social accounts — X + Farcaster: create, pin website, one launch post. Agent-facing, no active management needed.
6. zAuth + Dexter listings — link to /api/infoproducts as machine-readable catalog.
7. Website final polish — fix footer links once social accounts exist.
AGENT ROUTE SPEC
Single structured call: 402 challenge → retry with payment proof → attestation + SVG returned together. Agent needs a wallet but flow is fully autonomous.
x402 flow: Agent POSTs → server returns 402 + payment details → agent signs + sends USDC → agent retries with X-Payment header → server verifies → returns SVG + UID.
Request: POST /api/agent, body: { product: "badge"|"card"|"sealed"|"sid", agentId: "0x...", payload: { achievement, theme, imageUrl, txHash, chain, name, entityType, ...sid params } }
Response 200: { attestationUid, permalink, svg, txHash, chain, product, price }
Response 402: { error, amount, currency, payTo, chain, x402: {...} }
Implementation: Reuse attest logic from /api/attest. Reuse SVG generation from each product route. x402 facilitator handles payment middleware. Add validation + rate limiting.
POST-LAUNCH v1.1
Achievements: /api/achievements?agentId={id} — milestone credentials, needs activity tracking db.
Sealer ID Renewal: POST /api/sid/renew, $0.10, new EAS attestation + new stored static SVG. Build alongside static SVG architecture. Do NOT implement as param override.
WEBSITE
Sections: Hero, Stats, How It Works, Products x4, For Who, Pricing, Coming Soon, Footer. Hero has wax seal left + blue ink stamp right (base64 embedded). OG tags for bot previews. PREVIEW button on each product card. Footer: Built by @iamdevving with Claude · Grok · 💙. Dead links to fix: X, Farcaster, GitHub once accounts created.
KNOWN ISSUES

Solana attestation — verify implemented, not just cosmetic
Static SVG — not built, SVGs are dynamic at launch
Light theme stamp — slightly smaller than dark blue stamp, can unify later
Card imageUrl — uses Buffer.from(), verify works on edge runtime
x402 facilitator — must be configured + tested on mainnet
MRZ — always use safeMrzL1/safeMrzL2, never raw versions

SESSION 13 COMPLETED
Sealer ID XML fixed (MRZ escaping), blue ink stamp dark theme, circles removed from buildStamp, stamp up 5px, /api/identity renamed to /api/sid, imageUrl on card, infoproducts updated, website built with all sections + hero images + OG tags + preview modals, circular wax seal on card/badge, static SVG decision documented, repo clean.