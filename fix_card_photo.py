content = open('src/app/api/card/route.tsx', encoding='utf-8').read()

# 1. Add imageUrl param - find uid_param line
old_uid = "  const uid_param = searchParams.get('uid');"
new_uid = "  const uid_param  = searchParams.get('uid');\n  const imageUrl   = searchParams.get('imageUrl') ?? '';"

if old_uid in content:
    content = content.replace(old_uid, new_uid)
    print("Added imageUrl param")
else:
    print("uid_param not found")

# 2. Insert fetch logic before parts array
old_parts = "  const parts = ["
new_parts = """  // Fetch imageUrl if provided
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

  const parts = ["""

if old_parts in content:
    content = content.replace(old_parts, new_parts, 1)  # only first occurrence
    print("Added photoData fetch before parts array")
else:
    print("parts array not found")

open('src/app/api/card/route.tsx', 'w', encoding='utf-8').write(content)
print("Done")
