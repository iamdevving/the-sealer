# Security Checklist — New API Routes
## Check these before every commit that adds or modifies a route

---

### 1. Does this route fetch a user-supplied URL server-side?
→ **YES**: Import `validateImageUrl` from `@/lib/security` and call it before any `fetch()`.
→ Also validate the response `Content-Type` is `image/*` before embedding.

```typescript
import { validateImageUrl } from '@/lib/security';
const v = validateImageUrl(imageUrl);
if (!v.valid) return NextResponse.json({ error: v.reason }, { status: 400 });
```

---

### 2. Does this route accept user input and call string methods on it?
→ **YES**: Type-check every field that will call `.trim()`, `.toLowerCase()`, `.startsWith()`,
  regex test, or any string method before calling it.

```typescript
if (body.handle !== undefined && typeof body.handle !== 'string') {
  return NextResponse.json({ error: 'handle must be a string' }, { status: 400 });
}
```

---

### 3. Does this route write onchain state or modify user-owned objects?
→ **YES**: Require wallet ownership proof.
- EVM (`0x...`): `verifyAgentSignature()` from `@/lib/agentSig`
- Solana (base58): block `0x` agentId when `paymentChain === 'solana'`

```typescript
import { verifyAgentSignature, getSigningPayload, ACTIONS } from '@/lib/agentSig';
```

---

### 4. Does this route reveal any user state, platform data, or internal metadata?
→ **YES**: Add rate limiting. Also review what fields are returned — internal flags
  (e.g. `freeClaimUsed`, `failureReason`) must not appear in public responses.

```typescript
import { rateLimitRequest } from '@/lib/security';
const limited = await rateLimitRequest(req, 'my-action', 20, 3600);
if (limited) return limited;
```

**Rate limit reference:**
| Endpoint type | Limit | Window |
|---|---|---|
| Payment/write | 5–10/hr | 3600s |
| Public read | 30/min | 60s |
| Leaderboard | 60/min | 60s |
| Agent profile | 30/min | 60s |

---

### 5. Does this route accept a Solana payment and trust the `agentId` body field?
→ **YES**: Reject `0x` addresses when `paymentChain === 'solana'`. Validate base58 format.

```typescript
function isSolanaPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}
if (paymentChain === 'solana' && agentId.startsWith('0x')) {
  return NextResponse.json({ error: 'Solana payers must use Solana pubkey as agentId' }, { status: 400 });
}
```

---

### 6. Does this route reflect user input into SVG output?
→ **YES**: Every field that appears in SVG must pass through `esc()` before insertion.
  Apply `esc()` at parse time, not just before output.

```typescript
function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const name = esc(p.get('name') || '');
```

---

### Quick pre-commit grep

Run this before pushing any new route:

```powershell
# Check for unprotected fetch calls
Select-String -Path "src/app/api/**/*.ts" -Pattern "await fetch\(" | Where-Object { $_ -notmatch "validateImageUrl|AbortSignal|anthropic|alchemy|helius|neynar|easscan|vercel|coingecko|walletconnect" }

# Check for write routes missing rateLimitRequest
Select-String -Path "src/app/api/**/*.ts" -Pattern "export async function POST" | ForEach-Object { $file = $_.Path; if (-not (Select-String -Path $file -Pattern "rateLimitRequest" -Quiet)) { Write-Host "MISSING rate limit: $file" } }

# Check for string methods called without type check
Select-String -Path "src/app/api/**/*.ts" -Pattern "body\.\w+\?\.trim\(\)" 
```

---

### Mandatory imports by route type

| Route does this | Must import |
|---|---|
| Server-side image fetch | `validateImageUrl` from `@/lib/security` |
| Any POST/write | `rateLimitRequest` from `@/lib/security` |
| Onchain state write (EVM) | `verifyAgentSignature` from `@/lib/agentSig` |
| Solana payment flow | `isSolanaPubkey` (inline or shared util) |
| SVG output with user params | `esc()` function (inline or shared) |

---

*Last updated: March 2026 — after Vector v5 scan*
*Covers: SSRF, type confusion, wallet impersonation, SVG injection, rate limiting, Solana identity*
