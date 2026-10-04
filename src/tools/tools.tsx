import { useEffect, useState } from 'react'
import { DropZone, FileList, ProgressBar, ToolPage, useJob, useToast } from '../ui'
import PageGrid from '../PageGrid'
import { docxToPdf, pdfToDocx } from '../word'
import { ocrToPdf, OCR_LANGS, type OcrLang } from '../ocr'
import {
  IMAGE_EXT, baseName, compressPdf, extractPages, fmtSize, imagesToPdf,
  mergePdfs, openPdfJs, pdfOut, pdfToImages, rotatePdf, type Output, type PdfDoc,
} from '../pdf'

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isImg = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name)
const BIG = 300 * 1024 * 1024

function Job({ job }: { job: ReturnType<typeof useJob> }) {
  return job.busy ? <ProgressBar pct={job.pct} label={job.label} /> : null
}

function useBigWarn() {
  const toast = useToast()
  return (files: File[]) => {
    const total = files.reduce((a, f) => a + f.size, 0)
    if (total > BIG) toast('warn', `הקבצים גדולים (${fmtSize(total)}). העיבוד יכול לקחת זמן - השאר את הלשונית פתוחה.`)
  }
}

export function ImageToPdf() {
  const [out, setOut] = useState<Output>()
  const [files, setFiles] = useState<File[]>([])
  const [size, setSize] = useState('a4')
  const [landscape, setLandscape] = useState(false)
  const [margin, setMargin] = useState(18)
  const [quality, setQuality] = useState(0.85)
  const job = useJob(); const toast = useToast(); const warn = useBigWarn()
  const go = () => job.run(async (p) => {
    let skipped = 0
    const data = await imagesToPdf(files, { size, landscape, margin, quality }, p, (n, m) => { skipped++; toast('error', `"${n}" דולג: ${m}`) })
    setOut(pdfOut(data, `${files.length === 1 ? baseName(files[0]) : 'images'}.pdf`))
    return `ה-PDF מוכן (${fmtSize(data.length)})${skipped ? `, ${skipped} תמונות דולגו` : ''}`
  })
  return (
    <ToolPage icon="image" title="תמונה ל-PDF" hint="JPG, PNG, HEIC, WEBP ועוד. הסדר כאן הוא סדר העמודים." result={out} onReset={() => setOut(undefined)}>
      <DropZone multiple accept={isImg} text="בחר תמונות" onFiles={(f) => { warn(f); setFiles((x) => [...x, ...f]) }} />
      {files.length > 0 && <>
        <FileList files={files} onChange={setFiles} busy={job.busy} activeIdx={job.idx} pct={job.pct} />
        <div className="opts">
          <label>גודל עמוד<select value={size} onChange={(e) => setSize(e.target.value)}><option value="a4">A4</option><option value="letter">Letter</option><option value="fit">כגודל התמונה</option></select></label>
          {size !== 'fit' && <label>כיוון<select value={landscape ? 'l' : 'p'} onChange={(e) => setLandscape(e.target.value === 'l')}><option value="p">לאורך</option><option value="l">לרוחב</option></select></label>}
          <label>שוליים<select value={margin} onChange={(e) => setMargin(+e.target.value)}><option value={0}>בלי</option><option value={18}>קטנים</option><option value={36}>גדולים</option></select></label>
          <label>איכות<select value={quality} onChange={(e) => setQuality(+e.target.value)}><option value={1}>מקור (בלי דחיסה)</option><option value={0.85}>גבוהה</option><option value={0.65}>בינונית (קטן יותר)</option></select></label>
        </div>
        <Job job={job} />
        <button className="go" disabled={job.busy} onClick={go}>צור PDF ({files.length} {files.length === 1 ? 'עמוד' : 'עמודים'})</button>
      </>}
    </ToolPage>
  )
}

export function Merge() {
  const [out, setOut] = useState<Output>()
  const [files, setFiles] = useState<File[]>([])
  const job = useJob(); const warn = useBigWarn()
  const go = () => job.run(async (p) => {
    const data = await mergePdfs(files, p)
    setOut(pdfOut(data, 'merged.pdf'))
    return `אוחדו ${files.length} קבצים (${fmtSize(data.length)})`
  })
  return (
    <ToolPage icon="merge" title="איחוד PDF" hint="חבר כמה קבצים לאחד. סדר הרשימה = סדר באיחוד." result={out} onReset={() => setOut(undefined)}>
      <DropZone multiple accept={isPdf} text="בחר קבצי PDF" onFiles={(f) => { warn(f); setFiles((x) => [...x, ...f]) }} />
      {files.length > 0 && <>
        <FileList files={files} onChange={setFiles} busy={job.busy} activeIdx={job.idx} pct={job.pct} />
        <Job job={job} />
        <button className="go" disabled={job.busy || files.length < 2} onClick={go}>{files.length < 2 ? 'הוסף עוד קובץ' : 'אחד'}</button>
      </>}
    </ToolPage>
  )
}

function parseRanges(s: string, max: number): number[] | null {
  const out = new Set<number>()
  for (const part of s.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) return null
    const a = +m[1]; const b = m[2] ? +m[2] : a
    if (a < 1 || b > max || a > b) return null
    for (let i = a; i <= b; i++) out.add(i - 1)
  }
  return [...out]
}

function usePdfFile() {
  const [file, setFile] = useState<File>()
  const [doc, setDoc] = useState<PdfDoc>()
  const toast = useToast(); const warn = useBigWarn()
  useEffect(() => {
    if (!file) return
    let dead = false
    openPdfJs(file).then((d) => { if (!dead) setDoc(d) }).catch((e) => { toast('error', e.message); setFile(undefined) })
    return () => { dead = true }
  }, [file, toast])
  const pick = (f: File[]) => { warn(f); setDoc(undefined); setFile(f[0]) }
  const reset = () => { setFile(undefined); setDoc(undefined) }
  return { file, doc, pick, reset }
}

export function Split() {
  const [out, setOut] = useState<Output>()
  const { file, doc, pick, reset } = usePdfFile()
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [mode, setMode] = useState<'keep' | 'delete'>('keep')
  const [text, setText] = useState('')
  const job = useJob(); const toast = useToast()
  useEffect(() => setSel(new Set()), [doc])
  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const applyText = () => {
    const r = doc && parseRanges(text, doc.numPages)
    if (!r) return toast('error', `טווח לא תקין. דוגמה: 1-3, 5, 8-10 (הקובץ מכיל ${doc?.numPages} עמודים).`)
    setSel(new Set(r)); toast('info', `נבחרו ${r.length} עמודים`)
  }
  const go = () => job.run(async (p) => {
    if (!doc || !file) return
    const all = Array.from({ length: doc.numPages }, (_, i) => i)
    const keep = mode === 'keep' ? all.filter((i) => sel.has(i)) : all.filter((i) => !sel.has(i))
    if (!keep.length) throw new (await import('../pdf')).UserError('לא נשארו עמודים בקובץ. שנה את הבחירה.')
    const data = await extractPages(file, keep, p)
    setOut(pdfOut(data, `${baseName(file)}-${mode === 'keep' ? 'selected' : 'edited'}.pdf`))
    return `נשמר PDF עם ${keep.length} עמודים (${fmtSize(data.length)})`
  })
  return (
    <ToolPage icon="split" title="פיצול ומחיקת עמודים" hint="סמן עמודים (לחיצה או טווח), ובחר אם לשמור אותם או למחוק אותם." result={out} onReset={() => setOut(undefined)}>
      {!file ? <DropZone accept={isPdf} text="בחר קובץ PDF" onFiles={pick} /> : (
        <>
          <div className="bar2"><b>{file.name}</b> <span>{doc ? `${doc.numPages} עמודים` : 'טוען…'} · {fmtSize(file.size)}</span><button onClick={reset}>החלף קובץ</button></div>
          {doc && <>
            <div className="opts">
              <label>מה לעשות<select value={mode} onChange={(e) => setMode(e.target.value as 'keep' | 'delete')}><option value="keep">לשמור רק את המסומנים</option><option value="delete">למחוק את המסומנים</option></select></label>
              <label>טווח<span className="inline"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="1-3, 5, 8-10" dir="ltr" /><button onClick={applyText}>סמן</button></span></label>
              <button onClick={() => setSel(new Set(Array.from({ length: doc.numPages }, (_, i) => i)))}>סמן הכל</button>
              <button onClick={() => setSel(new Set())}>נקה</button>
            </div>
            <PageGrid doc={doc} selected={sel} onToggle={toggle} />
            <Job job={job} />
            <button className="go" disabled={job.busy || sel.size === 0} onClick={go}>{sel.size === 0 ? 'סמן עמודים' : `${mode === 'keep' ? 'שמור' : 'מחק'} ${sel.size} עמודים`}</button>
          </>}
        </>
      )}
    </ToolPage>
  )
}

export function Rotate() {
  const [out, setOut] = useState<Output>()
  const { file, doc, pick, reset } = usePdfFile()
  const [rot, setRot] = useState<Record<number, number>>({})
  const job = useJob()
  useEffect(() => setRot({}), [doc])
  const bump = (i: number, d = 90) => setRot((r) => ({ ...r, [i]: (((r[i] ?? 0) + d) % 360 + 360) % 360 }))
  const all = (d: number) => doc && setRot((r) => { const n = { ...r }; for (let i = 0; i < doc.numPages; i++) n[i] = (((n[i] ?? 0) + d) % 360 + 360) % 360; return n })
  const changed = Object.values(rot).filter(Boolean).length
  const go = () => job.run(async (p) => {
    if (!file) return
    const data = await rotatePdf(file, rot, p)
    setOut(pdfOut(data, `${baseName(file)}-rotated.pdf`))
    return `סובבו ${changed} עמודים (${fmtSize(data.length)})`
  })
  return (
    <ToolPage icon="rotate" title="סיבוב עמודים" hint="לחץ על עמוד כדי לסובב אותו 90°, או סובב הכל בבת אחת." result={out} onReset={() => setOut(undefined)}>
      {!file ? <DropZone accept={isPdf} text="בחר קובץ PDF" onFiles={pick} /> : (
        <>
          <div className="bar2"><b>{file.name}</b> <span>{doc ? `${doc.numPages} עמודים` : 'טוען…'}</span><button onClick={reset}>החלף קובץ</button></div>
          {doc && <>
            <div className="opts"><button onClick={() => all(-90)}>הכל שמאלה ↺</button><button onClick={() => all(90)}>הכל ימינה ↻</button><button onClick={() => setRot({})}>אפס</button></div>
            <PageGrid doc={doc} selected={new Set()} rotations={rot} onToggle={(i) => bump(i)} />
            <Job job={job} />
            <button className="go" disabled={job.busy || changed === 0} onClick={go}>{changed ? `שמור (${changed} עמודים סובבו)` : 'לחץ על עמוד כדי לסובב'}</button>
          </>}
        </>
      )}
    </ToolPage>
  )
}

export function Compress() {
  const [out, setOut] = useState<Output>()
  const [file, setFile] = useState<File>()
  const [level, setLevel] = useState<'light' | 'medium' | 'strong'>('medium')
  const job = useJob(); const toast = useToast(); const warn = useBigWarn()
  const go = () => job.run(async (p) => {
    if (!file) return
    const data = await compressPdf(file, level, p)
    if (data.length >= file.size) { toast('warn', 'הקובץ לא הוקטן (הוא כבר קטן/מכווץ), לכן לא הורדתי גרסה חדשה. נסה רמה חזקה יותר.'); return }
    setOut(pdfOut(data, `${baseName(file)}-compressed.pdf`))
    return `הקובץ הוקטן מ-${fmtSize(file.size)} ל-${fmtSize(data.length)} (${Math.round((1 - data.length / file.size) * 100)}%)`
  })
  return (
    <ToolPage icon="compress" title="כיווץ PDF" hint="כל עמוד הופך לתמונה מכווצת. מצוין לסריקות ותמונות. שים לב: הטקסט יהפוך לתמונה (אי אפשר לסמן/לחפש בו)." result={out} onReset={() => setOut(undefined)}>
      {!file ? <DropZone accept={isPdf} text="בחר קובץ PDF" onFiles={(f) => { warn(f); setFile(f[0]) }} /> : (
        <>
          <div className="bar2"><b>{file.name}</b> <span>{fmtSize(file.size)}</span><button onClick={() => setFile(undefined)}>החלף קובץ</button></div>
          <div className="opts"><label>עוצמה<select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}><option value="light">קלה (איכות גבוהה)</option><option value="medium">בינונית</option><option value="strong">חזקה (הכי קטן)</option></select></label></div>
          <Job job={job} />
          <button className="go" disabled={job.busy} onClick={go}>כווץ</button>
        </>
      )}
    </ToolPage>
  )
}

export function PdfToImages() {
  const [out, setOut] = useState<Output>()
  const [file, setFile] = useState<File>()
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [scale, setScale] = useState(2)
  const job = useJob(); const warn = useBigWarn()
  const go = () => job.run(async (p) => {
    if (!file) return
    const r = await pdfToImages(file, format, scale, p)
    setOut({ data: r.data, name: r.name, mime: r.single ? `image/${format}` : 'application/zip', images: r.images, imageMime: `image/${format}` })
    return r.single ? 'התמונה מוכנה' : `ה-ZIP מוכן (${fmtSize(r.data.length)})`
  })
  return (
    <ToolPage icon="toimg" title="PDF לתמונות" hint="כל עמוד הופך לתמונה. כמה עמודים = קובץ ZIP." result={out} onReset={() => setOut(undefined)}>
      {!file ? <DropZone accept={isPdf} text="בחר קובץ PDF" onFiles={(f) => { warn(f); setFile(f[0]) }} /> : (
        <>
          <div className="bar2"><b>{file.name}</b> <span>{fmtSize(file.size)}</span><button onClick={() => setFile(undefined)}>החלף קובץ</button></div>
          <div className="opts">
            <label>פורמט<select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="jpeg">JPG (קטן)</option><option value="png">PNG (איכותי)</option></select></label>
            <label>רזולוציה<select value={scale} onChange={(e) => setScale(+e.target.value)}><option value={1.3}>רגילה</option><option value={2}>גבוהה</option><option value={3}>גבוהה מאוד</option></select></label>
          </div>
          <Job job={job} />
          <button className="go" disabled={job.busy} onClick={go}>המר</button>
        </>
      )}
    </ToolPage>
  )
}

export function Ocr() {
  const [out, setOut] = useState<Output>()
  const [files, setFiles] = useState<File[]>([])
  const [lang, setLang] = useState<OcrLang>('heb+eng')
  const job = useJob(); const toast = useToast(); const warn = useBigWarn()
  const go = () => job.run(async (p) => {
    const data = await ocrToPdf(files, lang, p, (m) => toast('warn', m))
    setOut(pdfOut(data, `${files.length === 1 ? baseName(files[0]) : 'scan'}-ocr.pdf`))
    return `המסמך חיפושי ומוכן (${fmtSize(data.length)})`
  })
  return (
    <ToolPage icon="ocr" title="זיהוי טקסט (OCR)" hint="סריקה או תמונה הופכות ל-PDF עם שכבת טקסט: אפשר לחפש ולהעתיק. הכל קורה במכשיר." result={out} onReset={() => setOut(undefined)}>
      <DropZone multiple accept={(f) => isPdf(f) || isImg(f)} text="בחר PDF סרוק או תמונות" onFiles={(f) => { warn(f); setFiles((x) => [...x, ...f]) }} />
      {files.length > 0 && <>
        <FileList files={files} onChange={setFiles} busy={job.busy} activeIdx={job.idx} pct={job.pct} />
        <div className="opts">
          <label>שפה<select value={lang} onChange={(e) => setLang(e.target.value as OcrLang)}>{Object.entries(OCR_LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <p className="note">הזיהוי רץ עמוד אחר עמוד ויכול לקחת כמה שניות לעמוד. השאר את הלשונית פתוחה.</p>
        <Job job={job} />
        <button className="go" disabled={job.busy} onClick={go}>זהה טקסט</button>
      </>}
    </ToolPage>
  )
}

const isDocx = (f: File) => /\.docx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function WordToPdf() {
  const [out, setOut] = useState<Output>()
  const [file, setFile] = useState<File>()
  const job = useJob(); const toast = useToast()
  const go = () => job.run(async (p) => {
    if (!file) return
    const data = await docxToPdf(file, p)
    setOut(pdfOut(data, `${baseName(file)}.pdf`))
    return `ה-PDF מוכן (${fmtSize(data.length)})`
  })
  return (
    <ToolPage icon="word" title="המרת Word ל-PDF" hint="מסמך docx הופך ל-PDF בעמודי A4, כולל עברית מימין לשמאל, טבלאות ותמונות." result={out} onReset={() => setOut(undefined)}>
      <DropZone accept={isDocx} text="בחר מסמך Word (docx)" onFiles={(f) => { if (/\.doc$/i.test(f[0].name)) toast('error', 'רק docx נתמך'); else setFile(f[0]) }} />
      {file && <>
        <div className="bar2"><b>{file.name}</b> <span>{fmtSize(file.size)}</span><button onClick={() => setFile(undefined)}>החלף קובץ</button></div>
        <p className="note">הטקסט ב-PDF שנוצר הוא חלק מהתמונה של העמוד, כך שהעיצוב נשמר, אבל אי אפשר לסמן ולהעתיק ממנו. להפיכתו לחיפושי אפשר להעביר אותו דרך "זיהוי טקסט (OCR)".</p>
        <Job job={job} />
        <button className="go" disabled={job.busy} onClick={go}>המר ל-PDF</button>
      </>}
    </ToolPage>
  )
}

export function PdfToWord() {
  const [out, setOut] = useState<Output>()
  const [file, setFile] = useState<File>()
  const job = useJob(); const warn = useBigWarn()
  const go = () => job.run(async (p) => {
    if (!file) return
    const r = await pdfToDocx(file, p)
    setOut({ data: r.data, name: `${baseName(file)}.docx`, mime: DOCX_MIME, note: 'קובץ Word עם הטקסט והפסקאות של ה-PDF (עריכה חופשית). טבלאות ותמונות לא מועברות.' })
    return `קובץ ה-Word מוכן (${fmtSize(r.data.length)})`
  })
  return (
    <ToolPage icon="word" title="המרת PDF ל-Word" hint="מוציא את הטקסט מה-PDF לקובץ docx שאפשר לערוך, עם תמיכה בעברית." result={out} onReset={() => setOut(undefined)}>
      <DropZone accept={isPdf} text="בחר קובץ PDF" onFiles={(f) => { warn(f); setFile(f[0]) }} />
      {file && <>
        <div className="bar2"><b>{file.name}</b> <span>{fmtSize(file.size)}</span><button onClick={() => setFile(undefined)}>החלף קובץ</button></div>
        <p className="note">עובד על PDF עם טקסט אמיתי. מעבירים טקסט ופסקאות, בלי טבלאות ותמונות. לסריקות: קודם "זיהוי טקסט (OCR)".</p>
        <Job job={job} />
        <button className="go" disabled={job.busy} onClick={go}>המר ל-Word</button>
      </>}
    </ToolPage>
  )
}
