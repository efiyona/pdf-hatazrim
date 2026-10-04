import { PDFDocument, degrees } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { zipSync } from 'fflate'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type Progress = (pct: number, label: string, idx?: number) => void
export const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export class UserError extends Error {}

export const PAGE_SIZES: Record<string, [number, number] | null> = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
}

export function download(data: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function baseName(f: File) {
  return f.name.replace(/\.[^.]+$/, '')
}

export const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i

function isHeic(f: File) {
  return /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
}

/** Decode any browser-readable image (and HEIC) to a bitmap-ready blob. */
export async function toBitmap(file: File): Promise<ImageBitmap> {
  let blob: Blob = file
  if (isHeic(file)) {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
    blob = Array.isArray(out) ? out[0] : out
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    throw new UserError(`לא הצלחתי לקרוא את התמונה "${file.name}". ייתכן שהקובץ פגום או בפורמט לא נתמך.`)
  }
}

async function bitmapToJpeg(bmp: ImageBitmap, maxSide: number, quality: number): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality))
  c.width = c.height = 0
  if (!blob) throw new UserError('הדפדפן לא הצליח לעבד את התמונה (אולי חסר זיכרון).')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h }
}

export async function imagesToPdf(
  files: File[],
  opts: { size: string; landscape: boolean; margin: number; quality: number },
  onProgress: Progress,
  onSkip: (name: string, msg: string) => void,
) {
  const doc = await PDFDocument.create()
  let done = 0
  for (const f of files) {
    onProgress((done / files.length) * 100, `מעבד תמונה ${done + 1} מתוך ${files.length}: ${f.name}`, done)
    await tick()
    try {
      const bmp = await toBitmap(f)
      const png = /png$/i.test(f.type) && opts.quality >= 1
      let img
      if (png) img = await doc.embedPng(new Uint8Array(await f.arrayBuffer()))
      else {
        const j = await bitmapToJpeg(bmp, 5000, opts.quality)
        img = await doc.embedJpg(j.bytes)
      }
      const iw = img.width
      const ih = img.height
      bmp.close()
      let pw: number, ph: number
      const sz = PAGE_SIZES[opts.size]
      if (!sz) {
        pw = iw + opts.margin * 2
        ph = ih + opts.margin * 2
      } else {
        ;[pw, ph] = opts.landscape ? [sz[1], sz[0]] : sz
      }
      const page = doc.addPage([pw, ph])
      const aw = pw - opts.margin * 2
      const ah = ph - opts.margin * 2
      const s = Math.min(aw / iw, ah / ih)
      const dw = iw * s
      const dh = ih * s
      page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    } catch (e) {
      onSkip(f.name, e instanceof Error ? e.message : 'שגיאה לא ידועה')
    }
    done++
  }
  if (doc.getPageCount() === 0) throw new UserError('אף תמונה לא עובדה בהצלחה.')
  onProgress(98, 'שומר PDF…')
  await tick()
  return doc.save()
}

export async function loadPdfLib(file: File) {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false })
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/encrypt/i.test(m)) throw new UserError(`"${file.name}" מוגן בסיסמה. הסר את ההגנה ונסה שוב.`)
    throw new UserError(`לא הצלחתי לקרוא את "${file.name}". הקובץ פגום או שאינו PDF תקין.`)
  }
}

export async function mergePdfs(files: File[], onProgress: Progress) {
  const out = await PDFDocument.create()
  for (let i = 0; i < files.length; i++) {
    onProgress((i / files.length) * 100, `מאחד ${i + 1} מתוך ${files.length}: ${files[i].name}`, i)
    await tick()
    const src = await loadPdfLib(files[i])
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  onProgress(98, 'שומר PDF…')
  await tick()
  return out.save()
}

export async function extractPages(file: File, keep: number[], onProgress: Progress) {
  onProgress(5, 'קורא את הקובץ…')
  await tick()
  const src = await loadPdfLib(file)
  const out = await PDFDocument.create()
  const CH = 50
  for (let i = 0; i < keep.length; i += CH) {
    const part = await out.copyPages(src, keep.slice(i, i + CH))
    part.forEach((p) => out.addPage(p))
    onProgress(5 + (i / keep.length) * 90, `מעתיק עמודים ${Math.min(i + CH, keep.length)} מתוך ${keep.length}`)
    await tick()
  }
  onProgress(98, 'שומר PDF…')
  await tick()
  return out.save()
}

export async function rotatePdf(file: File, rotations: Record<number, number>, onProgress: Progress) {
  onProgress(10, 'קורא את הקובץ…')
  await tick()
  const doc = await loadPdfLib(file)
  doc.getPages().forEach((p, i) => {
    const add = rotations[i] ?? 0
    if (add) p.setRotation(degrees(((p.getRotation().angle + add) % 360 + 360) % 360))
  })
  onProgress(80, 'שומר PDF…')
  await tick()
  return doc.save()
}

export async function openPdfJs(file: File) {
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    return await pdfjs.getDocument({ data }).promise
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'PasswordException') throw new UserError(`"${file.name}" מוגן בסיסמה.`)
    throw new UserError(`לא הצלחתי לפתוח את "${file.name}". הקובץ פגום או שאינו PDF תקין.`)
  }
}

export type PdfDoc = Awaited<ReturnType<typeof openPdfJs>>

export async function renderPage(doc: PdfDoc, n: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale })
  const c = document.createElement('canvas')
  c.width = Math.ceil(vp.width)
  c.height = Math.ceil(vp.height)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise
  page.cleanup()
  return c
}

const canvasBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new UserError('חסר זיכרון להמרת העמוד.'))), type, q))

/** Real compression in-browser: re-render each page to JPEG. Text becomes an image. */
export async function compressPdf(file: File, level: 'light' | 'medium' | 'strong', onProgress: Progress) {
  const cfg = { light: { s: 1.6, q: 0.8 }, medium: { s: 1.2, q: 0.6 }, strong: { s: 0.9, q: 0.45 } }[level]
  const src = await openPdfJs(file)
  const out = await PDFDocument.create()
  for (let i = 1; i <= src.numPages; i++) {
    onProgress(((i - 1) / src.numPages) * 100, `מכווץ עמוד ${i} מתוך ${src.numPages}`)
    await tick()
    const page = await src.getPage(i)
    const base = page.getViewport({ scale: 1 })
    page.cleanup()
    const c = await renderPage(src, i, cfg.s)
    const blob = await canvasBlob(c, 'image/jpeg', cfg.q)
    c.width = c.height = 0
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    const p = out.addPage([base.width, base.height])
    p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height })
  }
  onProgress(98, 'שומר PDF…')
  await tick()
  await (src as unknown as { destroy?: () => Promise<void> }).destroy?.()
  return out.save()
}

export async function pdfToImages(file: File, format: 'jpeg' | 'png', scale: number, onProgress: Progress) {
  const src = await openPdfJs(file)
  const files: Record<string, Uint8Array> = {}
  const images: Uint8Array[] = []
  const ext = format === 'jpeg' ? 'jpg' : 'png'
  const pad = String(src.numPages).length
  for (let i = 1; i <= src.numPages; i++) {
    onProgress(((i - 1) / src.numPages) * 100, `ממיר עמוד ${i} מתוך ${src.numPages}`)
    await tick()
    const c = await renderPage(src, i, scale)
    const blob = await canvasBlob(c, `image/${format}`, 0.9)
    c.width = c.height = 0
    const bytes = new Uint8Array(await blob.arrayBuffer())
    images.push(bytes)
    files[`${baseName(file)}-${String(i).padStart(pad, '0')}.${ext}`] = bytes
  }
  await (src as unknown as { destroy?: () => Promise<void> }).destroy?.()
  onProgress(97, 'אורז ZIP…')
  await tick()
  if (src.numPages === 1) return { single: true as const, name: Object.keys(files)[0], data: Object.values(files)[0], images }
  return { single: false as const, name: `${baseName(file)}-images.zip`, data: zipSync(files, { level: 0 }), images }
}

export interface Output { data: Uint8Array; name: string; mime: string; images?: Uint8Array[]; imageMime?: string; note?: string }
export const pdfOut = (data: Uint8Array, name: string): Output => ({ data, name, mime: 'application/pdf' })
