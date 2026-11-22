import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorText, itemPath, live, usePage, useResource, viewKey, Waiting } from '@/Grabs';

export function Card({ item }) {
  return (
    <Link className="card" to={itemPath(item)}>
      <div className="card-art">
        {item.poster && <img src={item.poster} alt="" loading="lazy" width="480" height="270" />}
        {item.locked && <span className="card-badge">Watchers</span>}
        {item.kind === 'clip' && item.duration > 0 && <span className="card-duration">
          {item.duration < 60 ? item.duration + ' sec' : Math.ceil(item.duration / 60) + ' min'}
        </span>}
      </div>
      <strong>{item.title}</strong>
      <span className="muted">{item.kind === 'series' ? (item.random_order ? 'Series · RA' : 'Series') : item.category}</span>
    </Link>
  );
}

function Shelf({ row }) {
  const rail = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const element = rail.current;
    function measure() {
      setEdge({
        left: element.scrollLeft > 3,
        right: element.scrollWidth - element.clientWidth - element.scrollLeft > 3
      });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, [row.items.length]);
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

export function Browse() {
  const page = usePage();
  const [index, setIndex] = useState(0);
  const data = useResource('browse:' + viewKey(page), signal => live('catalog:list', null, '/catalog', { signal }), ['catalog:changed']);
  const spotlights = [];
  for (const item of [data.data?.featured, ...(data.data?.rows.find(row => row.id === 'new')?.items || [])]) {
    if (item && !item.locked && !spotlights.some(entry => entry.id === item.id)) spotlights.push(item);
    if (spotlights.length === 3) break;
  }
  const current = spotlights.length ? index % spotlights.length : 0;
  const featured = spotlights[current];
  return (
    <>
      {featured ? (
        <section className="hero" aria-label="Featured clips">
          <img src={featured.poster} alt="" fetchPriority="high" width="1600" height="900" key={featured.id} />
          <div className="hero-copy">
            <p className="meta">{featured.category}{Boolean(featured.demo) && ' · Sample preview'}</p>
            <h1>{featured.title}</h1>
            <p>{featured.description}</p>
            <div className="actions">
              <Link className="button primary" to={itemPath(featured) + '?play=1'}><span className="play-mark" aria-hidden="true" />
                {featured.demo ? 'Play preview' : 'Play clip'}
              </Link>
              <Link className="button quiet" to={itemPath(featured)}>Details</Link>
            </div>
          </div>
          {spotlights.length > 1 && <div className="spotlight-pages" aria-label="Choose a featured clip">
            {spotlights.map((item, position) => <button key={item.id} aria-label={item.title} title={item.title}
              aria-pressed={position === current} onClick={() => setIndex(position)}><span /></button>)}
          </div>}
        </section>
      ) : <h1>Browse</h1>}
      <ErrorText error={data.error} retry={data.refresh} />
      {!data.data && data.pending && <Waiting />}
      {data.data?.rows.map(row => <Shelf key={row.id} row={row} />)}
      {data.data && !data.data.rows.length && <p className="status">Clips will show here when they are ready.</p>}
    </>
  );
}

export function Search() {
  const page = usePage();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') || '').trim().slice(0, 80);
  const data = useResource(query ? 'search:' + query + ':' + viewKey(page) : null,
    signal => live('catalog:search', query, '/search?q=' + encodeURIComponent(query), { signal }), ['catalog:changed']);
  return (
    <div className="stack">
      <h1>Search</h1>
      <form className="inline" key={query} onSubmit={event => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get('q').trim();
        setParams(value ? { q: value } : {});
      }}>
        <label className="grow">Clips or series<input type="search" name="q" defaultValue={query} maxLength={80} /></label>
        <button className="button primary">Search</button>
      </form>
      <ErrorText error={data.error} retry={data.refresh} />
      {data.pending && !data.data && <Waiting />}
      {data.data?.length === 0 && <p className="status">No matches.</p>}
      {Boolean(data.data?.length) && <ul className="cards">{data.data.map(item => <li key={item.kind + item.id}><Card item={item} /></li>)}</ul>}
    </div>
  );
}
