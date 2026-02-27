# Handoff to Claude — Session 12
**From:** Claude Session 11 | **Date:** Feb 2026

Read this fully before doing anything. Then read PROJECT-CHARTER.md.

---

## Project State

The Sealer (thesealer.xyz) — onchain statement service for ERC-8004 agents.
Repo: github.com/iamdevving/agent-attestation-factory
Stack: Next.js 16, TypeScript, viem, Alchemy RPC (Base Sepolia), EAS SDK, x402

Everything in src/ is committed and working. End-to-end test passed — live attestation on Base Sepolia, card + badge + sealed all rendering correctly.

---

## What's Live

| Route | Status |
|---|---|
| /api/attest | x402 → EAS → returns permalinks |
| /api/card | 9-theme SVG cards, adaptive text, permanent ?uid= links |
| /api/badge | 9-theme SVG badges, 38-char limit + ellipsis |
| /api/sealed | Trading card sleeve, imageUrl + txHash + chain, ISSUE DATE footer |
| /api/infoproducts | NOT YET BUILT — first task |
| src/lib/eas.ts | EAS GraphQL: fetchAttestation(uid) + fetchAttestationByTx(txHash) |
| src/lib/x402.ts | withX402Payment + issueSealAttestation, currently uses CDP facilitator |

Branding: THESEALER.XYZ throughout. STATEMENT replaces ACHIEVEMENT in all display labels. Onchain schema field still named 'achievement' (do not change until mainnet launch).

---

## Task 1: /api/infoproducts (build this first)

Machine-readable product catalogue. Any agent can query this before deciding what to buy.

GET /api/infoproducts → returns JSON:

```json
{
  "platform": "The Sealer",
  "url": "thesealer.xyz",
  "tagline": "Make your statement. Seal it onchain.",
  "description": "Onchain statement service for AI agents and humans. Pay per attestation via x402 USDC micropayments. Each statement is permanent, verifiable, and generates a unique SVG asset.",
  "payment": {
    "protocol": "x402",
    "token": "USDC",
    "chains": ["Base", "Solana (coming)"]
  },
  "products": {
    "statement_badge": {
      "endpoint": "/api/attest",
      "format": "badge",
      "price_usdc": 0.05,
      "maxChars": 38,
      "lines": 1,
      "truncation": "ellipsis at 38 chars",
      "output": "240x200 SVG badge + permanent permalink",
      "themes": ["circuit-anim","circuit","parchment","aurora","base","gold","silver","bronze","bitcoin"],
      "useCases": [
        "Quick status stamp",
        "Role or tier badge",
        "Event participation proof",
        "Single-line achievement marker"
      ]
    },
    "statement_card": {
      "endpoint": "/api/attest",
      "format": "card",
      "price_usdc": 0.10,
      "maxChars": 220,
      "lines": "up to 4, font auto-scales 17.5px to 12px",
      "output": "560x530 SVG card + permanent permalink",
      "themes": ["circuit-anim","circuit","parchment","aurora","base","gold","silver","bronze","bitcoin"],
      "useCases": [
        "Announce a partnership",
        "Record a lesson learned",
        "Publish a performance milestone",
        "Declare a strategy shift",
        "Certify a completed task",
        "Document an agent-to-agent agreement"
      ]
    },
    "sealed": {
      "endpoint": "/api/sealed",
      "price_usdc": 0.15,
      "input": "imageUrl query param — any public image URL",
      "output": "315x440 SVG trading card sleeve wrapping your image",
      "footer": "TX hash + issue date + logo",
      "note": "No text input. The image is the content. Works on Basescan and Solscan.",
      "useCases": [
        "Frame a PNL screenshot",
        "Preserve a trade confirmation",
        "Wrap a performance chart in a verifiable sleeve",
        "Seal any visual proof onchain"
      ]
    },
    "verified_achievement": {
      "status": "planned",
      "price_usdc": 0.50,
      "note": "Platform-verified statements. Requires verification layer (in development)."
    },
    "declaration": {
      "status": "planned",
      "price_usdc": 1.00,
      "note": "Third-party co-signed attestations. Highest trust tier."
    }
  },
  "choosingAProduct": {
    "shortStatement": "Use badge (38 chars max, $0.05)",
    "longStatement": "Use card (up to 220 chars, 4 lines, $0.10)",
    "visualProof": "Use sealed (wrap any image, $0.15)",
    "needsVerification": "Use verified achievement — coming soon ($0.50)",
    "highestTrust": "Use declaration — coming soon ($1.00)"
  }
}
```

This is a static GET route — no payment, no auth. Pure JSON. File: src/app/api/infoproducts/route.ts

---

## Task 2: Logo + Wax Seal Integration

The user will provide new logo and wax seal assets at the start of the session. If they can't get them ready, keep the current placeholders and note what needs swapping.

### Current State
- Cards use hardcoded SVG paths for MARK_WHITE / MARK_BLACK (search these in route.tsx)
- Badges have a small logo area in the header
- Sealed sleeve has a circle+S placeholder in the footer

### What You Need to Do

**Step 1:** User provides two files:
- `logo.png` — the cartoon seal face (The Sealer mascot)
- `wax-seal.png` — the red wax stamp circle

**Step 2:** Convert both to base64 inline data URIs:
```bash
# In bash or PowerShell:
python3 -c "import base64; print(base64.b64encode(open('logo.png','rb').read()).decode())"
```

**Step 3:** Integration targets by file:

**src/app/api/card/route.tsx:**
- Find: `const MARK_WHITE = ...` and `const MARK_BLACK = ...` near top of file
- These are SVG path strings used as the logo mark
- Replace with base64 image: `<image href="data:image/png;base64,..." x="..." y="..." width="40" height="40"/>`
- Wax seal goes bottom-right corner of card (~60x60px), positioned around x=460, y=440
- Search for where `mark` is used in the SVG parts array — that's where it renders

**src/app/api/badge/route.tsx:**
- Logo appears in header area, small (~16x16px)
- Search for the header text block and logo reference
- Replace placeholder with base64 image element

**src/app/api/sealed/route.ts:**
- Footer logo placeholder is the SEAL_MARK_SVG const at the top of the file
- Replace the entire SEAL_MARK_SVG string with:
  `<image href="data:image/png;base64,YOURBASE64" x="-9" y="-9" width="18" height="18"/>`
- For dark background, logo should be white version if available

**Important:** Base64 strings are long — use a variable at the top of each file:
```typescript
const LOGO_B64 = 'iVBORw0KGgo...'; // paste full base64 here
const WAX_B64  = 'iVBORw0KGgo...'; // paste full base64 here
```
Then reference as `data:image/png;base64,${LOGO_B64}` in the SVG.

---

## Task 3: Import Box on Cards

Cards need to support an optional imageUrl param that embeds a thumbnail.

Suggested placement: bottom-left corner of the card, ~80x80px, rounded corners, below the statement text area. Should be optional — if no imageUrl param, card renders normally.

Pattern to follow: look at how sealed_route.ts fetches and embeds the image (fetch → ArrayBuffer → base64 → data URI in SVG image element). Apply same pattern to card route.

Params to add: `?imageUrl=` (optional public URL)

---

## Task 4: SEAL ID (design + route)

SEAL ID is a persistent onchain identity for ERC-8004 agents. Think of it as the agent's profile card.

Route: GET /api/identity?agentId=0x...&chain=Base

Output: SVG identity card showing:
- Agent wallet address (truncated)
- Chain
- First seen / registration date (from EAS or onchain)
- Statement count (how many attestations this wallet has issued — query EAS GraphQL)
- Theme — probably a single dedicated SEAL ID theme, dark and official looking

This needs a new EAS query in eas.ts: fetchAgentStats(walletAddress) → count of attestations by this attester.

---

## Task 5: The Sealer Agent (if time)

The Sealer agent is the platform mascot and first protocol user. It:
1. Reads /api/infoproducts
2. Answers questions about products (wrap with Claude API call)
3. Dogfoods — issues its own statements via /api/attest

This is likely a separate Next.js page at /agent or a chat widget. Lower priority than SEAL ID.

---

## Files You Should Not Touch

- src/lib/x402.ts — Grok owns this
- src/app/api/attest/route.ts — coordinate with Grok before changing
- .env.local — never commit

---

## Known Issues / Watch Out For

- Windows PowerShell curl syntax: use Invoke-WebRequest not curl -H
- After file renames or moves, restart VS Code TypeScript server (Ctrl+Shift+P → TypeScript: Restart TS Server)
- EAS GraphQL uid param is the attestation UID (from EAS), not the TX hash. fetchAttestationByTx handles the TX hash case
- The onchain schema field is named 'achievement' — do NOT change this until mainnet schema registration. Display labels say STATEMENT, internal field stays achievement.
- base64 images in SVGs make files large — this is expected and fine

---

## Session Start Checklist

1. Read this file
2. Read PROJECT-CHARTER.md
3. Ask user: do you have the new logo and wax seal PNGs ready?
4. If yes: start with logo integration (Task 2), then infoproducts (Task 1)
5. If no: start with infoproducts (Task 1), skip logo tasks, note placeholders
6. Then: import box on cards (Task 3), SEAL ID (Task 4)
