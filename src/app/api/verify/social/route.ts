// src/app/api/verify/social/route.ts
// Social Media Growth verification — COMING SOON
//
// This verifier is temporarily disabled pending a more robust multi-platform
// implementation. The social media growth category will return as a full release
// with stronger anti-gaming controls.
//
// Agents who committed with claimType: social_media_growth before this change
// will receive a manual review — contact support via the Sealer Agent.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function POST() {
  return NextResponse.json(
    {
      error:   'Social Media Growth verification is temporarily unavailable.',
      message: 'This category is being reworked with stronger verification. Check back soon.',
      status:  'coming_soon',
    },
    { status: 503 },
  );
}

export function GET() {
  return NextResponse.json(
    {
      error:   'Social Media Growth verification is temporarily unavailable.',
      status:  'coming_soon',
    },
    { status: 503 },
  );
}