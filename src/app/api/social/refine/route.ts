// src/app/api/social/refine/route.ts
// Refines a social post draft based on discussion

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { currentText, instruction, trigger, triggerData, platforms, history } = await req.json();

  const systemPrompt = `You are the social media voice of The Sealer Protocol — an onchain attestation and trust infrastructure for AI agents.

You are helping refine a social post draft. The user will give you instructions to improve it.
Respond with JSON: { "text": "refined post text", "message": "brief explanation of change" }
Keep posts under 280 chars for X. Never make up data. Only use facts from triggerData.`;

  const historyText = (history || []).map((m: any) =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  ).join('\n');

  const userPrompt = `Current post:
"${currentText}"

Trigger context: ${trigger}
Data: ${JSON.stringify(triggerData)}
Platforms: ${platforms?.join(', ')}

${historyText ? `Previous discussion:\n${historyText}\n` : ''}
Instruction: ${instruction}

Refine the post accordingly. Respond with JSON only.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 400,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await res.json();
  const raw  = data.content?.[0]?.text?.trim() || '{}';

  try {
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ text: currentText, message: 'Could not parse response' });
  }
}