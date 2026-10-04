import { createWorker } from 'tesseract.js'
import { PDFDocument } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { IMAGE_EXT, UserError, openPdfJs, renderPage, tick, type Progress } from './pdf'

export const OCR_LANGS = { 'heb+eng': 'עברית + אנגלית', heb: 'עברית בלבד', eng: 'אנגלית בלבד' } as const
export type OcrLang = keyof typeof OCR_LANGS

const canvasJpeg = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new UserError('חסר זיכרון לעיבוד העמוד.'))), 'image/jpeg', q))

async function imageToCanvas(f: File): Promise<HTMLCanvasElement> {
  let blob: Blob = f
  if (/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)) {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.92 })
    blob = Array.isArray(out) ? out[0] : out
  }
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }) } catch { throw new UserError(`לא הצלחתי לקרוא את "${f.name}".`) }
  const scale = Math.min(1, 3200 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

/** Runs OCR on a PDF or a list of images; returns a searchable PDF (image + invisible text layer). */
export async function ocrToPdf(files: File[], lang: OcrLang, onProgress: Progress, onWarn: (m: string) => void) {
  // Build a list of lazy page sources
  type Src = { label: string; get: () => Promise<HTMLCanvasElement>; ptPerPx: number }
  const sources: Src[] = []
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      const doc = await openPdfJs(f)
      for (let i = 1; i <= doc.numPages; i++) sources.push({ label: `${f.name} עמוד ${i}/${doc.numPages}`, get: () => renderPage(doc, i, 2.2), ptPerPx: 1 / 2.2 })
    } else if (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)) {
      sources.push({ label: f.name, get: () => imageToCanvas(f), ptPerPx: 0.48 })
    }
  }
  if (!sources.length) throw new UserError('לא נמצאו עמודים לעיבוד.')
  let cur = 0
  onProgress(1, 'טוען מנוע זיהוי טקסט (בפעם הראשונה לוקח כמה שניות)…')
  const base = new URL(import.meta.env.BASE_URL + 'ocr/', window.location.href).href
  const worker = await createWorker(lang.split('+'), 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base + 'lang',
    gzip: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress(((cur + m.progress) / sources.length) * 96 + 2, `מזהה טקסט: ${sources[cur]?.label ?? ''}`, cur)
    },
  })
  const out = await PDFDocument.create()
  out.registerFontkit(fontkit)
  const fontBytes = await fetch(base + 'font.ttf').then((r) => r.arrayBuffer())
  const font = await out.embedFont(fontBytes, { subset: true })
  let empty = 0
  try {
    for (cur = 0; cur < sources.length; cur++) {
      onProgress((cur / sources.length) * 96 + 2, `מכין: ${sources[cur].label}`, cur)
      await tick()
      const c = await sources[cur].get()
      const blob = await canvasJpeg(c, 0.85)
      const cw = c.width, ch = c.height
      c.width = c.height = 0
      const res = await worker.recognize(blob, {}, { blocks: true })
      if (!res.data.text?.trim()) empty++
      const k = sources[cur].ptPerPx
      const W = cw * k, H = ch * k
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
      const page = out.addPage([W, H])
      page.drawImage(img, { x: 0, y: 0, width: W, height: H })
      // Invisible text layer. Tesseract returns words already in logical order; keep it as is.
      for (const block of res.data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) {
        const ordered = line.words.filter((w) => w.text.trim())
        for (const w of ordered) {
          const text = w.text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
          const bw = (w.bbox.x1 - w.bbox.x0) * k, bh = (w.bbox.y1 - w.bbox.y0) * k
          if (bw < 1 || bh < 1) continue
          let size = Math.max(4, bh * 0.85)
          try {
            const wd = font.widthOfTextAtSize(text, size)
            if (wd > bw) size = Math.max(3, size * (bw / wd))
            page.drawText(text, { x: w.bbox.x0 * k, y: H - w.bbox.y1 * k + bh * 0.15, size, font, opacity: 0 })
          } catch { /* glyph missing in font: skip word */ }
        }
      }
    }
  } finally {
    await worker.terminate()
  }
  if (empty) onWarn(`ב-${empty} מתוך ${sources.length} עמודים לא זוהה טקסט (עמוד ריק או איכות נמוכה).`)
  onProgress(99, 'שומר PDF…')
  await tick()
  return out.save()
}
