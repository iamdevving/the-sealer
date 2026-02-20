import { NextResponse } from 'next/server';
import { withX402Payment } from '@/lib/x402';
import { NextRequest } from 'next/server'; // Add this if missing

export async function GET(req: NextRequest) {
  return withX402Payment(req, async () => {
    return NextResponse.json({
      status: 'ok',
      message: 'Agent Attestation Factory is alive 🚀 (x402 payment processed!)',
      timestamp: new Date().toISOString(),
      version: '0.1.0-initial',
      paid: true,
    });
  });
}