import { Link } from 'react-router-dom';
import { api, ErrorText, formatDate, formValues, itemPath, live, useAction, usePage, useResource, viewKey, Waiting } from '@/Grabs';

export function Library() {
  const page = usePage();
  const auth = usePage().props;
  const lists = useResource(auth.canWatch ? 'playlists:' + viewKey(page) : null,
    signal => live('playlists:list', true, '/playlists', { signal }), ['playlists:changed']);
  const action = useAction();

  function create(event) {
    const form = event.currentTarget;
    const title = formValues(event).get('title');
    action.run(async () => { await api('/playlists', { method: 'POST', body: { title } }); form.reset(); lists.refresh(); });
  }
  function remove(path) {
    action.run(async () => { await api('/playlists/' + path, { method: 'DELETE' }); lists.refresh(); });
  }

  return (
    <section className="stack">
      <h1>Playlists</h1>
      {!auth.canWatch ? <Link to={auth.id ? '/plans' : '/signin'}>{auth.id ? 'Choose a plan' : 'Sign in to see your playlists'}</Link> : <>
        <form className="inline panel" onSubmit={create}>
          <label className="grow">New playlist<input name="title" required maxLength={80} /></label>
          <button className="button primary" disabled={action.pending}>Make playlist</button>
        </form>
        <ErrorText error={lists.error || action.error} retry={lists.error ? lists.refresh : undefined} />
        {lists.pending && !lists.data && <Waiting />}
        {lists.data?.length === 0 && <p className="muted">You have no playlists yet.</p>}
        {lists.data?.map(list => <article className="panel stack" key={list.id}>
          <div className="split"><h2>{list.title}</h2>
            <button className="button quiet small" disabled={action.pending} onClick={() => {
              if (window.confirm('Delete this playlist?')) remove(list.id);
            }}>Delete playlist</button>
          </div>
          {list.items.length ? <ul className="lines">{list.items.map(item => <li className="split" key={item.kind + item.id}>
            <Link to={itemPath(item)}>{item.title}</Link>
            <button className="button quiet small" disabled={action.pending} aria-label={`Remove ${item.title}`}
              onClick={() => remove(`${list.id}/items/${item.kind}/${item.id}`)}>Remove</button>
          </li>)}</ul> : <p className="muted">Open a clip or series to save it here.</p>}
        </article>)}
      </>}
    </section>
  );
}

export function Support({ admin = false }) {
  const auth = usePage().props;
  const page = usePage();
  const data = useResource(auth.id ? 'support:' + viewKey(page) : null,
    signal => live('support:list', null, '/support', { signal }), ['support:changed']);
  const action = useAction();

  function send(event, id) {
    const form = event.currentTarget;
    const message = formValues(event).get('message');
    action.run(async () => {
      await api(id ? '/admin/support/' + id : '/support', { method: 'POST', body: { message } });
      form.reset();
      data.refresh();
    });
  }

  return (
    <section className="stack">
      {admin ? <h2>Help inbox</h2> : <h1>Help</h1>}
      {!auth.id && <Link to="/signin">Sign in to ask for help</Link>}
      {auth.id && auth.role !== 'admin' && <form className="stack panel" onSubmit={event => send(event)}>
        <label>Tell us what you need<textarea name="message" rows="3" maxLength={2000} required /></label>
        <button className="button primary" disabled={action.pending}>Send message</button>
      </form>}
      <ErrorText error={data.error || action.error} retry={data.error ? data.refresh : undefined} />
      {data.pending && !data.data && <Waiting />}
      {data.data?.length === 0 && <p className="muted">No messages yet.</p>}
      {data.data?.map(request => <article className="stack panel" key={request.id}>
        <div className="comment-meta"><strong>{request.name || 'Your message'}</strong>{Boolean(request.priority) && <span className="tag">Priority</span>}<span>{formatDate(request.created_at)}</span></div>
        <p className="preserve">{request.body}</p>
        {request.answer && <p className="preserve"><strong>Reply</strong> {request.answer}</p>}
        {auth.role === 'admin' && !request.answer && <form className="stack" onSubmit={event => send(event, request.id)}>
          <label>Reply<textarea name="message" rows="2" maxLength={2000} required /></label>
          <button className="button quiet" disabled={action.pending}>Send reply</button>
        </form>}
      </article>)}
    </section>
  );
}
