content = open('src/app/api/identity/route.ts', encoding='utf-8').read()
stamp_b64 = open('stamp_small_b64.txt').read().strip()

print(f"STAMP_B64 length: {len(stamp_b64)}")

# Add STAMP_B64 constant after LOGO_B64
import re
logo_match = re.search(r"(const LOGO_B64 = '[^']+';)", content)
if logo_match:
    old = logo_match.group(1)
    new = old + "\nconst STAMP_B64 = '" + stamp_b64 + "';"
    content = content.replace(old, new)
    print("Added STAMP_B64 constant")
else:
    print("ERROR: LOGO_B64 not found")
    exit(1)

# Restore image tag in buildStamp - find the empty string at the end
old_stamp_end = "    '<text font-family=\"monospace\" font-size=\"7.5\" letter-spacing=\"2\" fill=\"' + stampColor + '\"><textPath href=\"#botRim\" startOffset=\"14%\">SEALER ID</textPath></text>' +\n    '';"
new_stamp_end = "    '<text font-family=\"monospace\" font-size=\"7.5\" letter-spacing=\"2\" fill=\"' + stampColor + '\"><textPath href=\"#botRim\" startOffset=\"14%\">SEALER ID</textPath></text>' +\n    '<image href=\"data:image/png;base64,' + STAMP_B64 + '\" x=\"-34\" y=\"-34\" width=\"68\" height=\"68\" preserveAspectRatio=\"xMidYMid meet\" opacity=\"0.9\"/>';"

if old_stamp_end in content:
    content = content.replace(old_stamp_end, new_stamp_end)
    print("Restored stamp image tag")
else:
    print("Stamp end pattern not found - checking buildStamp:")
    idx = content.find('function buildStamp')
    print(repr(content[idx:idx+600]))

open('src/app/api/identity/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
