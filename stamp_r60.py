content = open('src/app/api/identity/route.ts', encoding='utf-8').read()

content = content.replace('  const r = 70;', '  const r = 60;')
print("Stamp r changed to 60")

# For r=60, inner circle is r-7=53, image ~100x100, offset -50
content = content.replace(
    '\'<image href="data:image/png;base64,\' + STAMP_B64 + \'" x="-60" y="-60" width="120" height="120" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\';',
    '\'<image href="data:image/png;base64,\' + STAMP_B64 + \'" x="-50" y="-50" width="100" height="100" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\';'
)
print("Image size updated to 100x100")

open('src/app/api/identity/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
