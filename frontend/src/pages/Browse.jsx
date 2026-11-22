import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ErrorText, isCatalogPath, itemPath, live, playbackPath, usePage, useResource, viewKey, Waiting } from '@/Grabs';
import { usePreview } from '@/Preview';
import { progressKey, readProgress } from '@/WatchProgress';

const browseVisits = new Map();

function browseVisit(key) {
  if (browseVisits.has(key)) return browseVisits.get(key);
  if (browseVisits.size >= 12) browseVisits.delete(browseVisits.keys().next().value);
  const visit = { spotlight: null, rows: new Map() };
  browseVisits.set(key, visit);
  return visit;
}

export function Card({ item }) {
  const preview = usePreview();
  const location = useLocation();
  const state = { fromCatalog: isCatalogPath(location.pathname) };
  return (
    <div className="card-tile">
      <Link className="card" aria-haspopup="dialog" aria-label={item.title} to={itemPath(item)} state={state} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        preview(item);
      }}>
        <div className="card-art">
          {item.poster && <img src={item.poster} alt="" loading="lazy" width="480" height="270" />}
          {item.locked && <span className="card-badge">Watchers</span>}
          {item.kind === 'clip' && item.duration > 0 && <span className="card-duration">
            {item.duration < 60 ? item.duration + ' sec' : Math.ceil(item.duration / 60) + ' min'}
          </span>}
          {item.progress && <progress className="card-progress" aria-label="Watch progress" value={item.progress.time} max={item.progress.duration} />}
        </div>
        <strong>{item.title}</strong>
        <span className="muted">{item.kind === 'series' ? (item.random_order ? 'Series · RA' : 'Series') : item.category}</span>
      </Link>
      {item.kind === 'clip' && !item.locked && <Link to={playbackPath(item)} state={state} className="round-control card-play"
        aria-label={`${item.progress ? 'Resume' : 'Play'} ${item.title}`}>
        <span className="play-mark" aria-hidden="true" />
      </Link>}
    </div>
  );
}

function Shelf({ row, visit }) {
  const rail = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    rail.current.scrollTo({ left: visit.rows.get(row.id) || 0, behavior: 'instant' });
  }, [row.id, visit]);

  useEffect(() => {
    const element = rail.current;
    function measure() {
      const left = element.scrollLeft > 3;
      const right = element.scrollWidth - element.clientWidth - element.scrollLeft > 3;
      setEdge(current => current.left === left && current.right === right ? current : { left, right });
    }
    function scroll() {
      visit.rows.set(row.id, element.scrollLeft);
      measure();
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', scroll, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', scroll);
    };
  }, [row.id, row.items.length, visit]);

  function shift(direction) {
    rail.current.scrollBy({ left: direction * rail.current.clientWidth * 0.8 });
  }

  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{row.name}</h2>
        {(edge.left || edge.right) && <div className="shelf-arrows">
          <button className="arrow-button" aria-label={`Scroll ${row.name} left`} disabled={!edge.left} onClick={() => shift(-1)}>‹</button>
          <button className="arrow-button" aria-label={`Scroll ${row.name} right`} disabled={!edge.right} onClick={() => shift(1)}>›</button>
        </div>}
      </div>
      <ul className="rail" aria-label={row.name} ref={rail}>{row.items.map(item => <li key={item.id}><Card item={item} /></li>)}</ul>
    </section>
  );
}

function Spotlight({ items, visit }) {
  const preview = usePreview();
  const [selected, setSelected] = useState(visit.spotlight);
  const current = Math.max(0, items.findIndex(item => item.id === selected));
  const feature = items[current];

  function select(index) {
    const item = items[(index + items.length) % items.length];
    visit.spotlight = item.id;
    setSelected(item.id);
  }

  return (
    <section className="hero" aria-label="Featured clips" onKeyDown={event => {
      if (items.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      select(current + (event.key === 'ArrowRight' ? 1 : -1));
    }}>
      <div className="hero-art" aria-hidden="true">
        {items.map((item, index) => <img key={item.id} src={item.poster} alt="" width="1600" height="900"
          fetchPriority={index === 0 ? 'high' : 'low'} data-active={index === current} />)}
      </div>
      <div className="hero-inner wrap">
        <div className="hero-copy" key={feature.id}>
          <p className="meta">{feature.category}{Boolean(feature.demo) && ' · Sample preview'}</p>
          <h1>{feature.title}</h1>
          <p>{feature.description}</p>
          <div className="actions">
            <Link className="button primary" to={playbackPath(feature)} state={{ fromCatalog: true }}>
              <span className="play-mark" aria-hidden="true" />{feature.demo ? 'Play preview' : 'Play clip'}
            </Link>
            <button className="button quiet" aria-haspopup="dialog" onClick={() => preview(feature)}>Details</button>
          </div>
        </div>
        {items.length > 1 && <div className="spotlight-controls">
          <button className="round-control" aria-label="Previous featured clip" onClick={() => select(current - 1)}>‹</button>
          <div className="spotlight-pages" aria-label="Choose a featured clip">
            {items.map((item, index) => <button key={item.id} aria-label={item.title} title={item.title}
              aria-pressed={index === current} onClick={() => select(index)}><span /></button>)}
          </div>
          <button className="round-control" aria-label="Next featured clip" onClick={() => select(current + 1)}>›</button>
        </div>}
      </div>
    </section>
  );
}

function LoadingCatalog() {
  return <div className="catalog-loading" role="status" aria-label="Loading catalog">
    <div className="hero loading-feature" aria-hidden="true">
      <div className="wrap hero-inner"><span /><span /></div>
    </div>
    <div className="wrap loading-shelf" aria-hidden="true"><span /><span /><span /><span /><span /></div>
  </div>;
}

export function Browse() {
  const page = usePage();
  const { key } = useLocation();
  const visit = browseVisit(key);
  const data = useResource('browse:' + viewKey(page), signal => live('catalog:list', null, '/catalog', { signal }), ['catalog:changed']);
  const storageKey = progressKey(page.props.id);
  const [history, setHistory] = useState(() => readProgress(storageKey));
  useEffect(() => {
    function sync() { setHistory(readProgress(storageKey)); }
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);

  const rows = data.data?.rows || [];
  const clips = new Map(rows.flatMap(row => row.items)
    .filter(item => item.kind === 'clip' && !item.locked).map(clip => [clip.id, clip]));
  const resume = history.flatMap(progress => {
    const clip = clips.get(progress.id);
    return clip ? [{ ...clip, progress }] : [];
  });
  const spotlights = Array.from(new Map([data.data?.featured, ...(rows.find(row => row.id === 'new')?.items || [])]
    .filter(item => item && !item.locked).map(item => [item.id, item])).values()).slice(0, 3);
  if (data.pending && !data.data) return <LoadingCatalog />;

  return (
    <>
      {spotlights.length > 0 && <Spotlight items={spotlights} visit={visit} key={key} />}
      <div className="wrap browse-feed">
        {spotlights.length === 0 && <h1>Browse</h1>}
        <ErrorText error={data.error} retry={data.refresh} />
        {resume.length > 0 && <Shelf row={{ id: 'resume', name: 'Continue watching', items: resume }} visit={visit} />}
        {rows.map(row => <Shelf key={row.id} row={row} visit={visit} />)}
        {data.data && !rows.length && <p className="status">Clips will show here when they are ready.</p>}
      </div>
    </>
  );
}

export function Search() {
  const page = usePage();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') || '').trim().slice(0, 80);
  const [entry, setEntry] = useState(query);

  useEffect(() => {
    setEntry(value => value.trim() === query ? value : query);
  }, [query]);

  useEffect(() => {
    const next = entry.trim();
    if (next === query) return;
    const timer = setTimeout(() => setParams(next ? { q: next } : {}, { replace: true }), 280);
    return () => clearTimeout(timer);
  }, [entry, query, setParams]);

  const data = useResource(query ? 'search:' + query + ':' + viewKey(page) : null,
    signal => live('catalog:search', query, '/search?q=' + encodeURIComponent(query), { signal }), ['catalog:changed']);
  return (
    <div className="stack">
      <h1>Search</h1>
      <form className="inline" onSubmit={event => {
        event.preventDefault();
        const value = entry.trim();
        setParams(value ? { q: value } : {}, { replace: true });
      }}>
        <label className="grow">Clips or series<input type="search" name="q" value={entry} maxLength={80}
          onChange={event => setEntry(event.target.value)} /></label>
        <button className="button primary">Search</button>
      </form>
      <ErrorText error={data.error} retry={data.refresh} />
      {data.pending && !data.data && <Waiting />}
      {data.data?.length === 0 && <p className="status">No matches.</p>}
      {Boolean(data.data?.length) && <ul className="cards search-results" key={query}>{data.data.map(item => <li key={item.kind + item.id}><Card item={item} /></li>)}</ul>}
    </div>
  );
}
