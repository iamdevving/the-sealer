content = open('src/app/api/card/route.tsx', encoding='utf-8').read()
lines = content.split('\n')

# Find the area around the parts array and SVG building
for i, l in enumerate(lines[460:500], 461):
    print(i, repr(l[:100]))
