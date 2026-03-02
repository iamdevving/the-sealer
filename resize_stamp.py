from PIL import Image
import base64, io

img = Image.open(r'C:\Users\Ale\Desktop\Seal\stamp_nobg.png')
print('Original size:', img.size, 'mode:', img.mode)

# Resize to 120x120 - plenty for a 68px display
img = img.resize((120, 120), Image.LANCZOS)

# Save as PNG preserving transparency
buf = io.BytesIO()
img.save(buf, format='PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
print('New base64 length:', len(b64))
print('Ends with:', repr(b64[-10:]))

open('stamp_small_b64.txt', 'w').write(b64)
print('Saved to stamp_small_b64.txt')
