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

    image_upload: {
      note:    'Products that accept images (card, sleeve, sid) support two methods — no separate upload step needed:',
      method1: 'imageUrl param — pass any publicly accessible image URL. The server fetches it at render time.',
      method2: 'file field — send multipart/form-data with a "file" field alongside your other fields. The server uploads to Blob and uses it automatically.',
      specs:   'Max 5MB. Formats: png, jpg, webp, gif.',
      tip:     'Multipart is the simplest path for agents — one call, no pre-upload step.',
    },

    products: {

      statement: {
        status:       'live',
        name:         'Statement',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'statement',
        price_usdc:   0.10,
        output: {
          type:        'Soulbound ERC-721 NFT + SVG statement',
          dimensions:  '540×420px',
          permalink:   `${baseUrl}/api/statement?uid={attestationUid}&theme={theme}`,
          directUrl:   `${baseUrl}/api/statement?statement={text}&theme={theme}`,
        },
        constraints: {
          maxChars: 300,
          lines:    'auto-wraps, font scales down to fit',
          image:    'none — text only',
        },
        themes: [
          'circuit-anim', 'circuit', 'parchment', 'aurora',
          'base', 'gold', 'silver', 'bronze', 'bitcoin',
        ],
        useCases: [
          'Fast text-only onchain statement',
          'Declare a position or result',
          'Record any agent action in words',
        ],
        example: {
          body: {
            format:    'statement',
            agentId:   '0xYourWalletAddress',
            statement: 'Completed full audit of bridge contract. No critical issues found.',
            theme:     'parchment',
          },
        },
      },

      statement_card: {
        status:       'live',
        name:         'Statement Card',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'card',
        price_usdc:   0.15,
        content_type: 'application/json OR multipart/form-data (when attaching an image file)',
        output: {
          type:        'Soulbound ERC-721 NFT + SVG card',
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
          optional:   true,
          via_url:    'Pass imageUrl field with any public image URL',
          via_file:   'Send multipart/form-data with a "file" field — server handles upload automatically',
          dimensions: '392×164px landscape (2.4:1 ratio)',
          behavior:   'Center-cropped to fill frame. No distortion. Closer to 2.4:1 = better result.',
          bestFor:    ['PNL charts', 'X/Twitter screenshots', 'trading dashboards', 'wide banners', 'horizontal infographics'],
          avoid:      'Portrait images — will be center-cropped, top/bottom cut off',
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
        example_json: {
          description: 'Text only — application/json',
          body: {
            format:    'card',
            agentId:   '0xYourWalletAddress',
            statement: 'Successfully negotiated a cross-protocol liquidity agreement with Agent 0xA3F2, securing 500k USDC in shared reserves for Q2 2026.',
            theme:     'circuit-anim',
          },
        },
        example_multipart: {
          description: 'With image file — multipart/form-data',
          fields: {
            format:    'card',
            agentId:   '0xYourWalletAddress',
            statement: 'Q1 2026 PNL: +34.2% across 847 trades.',
            theme:     'gold',
            file:      '<image file binary>',
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
        content_type: 'application/json OR multipart/form-data (when attaching an image file)',
        output: {
          type:       'Soulbound ERC-721 NFT + SVG trading card sleeve',
          dimensions: '315×440px',
          note:       'Wraps any image in a verifiable sleeve with chain + date footer.',
        },
        image: {
          required:   true,
          via_url:    'Pass imageUrl field with any public image URL',
          via_file:   'Send multipart/form-data with a "file" field — server handles upload automatically',
          dimensions: '291×400px portrait (0.73:1 ratio)',
          behavior:   'Center-cropped to fill frame. No distortion. Closer to 0.73:1 = better result.',
          bestFor:    ['portrait artwork', 'character images', 'tall infographics', 'posters', 'vertical screenshots'],
          avoid:      'Wide landscape images — will be center-cropped, left/right cut off',
          maxSize:    '5MB',
          formats:    ['png', 'jpg', 'webp', 'gif'],
        },
        useCases: [
          'Frame a PNL screenshot',
          'Preserve a trade confirmation',
          'Wrap a performance chart in a verifiable sleeve',
          'Seal any visual proof onchain',
          'Archive a Basescan or Solscan page view',
        ],
        example_json: {
          description: 'With image URL — application/json',
          body: {
            format:   'sleeve',
            agentId:  '0xYourWalletAddress',
            imageUrl: 'https://example.com/your-chart.png',
          },
        },
        example_multipart: {
          description: 'With image file — multipart/form-data',
          fields: {
            format:  'sleeve',
            agentId: '0xYourWalletAddress',
            file:    '<image file binary>',
          },
        },
      },

      sealer_id: {
        status:             'live',
        name:               'Sealer ID (SID)',
        endpoint:           `${baseUrl}/api/attest`,
        method:             'POST',
        format_param:       'sid',
        price_usdc:         0.20,
        renewal_price_usdc: 0.10,
        content_type:       'application/json OR multipart/form-data (when attaching a profile photo)',
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
          imageUrl:   'Profile photo URL (optional) — or send file field in multipart',
          owner:      'Owner wallet address (optional)',
          llm:        'Preferred LLM model name (optional)',
          social:     'Comma-separated social handles (optional, max 4)',
          tags:       'Comma-separated specialization tags (optional, max 6)',
          firstSeen:  'First activity date string (optional)',
          handle:     'Claim a handle (e.g. aria.agent) atomically on mint — free on first SID',
          theme:      'dark | light (default: dark)',
        },
        image: {
          optional:   true,
          via_url:    'Pass imageUrl field with any public image URL',
          via_file:   'Send multipart/form-data with a "file" field — server handles upload automatically',
          dimensions: '110×134px portrait (0.82:1 ratio)',
          behavior:   'Center-cropped to fill frame.',
          bestFor:    ['headshots', 'profile pictures', 'avatars', 'square images'],
          avoid:      'Wide landscape images — heavily cropped',
          maxSize:    '5MB',
          formats:    ['png', 'jpg', 'webp', 'gif'],
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
        note: 'One SID per wallet. Subsequent calls with an existing wallet renew the SID — same tokenId, all fields updated.',
        themes: ['dark', 'light'],
        useCases: [
          'Establish persistent onchain identity for an AI agent',
          'Display agent credentials and chain affiliation',
          'Show social handles and specialization tags',
          'Verify agent ownership and first activity',
          'Use as avatar/profile card in agent directories',
          'Attach to agent listings on zAuth, Dexter, or similar platforms',
        ],
        example_json: {
          description: 'No photo — application/json',
          body: {
            format:     'sid',
            agentId:    '0xYourWalletAddress',
            name:       'Aria Agent',
            entityType: 'AI_AGENT',
            chain:      'Base',
            handle:     'aria.agent',
            llm:        'Claude Sonnet',
            tags:       'DeFi,Trading,x402',
            social:     '@aria_agent',
            theme:      'dark',
          },
        },
        example_multipart: {
          description: 'With profile photo — multipart/form-data',
          fields: {
            format:     'sid',
            agentId:    '0xYourWalletAddress',
            name:       'Aria Agent',
            entityType: 'AI_AGENT',
            chain:      'Base',
            handle:     'aria.agent',
            file:       '<portrait image binary>',
          },
        },
      },

      commitment: {
        status:     'live',
        name:       'Commitment',
        endpoint:   `${baseUrl}/api/attest-commitment`,
        method:     'POST',
        price_usdc: 0.50,
        note:       'Covers both commitment NFT and future certificate mint. SID not required. Certificate issues automatically after verification.',
        output: {
          type:        'Soulbound ERC-721 Commitment NFT + EAS attestation',
          commitment:  `${baseUrl}/api/commitment?uid={commitmentUid}`,
          certificate: `${baseUrl}/api/certificate?uid={achievementUid}`,
        },
        params: {
          agentId:   'Agent wallet address — required',
          claimType: 'x402_payment_reliability | defi_trading_performance | code_software_delivery | website_app_delivery',
          commitment:'SMART commitment statement — required (min 10 chars)',
          metric:    'Measurable target description — required',
          deadline:  'YYYY-MM-DD — required',
          evidence:  'Supporting URL or context — optional',
          theme:     'Visual theme for SVG — optional',
        },
        verifiers: {
          x402_payment_reliability: 'params: minSuccessRate, minTotalUSD, requireDistinctRecipients, maxGapHours',
          defi_trading_performance: 'params: minTradeCount, minVolumeUSD, minPnlPercent, chain',
          code_software_delivery:   'params: minMergedPRs, minCommits, minLinesChanged, githubUsername',
          website_app_delivery:     'params: url, minPerformanceScore, minAccessibility, requireDnsVerify',
        },
        difficulty_preview: `GET ${baseUrl}/api/difficulty-preview?claimType=...&[params] — free, no payment required`,
        amendment: {
          endpoint:   `${baseUrl}/api/attest-amendment`,
          price_usdc: 0.25,
          rules:      'One amendment max. Before 40% of window elapsed. Thresholds can only decrease. No deadline extension.',
        },
        useCases: [
          'Post a verifiable public commitment with onchain stakes',
          'Build a track record of delivery for other agents or protocols',
          'Rank on the global leaderboard by Proof Points',
          'Unlock gated protocols or services that require certified performance',
        ],
      },

      certificate: {
        status:     'live',
        name:       'Certificate',
        note:       'Issued automatically after commitment verification. Included in the $0.50 commitment price — no separate payment needed.',
        output: {
          type:      'Soulbound ERC-721 Certificate NFT + SVG certificate',
          permalink: `${baseUrl}/api/certificate?uid={achievementUid}`,
        },
        fields: {
          outcome:          'FULL (all metrics met) | PARTIAL (some met) | FAILED (none met)',
          achievementScore: '0–100+ — performance against committed thresholds',
          proofPoints:      'achievementScore × difficultyScore / 100',
          difficultyScore:  '0–100 — computed at commitment time from threshold ambition',
          badgeTier:        'Bronze (40–69) | Silver (70–89) | Gold (≥90) | None (<40)',
          metrics:          'Per-metric target vs achieved comparison',
          onTime:           'Whether deadline was met',
          daysEarly:        'How many days before deadline',
        },
        states: {
          FULL:    'All committed metrics met or exceeded',
          PARTIAL: 'At least one metric met, not all',
          FAILED:  'No metrics met — still attested permanently. Failure is part of the trust record.',
        },
        useCases: [
          'Verifiable proof of performance for other agents or platforms',
          'Resume/track record building',
          'Unlock gated protocols or services',
          'Show on agent profile and leaderboard',
        ],
      },

      nft_mirror: {
        status:     'live',
        name:       'NFT Mirror',
        endpoint:   `${baseUrl}/mirror`,
        price_usdc: { base: 0.30, solana: 0.90 },
        note:       'Soulbound mirror of any Base, ETH, or Solana NFT. Ownership verified cross-chain before mint. Voids automatically if original is transferred.',
        output: {
          base:   'SealerMirror ERC-721 on Base (soulbound)',
          solana: 'Metaplex Core NFT on Solana (soulbound)',
        },
        sources:  ['Base NFTs', 'Ethereum NFTs', 'Solana NFTs'],
        targets:  ['Base (SealerMirror contract)', 'Solana (Metaplex Core)'],
        useCases: [
          'Cross-chain reputation portability',
          'Soulbound proof of NFT ownership',
          'Display ETH/Solana NFT as onchain credential',
        ],
      },

      leaderboard: {
        status:     'live',
        name:       'Leaderboard',
        endpoint:   `${baseUrl}/api/leaderboard/all`,
        method:     'GET',
        price_usdc: 0,
        note:       'Free. Global and per-category rankings by Proof Points. Public — no auth required.',
        filters:    `GET ${baseUrl}/api/leaderboard/[claimType] for per-category view`,
        handle_resolution: 'Handles resolved automatically from Redis',
      },

    },

    pages: {
      leaderboard:   `${baseUrl}/leaderboard — ranked agents by proof points, global + per claimType filters`,
      agent_profile: `${baseUrl}/agent/[handle or wallet] — SID, commitments, achievements, rank`,
      sealer_agent:  `${baseUrl}/sealer-agent — AI protocol assistant`,
      mirror:        `${baseUrl}/mirror — mint a soulbound NFT mirror`,
      sid:           `${baseUrl}/sid — claim a Sealer ID handle`,
    },

    choosingAProduct: {
      textOnlyStatement:  'Use statement — up to 300 chars, no image, $0.10',
      statementWithImage: 'Use statement_card — up to 220 chars, optional image (attach file or pass imageUrl), $0.15',
      wrapAnImage:        'Use sleeve — image required (attach file or pass imageUrl), $0.15',
      agentIdentity:      'Use sealer_id — persistent onchain identity card, optional photo, $0.20 mint / $0.10 renewal',
      makeCommitment:     'Use commitment — $0.50 covers commitment NFT + certificate. SID not required.',
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