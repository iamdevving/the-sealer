#!/usr/bin/env npx ts-node -r tsconfig-paths/register
// scripts/acp-seller-register.ts
//
// ACP Seller Agent — Sealer Protocol integration script
//
// What this does:
//   1. Verifies this wallet is already registered as a seller on Virtuals ACP
//      (registration is done via the Virtuals web UI at app.virtuals.io/acp — not programmatically)
//   2. Checks if there's an existing active Sealer commitment for acp_job_delivery
//   3. If not, mints a new commitment via POST /api/attest-commitment with x-internal-key
//   4. Optionally triggers close-and-certify on an existing commitment
//
// Usage:
//   npx ts-node -r tsconfig-paths/register scripts/acp-seller-register.ts
//   npx ts-node -r tsconfig-paths/register scripts/acp-seller-register.ts --certify <commitmentUID>
//   npx ts-node -r tsconfig-paths/register scripts/acp-seller-register.ts --status <commitmentUID>
//
// Prerequisites:
//   - Agent wallet must be registered as a seller at app.virtuals.io/acp
//   - ACP_WALLET in .env.local must match the wallet used on Virtuals ACP
//   - ACP_WALLET_KEY in .env.local — private key for that wallet (local only, never sent to Vercel)
//   - SEALER_INTERNAL_KEY must be set in .env.local
//   - NEXT_PUBLIC_BASE_URL must be set (e.g. https://thesealer.xyz for prod,
//     http://localhost:3000 for local testing)
//
// Note on payment:
//   This script uses x-internal-key to bypass the x402 payment gate.
//   The ACP job fee collected by the ACP contract is the economic equivalent —
//   no separate USDC payment to Sealer is required for internal registrations.

import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE_URL        = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const INTERNAL_KEY    = process.env.SEALER_INTERNAL_KEY || '';
const ACP_WALLET      = process.env.ACP_WALLET || '';
const VIRTUALS_API    = 'https://acpx.virtuals.io/api';

// ── Default commitment params ─────────────────────────────────────────────────
// Adjust these to match the agent's actual capabilities and targets.
// Use /api/difficulty-preview first to tune thresholds before committing:
//   GET /api/difficulty-preview?claimType=acp_job_delivery
//     &minCompletedJobsDelta=10&minSuccessRate=0.8&minUniqueBuyersDelta=3

const DEFAULT_COMMITMENT = {
  claimType:             'acp_job_delivery',
  commitment:            'Complete at least 10 new ACP jobs with ≥80% success rate and ≥3 unique buyers within the commitment window.',
  metric:                'minCompletedJobsDelta=10, minSuccessRate=0.80, minUniqueBuyersDelta=3',
  deadlineDays:          30,    // window length — adjust based on expected throughput
  minCompletedJobsDelta: 10,    // new completed jobs (not all-time total)
  minSuccessRate:        0.80,  // fraction (0–1), not percentage
  minUniqueBuyersDelta:  3,     // new distinct buyer wallets
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertConfig() {
  if (!INTERNAL_KEY) {
    console.error('❌ SEALER_INTERNAL_KEY not set in .env.local');
    process.exit(1);
  }
  if (!ACP_WALLET || !ACP_WALLET.startsWith('0x')) {
    console.error('❌ ACP_WALLET not set or invalid in .env.local (must be 0x EVM address)');
    console.error('   Set ACP_WALLET=0x<your-acp-wallet> in .env.local');
    process.exit(1);
  }
}

async function sealerPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { body: json });
  }
  return json;
}

async function sealerGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-internal-key': INTERNAL_KEY },
  });
  if (res.status === 404) return null;
  return res.json();
}

// ── Virtuals ACP check ────────────────────────────────────────────────────────

async function checkVirtualsRegistration(): Promise<{
  registered: boolean;
  contractAddress?: string;
  agentName?: string;
}> {
  try {
    const res  = await fetch(
      `${VIRTUALS_API}/agents?filters%5BwalletAddress%5D=${encodeURIComponent(ACP_WALLET)}`,
      { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`Virtuals API ${res.status}`);
    const json = await res.json() as { data?: { contractAddress?: string; name?: string }[] };

    if (!json.data?.length) {
      return { registered: false };
    }

    return {
      registered:       true,
      contractAddress:  json.data[0].contractAddress,
      agentName:        json.data[0].name,
    };
  } catch (err) {
    console.warn('[acp-seller] Could not check Virtuals registration (non-fatal):', String(err));
    return { registered: false };
  }
}

// ── Commitment preview ────────────────────────────────────────────────────────

async function previewDifficulty(): Promise<void> {
  const params = new URLSearchParams({
    claimType:             DEFAULT_COMMITMENT.claimType,
    minCompletedJobsDelta: String(DEFAULT_COMMITMENT.minCompletedJobsDelta),
    minSuccessRate:        String(DEFAULT_COMMITMENT.minSuccessRate),
    minUniqueBuyersDelta:  String(DEFAULT_COMMITMENT.minUniqueBuyersDelta),
  });

  try {
    const res  = await fetch(`${BASE_URL}/api/difficulty-preview?${params}`);
    const json = await res.json();
    console.log('\n📊 Difficulty Preview:');
    console.log(`   Score:       ${json.difficulty} / 100  (${json.tierLabel})`);
    console.log(`   Bootstrapped: ${json.bootstrapped ? 'yes (preliminary)' : 'no (empirical)'}`);
    console.log(`   Proof Points (full): ~${json.proofPointsEstimate?.full ?? '?'}`);
    console.log(`   Interpretation: ${json.interpretation}`);
  } catch {
    console.log('   (difficulty preview unavailable — continuing)');
  }
}

// ── Mint commitment ───────────────────────────────────────────────────────────

async function mintCommitment(): Promise<string> {
  const deadline = new Date(Date.now() + DEFAULT_COMMITMENT.deadlineDays * 86400 * 1000);
  const deadlineStr = deadline.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`\n🔐 Minting Sealer commitment for ${ACP_WALLET}...`);
  console.log(`   Claim type: ${DEFAULT_COMMITMENT.claimType}`);
  console.log(`   Deadline:   ${deadlineStr} (${DEFAULT_COMMITMENT.deadlineDays} days)`);
  console.log(`   Targets:    ${DEFAULT_COMMITMENT.metric}`);

  const result = await sealerPost('/api/attest-commitment', {
    agentId:               ACP_WALLET,
    claimType:             DEFAULT_COMMITMENT.claimType,
    commitment:            DEFAULT_COMMITMENT.commitment,
    metric:                DEFAULT_COMMITMENT.metric,
    deadline:              deadlineStr,
    windowDays:            DEFAULT_COMMITMENT.deadlineDays,
    minCompletedJobsDelta: DEFAULT_COMMITMENT.minCompletedJobsDelta,
    minSuccessRate:        DEFAULT_COMMITMENT.minSuccessRate,
    minUniqueBuyersDelta:  DEFAULT_COMMITMENT.minUniqueBuyersDelta,
  });

  console.log(`\n✅ Commitment minted!`);
  console.log(`   UID:        ${result.commitmentUid}`);
  console.log(`   EAS TX:     ${result.easTxHash}`);
  console.log(`   NFT TX:     ${result.nftTxHash}`);
  console.log(`   Explorer:   ${result.easExplorer}`);
  console.log(`\n   ⚠️  Save this UID — you'll need it to check status or certify:`);
  console.log(`   ${result.commitmentUid}`);

  return result.commitmentUid;
}

// ── Check status ──────────────────────────────────────────────────────────────

async function checkStatus(uid: string): Promise<void> {
  console.log(`\n🔍 Checking status for commitment ${uid.slice(0, 10)}...`);

  const result = await sealerGet(`/api/commitment/${uid}`);
  if (!result) {
    console.log('   ❌ Commitment not found');
    return;
  }

  console.log(`\n📋 Commitment Status:`);
  console.log(`   Status:      ${result.status}`);
  console.log(`   Claim Type:  ${result.claimLabel}`);
  console.log(`   Difficulty:  ${result.difficulty ?? '(not yet computed)'}`);
  console.log(`   Proof Points: ${result.proofPoints ?? '(pending)'}`);
  console.log(`   Deadline:    ${result.deadline ? new Date(result.deadline).toLocaleString() : '?'}`);
  console.log(`   Amended:     ${result.amended ? 'yes' : 'no'}`);

  if (result.status === 'achieved') {
    console.log(`\n🏆 Already certified! Proof points: ${result.proofPoints}`);
  } else if (result.status === 'pending') {
    const deadlineTs = result.deadline ? new Date(result.deadline).getTime() : 0;
    const now        = Date.now();
    if (deadlineTs && now > deadlineTs) {
      console.log(`\n⏰ Deadline has passed — run with --certify ${uid} to trigger verification`);
    } else if (deadlineTs) {
      const remaining = Math.ceil((deadlineTs - now) / 86400000);
      console.log(`\n⏳ ${remaining} day(s) remaining. Use --certify ${uid} to trigger early verification.`);
    }
  }
}

// ── Close and certify ─────────────────────────────────────────────────────────

async function certify(uid: string): Promise<void> {
  console.log(`\n🎯 Triggering verification for commitment ${uid.slice(0, 10)}...`);
  console.log('   This will query Base onchain logs — may take 30–90s.');

  const result = await sealerPost('/api/close-and-certify', {
    commitmentUid: uid,
    agentId:       ACP_WALLET,
  });

  if (result.status === 'achieved') {
    console.log(`\n🏆 CERTIFIED!`);
    console.log(`   Outcome:       ${result.outcome}`);
    console.log(`   Achievement:   ${result.achievementScore}`);
    console.log(`   Proof Points:  ${result.proofPoints}`);
    console.log(`   Badge:         ${result.badgeTier}`);
    console.log(`   Certificate:   ${result.certificateUrl || 'pending'}`);
    console.log(`   EAS UID:       ${result.achievementUID}`);
  } else {
    console.log(`\n📋 Result:`);
    console.log(`   Status:  ${result.status}`);
    console.log(`   Message: ${result.message || result.error || JSON.stringify(result)}`);
    if (result.status !== 'achieved' && result.status !== 'failed') {
      console.log('\n   ℹ️  Verification may still be in progress. Check again in a few minutes.');
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  assertConfig();

  const args = process.argv.slice(2);

  // --status <uid>
  if (args[0] === '--status' && args[1]) {
    await checkStatus(args[1]);
    return;
  }

  // --certify <uid>
  if (args[0] === '--certify' && args[1]) {
    await certify(args[1]);
    return;
  }

  // Default: check registration, preview difficulty, mint commitment
  console.log('═══════════════════════════════════════════════════');
  console.log(' ACP Seller → Sealer Protocol Registration');
  console.log('═══════════════════════════════════════════════════');
  console.log(`\n Agent wallet: ${ACP_WALLET}`);
  console.log(` Sealer base:  ${BASE_URL}`);

  // 1. Check Virtuals ACP registration
  console.log('\n1️⃣  Checking Virtuals ACP registration...');
  const virtuals = await checkVirtualsRegistration();

  if (virtuals.registered) {
    console.log(`   ✅ Registered on Virtuals ACP`);
    if (virtuals.agentName)       console.log(`   Agent name:  ${virtuals.agentName}`);
    if (virtuals.contractAddress) console.log(`   Contract:    ${virtuals.contractAddress}`);
  } else {
    console.log('   ⚠️  Not found on Virtuals ACP (or API unavailable)');
    console.log('   → To register: visit https://app.virtuals.io/acp');
    console.log('   → Connect your agent wallet and complete seller registration');
    console.log('   → The ACP contract address will be auto-detected at commitment time');
    console.log('\n   Continuing with Sealer commitment anyway...');
  }

  // 2. Preview difficulty
  console.log('\n2️⃣  Previewing commitment difficulty...');
  await previewDifficulty();

  // 3. Mint commitment
  console.log('\n3️⃣  Minting Sealer commitment...');
  const uid = await mintCommitment();

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Next steps:');
  console.log('═══════════════════════════════════════════════════');
  console.log(' 1. Complete ACP jobs as normal — the verifier tracks');
  console.log('    your onchain job completion logs automatically.');
  console.log(' 2. Check status anytime:');
  console.log(`    npx ts-node scripts/acp-seller-register.ts --status ${uid}`);
  console.log(' 3. When ready to certify (at or after deadline):');
  console.log(`    npx ts-node scripts/acp-seller-register.ts --certify ${uid}`);
  console.log(' 4. Or trigger early verification at any time (force=true):');
  console.log(`    npx ts-node scripts/acp-seller-register.ts --certify ${uid}`);
  console.log('\n   Your commitment is live at:');
  console.log(`   ${BASE_URL}/api/commitment?uid=${uid}`);
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message || err);
  if ((err as any).body) console.error('   Details:', JSON.stringify((err as any).body, null, 2));
  process.exit(1);
});