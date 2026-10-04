import { useEffect, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { DropZone, ProgressBar, ToolPage, useJob, useToast } from '../ui'
import { Icons } from '../Icons'
import { baseName, fmtSize, openPdfJs, pdfOut, renderPage, tick, UserError, type Output, type PdfDoc } from '../pdf'

interface Item { id: number; page: number; x: number; y: number; w: number; h: number; url: string; text?: string; color?: string }
const SIG_KEY = 'pdf-hatazrim-signature'
const COLORS = ['#111111', '#1d3a9e', '#c0392b']

function trim(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext('2d')!
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return null
  const p = 6
  x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(c.width - 1, x1 + p); y1 = Math.min(c.height - 1, y1 + p)
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1
  o.getContext('2d')!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height)
  return o.toDataURL('image/png')
}

function textImage(text: string, color: string): { url: string; w: number; h: number } {
  const size = 72, lines = text.split('\n')
  const c = document.createElement('canvas'); const ctx = c.getContext('2d')!
  const font = `${size}px Arial, "Segoe UI", Heebo, "Noto Sans Hebrew", "DejaVu Sans", sans-serif`
  ctx.font = font
  const rtl = /[\u0590-\u08ff]/.test(text.split('').find((ch) => /[\u0590-\u08ffA-Za-z]/.test(ch)) ?? '')
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16, lh = size * 1.3
  c.width = w; c.height = Math.ceil(lh * lines.length) + 10
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'
  lines.forEach((l, i) => ctx.fillText(l, rtl ? w - 8 : 8, 5 + i * lh))
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height }
}

function SignPad({ onDone, onClose }: { onDone: (url: string) => void; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [color, setColor] = useState(COLORS[1])
  const toast = useToast()
  const saved = localStorage.getItem(SIG_KEY)
  const pos = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.current!.width, y: ((e.clientY - r.top) / r.height) * cv.current!.height } }
  const down = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); last.current = pos(e); const ctx = cv.current!.getContext('2d')!; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 2.2, 0, 7); ctx.fill() }
  const move = (e: React.PointerEvent) => {
    if (!last.current) return
    const p = pos(e), ctx = cv.current!.getContext('2d')!
    ctx.strokeStyle = color; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p
  }
  const clear = () => cv.current!.getContext('2d')!.clearRect(0, 0, 900, 360)
  const use = () => {
    const u = trim(cv.current!)
    if (!u) { toast('warn', 'עוד לא חתמת. צייר חתימה בתיבה.'); return }
    try { localStorage.setItem(SIG_KEY, u) } catch { /* ignore quota */ }
    onDone(u)
  }
  const upload = async (f?: File) => {
    if (!f) return
    try {
      const bmp = await createImageBitmap(f)
      const s = Math.min(1, 900 / bmp.width)
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close()
      const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data
      for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (d[i + 3] === 255) { d[i + 3] = l > 225 ? 0 : l > 150 ? Math.round((225 - l) * 3.4) : 255 } }
      ctx.putImageData(im, 0, 0)
      const u = trim(c); if (!u) throw new Error('empty')
      try { localStorage.setItem(SIG_KEY, u) } catch { /* ignore */ }
      onDone(u)
    } catch { toast('error', 'לא הצלחתי לקרוא את תמונת החתימה.') }
  }
  return (
    <div className="modal" role="dialog"><div className="mcard">
      <b>החתימה שלך</b><small>צייר באצבע או בעכבר. החתימה נשמרת רק במכשיר הזה.</small>
      <canvas ref={cv} width={900} height={360} className="pad" onPointerDown={down} onPointerMove={move} onPointerUp={() => (last.current = null)} onPointerCancel={() => (last.current = null)} />
      <div className="mrow">
        {COLORS.map((c) => <button key={c} aria-label="צבע" className={`dot ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
        <button className="ghost sm" onClick={clear}>נקה</button>
        <label className="ghost sm" style={{ cursor: 'pointer' }}>מתמונה<input type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} /></label>
        {saved && <button className="ghost sm" onClick={() => onDone(saved)}>החתימה השמורה</button>}
      </div>
      <div className="mrow"><button className="go sm" onClick={use}>השתמש בחתימה</button><button className="ghost" onClick={onClose}>ביטול</button></div>
    </div></div>
  )
}

function TextModal({ init, onDone, onClose }: { init?: { text: string; color: string }; onDone: (t: string, c: string) => void; onClose: () => void }) {
  const [t, setT] = useState(init?.text ?? '')
  const [c, setC] = useState(init?.color ?? COLORS[0])
  return (
    <div className="modal" role="dialog"><div className="mcard">
      <b>טקסט על המסמך</b>
      <textarea autoFocus value={t} onChange={(e) => setT(e.target.value)} dir="auto" rows={3} placeholder="הקלד טקסט, שם, תאריך…" className="ta" />
      <div className="mrow">{COLORS.map((x) => <button key={x} aria-label="צבע" className={`dot ${x === c ? 'on' : ''}`} style={{ background: x }} onClick={() => setC(x)} />)}
        <button className="ghost sm" onClick={() => setT((v) => v + new Date().toLocaleDateString('he-IL'))}>תאריך של היום</button></div>
      <div className="mrow"><button className="go sm" disabled={!t.trim()} onClick={() => onDone(t, c)}>אישור</button><button className="ghost" onClick={onClose}>ביטול</button></div>
    </div></div>
  )
}

function PageView({ doc, n, ratio, items, sel, setSel, update, remove, onVisible, edit }: {
  doc: PdfDoc; n: number; ratio: number; items: Item[]; sel: number | null; setSel: (i: number | null) => void
  update: (id: number, p: Partial<Item>) => void; remove: (id: number) => void; onVisible: (n: number, r: number) => void; edit: (it: Item) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ id: number; mode: 'move' | 'size'; sx: number; sy: number; o: Item } | null>(null)
  useEffect(() => {
    let live = false, busy = false
    const io = new IntersectionObserver((es) => {
      const e = es[0]
      onVisible(n, e.isIntersecting ? e.intersectionRatio : 0)
      if (e.isIntersecting && !live && !busy) {
        busy = true
        renderPage(doc, n, Math.min(2, (window.devicePixelRatio || 1) * 1.1) * ((box.current?.clientWidth || 600) / 595)).then((c) => {
          busy = false
          if (!cv.current) return
          cv.current.width = c.width; cv.current.height = c.height
          cv.current.getContext('2d')!.drawImage(c, 0, 0); c.width = c.height = 0; live = true
        }).catch(() => { busy = false })
      } else if (!e.isIntersecting && live && cv.current) { cv.current.width = cv.current.height = 1; live = false }
    }, { rootMargin: '700px 0px', threshold: [0, 0.25, 0.5, 0.75, 1] })
    io.observe(box.current!)
    return () => io.disconnect()
  }, [doc, n]) // eslint-disable-line
  const move = (e: React.PointerEvent) => {
    const s = state.current; if (!s || !box.current) return
    const r = box.current.getBoundingClientRect()
    const dx = (e.clientX - s.sx) / r.width, dy = (e.clientY - s.sy) / r.height
    if (s.mode === 'move') update(s.id, { x: Math.min(1 - s.o.w, Math.max(0, s.o.x + dx)), y: Math.min(1 - s.o.h, Math.max(0, s.o.y + dy)) })
    else { const w = Math.min(1 - s.o.x, Math.max(0.05, s.o.w + dx)); update(s.id, { w, h: (w * r.width) / (s.o.w * r.width) * s.o.h * (s.o.w / s.o.w) }) }
  }
  return (
    <div className="spv" ref={box} style={{ aspectRatio: String(ratio) }} onPointerMove={move} onPointerUp={() => (state.current = null)} onPointerCancel={() => (state.current = null)} onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as Element).tagName === 'CANVAS') setSel(null) }}>
      <canvas ref={cv} className="spc" />
      <span className="pn">{n}</span>
      {items.map((it) => (
        <div key={it.id} className={`sitem ${sel === it.id ? 'sel' : ''}`} style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, height: `${it.h * 100}%` }}
          onPointerDown={(e) => { e.stopPropagation(); setSel(it.id); (e.currentTarget as Element).setPointerCapture(e.pointerId); state.current = { id: it.id, mode: 'move', sx: e.clientX, sy: e.clientY, o: it } }}>
          <img src={it.url} alt="" draggable={false} />
          {sel === it.id && <>
            <button className="sdel" aria-label="מחק" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(it.id)}>{Icons.x(14)}</button>
            {it.text && <button className="sedit" aria-label="ערוך" onPointerDown={(e) => e.stopPropagation()} onClick={() => edit(it)}>ערוך</button>}
            <span className="shandle" onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); state.current = { id: it.id, mode: 'size', sx: e.clientX, sy: e.clientY, o: it } }} />
          </>}
        </div>
      ))}
    </div>
  )
}

export function Sign() {
  const [out, setOut] = useState<Output>()
  const [file, setFile] = useState<File>()
  const [doc, setDoc] = useState<PdfDoc>()
  const [ratios, setRatios] = useState<number[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [pad, setPad] = useState(false)
  const [txt, setTxt] = useState<{ edit?: Item } | null>(null)
  const vis = useRef<Record<number, number>>({})
  const seq = useRef(0)
  const job = useJob(); const toast = useToast()

  const open = async (f: File) => {
    try {
      const d = await openPdfJs(f)
      const rs: number[] = []
      for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); const v = p.getViewport({ scale: 1 }); rs.push(v.width / v.height); p.cleanup() }
      setDoc(d); setRatios(rs); setFile(f); setItems([]); setSel(null)
    } catch (e) { toast('error', e instanceof UserError ? e.message : 'לא הצלחתי לפתוח את הקובץ.') }
  }
  const curPage = () => { const e = Object.entries(vis.current).sort((a, b) => b[1] - a[1])[0]; return e && e[1] > 0 ? +e[0] : 1 }
  const place = (url: string, aspect: number, wFrac: number, extra: Partial<Item> = {}) => {
    const page = curPage(), r = ratios[page - 1] || 0.7
    const w = wFrac, h = (w / aspect) * r
    const id = ++seq.current
    setItems((x) => [...x, { id, page, x: Math.max(0, 0.5 - w / 2), y: Math.max(0, Math.min(1 - h, 0.4)), w, h, url, ...extra }])
    setSel(id)
  }
  const addSig = (url: string) => {
    setPad(false)
    const im = new Image(); im.onload = () => place(url, im.width / im.height, 0.3); im.src = url
  }
  const addText = (text: string, color: string, replace?: Item) => {
    setTxt(null)
    const t = textImage(text, color)
    if (replace) {
      const r = ratios[replace.page - 1] || 0.7
      setItems((x) => x.map((i) => (i.id === replace.id ? { ...i, url: t.url, text, color, h: (i.w / (t.w / t.h)) * r } : i)))
    } else place(t.url, t.w / t.h, Math.min(0.5, Math.max(0.12, t.w / 3000)), { text, color })
  }
  const update = (id: number, p: Partial<Item>) => setItems((x) => x.map((i) => {
    if (i.id !== id) return i
    if (p.w !== undefined && p.h !== undefined) { const k = p.w / i.w; return { ...i, ...p, h: i.h * k } } // keep aspect
    return { ...i, ...p }
  }))
  const save = () => job.run(async (p) => {
    if (!file) return
    p(5, 'פותח את ה-PDF…'); await tick()
    let pdf: PDFDocument
    try { pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true }) } catch { throw new UserError('לא הצלחתי לערוך את הקובץ.') }
    const pages = pdf.getPages()
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      p(10 + (i / items.length) * 85, `מוסיף ${i + 1} מתוך ${items.length}`); await tick()
      const pg = pages[it.page - 1]
      const { width: pw, height: ph } = pg.getSize()
      const img = await pdf.embedPng(await (await fetch(it.url)).arrayBuffer())
      pg.drawImage(img, { x: it.x * pw, y: ph - (it.y + it.h) * ph, width: it.w * pw, height: it.h * ph })
    }
    p(97, 'שומר…'); await tick()
    const data = await pdf.save()
    setOut(pdfOut(data, `${baseName(file)}-signed.pdf`))
    return `המסמך החתום מוכן (${fmtSize(data.length)})`
  })
  return (
    <ToolPage icon="sign" title="חתימה וטקסט על PDF" hint="פתח PDF, הוסף חתימה וטקסט, גרור למקום ושנה גודל. הכל קורה במכשיר." result={out} onReset={() => setOut(undefined)}>
      {!doc || !file ? <DropZone types="application/pdf,.pdf" accept={(f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)} text="בחר PDF לחתימה" onFiles={(f) => open(f[0])} /> : <>
        <div className="bar2"><b>{file.name}</b> <span>{ratios.length} עמ׳ · {fmtSize(file.size)}</span><button onClick={() => { setDoc(undefined); setFile(undefined); setItems([]) }}>החלף קובץ</button></div>
        <div className="stool">
          <button className="go sm" onClick={() => setPad(true)}>{Icons.sign(16)} הוסף חתימה</button>
          <button className="go sm alt" onClick={() => setTxt({})}>הוסף טקסט</button>
        </div>
        <p className="note">הוספה: הפריט נוסף לעמוד שמוצג כרגע. גרור כדי להזיז, וגרור את העיגול בפינה להגדלה.</p>
        <div className="spages2">
          {ratios.map((r, i) => <PageView key={i} doc={doc} n={i + 1} ratio={r} items={items.filter((x) => x.page === i + 1)} sel={sel} setSel={setSel} update={update}
            remove={(id) => { setItems((x) => x.filter((y) => y.id !== id)); setSel(null) }} onVisible={(n, rt) => { vis.current[n] = rt }} edit={(it) => setTxt({ edit: it })} />)}
        </div>
        {job.busy && <ProgressBar pct={job.pct} label={job.label} />}
        <div className="stickyGo"><button className="go" disabled={job.busy || !items.length} onClick={save}>{items.length ? `שמור PDF (${items.length} פריטים)` : 'הוסף חתימה או טקסט'}</button></div>
      </>}
      {pad && <SignPad onDone={addSig} onClose={() => setPad(false)} />}
      {txt && <TextModal init={txt.edit && { text: txt.edit.text ?? '', color: txt.edit.color ?? COLORS[0] }} onDone={(t, c) => addText(t, c, txt.edit)} onClose={() => setTxt(null)} />}
    </ToolPage>
  )
}
