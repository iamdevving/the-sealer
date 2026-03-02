import re

content = open('src/app/api/card/route.tsx', encoding='utf-8').read()

# 1. Add imageUrl param extraction - find where other params are extracted
# Look for where uid/chain/agentId are extracted
old_params = "  const uid       = searchParams.get('uid')       ?? '';"
new_params = "  const uid       = searchParams.get('uid')       ?? '';\n  const imageUrl  = searchParams.get('imageUrl')  ?? '';"

if old_params in content:
    content = content.replace(old_params, new_params)
    print("Added imageUrl param")
else:
    # Find param extraction area
    idx = content.find("searchParams.get('uid')")
    print("uid context:", repr(content[idx-20:idx+60]))

# 2. Add image fetch logic before SVG parts array
# Find where parts array starts
old_parts_start = "  const parts: string[] = ["
new_fetch = """  // Fetch imageUrl if provided
  let photoData = '';
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const b64i = Buffer.from(buf).toString('base64');
        const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
        photoData = 'data:' + mime + ';base64,' + b64i;
      }
    } catch { /* no photo */ }
  }

  const parts: string[] = ["""

if old_parts_start in content:
    content = content.replace(old_parts_start, new_fetch)
    print("Added image fetch logic")
else:
    print("parts array start not found")

# 3. Replace the upload box with image when photoData exists
old_upload = """    '<rect x="148" y="52" width="392" height="164" rx="8" fill="\'+t.uploadBg+\'" stroke="\'+t.accentDim+\'" stroke-width="1.2" stroke-dasharray="7,4"/>',
    '<text x="344" y="128" font-family="monospace" font-size="9" fill="\'+t.accentDim+\'" text-anchor="middle" opacity="0.5">NO ATTACHMENT</text>',
    '<text x="344" y="148" font-family="monospace" font-size="7" fill="\'+t.accentDim+\'" text-anchor="middle" opacity="0.28">PNL CARD &#183; SCREENSHOT &#183; CHART</text>',"""

new_upload = """    ...(photoData ? [
      '<defs><clipPath id="imgClip"><rect x="148" y="52" width="392" height="164" rx="8"/></clipPath></defs>',
      '<image href="\'+photoData+\'" x="148" y="52" width="392" height="164" clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid slice"/>',
    ] : [
      '<rect x="148" y="52" width="392" height="164" rx="8" fill="\'+t.uploadBg+\'" stroke="\'+t.accentDim+\'" stroke-width="1.2" stroke-dasharray="7,4"/>',
      '<text x="344" y="128" font-family="monospace" font-size="9" fill="\'+t.accentDim+\'" text-anchor="middle" opacity="0.5">NO ATTACHMENT</text>',
      '<text x="344" y="148" font-family="monospace" font-size="7" fill="\'+t.accentDim+\'" text-anchor="middle" opacity="0.28">PNL CARD &#183; SCREENSHOT &#183; CHART</text>',
    ]),"""

if old_upload in content:
    content = content.replace(old_upload, new_upload)
    print("Upload box replaced with conditional image")
else:
    print("Upload box pattern not found - checking:")
    idx = content.find('NO ATTACHMENT')
    print(repr(content[idx-200:idx+100]))

open('src/app/api/card/route.tsx', 'w', encoding='utf-8').write(content)
print("Done")
