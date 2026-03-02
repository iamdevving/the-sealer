content = open('src/app/api/identity/route.ts', encoding='utf-8').read()

# Serial is at DIV2_Y + 18 = 420 + 18 = 438
# Stamp center is at DIV2_Y + 72 = 420 + 72 = 492
# Move serial up to DIV2_Y - 10 = 410 so it clears the stamp

old = "'<text x=\"' + (W - PAD) + '\" y=\"' + (DIV2_Y + 18) + '\" font-family=\"monospace\" font-size=\"9\" fill=\"' + T.ACCENT + '\" text-anchor=\"end\" letter-spacing=\"2\">' + ser + '</text>'"
new = "'<text x=\"' + (W - PAD) + '\" y=\"' + (DIV2_Y - 10) + '\" font-family=\"monospace\" font-size=\"9\" fill=\"' + T.ACCENT + '\" text-anchor=\"end\" letter-spacing=\"2\">' + ser + '</text>'"

if old in content:
    content = content.replace(old, new)
    print("Serial moved up to DIV2_Y - 10 =", 420 - 10)
else:
    # Find it
    idx = content.find('+ ser +')
    print("ser context:", repr(content[idx-100:idx+50]))

open('src/app/api/identity/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
