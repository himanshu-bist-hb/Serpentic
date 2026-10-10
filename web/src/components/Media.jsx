import { useEffect, useState } from "react";
import { Icon } from "./ui.jsx";

export function Lightbox({ urls, index, onClose, onIndex }) {
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % urls.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + urls.length) % urls.length);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [index, urls.length, onClose, onIndex]);
  return (
    <div className="scrim lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <img src={urls[index]} alt="" referrerPolicy="no-referrer" />
      <button className="btn icon lb-close" aria-label="Close" onClick={onClose}><Icon n="x" /></button>
      {urls.length > 1 && <>
        <button className="btn icon lb-prev" aria-label="Previous photo" onClick={() => onIndex((index - 1 + urls.length) % urls.length)}><Icon n="arrow" style={{ transform: "scaleX(-1)" }} /></button>
        <button className="btn icon lb-next" aria-label="Next photo" onClick={() => onIndex((index + 1) % urls.length)}><Icon n="arrow" /></button>
        <span className="lb-count mono">{index + 1} / {urls.length}</span>
      </>}
    </div>
  );
}

export function Gallery({ urls, onOpen }) {
  const [broken, setBroken] = useState({});
  const ok = urls.filter((u) => !broken[u]);
  if (!ok.length) return null;
  return (
    <div className={`gallery g${Math.min(ok.length, 4)}`}>
      {ok.slice(0, 8).map((u, i) => (
        <button key={u} className="gal-item" onClick={() => onOpen(ok, i)} aria-label={`Open photo ${i + 1}`}>
          <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken((b) => ({ ...b, [u]: true }))} />
          {i === 7 && ok.length > 8 && <span className="gal-more">+{ok.length - 8}</span>}
        </button>
      ))}
    </div>
  );
}


/** Gallery plus its own lightbox, for places that don't manage one. */
export function PhotoGrid({ urls }) {
  const [lb, setLb] = useState(null);
  return (
    <>
      <Gallery urls={urls} onOpen={(list, i) => setLb({ urls: list, i })} />
      {lb && <Lightbox urls={lb.urls} index={lb.i} onClose={() => setLb(null)} onIndex={(i) => setLb({ ...lb, i })} />}
    </>
  );
}
