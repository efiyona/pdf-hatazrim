import { useEffect, useRef, useState } from 'react'
import { ProgressBar, ToolPage, useJob, useToast } from '../ui'
import { Icons } from '../Icons'
import { fmtSize, pdfOut, type Output } from '../pdf'
import { SCAN_MODES, detectQuad, fullQuad, makeWork, previewScan, scansToPdf, type Quad, type ScanMode, type ScanPage } from '../scan'

const isImg = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|bmp|avif)$/i.test(f.name)

function Editor({ page, onSave, onClose }: { page: ScanPage; onSave: (q: Quad) => void; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [q, setQ] = useState<Quad>(page.quad)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(-1)
  useEffect(() => { const u = URL.createObjectURL(page.work); setUrl(u); return () => URL.revokeObjectURL(u) }, [page])
  const move = (e: React.PointerEvent) => {
    if (drag.current < 0 || !box.current) return
    const r = box.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    setQ((o) => o.map((p, i) => (i === drag.current ? { x, y } : p)) as Quad)
  }
  const auto = async () => {
    const bmp = await createImageBitmap(page.work)
    setQ(detectQuad(bmp, bmp.width, bmp.height)); bmp.close()
  }
  return (
    <div className="modal" role="dialog">
      <div className="mcard">
        <b>כוונון פינות המסמך</b>
        <small>גרור את 4 העיגולים אל פינות הדף. אחרי השמירה יתבצע יישור אוטומטי.</small>
        <div className="qbox" ref={box} style={{ aspectRatio: `${page.w}/${page.h}` }} onPointerMove={move} onPointerUp={() => (drag.current = -1)} onPointerCancel={() => (drag.current = -1)}>
          {url && <img src={url} alt="" draggable={false} />}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none"><polygon points={q.map((p) => `${p.x},${p.y}`).join(' ')} /></svg>
          {q.map((p, i) => (
            <span key={i} className="qh" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} onPointerDown={(e) => { drag.current = i; (e.target as HTMLElement).setPointerCapture(e.pointerId) }} />
          ))}
        </div>
        <div className="mrow">
          <button className="ghost" onClick={auto}>זיהוי אוטומטי</button>
          <button className="ghost" onClick={() => setQ(fullQuad())}>כל התמונה</button>
          <button className="go sm" onClick={() => onSave(q)}>שמור</button>
          <button className="ghost" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  )
}

export function Scan() {
  const [out, setOut] = useState<Output>()
  const [pages, setPages] = useState<ScanPage[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<ScanMode>('bw')
  const [edit, setEdit] = useState<string>()
  const [adding, setAdding] = useState(0)
  const job = useJob(); const toast = useToast()
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    let dead = false
    ;(async () => {
      for (const p of pages) {
        const key = `${p.id}|${mode}|${p.rot}|${p.quad.map((a) => a.x.toFixed(3) + a.y.toFixed(3)).join()}`
        if (thumbs[p.id + '#k'] === key) continue
        try {
          const u = await previewScan(p, mode)
          if (dead) { URL.revokeObjectURL(u); return }
          setThumbs((t) => { if (t[p.id]) URL.revokeObjectURL(t[p.id]); return { ...t, [p.id]: u, [p.id + '#k']: key } })
        } catch (e) { console.error(e) }
      }
    })()
    return () => { dead = true }
  }, [pages, mode]) // eslint-disable-line

  const add = async (list: FileList | null) => {
    if (!list) return
    const files = Array.from(list)
    const ok = files.filter(isImg)
    if (ok.length < files.length) toast('warn', `${files.length - ok.length} קבצים שאינם תמונה דולגו.`)
    for (const f of ok) {
      setAdding((n) => n + 1)
      try {
        if (f.size === 0) throw new Error('empty')
        const w = await makeWork(f)
        const bmp = await createImageBitmap(w.blob)
        const quad = detectQuad(bmp, bmp.width, bmp.height)
        bmp.close()
        const page: ScanPage = { id: `p${++seq.current}`, name: f.name, work: w.blob, w: w.w, h: w.h, quad, rot: 0 }
        setPages((x) => [...x, page])
      } catch (e) {
        console.error(e)
        toast('error', `לא הצלחתי לקרוא את "${f.name}". נסה לצלם שוב.`)
      } finally { setAdding((n) => n - 1) }
    }
  }
  const upd = (id: string, fn: (p: ScanPage) => ScanPage) => setPages((x) => x.map((p) => (p.id === id ? fn(p) : p)))
  const del = (id: string) => setPages((x) => x.filter((p) => p.id !== id))
  const mv = (id: string, d: number) => setPages((x) => { const i = x.findIndex((p) => p.id === id), j = i + d; if (j < 0 || j >= x.length) return x; const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c })
  const go = () => job.run(async (p) => {
    const data = await scansToPdf(pages, mode, p)
    setOut(pdfOut(data, 'scan.pdf'))
    return `הסריקה מוכנה: ${pages.length} ${pages.length === 1 ? 'עמוד' : 'עמודים'} (${fmtSize(data.length)})`
  })
  const ep = pages.find((p) => p.id === edit)
  return (
    <ToolPage icon="scan" title="סורק מסמכים" hint="צלם דף במצלמה: מיישרים את הקצוות והופכים לסריקה נקייה, כמו סורק במדפסת. אפשר כמה עמודים ברצף." result={out} onReset={() => setOut(undefined)}>
      <div className="capture">
        <button className="camBtn" onClick={() => cam.current?.click()}>{Icons.camera(30)}<b>{pages.length ? 'צלם עמוד נוסף' : 'צלם מסמך'}</b><small>פותח את המצלמה</small></button>
        <button className="ghost wide" onClick={() => gal.current?.click()}>בחר תמונות מהגלריה</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <input ref={gal} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      </div>
      {adding > 0 && <ProgressBar pct={50} label="מזהה את קצוות המסמך…" />}
      {pages.length > 0 && <>
        <div className="opts">
          <label>סוג סריקה<select value={mode} onChange={(e) => setMode(e.target.value as ScanMode)}>{Object.entries(SCAN_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <div className="spages">
          {pages.map((p, i) => (
            <div className="spage" key={p.id}>
              <div className="sth" onClick={() => setEdit(p.id)}>{thumbs[p.id] ? <img src={thumbs[p.id]} alt={`עמוד ${i + 1}`} /> : <span className="spin" />}</div>
              <div className="sbar">
                <b>{i + 1}</b>
                <button aria-label="הקדם" disabled={i === 0} onClick={() => mv(p.id, -1)}>{Icons.back(16)}</button>
                <button aria-label="אחר" disabled={i === pages.length - 1} onClick={() => mv(p.id, 1)} style={{ transform: 'scaleX(-1)' }}>{Icons.back(16)}</button>
                <button aria-label="סובב" onClick={() => upd(p.id, (x) => ({ ...x, rot: (x.rot + 90) % 360 }))}>{Icons.rotate(16)}</button>
                <button aria-label="מחק" onClick={() => del(p.id)}>{Icons.x(16)}</button>
              </div>
              <button className="ghost sm" onClick={() => setEdit(p.id)}>כוונן פינות</button>
            </div>
          ))}
        </div>
        {job.busy && <ProgressBar pct={job.pct} label={job.label} />}
        <button className="go" disabled={job.busy || adding > 0} onClick={go}>צור PDF ({pages.length} {pages.length === 1 ? 'עמוד' : 'עמודים'})</button>
      </>}
      {ep && <Editor page={ep} onClose={() => setEdit(undefined)} onSave={(q) => { upd(ep.id, (x) => ({ ...x, quad: q })); setEdit(undefined) }} />}
    </ToolPage>
  )
}
