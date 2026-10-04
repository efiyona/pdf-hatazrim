import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { UserError, download, fmtSize, openPdfJs, renderPage, type Output, type PdfDoc, type Progress } from './pdf'
import { Icons, TOOL_COLORS } from './Icons'

type ToastKind = 'success' | 'error' | 'info' | 'warn'
interface T { id: number; kind: ToastKind; text: string }
const Ctx = createContext<(kind: ToastKind, text: string) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const id = useRef(0)
  const push = useCallback((kind: ToastKind, text: string) => {
    const n = ++id.current
    setItems((x) => [...x.slice(-3), { id: n, kind, text }])
    if (kind !== 'error') setTimeout(() => setItems((x) => x.filter((t) => t.id !== n)), 5000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="ticon">{{ success: Icons.check(20), error: Icons.warn(20), info: Icons.info(20), warn: Icons.warn(20) }[t.kind]}</span>
            <p>{t.text}</p>
            <button aria-label="סגור" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>{Icons.x(16)}</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function ToolPage({ icon, title, hint, children, result, onReset }: { icon: string; title: string; hint: string; children: ReactNode; result?: Output; onReset?: () => void }) {
  return (
    <div className="shell">
      <header className="hero small">
        <Link to="/" className="backbtn" aria-label="חזרה">{Icons.back(22)}</Link>
        <div className="herotitle">
          <span className="chip" style={{ background: TOOL_COLORS[icon] }}>{Icons[icon](22)}</span>
          <div><h1>{title}</h1><p>{hint}</p></div>
        </div>
      </header>
      <main className="sheet">{result ? <ResultCard out={result} onReset={onReset!} /> : children}</main>
    </div>
  )
}

export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="bar"><div style={{ width: `${Math.max(2, pct)}%` }} /></div>
      <div className="plabel"><span>{label}</span><b>{Math.round(pct)}%</b></div>
    </div>
  )
}

/** Runs a job with busy/progress state, error toasts, and a leave-page guard. */
export function useJob() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [label, setLabel] = useState('')
  const [idx, setIdx] = useState(-1)
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])
  const progress: Progress = useCallback((p, l, i) => { setPct(p); setLabel(l); if (i !== undefined) setIdx(i) }, [])
  const run = useCallback(async (fn: (p: Progress) => Promise<string | void>) => {
    setBusy(true); setPct(0); setLabel('מתחיל…'); setIdx(-1)
    try {
      const msg = await fn(progress)
      setPct(100)
      if (msg) toast('success', msg)
    } catch (e) {
      console.error(e)
      if (e instanceof UserError) toast('error', e.message)
      else if (e instanceof RangeError || /memory|allocation/i.test(String((e as Error)?.message)))
        toast('error', 'נגמר הזיכרון במכשיר. נסה קובץ קטן יותר או סגור לשוניות אחרות.')
      else toast('error', 'משהו השתבש בעיבוד. הקבצים שלך לא הועלו לשום מקום - אפשר לנסות שוב.')
    } finally {
      setBusy(false)
    }
  }, [progress, toast])
  return { busy, pct, label, idx, run }
}

export function DropZone({ accept, multiple, onFiles, text }: { accept: (f: File) => boolean; multiple?: boolean; onFiles: (f: File[]) => void; text: string }) {
  const toast = useToast()
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const take = (list: FileList | File[]) => {
    const all = Array.from(list)
    const ok = all.filter(accept)
    const bad = all.length - ok.length
    if (bad) toast('warn', `${bad} ${bad === 1 ? 'קובץ לא נתמך ודולג' : 'קבצים לא נתמכים ודולגו'}.`)
    if (!ok.length) { if (all.length) toast('error', 'אף קובץ לא נתמך בכלי הזה.'); return }
    const empty = ok.filter((f) => f.size === 0)
    if (empty.length) toast('warn', `הקובץ "${empty[0].name}" ריק ודולג.`)
    const good = ok.filter((f) => f.size > 0)
    if (good.length) onFiles(multiple ? good : good.slice(0, 1))
    if (!multiple && good.length > 1) toast('info', 'הכלי הזה עובד עם קובץ אחד - לקחתי את הראשון.')
  }
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
      role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      <div className="folder">{Icons.folder(40)}</div>
      <b>{text}</b>
      <span>גרור לכאן או לחץ לבחירה</span>
      <span className="browse">בחירת קבצים</span>
      <em>הקבצים נשארים במכשיר שלך</em>
      <input ref={input} type="file" hidden multiple={multiple} onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = '' }} />
    </div>
  )
}

export function FileList({ files, onChange, busy, activeIdx = -1, pct = 0 }: { files: File[]; onChange: (f: File[]) => void; busy?: boolean; activeIdx?: number; pct?: number }) {
  const items = useRef<(HTMLLIElement | null)[]>([])
  const [drag, setDrag] = useState<number | null>(null)
  const cur = useRef(-1)
  const filesRef = useRef(files)
  filesRef.current = files
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= filesRef.current.length) return
    const c = [...filesRef.current]
    const [m] = c.splice(from, 1)
    c.splice(to, 0, m)
    onChange(c)
  }
  const start = (e: React.PointerEvent, i: number) => {
    e.preventDefault()
    cur.current = i
    setDrag(i)
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    if (cur.current < 0) return
    const y = e.clientY
    for (let j = 0; j < items.current.length; j++) {
      const r = items.current[j]?.getBoundingClientRect()
      if (r && y >= r.top && y <= r.bottom) {
        if (j !== cur.current) { reorder(cur.current, j); cur.current = j; setDrag(j) }
        break
      }
    }
    // auto-scroll near viewport edges (touch)
    if (y < 90) window.scrollBy(0, -12)
    else if (y > window.innerHeight - 90) window.scrollBy(0, 12)
  }
  const end = () => { cur.current = -1; setDrag(null) }
  return (
    <>
      <h3 className="flh">קבצים ({files.length}){files.length > 1 && !busy ? <small> · גרור את הידית כדי לסדר</small> : null}</h3>
      <ul className="files">
        {files.map((f, i) => {
          const state = !busy ? 'idle' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'wait'
          return (
            <li key={f.name + f.size + f.lastModified} ref={(el) => { items.current[i] = el }} className={`${state} ${drag === i ? 'dragging' : ''}`}>
              {!busy && files.length > 1 && (
                <span
                  className="grip" role="button" tabIndex={0} aria-label="גרור לשינוי סדר"
                  onPointerDown={(e) => start(e, i)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                  onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); reorder(i, i - 1) } if (e.key === 'ArrowDown') { e.preventDefault(); reorder(i, i + 1) } }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="9" cy="6" r="1.8" /><circle cx="15" cy="6" r="1.8" /><circle cx="9" cy="12" r="1.8" /><circle cx="15" cy="12" r="1.8" /><circle cx="9" cy="18" r="1.8" /><circle cx="15" cy="18" r="1.8" /></svg>
                </span>
              )}
              <Thumb file={f} />
              <div className="meta">
                <b>{f.name}</b>
                <span><bdi>{fmtSize(f.size)}</bdi>{state === 'done' ? ' · הושלם ✓' : state === 'active' ? ` · ${Math.max(5, Math.min(95, Math.round((pct * files.length) % 100)))}%` : state === 'wait' ? ' · ממתין' : ''}</span>
                {busy && <div className="mini"><div style={{ width: state === 'done' ? '100%' : state === 'active' ? `${Math.max(8, Math.min(95, (pct * files.length) % 100 || 8))}%` : '0%' }} /></div>}
              </div>
              {!busy && <button className="ib" onClick={() => onChange(files.filter((_, k) => k !== i))} aria-label="הסר">{Icons.x(18)}</button>}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file.type.startsWith('image/') || /hei[cf]/i.test(file.type)) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url ? <img src={url} alt="" className="thumb" /> : <div className="thumb ph">{/pdf$/i.test(file.type) ? Icons.pdf(22) : Icons.image(22)}</div>
}

function PdfPreview({ data }: { data: Uint8Array }) {
  const [doc, setDoc] = useState<PdfDoc>()
  const [err, setErr] = useState(false)
  useEffect(() => {
    let dead = false
    openPdfJs(new File([data as BlobPart], 'preview.pdf', { type: 'application/pdf' })).then((d) => !dead && setDoc(d)).catch(() => !dead && setErr(true))
    return () => { dead = true }
  }, [data])
  if (err) return <p className="pvnote">אי אפשר להציג תצוגה מקדימה, אבל הקובץ תקין וניתן להוריד.</p>
  if (!doc) return <p className="pvnote">טוען תצוגה מקדימה…</p>
  return <div className="pvpages">{Array.from({ length: doc.numPages }, (_, i) => <PvPage key={i} doc={doc} n={i + 1} total={doc.numPages} />)}</div>
}

function PvPage({ doc, n, total }: { doc: PdfDoc; n: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let dead = false
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      try {
        const c = await renderPage(doc, n, 1.1)
        const url = c.toDataURL('image/jpeg', 0.8)
        c.width = c.height = 0
        if (!dead) setSrc(url)
      } catch { /* preview only */ }
    }, { rootMargin: '600px' })
    io.observe(ref.current!)
    return () => { dead = true; io.disconnect() }
  }, [doc, n])
  return (
    <div ref={ref} className="pvpage">
      {src ? <img src={src} alt={`עמוד ${n}`} /> : <div className="pvph">…</div>}
      <span>{n} / {total}</span>
    </div>
  )
}

function ImagePreview({ images, mime }: { images: Uint8Array[]; mime: string }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const u = images.map((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: mime })))
    setUrls(u)
    return () => u.forEach(URL.revokeObjectURL)
  }, [images, mime])
  return <div className="pvpages">{urls.map((u, i) => <div key={i} className="pvpage"><img src={u} alt={`עמוד ${i + 1}`} /><span>{i + 1} / {urls.length}</span></div>)}</div>
}

export function ResultCard({ out, onReset }: { out: Output; onReset: () => void }) {
  const toast = useToast()
  const ext = (out.name.match(/\.[^.]+$/)?.[0] ?? '')
  const [stem, setStem] = useState(out.name.slice(0, out.name.length - ext.length))
  const clean = stem.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || 'document'
  const fileName = clean + ext
  const save = () => { download(out.data, fileName, out.mime); toast('success', 'ההורדה התחילה') }
  const share = async () => {
    const file = new File([out.data as BlobPart], fileName, { type: out.mime })
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    try {
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: fileName })
      } else {
        download(out.data, fileName, out.mime)
        toast('info', 'השיתוף הישיר לא נתמך בדפדפן הזה, אז הקובץ הורד. אפשר לשתף אותו משם.')
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      toast('error', 'השיתוף נכשל. אפשר להוריד את הקובץ ולשתף ממנו.')
    }
  }
  return (
    <section className="result">
      <div className="rhead">
        <span className="rok">{Icons.check(22)}</span>
        <div className="meta"><b>הקובץ מוכן</b><span><bdi>{fmtSize(out.data.length)}</bdi></span></div>
      </div>
      <label className="fname">שם הקובץ<span className="fnrow"><input value={stem} onChange={(e) => setStem(e.target.value)} dir="auto" aria-label="שם הקובץ" /><bdi className="fext">{ext}</bdi></span></label>
      <div className="ractions">
        <button className="go" onClick={save}>{Icons.download(20)} הורדה</button>
        <button className="go alt" onClick={share}>{Icons.share(20)} שיתוף</button>
      </div>
      <div className="preview">
        {out.images ? <ImagePreview images={out.images} mime={out.imageMime ?? 'image/jpeg'} /> : out.mime === 'application/pdf' ? <PdfPreview data={out.data} /> : <p className="note">{out.note ?? ''}</p>}
      </div>
      <button className="linkbtn" onClick={onReset}>חזרה לעריכה</button>
    </section>
  )
}
