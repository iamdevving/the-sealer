// src/app/api/admin/auth/route.ts
// Server-side admin password check
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.ADMIN_PASSWORD;
  if (!correct) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (password !== correct) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  return NextResponse.json({ ok: true });
}