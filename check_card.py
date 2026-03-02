content = open('src/app/api/card/route.tsx', encoding='utf-8').read()
lines = content.split('\n')

# Find photoData
for i, l in enumerate(lines, 1):
    if 'photoData' in l or 'imageUrl' in l or 'parts: string' in l:
        print(i, repr(l[:100]))
