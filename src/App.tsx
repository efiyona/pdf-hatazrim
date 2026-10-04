import { Link, Route, Routes } from 'react-router-dom'
import { Icons, TOOL_COLORS } from './Icons'
import { Compress, ImageToPdf, Merge, PdfToImages, Rotate, Split } from './tools/tools'

const TOOLS = [
  { to: '/image-to-pdf', icon: 'image', name: 'תמונה ל-PDF', desc: 'JPG, PNG, HEIC ועוד' },
  { to: '/merge', icon: 'merge', name: 'איחוד', desc: 'כמה קבצים לאחד' },
  { to: '/split', icon: 'split', name: 'פיצול ומחיקה', desc: 'שמור או מחק עמודים' },
  { to: '/rotate', icon: 'rotate', name: 'סיבוב', desc: 'עמוד אחד או הכל' },
  { to: '/compress', icon: 'compress', name: 'כיווץ', desc: 'להקטין קובץ כבד' },
  { to: '/pdf-to-images', icon: 'toimg', name: 'PDF לתמונות', desc: 'כל עמוד לתמונה' },
]

function Home() {
  const [main, ...rest] = TOOLS
  return (
    <div className="shell">
      <header className="hero">
        <div className="brand"><span className="logo">{Icons.pdf(22)}</span> כלי PDF</div>
        <h1>מה נעשה היום עם הקבצים?</h1>
        <p>חינם, בלי הרשמה, ושום דבר לא עולה לשרת.</p>
        <div className="privacy">{Icons.lock(16)} הכל קורה בדפדפן שלך</div>
      </header>
      <main className="sheet">
        <Link to={main.to} className="featured">
          <span className="fico">{Icons[main.icon](30)}</span>
          <div><b>{main.name}</b><small>הכלי הכי נפוץ: תמונות מכל סוג לקובץ PDF אחד</small></div>
          <span className="go2">{Icons.back(20)}</span>
        </Link>
        <h2 className="sec">כל הכלים</h2>
        <div className="grid tools">
          {rest.map((t) => (
            <Link key={t.to} to={t.to} className="tile">
              <span className="tico" style={{ background: TOOL_COLORS[t.icon] + '1f', color: TOOL_COLORS[t.icon] }}>{Icons[t.icon](26)}</span>
              <b>{t.name}</b><small>{t.desc}</small>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/image-to-pdf" element={<ImageToPdf />} />
      <Route path="/merge" element={<Merge />} />
      <Route path="/split" element={<Split />} />
      <Route path="/rotate" element={<Rotate />} />
      <Route path="/compress" element={<Compress />} />
      <Route path="/pdf-to-images" element={<PdfToImages />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
