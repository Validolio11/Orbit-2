import { cp, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const native = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(native, 'ui'), dist = path.join(native, 'dist');
// Preserve the prewarmed vanilla overlay byte for byte, including its shared renderer.
const files = ['wheel.html', 'wheel.js', 'wheel.css', 'wheel-renderer.js',
  'wheel-icons.js', 'wheel-geometry.js', 'api.js', 'tokens.css', 'LICENSE-phosphor.txt', 'fonts'];
for (const file of files) await cp(path.join(source, file), path.join(dist, file), { recursive: true });
// Catch accidentally omitted relative imports before embedding the directory in Tauri.
const entries = new Set(await readdir(dist));
for (const file of files.filter((file) => /\.(js|html|css)$/.test(file))) {
  const text = await readFile(path.join(dist, file), 'utf8');
  for (const [, dependency] of text.matchAll(/(?:from\s+["']\.\/|(?:src|href)=["'])([^"']+)["']/g)) {
    if (!entries.has(dependency.split('/')[0])) throw new Error(`Missing wheel asset: ${dependency}`);
  }
}
