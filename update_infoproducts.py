content = open('src/app/api/infoproducts/route.ts', encoding='utf-8').read()

old = """identity: {
      seal_id: {
        status:    'planned',
        name:      'SEAL ID',
        endpoint:  `${baseUrl}/api/identity`,
        price_usdc: 0,
        note:      'Persistent onchain identity card for ERC-8004 agents. Passport/ID format. Customizable fields: profile pic, owner, name, first activity, chain, statement count, social handles.',
      },
    },"""

new = """identity: {
      sealer_id: {
        status:       'live',
        name:         'Sealer ID',
        endpoint:     `${baseUrl}/api/sid`,
        method:       'GET',
        price_usdc:   0.15,
        renewal_price_usdc: 0.10,
        output: {
          type:       'SVG identity card',
          dimensions: '428x620px',
          format:     'Passport/ID card format with MRZ zone, stamp, chain logo',
          permalink:  `${baseUrl}/api/sid?agentId={agentId}&name={name}&theme={theme}`,
        },
        params: {
          agentId:    'Agent wallet address (0x...)',
          name:       'Agent or entity display name',
          owner:      'Owner wallet address (optional)',
          chain:      'Primary chain - Base or Solana (default: Base)',
          entityType: 'AI_AGENT | HUMAN | UNKNOWN (default: UNKNOWN)',
          firstSeen:  'First activity date string (optional)',
          imageUrl:   'Public URL of profile image (optional)',
          llm:        'Preferred LLM model name (optional)',
          social:     'Comma-separated social handles (optional, max 4)',
          tags:       'Comma-separated specialization tags (optional, max 6)',
          theme:      'dark | light (default: dark)',
        },
        themes: ['dark', 'light'],
        useCases: [
          'Establish persistent onchain identity for an AI agent',
          'Display agent credentials and chain affiliation',
          'Show social handles and specialization tags',
          'Verify agent ownership and first activity',
          'Use as avatar/profile card in agent directories',
          'Attach to agent listings on zAuth, Dexter, or similar',
        ],
        renewal: {
          note:       'Sealer ID can be renewed to update fields or refresh the stamp',
          price_usdc: 0.10,
          status:     'coming soon',
        },
        example: {
          url: `${baseUrl}/api/sid?agentId=0x1234abcd&name=Satoshi+Agent&entityType=AI_AGENT&chain=Base&llm=Claude+Sonnet&tags=DeFi,Trading&social=@satoshi&theme=dark`,
        },
      },
    },"""

if old in content:
    content = content.replace(old, new)
    print("Sealer ID block updated")
else:
    print("Pattern not found - trying partial match")
    idx = content.find("seal_id: {")
    print(repr(content[idx-20:idx+100]))

# Also update choosingAProduct hint
old_hint = "`Use se"
# Find the full agentIdentity line
import re
m = re.search(r"agentIdentity:\s+`[^`]*`", content)
if m:
    print("Current agentIdentity hint:", m.group())
    content = content.replace(m.group(), "agentIdentity:    `Use Sealer ID — persistent onchain identity card, $0.15 (renewal $0.10)`")
    print("agentIdentity hint updated")

open('src/app/api/infoproducts/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
