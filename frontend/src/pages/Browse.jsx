import { Link, useSearchParams } from 'react-router-dom';
import { ErrorText, itemPath, live, usePage, useResource, viewKey, Waiting } from '@/Grabs';

export function Card({ item }) {
  return (
    <Link className="card" to={itemPath(item)}>
      <div className="card-art">
        {item.poster && <img src={item.poster} alt="" loading="lazy" width="480" height="270" />}
        {item.locked && <span className="card-badge">Watchers</span>}
      </div>
      <strong>{item.title}</strong>
      <span className="muted">{item.kind === 'series' ? (item.random_order ? 'Series · RA' : 'Series') : item.category}</span>
    </Link>
  );
}

export function Browse() {
  const page = usePage();
  const data = useResource('browse:' + viewKey(page), signal => live('catalog:list', null, '/catalog', { signal }), ['catalog:changed']);
  const featured = data.data?.featured;
  return (
    <>
      {featured && (
        <section className="hero">
          <img src={featured.poster} alt="" fetchPriority="high" width="960" height="540" />
          <div className="hero-copy">
            <p className="meta">{featured.category}</p>
            <h1>{featured.title}</h1>
            <p>{featured.description}</p>
            <Link className="button primary" to={itemPath(featured)}>Watch clip</Link>
          </div>
        </section>
      )}
      {!featured && <h1>Browse</h1>}
      <ErrorText error={data.error} retry={data.refresh} />
      {!data.data && data.pending && <Waiting />}
      {data.data?.rows.map(row => (
        <section key={row.id} className="shelf">
          <h2>{row.name}</h2>
          <ul className="rail" aria-label={row.name}>{row.items.map(item => <li key={item.id}><Card item={item} /></li>)}</ul>
        </section>
      ))}
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
