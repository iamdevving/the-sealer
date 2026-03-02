content = open('src/app/api/infoproducts/route.ts', encoding='utf-8').read()

idx = content.find('identity')
print("Found at:", idx)
print(repr(content[idx:idx+800]))
