import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ErrorText, isCatalogPath, itemPath, live, playbackPath, usePage, useResource, viewKey } from '@/Grabs';
import { progressKey, readProgress } from '@/WatchProgress';

const PreviewContext = createContext(null);
export const usePreview = () => useContext(PreviewContext);

export default function PreviewProvider({ children }) {
  const page = usePage();
  const location = useLocation();
  const dialog = useRef(null);
  const [selection, setSelection] = useState(null);
  const [open, setOpen] = useState(false);
  const active = open && selection?.route === location.key;
  const selected = selection?.item;
  const details = useResource(active ? `preview:${selected.kind}:${selected.id}:${viewKey(page)}` : null,
    signal => live('catalog:details', { type: selected.kind, id: selected.id },
      `/details/${selected.kind}/${selected.id}`, { signal }), ['catalog:changed']);
  const item = details.data || selected;
  // Keep the dialog's contents mounted while the browser animates it out.
  const inSeries = item?.kind === 'series';
  const playable = inSeries ? item?.items?.find(clip => !clip.locked) : item?.locked ? null : item;
  const progress = playable && readProgress(progressKey(page.props.id)).find(entry => entry.id === playable.id);
  const fromCatalog = isCatalogPath(location.pathname);

  function preview(itemToShow) {
    setSelection({ item: itemToShow, route: location.key });
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (active && !panel.open) panel.showModal();
    else if (!active && panel.open) panel.close();
  }, [active]);

  useEffect(() => {
    if (details.data) setSelection(current => current?.item.id === details.data.id ? { ...current, item: details.data } : current);
  }, [details.data]);

  return (
    <PreviewContext.Provider value={preview}>
      {children}
      <dialog ref={dialog} className="preview" aria-labelledby="preview-title" onClose={close}
        onClick={event => { if (event.target === event.currentTarget) close(); }}>
        {item && <div className="preview-shell">
          <div className="preview-top">
            <button type="button" className="round-control preview-close" aria-label="Close preview" autoFocus onClick={close}>×</button>
          </div>
          <div className="preview-cover">{item.poster && <img src={item.poster} alt="" width="960" height="540" />}</div>
          <div className="preview-content">
            <p className="meta">{inSeries ? 'Series' : item.category}{Boolean(item.demo) && ' · Sample preview'}</p>
            <h2 id="preview-title">{item.title}</h2>
            <p className="description">{item.description}</p>
            <div className="actions">
              {playable && <Link className="button primary" to={playbackPath(playable)} state={{ fromCatalog }} onClick={close}>
                <span className="play-mark" aria-hidden="true" />{progress ? 'Resume' : inSeries ? 'Play first available clip' : 'Play'}
              </Link>}
              {progress && <Link className="button quiet" to={playbackPath(playable, true)} state={{ fromCatalog }} onClick={close}>Start over</Link>}
              {item.locked && <Link className="button primary" to={page.props.id ? '/plans' : '/join'} onClick={close}>
                {page.props.id ? 'See plans' : 'Join to watch'}
              </Link>}
              <Link className="button quiet" to={itemPath(item)} state={{ fromCatalog }} onClick={close}>
                {inSeries ? 'View series' : 'Open clip page'}
              </Link>
            </div>
            {inSeries && details.pending && !details.data && <p className="muted" role="status">Loading clips…</p>}
            <ErrorText error={details.error} retry={details.refresh} />
            {inSeries && Boolean(item.items?.length) && <ul className="preview-episodes">
              {item.items.slice(0, 4).map(clip => <li key={clip.id}>
                <Link to={clip.locked ? itemPath(clip) : playbackPath(clip)} state={{ fromCatalog }} onClick={close}>
                  <img src={clip.poster} alt="" width="128" height="72" loading="lazy" />
                  <span>{clip.title}{clip.locked && <small>Watchers</small>}</span>
                </Link>
              </li>)}
            </ul>}
          </div>
        </div>}
      </dialog>
    </PreviewContext.Provider>
  );
}
