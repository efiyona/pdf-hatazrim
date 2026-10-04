import { PDFDocument } from 'pdf-lib'
import { zipSync, strToU8 } from 'fflate'
import { openPdfJs, tick, UserError, type Progress } from './pdf'

const blobOf = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new UserError('חסר זיכרון להמרת העמוד.'))), 'image/jpeg', q))

/* ---------- Word -> PDF (own layout on canvas: works in every browser, incl. Safari) ---------- */
const PW = 794, PH = 1123, MX = 64, MY = 64, SC = 1.75 // A4 @96dpi, 2x raster
const FONT = 'Arial, "Segoe UI", Heebo, "Noto Sans Hebrew", "DejaVu Sans", sans-serif'
const RTL_RE = /[\u0590-\u08ff]/
const LTR_RE = /[A-Za-z]/

interface Run { text: string; bold?: boolean; italic?: boolean; img?: HTMLImageElement }
interface Para { runs: Run[]; size: number; bold?: boolean; indent: number; prefix?: string; after: number; rtl: boolean }
type Block = { t: 'break' } | { t: 'p'; p: Para } | { t: 'table'; rows: Para[][][] }
interface Seg { text: string; font: string; w: number; img?: HTMLImageElement; ih?: number }
interface Line { segs: Seg[]; w: number; h: number }

function runsOf(node: Node, st: { bold?: boolean; italic?: boolean }, out: Run[]) {
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { const t = (n.textContent ?? '').replace(/\s+/g, ' '); if (t) out.push({ text: t, ...st }) }
    else if (n.nodeType === 1) {
      const e = n as HTMLElement, tag = e.tagName.toLowerCase()
      if (tag === 'img') { out.push({ text: '', img: e as HTMLImageElement }); return }
      if (tag === 'br') { out.push({ text: '\n' }); return }
      runsOf(e, { bold: st.bold || tag === 'strong' || tag === 'b', italic: st.italic || tag === 'em' || tag === 'i' }, out)
    }
  })
}
const mkPara = (e: Element, size: number, bold: boolean, prefix = '', indent = 0, after = 9): Para => {
  const runs: Run[] = []
  runsOf(e, { bold }, runs)
  const txt = runs.map((r) => r.text).join('')
  const first = txt.split('').find((c) => RTL_RE.test(c) || LTR_RE.test(c))
  return { runs, size, bold, indent, prefix, after, rtl: !!first && RTL_RE.test(first) }
}
function blocksOf(root: Element, out: Block[], depth = 0) {
  root.childNodes.forEach((n) => {
    if (n.nodeType !== 1) return
    const e = n as Element, tag = e.tagName.toLowerCase()
    if (tag === 'hr') { out.push({ t: 'break' }); return }
    const hasBreak = (tag === 'p' || /^h[1-6]$/.test(tag)) && e.querySelector('hr')
    if (hasBreak) { e.querySelectorAll('hr').forEach((h) => h.remove()) }
    if (/^h[1-6]$/.test(tag)) out.push({ t: 'p', p: mkPara(e, ({ h1: 26, h2: 21, h3: 17 } as Record<string, number>)[tag] ?? 15, true, '', 0, 10) })
    else if (tag === 'p' || tag === 'blockquote') { const pp = mkPara(e, 15, false); if (pp.runs.some((r) => r.text.trim() || r.img) || !hasBreak) out.push({ t: 'p', p: pp }) }
    else if (tag === 'ul' || tag === 'ol') {
      let i = 0
      e.childNodes.forEach((li) => {
        if ((li as Element).tagName?.toLowerCase() !== 'li') return
        i++
        const clone = li.cloneNode(true) as Element
        clone.querySelectorAll('ul,ol').forEach((x) => x.remove())
        out.push({ t: 'p', p: mkPara(clone, 15, false, tag === 'ol' ? `${i}.` : '•', 22 + depth * 20, 4) })
        const sub = (li as Element).querySelectorAll(':scope > ul, :scope > ol')
        sub.forEach((s) => blocksOf({ childNodes: [s] } as unknown as Element, out, depth + 1))
      })
    } else if (tag === 'table') {
      const rows: Para[][][] = []
      e.querySelectorAll('tr').forEach((tr) => {
        const cells: Para[][] = []
        Array.from(tr.children).forEach((td) => {
          const ps = td.querySelectorAll('p')
          cells.push(ps.length ? Array.from(ps).map((p) => mkPara(p, 14, td.tagName === 'TH', '', 0, 2)) : [mkPara(td, 14, td.tagName === 'TH', '', 0, 2)])
        })
        if (cells.length) rows.push(cells)
      })
      if (rows.length) out.push({ t: 'table', rows })
    } else if (tag === 'img') out.push({ t: 'p', p: { runs: [{ text: '', img: e as HTMLImageElement }], size: 15, indent: 0, after: 9, rtl: false } })
    else blocksOf(e, out, depth)
    if (hasBreak) out.push({ t: 'break' })
  })
}

function layout(ctx: CanvasRenderingContext2D, p: Para, width: number): Line[] {
  const fontOf = (r: Run) => `${r.italic ? 'italic ' : ''}${r.bold || p.bold ? 'bold ' : ''}${p.size}px ${FONT}`
  const lines: Line[] = []
  let cur: Seg[] = [], cw = 0
  const lh = Math.round(p.size * 1.5)
  const avail = width - p.indent
  const push = () => { if (cur.length) { const ih = Math.max(0, ...cur.map((s) => s.ih ?? 0)); lines.push({ segs: cur, w: cw, h: Math.max(lh, ih) }) } cur = []; cw = 0 }
  const add = (text: string, font: string) => {
    ctx.font = font
    const last = cur[cur.length - 1]
    if (last && last.font === font && !last.img) { last.text += text; last.w = ctx.measureText(last.text).width; cw = cur.reduce((a, s) => a + s.w, 0) }
    else { const w = ctx.measureText(text).width; cur.push({ text, font, w }); cw += w }
  }
  if (p.prefix) { /* prefix drawn separately */ }
  for (const r of p.runs) {
    if (r.img) {
      const iw = r.img.naturalWidth || 1, ih0 = r.img.naturalHeight || 1
      const s = Math.min(1, avail / iw, 600 / ih0)
      if (cw > 0) push()
      cur.push({ text: '', font: '', w: iw * s, img: r.img, ih: ih0 * s }); cw = iw * s; push(); continue
    }
    if (r.text === '\n') { push(); continue }
    const font = fontOf(r)
    const words = r.text.split(/(?<= )/)
    for (const w of words) {
      ctx.font = font
      const ww = ctx.measureText(w).width
      if (cw + ctx.measureText(w.trimEnd()).width > avail && cur.length) { const l = cur[cur.length - 1]; l.text = l.text.trimEnd(); push() }
      if (!(cw === 0 && !w.trim())) add(w, font)
      void ww
    }
  }
  const l = cur[cur.length - 1]; if (l && !l.img) l.text = l.text.trimEnd()
  push()
  return lines.length ? lines : [{ segs: [], w: 0, h: lh }]
}
function drawLine(ctx: CanvasRenderingContext2D, p: Para, ln: Line, x0: number, width: number, y: number) {
  ctx.textBaseline = 'alphabetic'
  let x = p.rtl ? x0 + width - p.indent : x0 + p.indent
  ctx.fillStyle = '#111'
  for (const s of ln.segs) {
    if (s.img) {
      try { ctx.drawImage(s.img, p.rtl ? x - s.w : x, y, s.w, s.ih!) } catch { /* ignore broken image */ }
      x += p.rtl ? -s.w : s.w; continue
    }
    ctx.font = s.font
    ctx.direction = p.rtl ? 'rtl' : 'ltr'
    ctx.textAlign = p.rtl ? 'right' : 'left'
    ctx.fillText(s.text, x, y + p.size * 1.12)
    x += p.rtl ? -s.w : s.w
  }
}
function drawPrefix(ctx: CanvasRenderingContext2D, p: Para, x0: number, width: number, y: number) {
  if (!p.prefix) return
  ctx.font = `${p.size}px ${FONT}`; ctx.fillStyle = '#111'; ctx.direction = p.rtl ? 'rtl' : 'ltr'; ctx.textAlign = p.rtl ? 'right' : 'left'
  ctx.fillText(p.prefix, p.rtl ? x0 + width : x0 + 4, y + p.size * 1.12)
}

export async function docxToPdf(file: File, onProgress: Progress): Promise<Uint8Array> {
  onProgress(3, 'קורא את מסמך ה-Word…')
  await tick()
  const mammoth = await import('mammoth')
  let html: string
  try {
    html = (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap: ["br[type='page'] => hr"] })).value
  } catch {
    throw new UserError(`לא הצלחתי לפתוח את "${file.name}". נתמך רק Word בפורמט docx (לא doc ישן), והקובץ אולי פגום.`)
  }
  if (!html.trim()) throw new UserError('המסמך נראה ריק.')
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const imgs = Array.from(dom.querySelectorAll('img'))
  await Promise.all(imgs.map((i) => { const im = new Image(); im.src = i.getAttribute('src') ?? ''; return im.decode().then(() => { (i as unknown as { _d: HTMLImageElement })._d = im }).catch(() => i.remove()) }))
  dom.querySelectorAll('img').forEach((i) => { const d = (i as unknown as { _d?: HTMLImageElement })._d; if (d) Object.defineProperty(i, 'naturalWidth', { value: d.naturalWidth }), Object.defineProperty(i, 'naturalHeight', { value: d.naturalHeight }) })
  const blocks: Block[] = []
  blocksOf(dom.body, blocks)
  if (!blocks.length) throw new UserError('לא נמצא תוכן במסמך.')
  // swap decoded images in
  const fixImg = (r: Run) => { if (r.img) r.img = (r.img as unknown as { _d?: HTMLImageElement })._d ?? r.img }
  blocks.forEach((b) => (b.t === 'break' ? undefined : b.t === 'p' ? b.p.runs.forEach(fixImg) : b.rows.forEach((row) => row.forEach((c) => c.forEach((p) => p.runs.forEach(fixImg))))))

  const out = await PDFDocument.create()
  let canvas: HTMLCanvasElement | null = null
  let ctx!: CanvasRenderingContext2D
  let y = MY, pages = 0
  const W = PW - 2 * MX, bottom = PH - MY
  const flush = async () => {
    if (!canvas) return
    const jb = await blobOf(canvas, 0.7)
    canvas.width = canvas.height = 0; canvas = null
    const e = await out.embedJpg(new Uint8Array(await jb.arrayBuffer()))
    out.addPage([595.28, 841.89]).drawImage(e, { x: 0, y: 0, width: 595.28, height: 841.89 })
    pages++
    if (pages > 300) throw new UserError('המסמך ארוך מאוד (מעל 300 עמודים). פצל אותו ונסה שוב.')
  }
  const newPage = async () => {
    await flush()
    canvas = document.createElement('canvas'); canvas.width = PW * SC; canvas.height = PH * SC
    ctx = canvas.getContext('2d')!
    ctx.scale(SC, SC); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PW, PH)
    y = MY
  }
  await newPage()
  const measure = document.createElement('canvas').getContext('2d')!
  for (let bi = 0; bi < blocks.length; bi++) {
    onProgress(5 + (bi / blocks.length) * 90, `מסדר את המסמך… (${pages + 1} עמודים עד כה)`, 0)
    if (bi % 20 === 0) await tick()
    const b = blocks[bi]
    if (b.t === 'break') { if (y > MY + 1) await newPage(); continue }
    if (b.t === 'p') {
      const lines = layout(measure, b.p, W)
      for (let li = 0; li < lines.length; li++) {
        const ln = lines[li]
        if (y + ln.h > bottom) await newPage()
        if (li === 0) drawPrefix(ctx, b.p, MX, W, y)
        drawLine(ctx, b.p, ln, MX, W, y)
        y += ln.h
      }
      y += b.p.after
    } else {
      const ncol = Math.max(...b.rows.map((r) => r.length))
      const cw = W / ncol
      for (const row of b.rows) {
        const cellLines = row.map((c) => c.map((p) => layout(measure, p, cw - 14)))
        const rh = Math.max(...cellLines.map((cl) => cl.reduce((a, ls) => a + ls.reduce((s, l) => s + l.h, 0), 0))) + 10
        if (y + rh > bottom) await newPage()
        const rtl = row[0]?.[0]?.rtl
        row.forEach((c, ci) => {
          const cx = MX + (rtl ? W - (ci + 1) * cw : ci * cw)
          ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(cx, y, cw, rh)
          let cy = y + 5
          c.forEach((p, pi) => cellLines[ci][pi].forEach((ln) => { drawLine(ctx, p, ln, cx + 7, cw - 14, cy); cy += ln.h }))
        })
        y += rh
      }
      y += 10
    }
  }
  await flush()
  onProgress(98, 'שומר PDF…')
  return out.save()
}

/* ---------- PDF -> Word ---------- */
const HEB = /[\u0590-\u05ff]/g
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

interface TLine { y: number; h: number; text: string; rtl: boolean; x0: number; x1: number }

export async function pdfToDocx(file: File, onProgress: Progress): Promise<{ data: Uint8Array; chars: number }> {
  const pdf = await openPdfJs(file)
  const body: string[] = []
  let chars = 0
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(((n - 1) / pdf.numPages) * 92, `קורא עמוד ${n} מתוך ${pdf.numPages}`, 0)
    await tick()
    const page = await pdf.getPage(n)
    const tc = await page.getTextContent()
    type It = { s: string; x: number; y: number; w: number; h: number }
    const items: It[] = []
    for (const it of tc.items as Array<{ str: string; transform: number[]; width: number; height: number }>) {
      if (!it.str || !it.str.trim()) continue
      items.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height })
    }
    items.sort((a, b) => b.y - a.y)
    const rows: It[][] = []
    for (const it of items) {
      const last = rows[rows.length - 1]
      if (last && Math.abs(last[0].y - it.y) < Math.max(2, Math.min(last[0].h, it.h) * 0.5)) last.push(it)
      else rows.push([it])
    }
    const lines: TLine[] = rows.map((r) => {
      const all = r.map((i) => i.s).join('')
      const heb = (all.match(HEB) ?? []).length
      const rtl = heb > all.replace(/\s/g, '').length * 0.4
      r.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x))
      let text = ''
      let prev: It | undefined
      for (const i of r) {
        if (prev) {
          const gap = rtl ? prev.x - (i.x + i.w) : i.x - (prev.x + prev.w)
          if (gap > prev.h * 0.15 && !text.endsWith(' ') && !i.s.startsWith(' ')) text += ' '
        }
        text += i.s; prev = i
      }
      return { y: r[0].y, h: Math.max(...r.map((i) => i.h)), text: text.trim(), rtl, x0: Math.min(...r.map((i) => i.x)), x1: Math.max(...r.map((i) => i.x + i.w)) }
    })
    const hs = lines.map((l) => l.h).sort((a, b) => a - b)
    const med = hs[Math.floor(hs.length / 2)] || 10
    let para: TLine[] = []
    const flush = () => {
      if (!para.length) return
      const rtl = para.filter((l) => l.rtl).length >= para.length / 2
      const big = para[0].h > med * 1.3
      const text = esc(para.map((l) => l.text).join(' '))
      chars += text.length
      const sz = big ? Math.min(48, Math.round(para[0].h * 2)) : Math.round(med * 2)
      body.push(`<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}<w:spacing w:after="120"/>${rtl ? '<w:jc w:val="left"/>' : ''}</w:pPr><w:r><w:rPr>${rtl ? '<w:rtl/>' : ''}${big ? '<w:b/>' : ''}<w:sz w:val="${Math.max(16, sz)}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
      para = []
    }
    for (const l of lines) {
      const p = para[para.length - 1]
      if (p && (p.y - l.y > Math.max(p.h, l.h) * 1.7 || Math.abs(p.h - l.h) > med * 0.3 || p.rtl !== l.rtl)) flush()
      para.push(l)
    }
    flush()
    if (n < pdf.numPages) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    page.cleanup()
  }
  if (!chars) throw new UserError('לא נמצא טקסט בקובץ. כנראה זו סריקה (תמונה). הפעל קודם "זיהוי טקסט (OCR)" ואז המר ל-Word.')
  onProgress(96, 'בונה קובץ Word…')
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  const zip = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(styles),
  })
  return { data: zip, chars }
}
