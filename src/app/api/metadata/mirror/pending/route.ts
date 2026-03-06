import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    name:        'Sealer Mirror (Pending)',
    description: 'This mirror is being minted. Metadata will be available shortly.',
    image:       `${process.env.NEXT_PUBLIC_BASE_URL}/api/mirror/card`,
    attributes:  [{ trait_type: 'Status', value: 'Pending' }],
  });
}