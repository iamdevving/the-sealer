import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Agent Attestation Factory is alive 🚀',
    timestamp: new Date().toISOString(),
    version: '0.1.0-initial',
  });
}