content = open('src/app/api/identity/route.ts', encoding='utf-8').read()

old = "'<text x=\"' + (W - PAD) + '\" y=\"' + (DIV2_Y - 10) + '\" font-family=\"monospace\" font-size=\"9\" fill=\"' + T.ACCENT + '\" text-anchor=\"end\" letter-spacing=\"2\">' + ser + '</text>'"
new = "'<text x=\"' + (W - PAD) + '\" y=\"' + (DIV2_Y + 8) + '\" font-family=\"monospace\" font-size=\"9\" fill=\"' + T.ACCENT + '\" text-anchor=\"end\" letter-spacing=\"2\">' + ser + '</text>'"

if old in content:
    content = content.replace(old, new)
    print("Serial moved to DIV2_Y + 8 =", 420 + 8)
else:
    idx = content.find('+ ser +')
    print("ser context:", repr(content[idx-100:idx+50]))

open('src/app/api/identity/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
