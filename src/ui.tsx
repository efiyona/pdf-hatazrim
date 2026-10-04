import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { UserError, fmtSize, type Progress } from './pdf'

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
            <span>{{ success: '✅', error: '⚠️', info: 'ℹ️', warn: '🟠' }[t.kind]}</span>
            <p>{t.text}</p>
            <button aria-label="סגור" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function ToolPage({ icon, title, hint, children }: { icon: string; title: string; hint: string; children: ReactNode }) {
  return (
    <main className="tool">
      <Link to="/" className="back">→ כל הכלים</Link>
      <h1><span className="ico">{icon}</span> {title}</h1>
      <p className="hint">{hint}</p>
      {children}
    </main>
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
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])
  const progress: Progress = useCallback((p, l) => { setPct(p); setLabel(l) }, [])
  const run = useCallback(async (fn: (p: Progress) => Promise<string | void>) => {
    setBusy(true); setPct(0); setLabel('מתחיל…')
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
  return { busy, pct, label, run }
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
      <div className="big">📂</div>
      <b>{text}</b>
      <span>גרור לכאן או לחץ לבחירה</span>
      <input ref={input} type="file" hidden multiple={multiple} onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = '' }} />
    </div>
  )
}

export function FileList({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= files.length) return
    const c = [...files]; [c[i], c[j]] = [c[j], c[i]]; onChange(c)
  }
  return (
    <ul className="files">
      {files.map((f, i) => (
        <li key={f.name + i + f.size}>
          <Thumb file={f} />
          <div className="meta"><b>{f.name}</b><span>{fmtSize(f.size)}</span></div>
          <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="למעלה">▲</button>
          <button onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="למטה">▼</button>
          <button onClick={() => onChange(files.filter((_, k) => k !== i))} aria-label="הסר">✕</button>
        </li>
      ))}
    </ul>
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
  return url ? <img src={url} alt="" className="thumb" /> : <div className="thumb ph">{/pdf$/i.test(file.type) ? 'PDF' : '🖼️'}</div>
}
