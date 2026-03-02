content = open('src/app/api/identity/route.ts', encoding='utf-8').read()

# Change r to 55
content = content.replace('  const r = 60;', '  const r = 55;')
print("r set to 55")

# Update image size for r=55 (inner ~48, image ~90x90, offset -45)
content = content.replace(
    '\'<image href="data:image/png;base64,\' + STAMP_B64 + \'" x="-50" y="-50" width="100" height="100" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\';',
    '\'<image href="data:image/png;base64,\' + STAMP_B64 + \'" x="-45" y="-45" width="90" height="90" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\';'
)
print("Image size updated to 90x90")

# Remove the defs + text rings - keep only the two circles and image
import re

# Find buildStamp function and rewrite it cleanly
old_func = content[content.find('function buildStamp'):content.find('\n}\n', content.find('function buildStamp'))+3]

new_func = '''function buildStamp(stampColor: string): string {
  const r = 55;
  return '<circle cx="0" cy="0" r="' + r + '" fill="none" stroke="' + stampColor + '" stroke-width="2.5"/>' +
    '<circle cx="0" cy="0" r="' + (r - 7) + '" fill="none" stroke="' + stampColor + '" stroke-width="0.6" opacity="0.4"/>' +
    '<image href="data:image/png;base64,' + STAMP_B64 + '" x="-45" y="-45" width="90" height="90" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>';
}
'''

content = content.replace(old_func, new_func)
print("Text rings removed, buildStamp cleaned")

open('src/app/api/identity/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
