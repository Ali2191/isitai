// Offline benchmark runner: point it at a directory of labeled images
// (<dir>/real/*.jpg and <dir>/ai/*.png etc.), it runs the FULL pipeline via
// analyzeImage() and writes label+score pairs to .data/benchmark.jsonl.
// Usage: node scripts/benchmark.mjs path/to/samples
import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, extname } from 'path'
import { register } from 'node:module'

// Next-style ESM imports of lib work directly under node ≥18 for plain JS.
const { analyzeImage } = await import('../lib/analyze.js')

const root = process.argv[2]
if (!root) { console.error('usage: node scripts/benchmark.mjs <samples-dir with real/ and ai/ subdirs>'); process.exit(1) }
const rows = []
for (const [label, dir] of [[0, 'real'], [1, 'ai']]) {
  const p = join(root, dir)
  if (!existsSync(p)) { console.warn(`skip missing ${p}`); continue }
  for (const f of await readdir(p)) {
    if (!/\.(jpe?g|png|webp|gif)$/i.test(extname(f))) continue
    try {
      const buf = await readFile(join(p, f))
      const r = await analyzeImage(buf)
      rows.push({ set: dir, label, score: r.score, file: f })
      console.log(`${dir}/${f} -> ${r.score}`)
    } catch (e) { console.warn(`fail ${f}: ${e?.message}`) }
  }
}
const outDir = process.env.DATA_DIR || '.data'
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'benchmark.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(`wrote ${rows.length} rows to ${join(outDir, 'benchmark.jsonl')}`)
