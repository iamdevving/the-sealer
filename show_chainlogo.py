content = open('src/app/api/identity/route.ts', encoding='utf-8').read()

# Find chainLogo
start = content.find('const chainLogo =')
# Find end - look for next const/let/var or function
import re
end = content.find('\n  let photoData', start)
chunk = content[start:end]
print(f"chainLogo block ({len(chunk)} chars):")
for i, line in enumerate(chunk.split('\n'), 1):
    print(f"{i:3}: {repr(line)}")
