import { useEffect, useRef, useState } from 'react'
import { renderPage, type PdfDoc } from './pdf'

function Page({ doc, n, selected, rot, onClick }: { doc: PdfDoc; n: number; selected: boolean; rot: number; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let dead = false
    const el = ref.current!
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      try {
        const c = await renderPage(doc, n, 0.3)
        const url = c.toDataURL('image/jpeg', 0.6)
        c.width = c.height = 0
        if (!dead) setSrc(url)
      } catch { /* thumbnail only */ }
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => { dead = true; io.disconnect() }
  }, [doc, n])
  return (
    <div ref={ref} className={`pg ${selected ? 'sel' : ''}`} onClick={onClick}>
      <div className="pgimg">{src ? <img src={src} alt="" style={{ transform: `rotate(${rot}deg)` }} /> : <i>…</i>}</div>
      <span>{n}</span>
    </div>
  )
}

export default function PageGrid({ doc, selected, rotations, onToggle }: { doc: PdfDoc; selected: Set<number>; rotations?: Record<number, number>; onToggle: (i: number) => void }) {
  return (
    <div className="grid pages">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <Page key={i} doc={doc} n={i + 1} selected={selected.has(i)} rot={rotations?.[i] ?? 0} onClick={() => onToggle(i)} />
      ))}
    </div>
  )
}
