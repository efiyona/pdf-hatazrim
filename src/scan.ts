import { PDFDocument } from 'pdf-lib'
import { tick, toBitmap, UserError, type Progress } from './pdf'

export type Pt = { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt] // TL, TR, BR, BL (normalized 0..1)
export type ScanMode = 'bw' | 'gray' | 'color'
export const SCAN_MODES: Record<ScanMode, string> = { bw: 'שחור-לבן נקי (כמו סורק)', gray: 'גווני אפור משופר', color: 'צבע משופר' }

export const fullQuad = (): Quad => [{ x: 0.03, y: 0.03 }, { x: 0.97, y: 0.03 }, { x: 0.97, y: 0.97 }, { x: 0.03, y: 0.97 }]

const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }

/** Decode a photo into a work blob (long side <= maxSide) + its size. */
export async function makeWork(file: File, maxSide = 2600): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await toBitmap(file)
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s)
  const c = mk(w, h)
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
  c.width = c.height = 0
  if (!blob) throw new UserError('הדפדפן לא הצליח לעבד את התמונה (אולי חסר זיכרון).')
  return { blob, w, h }
}

/** Find the paper: bright blob (Otsu) -> largest component -> extreme corners. */
export function detectQuad(bmp: ImageBitmap | HTMLCanvasElement | HTMLImageElement, bw: number, bh: number): Quad {
  const s = Math.min(1, 420 / Math.max(bw, bh))
  const w = Math.max(8, Math.round(bw * s)), h = Math.max(8, Math.round(bh * s))
  const c = mk(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.filter = 'blur(2px)'
  ctx.drawImage(bmp, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Uint8Array(w * h)
  const hist = new Array(256).fill(0)
  for (let i = 0; i < w * h; i++) { const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; g[i] = v; hist[v]++ }
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let wB = 0, sB = 0, best = 0, thr = 128
  const tot = w * h
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue
    const wF = tot - wB; if (!wF) break
    sB += t * hist[t]
    const m = (sB / wB - (sum - sB) / wF)
    const v = wB * wF * m * m
    if (v > best) { best = v; thr = t }
  }
  const lab = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  let bestLab = 0, bestSize = 0, cur = 0
  for (let i = 0; i < w * h; i++) {
    if (g[i] <= thr || lab[i]) continue
    cur++
    let sp = 0, size = 0
    stack[sp++] = i; lab[i] = cur
    while (sp) {
      const p = stack[--sp]; size++
      const x = p % w, y = (p / w) | 0
      if (x > 0 && g[p - 1] > thr && !lab[p - 1]) { lab[p - 1] = cur; stack[sp++] = p - 1 }
      if (x < w - 1 && g[p + 1] > thr && !lab[p + 1]) { lab[p + 1] = cur; stack[sp++] = p + 1 }
      if (y > 0 && g[p - w] > thr && !lab[p - w]) { lab[p - w] = cur; stack[sp++] = p - w }
      if (y < h - 1 && g[p + w] > thr && !lab[p + w]) { lab[p + w] = cur; stack[sp++] = p + w }
    }
    if (size > bestSize) { bestSize = size; bestLab = cur }
  }
  c.width = c.height = 0
  if (!bestLab || bestSize < tot * 0.12 || bestSize > tot * 0.97) return fullQuad()
  let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity
  let pTL = { x: 0, y: 0 }, pBR = { x: w, y: h }, pTR = { x: w, y: 0 }, pBL = { x: 0, y: h }
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== bestLab) continue
    const x = i % w, y = (i / w) | 0
    const a = x + y, b = x - y
    if (a < tl) { tl = a; pTL = { x, y } }
    if (a > br) { br = a; pBR = { x, y } }
    if (b > tr) { tr = b; pTR = { x, y } }
    if (b < bl) { bl = b; pBL = { x, y } }
  }
  const q: Quad = [pTL, pTR, pBR, pBL].map((p) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h })) as Quad
  // sanity: polygon area
  let area = 0
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; area += a.x * b.y - b.x * a.y }
  if (Math.abs(area) / 2 < 0.12) return fullQuad()
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  return q.map((p) => ({ x: p.x + (cx - p.x) * 0.012, y: p.y + (cy - p.y) * 0.012 })) as Quad
}

function solveH(src: number[][], dst: number[][]): number[] {
  // maps dst(x,y) -> src(u,v): u=(h0x+h1y+h2)/(h6x+h7y+1)
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let i = 0; i < 8; i++) {
    let m = i
    for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r
    ;[A[i], A[m]] = [A[m], A[i]]
    const p = A[i][i] || 1e-12
    for (let k = i; k < 9; k++) A[i][k] /= p
    for (let r = 0; r < 8; r++) {
      if (r === i) continue
      const f = A[r][i]
      for (let k = i; k < 9; k++) A[r][k] -= f * A[i][k]
    }
  }
  return A.map((r) => r[8])
}

const smooth = (t: number) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t) }

/** Perspective-correct + scanner filter. Returns a canvas. */
export function processScan(img: CanvasImageSource, iw: number, ih: number, quad: Quad, mode: ScanMode, maxSide: number, rot = 0): HTMLCanvasElement {
  const P = quad.map((p) => [p.x * iw, p.y * ih])
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  let W = Math.max(dist(P[0], P[1]), dist(P[3], P[2]))
  let H = Math.max(dist(P[0], P[3]), dist(P[1], P[2]))
  const sc = Math.min(1, maxSide / Math.max(W, H))
  W = Math.max(16, Math.round(W * sc)); H = Math.max(16, Math.round(H * sc))
  const src = mk(iw, ih)
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(img, 0, 0, iw, ih)
  const sd = sctx.getImageData(0, 0, iw, ih).data
  const out = mk(W, H)
  const octx = out.getContext('2d')!
  const od = octx.createImageData(W, H)
  const o = od.data
  const hm = solveH(P, [[0, 0], [W, 0], [W, H], [0, H]])
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dn = hm[6] * x + hm[7] * y + 1
      let u = (hm[0] * x + hm[1] * y + hm[2]) / dn
      let v = (hm[3] * x + hm[4] * y + hm[5]) / dn
      u = u < 0 ? 0 : u > iw - 1.001 ? iw - 1.001 : u
      v = v < 0 ? 0 : v > ih - 1.001 ? ih - 1.001 : v
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0
      const i00 = (y0 * iw + x0) * 4, i10 = i00 + 4, i01 = i00 + iw * 4, i11 = i01 + 4
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
      const oi = (y * W + x) * 4
      for (let k = 0; k < 3; k++) o[oi + k] = sd[i00 + k] * w00 + sd[i10 + k] * w10 + sd[i01 + k] * w01 + sd[i11 + k] * w11
      o[oi + 3] = 255
    }
  }
  src.width = src.height = 0
  // background (paper) estimate on a coarse grid
  const B = Math.max(8, Math.round(Math.max(W, H) / 64))
  const gw = Math.ceil(W / B), gh = Math.ceil(H / B)
  let bg = new Float32Array(gw * gh)
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let s = 0, n = 0
    const vals: number[] = []
    for (let y = by * B; y < Math.min(H, (by + 1) * B); y += 2) for (let x = bx * B; x < Math.min(W, (bx + 1) * B); x += 2) {
      const i = (y * W + x) * 4
      vals.push(o[i] * 0.299 + o[i + 1] * 0.587 + o[i + 2] * 0.114)
    }
    vals.sort((a, b) => a - b)
    for (let k = Math.floor(vals.length * 0.6); k < vals.length; k++) { s += vals[k]; n++ }
    bg[by * gw + bx] = n ? s / n : 255
  }
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(bg.length)
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue
        s += bg[yy * gw + xx]; n++
      }
      nb[y * gw + x] = s / n
    }
    bg = nb
  }
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5)), y0 = gy | 0, fy = gy - y0
    for (let x = 0; x < W; x++) {
      const gx = Math.min(gw - 1.001, Math.max(0, x / B - 0.5)), x0 = gx | 0, fx = gx - x0
      const b = Math.max(40, bg[y0 * gw + x0] * (1 - fx) * (1 - fy) + bg[y0 * gw + x0 + 1] * fx * (1 - fy) + bg[(y0 + 1) * gw + x0] * (1 - fx) * fy + bg[(y0 + 1) * gw + x0 + 1] * fx * fy)
      const i = (y * W + x) * 4
      const k = 255 / b
      if (mode === 'color') {
        for (let c = 0; c < 3; c++) { const t = Math.min(1, (o[i + c] * k) / 255); o[i + c] = Math.pow(t, 1.6) * 255 }
      } else {
        const g = Math.min(255, (o[i] * 0.299 + o[i + 1] * 0.587 + o[i + 2] * 0.114) * k)
        const v = mode === 'bw' ? smooth((g - 120) / 80) * 255 : smooth((g - 60) / 170) * 255
        o[i] = o[i + 1] = o[i + 2] = v
      }
    }
  }
  octx.putImageData(od, 0, 0)
  if (!rot) return out
  const r = mk(rot % 180 ? H : W, rot % 180 ? W : H)
  const rc = r.getContext('2d')!
  rc.translate(r.width / 2, r.height / 2)
  rc.rotate((rot * Math.PI) / 180)
  rc.drawImage(out, -W / 2, -H / 2)
  out.width = out.height = 0
  return r
}

export interface ScanPage { id: string; name: string; work: Blob; w: number; h: number; quad: Quad; rot: number }

async function decodeWork(p: ScanPage) {
  const bmp = await createImageBitmap(p.work)
  return bmp
}

export async function previewScan(p: ScanPage, mode: ScanMode): Promise<string> {
  const bmp = await decodeWork(p)
  const c = processScan(bmp, bmp.width, bmp.height, p.quad, mode, 520, p.rot)
  bmp.close()
  const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
  c.width = c.height = 0
  return URL.createObjectURL(blob!)
}

export async function scansToPdf(pages: ScanPage[], mode: ScanMode, onProgress: Progress) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages.length; i++) {
    onProgress((i / pages.length) * 95, `מעבד עמוד ${i + 1} מתוך ${pages.length}`, i)
    await tick()
    const p = pages[i]
    const bmp = await decodeWork(p)
    const c = processScan(bmp, bmp.width, bmp.height, p.quad, mode, 2400, p.rot)
    bmp.close()
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', mode === 'bw' ? 0.78 : 0.85))
    const cw = c.width, ch = c.height
    c.width = c.height = 0
    if (!blob) throw new UserError('הדפדפן לא הצליח לעבד עמוד (אולי חסר זיכרון).')
    const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    // A4 page matching orientation; image fills it keeping aspect
    const land = cw > ch
    const [pw, ph] = land ? [841.89, 595.28] : [595.28, 841.89]
    const s = Math.min(pw / cw, ph / ch)
    const page = doc.addPage([pw, ph])
    page.drawImage(img, { x: (pw - cw * s) / 2, y: (ph - ch * s) / 2, width: cw * s, height: ch * s })
  }
  onProgress(98, 'שומר PDF…')
  await tick()
  return doc.save()
}
