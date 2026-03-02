import re

content = open('src/app/api/identity/route.ts', encoding='utf-8').read()

# 1. Change r from 52 to 70 in buildStamp
content = content.replace('  const r = 52;', '  const r = 70;')
print("Stamp r changed to 70")

# 2. The image inside stamp needs to scale with r
# Currently x="-34" y="-34" width="68" height="68" (fits r=52 inner circle)
# For r=70, inner circle is r-7=63, so image should be ~120x120, offset -60
content = content.replace(
    '"<image href=\\"data:image/png;base64,\' + STAMP_B64 + \'" x=\\"-34\\" y=\\"-34\\" width=\\"68\\" height=\\"68\\" preserveAspectRatio=\\"xMidYMid meet\\" opacity=\\"0.9\\"/>"',
    '"<image href=\\"data:image/png;base64,\' + STAMP_B64 + \'" x=\\"-60\\" y=\\"-60\\" width=\\"120\\" height=\\"120\\" preserveAspectRatio=\\"xMidYMid meet\\" opacity=\\"0.9\\"/>"'
)

# Try the actual string as it appears in the file
old_img = '\'<image href="data:image/png;base64,\' + STAMP_B64 + \'" x="-34" y="-34" width="68" height="68" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\';'
new_img = '\'<image href="data:image/png;base64,\' + STAMP_B64 + \'" x="-60" y="-60" width="120" height="120" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\';'

if old_img in content:
    content = content.replace(old_img, new_img)
    print("Image size updated to 120x120")
else:
    # Find it
    idx = content.find('STAMP_B64')
    print("STAMP_B64 context:", repr(content[idx-10:idx+120]))

# 3. Remove the placeholder - find it
idx = content.find('placeholder')
if idx >= 0:
    print("Placeholder found:", repr(content[idx-20:idx+60]))
else:
    # The placeholder is the empty string '' at end of buildStamp
    # Check what buildStamp ends with now
    idx = content.find('function buildStamp')
    end = content.find('\n}\n', idx)
    print("buildStamp end:", repr(content[end-200:end+3]))

open('src/app/api/identity/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
