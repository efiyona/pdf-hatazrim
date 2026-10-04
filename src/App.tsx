import { Link, Route, Routes } from 'react-router-dom'
import { Compress, ImageToPdf, Merge, PdfToImages, Rotate, Split } from './tools/tools'

const TOOLS = [
  { to: '/image-to-pdf', icon: '🖼️', name: 'תמונה ל-PDF', desc: 'JPG, PNG, HEIC ועוד' },
  { to: '/merge', icon: '🧩', name: 'איחוד PDF', desc: 'כמה קבצים לאחד' },
  { to: '/split', icon: '✂️', name: 'פיצול ומחיקה', desc: 'בחר עמודים לשמירה או מחיקה' },
  { to: '/rotate', icon: '🔄', name: 'סיבוב עמודים', desc: 'עמוד אחד או הכל' },
  { to: '/compress', icon: '🗜️', name: 'כיווץ', desc: 'להקטין קובץ כבד' },
  { to: '/pdf-to-images', icon: '📸', name: 'PDF לתמונות', desc: 'כל עמוד לתמונה' },
]

function Home() {
  return (
    <main className="home">
      <h1>כלי PDF</h1>
      <p className="sub">חינם. בלי הרשמה. הקבצים נשארים אצלך - הכל קורה בדפדפן.</p>
      <div className="grid tools">
        {TOOLS.map((t) => (
          <Link key={t.to} to={t.to} className="card">
            <span className="ico">{t.icon}</span><b>{t.name}</b><small>{t.desc}</small>
          </Link>
        ))}
      </div>
      <p className="foot">🔒 שום קובץ לא עולה לשרת</p>
    </main>
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
