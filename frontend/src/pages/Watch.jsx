import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from './Browse';
import { api, ErrorText, formatDate, formValues, live, socket, useAction, usePage, useResource, viewKey, Waiting } from '@/Grabs';

function Player({ clip }) {
  const page = usePage();
  const auth = usePage().props;
  const premium = page.paid && auth.tier === 'premium';
  const high = premium || auth.role === 'admin';
  const [wanted, setWanted] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const video = useRef(null);
  const resume = useRef({ time: 0, playing: false });
  const quality = (wanted === 'high' && high) || (wanted === 'hd' && auth.canWatch) || wanted === 'guest'
    ? wanted : auth.canWatch ? 'hd' : 'guest';

  return (
    <>
      <video
        ref={video} key={quality + ':' + reload} className="player" controls playsInline
        src={`/api/media/${clip.id}/${quality}`} poster={clip.poster}
        preload={premium ? 'auto' : 'metadata'}
        onError={() => setFailed(true)}
        onLoadedMetadata={event => {
          const player = event.currentTarget;
          player.currentTime = Math.min(resume.current.time, player.duration || 0);
          if (resume.current.playing) player.play().catch(() => {});
        }}
      >
        Your browser cannot play this video.
      </video>
      {failed && <p className="error" role="alert">The video could not load. <button className="button small quiet" onClick={() => { setFailed(false); setReload(value => value + 1); }}>Retry</button></p>}
      {auth.canWatch && <label className="quality">Quality
        <select value={quality} onChange={event => {
          resume.current = { time: video.current?.currentTime || 0, playing: !video.current?.paused };
          setFailed(false);
          setWanted(event.target.value);
        }}>
          <option value="guest">Standard</option>
          <option value="hd">HD</option>
          {high && <option value="high">Highest available</option>}
        </select>
      </label>}
    </>
  );
}

function SaveToList({ target }) {
  const action = useAction();
  const [active, setActive] = useState(false);
  const [saved, setSaved] = useState(false);
  const lists = useResource(active ? 'playlist-picker' : null, signal => live('playlists:list', false, '/playlists?items=0', { signal }), ['playlists:changed']);
  return (
    <div className="save">
      <button className="button quiet" onClick={() => { setActive(value => !value); setSaved(false); }} aria-expanded={active}>Save to playlist</button>
      {active && <div className="stack panel">
        <ErrorText error={lists.error || action.error} retry={lists.error ? lists.refresh : undefined} />
        {lists.pending && !lists.data && <Waiting />}
        {lists.data?.length === 0 && <Link to="/library">Make a playlist first</Link>}
        {lists.data?.length > 0 && <form className="inline" onSubmit={event => {
          const id = formValues(event).get('list');
          action.run(async () => {
            await api('/playlists/' + id + '/items', { method: 'POST', body: target });
            setSaved(true);
          });
        }}>
          <label>Playlist<select name="list">{lists.data.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <button className="button primary" disabled={action.pending}>Save</button>
        </form>}
        {saved && <p className="status" role="status">Saved to your playlist.</p>}
      </div>}
    </div>
  );
}

function Thread({ target }) {
  const page = usePage();
  const auth = usePage().props;
  const path = `/comments/${target.type}/${target.id}`;
  const base = target.type + ':' + target.id + ':' + viewKey(page);
  const list = useResource('thread:' + base, signal => live('comments:list', target, path, { signal }), ['comments:changed']);
  const action = useAction();
  const [reply, setReply] = useState(null);

  useEffect(() => () => {
    if (socket.connected) socket.emit('comments:leave', null, () => {});
  }, [base]);

  function post(event) {
    const form = event.currentTarget;
    const body = formValues(event).get('body');
    const value = { ...target, body, parent: reply?.id };
    action.run(async () => {
      await live('comments:post', value, path, { method: 'POST', body: value }, true);
      setReply(null);
      form.reset();
      list.refresh();
    });
  }
  function remove(id) {
    action.run(async () => { await api('/comments/' + id, { method: 'DELETE' }); list.refresh(); });
  }
  function comment(row, root) {
    return <div className="comment-body">
      <div className="comment-meta"><strong>{row.name}</strong>{row.badge && <span className="tag">{row.badge}</span>}<span>{formatDate(row.created_at)}</span></div>
      <p>{row.body}</p>
      <div className="comment-actions">
        {root && auth.canWatch && <button type="button" className="text-button" onClick={() => setReply(row)}>Reply</button>}
        {row.canDelete && <button type="button" className="text-button" disabled={action.pending} onClick={() => remove(row.id)}>Remove</button>}
      </div>
    </div>;
  }

  return (
    <section className="stack comments">
      <h2>Comments</h2>
      <ErrorText error={list.error || action.error} retry={list.error ? list.refresh : undefined} />
      {auth.canWatch && !reply && <form onSubmit={post} className="stack panel">
        <label>Add a comment<textarea name="body" rows="2" maxLength={500} required /></label>
        <button className="button primary" disabled={action.pending}>Post</button>
      </form>}
      {!auth.id && <p className="muted"><Link to="/signin">Sign in</Link> to comment.</p>}
      {list.pending && !list.data && <Waiting />}
      {list.data?.length === 0 && <p className="muted">No comments yet.</p>}
      <ul className="threads">
        {list.data?.map(row => <li key={row.id}>
          {comment(row, true)}
          {row.replies.length > 0 && <ul className="threads replies">{row.replies.map(item => <li key={item.id}>{comment(item, false)}</li>)}</ul>}
          {reply?.id === row.id && <form className="stack panel replies" onSubmit={post}>
            <label>Reply to {reply.name}<textarea autoFocus name="body" rows="2" maxLength={500} required /></label>
            <div className="actions"><button className="button primary" disabled={action.pending}>Reply</button>
              <button className="button quiet" type="button" onClick={() => setReply(null)}>Cancel</button></div>
          </form>}
        </li>)}
      </ul>
    </section>
  );
}

function WatchItem({ type, id }) {
  const auth = usePage().props;
  const page = usePage();
  const target = { type, id };
  const data = useResource(`watch:${type}:${id}:${viewKey(page)}`,
    signal => live('catalog:details', target, `/details/${type}/${id}`, { signal }), ['catalog:changed']);
  const clip = data.data;
  if (!clip) return data.error ? <ErrorText error={data.error} retry={data.refresh} /> : <Waiting />;
  const series = type === 'series';
  return (
    <article className="watch stack">
      <Link className="back" to="/">Browse</Link>
      {series && clip.poster && <img className="show-art" alt="" src={clip.poster} />}
      <div className="stack">
        <p className="meta">{series ? clip.random_order ? 'Series · Randomly Assembled (RA)' : 'Series · In date order' : clip.category}</p>
        <h1>{clip.title}</h1>
        <p className="description">{clip.description}</p>
        {!series && <p className="muted">{formatDate(clip.published_at)}{clip.duration ? ` · ${Math.ceil(clip.duration / 60)} min` : ''}</p>}
      </div>
      <ErrorText error={data.error} retry={data.refresh} />
      {clip.locked && <div className="panel stack">
        <p>Watchers can play this {type}.</p>
        <Link className="button primary" to={auth.id ? '/plans' : '/join'}>{auth.id ? 'See plans' : 'Join to watch'}</Link>
      </div>}
      {!series && !clip.locked && <Player clip={clip} />}
      {!series && clip.series_id && <Link to={`/series/${clip.series_id}`}>See the series</Link>}
      {series && <section className="stack"><h2>Clips</h2>
        {clip.items.length ? <ul className="cards">{clip.items.map(item => <li key={item.id}><Card item={item} /></li>)}</ul>
          : <p className="muted">No clips yet.</p>}
      </section>}
      {auth.canWatch && !clip.locked && <SaveToList target={target} />}
      {!clip.locked && <Thread key={viewKey(page)} target={target} />}
    </article>
  );
}

export function Watch() {
  const { type, id } = useParams();
  if (!['clip', 'series'].includes(type)) return <p className="status">Page not found.</p>;
  return <WatchItem key={type + ':' + id} type={type} id={id} />;
}
