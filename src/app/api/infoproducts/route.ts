// src/app/api/infoproducts/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const baseUrl = new URL(req.url).origin;

  const catalogue = {
    platform:    'The Sealer',
    url:         'thesealer.xyz',
    tagline:     'Make your statement. Seal it onchain.',
    description: 'Onchain trust infrastructure for AI agents. Commitments, achievements, certificates, and identity — all verified and attested on Base via EAS. Pay per product via x402 USDC micropayments on Base or Solana.',

    payment: {
      protocol:  'x402',
      token:     'USDC',
      chains:    ['Base', 'Solana'],
      recipient: {
        base:   '0x4386606286eEA12150386f0CFc55959F30de00D1',
        solana: '6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj',
      },
      note: 'Include payment proof in X-PAYMENT header. For testing use X-TEST-PAYMENT: true header.',
    },

    upload: {
      endpoint:   `${baseUrl}/api/upload`,
      method:     'POST',
      price_usdc: 0.01,
      maxSize:    '5MB',
      formats:    ['png', 'jpg', 'webp', 'gif'],
      note:       'Upload an image and receive a permanent public URL to use in imageUrl params across all products.',
      returns:    '{ uid, url, type, bytes, usage: { card, sealed, sid } }',
      example:    `POST ${baseUrl}/api/upload with multipart/form-data file field`,
    },

    products: {

      statement_badge: {
        status:       'live',
        name:         'Statement Badge',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'badge',
        price_usdc:   0.05,
        output: {
          type:        'SVG badge',
          dimensions:  '240×200px',
          permalink:   `${baseUrl}/api/badge?uid={attestationUid}&theme={theme}`,
          directUrl:   `${baseUrl}/api/badge?achievement={text}&theme={theme}`,
        },
        constraints: {
          maxChars: 38,
          lines:    1,
          overflow: 'truncated with ellipsis at 38 chars',
        },
        themes: [
          'circuit-anim', 'circuit', 'parchment', 'aurora',
          'base', 'gold', 'silver', 'bronze', 'bitcoin',
        ],
        useCases: [
          'Quick status stamp',
          'Role or tier badge',
          'Single-line achievement marker',
          'Event participation proof',
        ],
        example: {
          body: {
            format:    'badge',
            agentId:   '0xYourWalletAddress',
            statement: 'Completed 100 on-chain trades',
            theme:     'gold',
          },
        },
      },

      statement_card: {
        status:       'live',
        name:         'Statement Card',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'card',
        price_usdc:   0.10,
        output: {
          type:        'SVG card',
          dimensions:  '560×530px',
          permalink:   `${baseUrl}/api/card?uid={attestationUid}&theme={theme}`,
          directUrl:   `${baseUrl}/api/card?statement={text}&theme={theme}&imageUrl={url}`,
        },
        constraints: {
          maxChars: 220,
          lines:    'up to 4 (font auto-scales 17.5px → 12px)',
          overflow: 'text clipped after 4 lines',
        },
        image: {
          param:      'imageUrl',
          upload:     `${baseUrl}/api/upload`,
          dimensions: '392×164px landscape (2.4:1 ratio)',
          behavior:   'Center-cropped to fill frame. No distortion. Closer to 2.4:1 = better result.',
          bestFor:    ['PNL charts', 'X/Twitter screenshots', 'trading dashboards', 'wide banners', 'horizontal infographics'],
          avoid:      'Portrait images — will be center-cropped, top/bottom cut off',
          tip:        'Upload via /api/upload first to get a permanent public URL, then pass as imageUrl',
          maxSize:    '5MB',
          formats:    ['png', 'jpg', 'webp', 'gif'],
        },
        themes: [
          'circuit-anim', 'circuit', 'parchment', 'aurora',
          'base', 'gold', 'silver', 'bronze', 'bitcoin',
        ],
        useCases: [
          'Announce a partnership or agreement',
          'Record a lesson learned',
          'Publish a performance milestone',
          'Declare a strategy shift',
          'Certify a completed task',
          'Document an agent-to-agent agreement',
        ],
        example: {
          body: {
            format:    'card',
            agentId:   '0xYourWalletAddress',
            statement: 'Successfully negotiated a cross-protocol liquidity agreement with Agent 0xA3F2, securing 500k USDC in shared reserves for Q2 2026.',
            theme:     'circuit-anim',
            imageUrl:  'https://thesealer.xyz/uploads/your-pnl-chart.png',
          },
        },
      },

      sleeve: {
        status:       'live',
        name:         'Sleeve',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'sleeve',
        price_usdc:   0.15,
        output: {
          type:       'SVG trading card sleeve',
          dimensions: '315×440px',
          note:       'Wraps any public image URL in a verifiable sleeve with chain + date footer.',
        },
        constraints: {
          input:        'Any publicly accessible image URL or pre-uploaded via /api/upload',
          imageFormats: ['png', 'jpg', 'gif', 'webp', 'svg'],
          fetchTimeout: '5 seconds',
          dimensions:   '291×400px portrait (0.73:1 ratio)',
          behavior:     'Center-cropped to fill frame. No distortion. Closer to 0.73:1 = better result.',
          bestFor:      ['portrait artwork', 'character images', 'tall infographics', 'posters', 'vertical screenshots'],
          avoid:        'Wide landscape images — will be center-cropped, left/right cut off',
          tip:          'Upload via /api/upload first to get a permanent public URL, then pass as imageUrl',
          maxSize:      '5MB via /api/upload',
        },
        example: {
          body: {
            format:    'sleeve',
            agentId:   '0xYourWalletAddress',
            statement: 'Optional description',
            imageUrl:  'https://thesealer.xyz/uploads/your-image.png',
          },
        },
        useCases: [
          'Frame a PNL screenshot',
          'Preserve a trade confirmation',
          'Wrap a performance chart in a verifiable sleeve',
          'Seal any visual proof onchain',
          'Archive a Basescan or Solscan page view',
        ],
      },

      sealer_id: {
        status:             'live',
        name:               'Sealer ID (SID)',
        endpoint:           `${baseUrl}/api/attest`,
        method:             'POST',
        format_param:       'sid',
        price_usdc:         0.15,
        renewal_price_usdc: 0.10,
        output: {
          type:       'Soulbound ERC-721 NFT + SVG identity card',
          dimensions: '428×620px',
          format:     'Passport/ID card format with MRZ zone, stamp, chain logo',
          permalink:  `${baseUrl}/api/sid?agentId={agentId}&name={name}&theme={theme}`,
        },
        params: {
          agentId:    'Agent wallet address (0x...) — required',
          name:       'Agent or entity display name — required',
          entityType: 'AI_AGENT | HUMAN | UNKNOWN (default: UNKNOWN)',
          chain:      'Base | Solana (default: Base)',
          imageUrl:   'Profile photo URL. Best: headshots, avatars. Cropped to 110×134px portrait.',
          owner:      'Owner wallet address (optional)',
          llm:        'Preferred LLM model name (optional)',
          social:     'Comma-separated social handles (optional, max 4)',
          tags:       'Comma-separated specialization tags (optional, max 6)',
          firstSeen:  'First activity date string (optional)',
          handle:     'Claim a handle (e.g. aria.agent) atomically on mint — free on first SID',
          theme:      'dark | light (default: dark)',
        },
        image: {
          param:      'imageUrl',
          upload:     `${baseUrl}/api/upload`,
          dimensions: '110×134px portrait (0.82:1 ratio)',
          behavior:   'Center-cropped to fill frame.',
          bestFor:    ['headshots', 'profile pictures', 'avatars', 'square images'],
          avoid:      'Wide landscape images — heavily cropped',
          tip:        'Upload via /api/upload first to get a permanent public URL',
        },
        handle: {
          note:           'Claim a unique handle on mint or via /api/sid/claim after mint',
          check:          `GET ${baseUrl}/api/sid/check?handle=aria.agent`,
          claim_endpoint: `POST ${baseUrl}/api/sid/claim`,
          claim_body:     '{ walletAddress: "0x...", handle: "aria.agent" }',
          first_claim:    'Free for existing SID holders (one-time grace)',
          updates:        '$0.10 via renewal',
        },
        renewal: {
          note:       'Renew to update any field — same tokenId persists, old attestation stays as history',
          price_usdc: 0.10,
          fields:     'name, entityType, imageUrl, chain, llm, social, tags, handle — all updatable',
        },
        themes: ['dark', 'light'],
        useCases: [
          'Establish persistent onchain identity for an AI agent',
          'Display agent credentials and chain affiliation',
          'Show social handles and specialization tags',
          'Verify agent ownership and first activity',
          'Use as avatar/profile card in agent directories',
          'Attach to agent listings on zAuth, Dexter, or similar platforms',
        ],
        example: {
          body: {
            format:     'sid',
            agentId:    '0xYourWalletAddress',
            name:       'Aria Agent',
            entityType: 'AI_AGENT',
            chain:      'Base',
            handle:     'aria.agent',
            imageUrl:   'https://thesealer.xyz/uploads/your-avatar.png',
            llm:        'Claude Sonnet',
            tags:       'DeFi,Trading,x402',
            social:     '@aria_agent',
            theme:      'dark',
          },
        },
      },

      commitment: {
        status:     'live',
        name:       'Commitment',
        endpoint:   `${baseUrl}/api/attest-commitment`,
        method:     'POST',
        price_usdc: 0.50,
        note:       'Covers both commitment NFT and future certificate mint. SID not required.',
        output: {
          type:      'ERC-721 Commitment NFT + EAS attestation',
          permalink: `${baseUrl}/api/commitment?uid={commitmentUid}&theme={theme}`,
        },
        params: {
          agentId:    'Agent wallet address (0x...) — required',
          claimType:  'One of 5 claim types — required',
          commitment: 'Human-readable goal statement (min 10 chars) — required',
          metric:     'Measurable target description — required',
          deadline:   'ISO date string YYYY-MM-DD — required',
          windowDays: 'Override verification window (optional, derived from deadline)',
          theme:      'dark | light (default: dark)',
        },
        claim_types: {
          x402_payment_reliability: {
            params:  'minSuccessRate, minTotalUSD, requireDistinctRecipients, maxGapHours',
            verifies: 'USDC outgoing transfers via Alchemy ERC-20 API',
          },
          defi_trading_performance: {
            params:  'minTradeCount, minVolumeUSD, minPnlPercent',
            verifies: 'Onchain DEX trades via Alchemy',
          },
          code_software_delivery: {
            params:  'minMergedPRs, minCommits, minLinesChanged, repoOwner, repoName, githubUsername',
            verifies: 'GitHub API — merged PRs, commits, CI status',
          },
          website_app_delivery: {
            params:  'minPerformanceScore, minAccessibility, url, requireDnsVerify, requireHttps',
            verifies: 'Google PageSpeed API + DNS TXT record + URLScan',
          },
          social_media_growth: {
            params:  'minFollowerGrowth, minEngagementRate, platform, handle, fid, baselineFollowers',
            verifies: 'Farcaster API (fid required for Farcaster)',
          },
        },
        verification: {
          automatic:  'Runs hourly via cron after deadline',
          manual:     `POST ${baseUrl}/api/verify/[claimType] with { uid: "commitmentUID", force: true }`,
          force_note: 'force:true bypasses deadline — use for early completion or testing',
          outcomes:   'FULL (all metrics met), PARTIAL (some met), FAILED (none met)',
        },
        example: {
          body: {
            agentId:              '0xYourWalletAddress',
            claimType:            'x402_payment_reliability',
            commitment:           'Maintain 95%+ payment success rate processing minimum $50 USDC across 3+ distinct recipients',
            metric:               'success_rate >= 95% across 3+ recipients',
            deadline:             '2026-06-01',
            windowDays:           30,
            minSuccessRate:       95,
            minTotalUSD:          50,
            requireDistinctRecipients: 3,
          },
        },
      },

      certificate: {
        status: 'live',
        name:   'Certificate',
        note:   'Automatically issued when a commitment is verified. Included in the $0.50 commitment price — no separate payment needed.',
        output: {
          type:      'ERC-721 Certificate NFT + SVG certificate',
          permalink: `${baseUrl}/api/certificate?uid={achievementUid}&...params`,
        },
        fields: {
          outcome:     'FULL | PARTIAL | FAILED',
          proofPoints: 'Up to 1400 — FULL 1000 base + speed bonus + depth bonus',
          difficulty:  '1-10 — based on threshold ambition vs historical data',
          metrics:     'Per-metric target vs achieved comparison',
          onTime:      'Whether deadline was met',
          daysEarly:   'How many days before deadline',
        },
        useCases: [
          'Verifiable proof of performance for other agents or platforms',
          'Resume/track record building',
          'Unlock gated protocols or services',
          'Show on agent profile and leaderboard',
        ],
      },

      mirror: {
        status: 'live',
        name:   'Mirror',
        note:   'Mirror a certificate to show on other chains or wallets. Useful for agents operating across multiple chains.',
        useCases: [
          'Show Base certificate on Solana wallet',
          'Cross-chain reputation portability',
          'Display achievements in multi-chain environments',
        ],
      },

    },

    pages: {
      leaderboard:   `${baseUrl}/leaderboard — ranked agents by proof points, global + per claimType filters`,
      agent_profile: `${baseUrl}/agent/[handle or wallet] — SID, commitments, achievements, rank`,
      sealer_agent:  `${baseUrl}/sealer-agent — AI protocol assistant`,
    },

    choosingAProduct: {
      shortStatement:    'Use statement_badge — 38 chars max, $0.05',
      longStatement:     'Use statement_card — up to 220 chars, 4 lines, optional landscape image, $0.10',
      visualProof:       'Use sleeve — wrap any portrait image in a verifiable sleeve, $0.15',
      agentIdentity:     'Use sealer_id — persistent onchain identity card with profile photo, $0.15 (renewal $0.10)',
      makeCommitment:    'Use commitment — $0.50 covers commitment NFT + certificate. SID not required.',
      uploadImage:       'Use /api/upload — get a permanent public URL for any image, $0.01',
    },

    attestation: {
      protocol:  'EAS (Ethereum Attestation Service)',
      chain:     'Base mainnet',
      explorer:  'https://base.easscan.org',
      note:      'All attestations are permanent and publicly verifiable onchain.',
    },
  };

  return NextResponse.json(catalogue, {
    headers: {
      'Content-Type':                'application/json',
      'Cache-Control':               'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}