import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Card } from './Browse';
import Player from '@/Player';
import { api, ErrorText, formatDate, formValues, live, socket, useAction, usePage, useResource, viewKey, Waiting } from '@/Grabs';

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
    const initials = row.name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
    const shade = (initials.codePointAt(0) || 0) % 4;
    return <div className="comment-item">
      <span aria-hidden="true" className={`avatar avatar-${shade}`}>{initials}</span>
      <div className="comment-content">
        <div className="comment-body">
          <div className="comment-meta"><strong>{row.name}</strong>{row.badge && <span className="tag">{row.badge}</span>}</div>
          <p>{row.body}</p>
        </div>
        <div className="comment-actions">
          <span className="comment-date">{formatDate(row.created_at)}</span>
          {auth.canWatch ? <button type="button" className="comment-like" aria-label={row.liked ? `Unlike comment. ${row.likes} likes` : `Like comment. ${row.likes} likes`} aria-pressed={row.liked} disabled={action.pending}
            onClick={() => action.run(async () => {
              await api(`/comments/${row.id}/like`, { method: 'PATCH', body: { liked: !row.liked } });
              list.refresh();
            })}><span aria-hidden="true">{row.liked ? '♥' : '♡'}</span> {row.likes || 'Like'}</button> :
            row.likes > 0 && <span className="comment-like"><span aria-hidden="true">♡</span> {row.likes}</span>}
          {root && auth.canWatch && <button type="button" className="text-button" onClick={() => setReply(row)}>Reply</button>}
          {row.canDelete && <button type="button" className="text-button" disabled={action.pending} onClick={() => remove(row.id)}>Remove</button>}
        </div>
      </div>
    </div>;
  }

  return (
    <section className="stack comments">
      <h2>Comments{list.data?.length > 0 && <span className="thread-count">{list.data.length}</span>}</h2>
      <ErrorText error={list.error || action.error} retry={list.error ? list.refresh : undefined} />
      {auth.canWatch && !reply && <form onSubmit={post} className="stack panel comment-composer">
        <label>Add a comment<textarea name="body" rows="2" maxLength={500} required /></label>
        <button className="button primary" disabled={action.pending}>Post</button>
      </form>}
      {!auth.id && <p className="muted"><Link to="/signin">Sign in</Link> to comment.</p>}
      {list.pending && !list.data && <Waiting />}
      {list.data?.length === 0 && <p className="muted">Be the first to comment.</p>}
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
  const [query] = useSearchParams();
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
      {!series && !clip.locked && <Player clip={clip} startPlaying={query.get('play') === '1'} />}
      <div className="stack watch-heading">
        <p className="meta">{series ? clip.random_order ? 'Series · Randomly Assembled (RA)' : 'Series · In date order' : clip.category}</p>
        <h1>{clip.title}</h1>
        <p className="description">{clip.description}</p>
        {!series && <p className="muted">{formatDate(clip.published_at)}{clip.duration ? ` · ${clip.duration < 60 ? clip.duration + ' sec' : Math.ceil(clip.duration / 60) + ' min'}` : ''}</p>}
      </div>
      <ErrorText error={data.error} retry={data.refresh} />
      {clip.locked && <div className="panel stack">
        <p>Watchers can play this {type}.</p>
        <Link className="button primary" to={auth.id ? '/plans' : '/join'}>{auth.id ? 'See plans' : 'Join to watch'}</Link>
      </div>}
      {Boolean(clip.demo) && <p className="muted">Sample clip with original preview art.
        {clip.source_url && <> <a href={clip.source_url} target="_blank" rel="noreferrer">Read or watch the source</a>.</>}
      </p>}
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
