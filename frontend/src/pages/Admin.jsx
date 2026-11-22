import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ErrorText, formatDate, formValues, live, useAction, usePage, useResource, Waiting } from '@/Grabs';
import { Support } from './Library';

function SeriesSelect({ series, value }) {
  return <label>Series<select name="seriesId" defaultValue={value || ''}>
    <option value="">No series</option>
    {series.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
  </select></label>;
}

function ClipFields({ clip, series }) {
  return <>
    <label>Title<input name="title" required maxLength={120} defaultValue={clip?.title} /></label>
    <label>About the clip<textarea name="description" rows="2" required maxLength={1600} defaultValue={clip?.description} /></label>
    <label>Category<input name="category" required maxLength={60} defaultValue={clip?.category} /></label>
    <SeriesSelect series={series} value={clip?.series_id} />
    <label>Clip date<input type="date" name="date" defaultValue={clip && new Date(clip.published_at).toISOString().slice(0, 10)} /></label>
    <label className="check"><input type="checkbox" name="guest" defaultChecked={Boolean(clip?.guest)} /> For guests</label>
  </>;
}

const tabs = [
  ['clips', 'Clips'], ['series', 'Series'], ['feeds', 'RSS feeds'], ['users', 'Watchers'], ['support', 'Help']
];

export function Admin() {
  const page = usePage();
  const auth = usePage().props;
  const [tab, setTab] = useState('clips');
  const [cursor, setCursor] = useState(null);
  const [message, setMessage] = useState('');
  const data = useResource(auth.role === 'admin' && tab !== 'support' ? 'admin:' + tab + ':' + (cursor || 'first') : null,
    signal => live('admin:get', cursor ? { before: cursor } : {}, '/admin' + (cursor ? '?before=' + cursor : ''), { signal }), ['admin:changed']);
  const action = useAction();

  if (auth.role !== 'admin') return <section className="stack"><h1>Admin</h1>
    {auth.id ? <p>This page is for admins.</p> : <Link to="/signin">Sign in</Link>}
  </section>;

  function change(path, method, body, done, form) {
    setMessage('');
    action.run(async () => {
      await api('/admin' + path, { method, body });
      form?.reset();
      if (done) setMessage(done);
      data.refresh();
      if (path === '/mode') page.refresh();
    });
  }

  function submitForm(event, path, type) {
    const form = event.currentTarget;
    const fields = formValues(event);
    const value = Object.fromEntries(fields);
    const guest = fields.has('guest');
    if (type === 'upload') {
      fields.set('guest', String(guest));
      return change(path, 'POST', fields, 'Video is in line to be checked and made ready.', form);
    }
    if (type === 'edit') return change(path, 'PATCH', { ...value, guest, seriesId: value.seriesId || null, date: value.date || undefined }, 'Clip saved.');
    if (type === 'feed') return change(path, 'POST', { ...value, guest, seriesId: value.seriesId || null }, 'Feed added.', form);
    return change(path, 'POST', { ...value, random: fields.has('random') }, 'Series added.', form);
  }

  const info = data.data;
  const paidModeName = auth.mockBilling ? 'Dummy paid' : 'Paid';
  return (
    <section className="stack">
      <h1>Admin</h1>
      {auth.isHead && <div className="panel split">
        <div><strong>Site mode</strong><p className="muted">{page.paid ? paidModeName : 'Free'}</p></div>
        <button className="button quiet" disabled={action.pending || (!page.paid && !page.billingAvailable)} onClick={() => {
          if (window.confirm(page.paid ? (auth.mockBilling ? 'Let every Watcher view clips for free?' : 'Let every Watcher view clips for free? Existing Stripe plans keep billing until canceled.') : auth.mockBilling ? 'Enable dummy payments for developer testing?' : 'Require a plan for Watcher clips?')) {
            change('/mode', 'POST', { paid: !page.paid }, 'Site mode saved.');
          }
        }}>{page.paid ? 'Switch to free' : auth.mockBilling ? 'Switch to dummy paid' : 'Switch to paid'}</button>
        {auth.mockBilling && <p className="muted">Dummy paid mode uses a test card and makes no charges.</p>}
        {!page.billingAvailable && <p className="muted">Set up Stripe to use paid mode.</p>}
      </div>}
      <nav className="actions admin-tabs" aria-label="Admin sections">
        {tabs.map(([value, label]) => <button key={value} className={`button small ${tab === value ? 'primary' : 'quiet'}`}
          aria-pressed={tab === value} onClick={() => { setTab(value); setCursor(null); setMessage(''); }}>{label}</button>)}
      </nav>
      <ErrorText error={data.error || action.error} retry={data.error ? data.refresh : undefined} />
      {message && <p className="status" role="status">{message}</p>}
      {tab === 'support' && <Support admin />}
      {tab !== 'support' && data.pending && !info && <Waiting />}
      {tab === 'clips' && info && <>
        <h2>Add a clip</h2>
        <form className="panel form-grid" onSubmit={event => submitForm(event, '/clips', 'upload')}>
          <ClipFields series={info.series} />
          <label>Video file<input type="file" name="video" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" required /></label>
          <button className="button primary" disabled={action.pending}>Upload clip</button>
        </form>
        <h2>Recent clips</h2>
        {info.clips.length === 0 && <p className="muted">No clips yet.</p>}
        {info.clips.map(clip => <details key={clip.id} className="panel admin-detail">
          <summary><strong>{clip.title}</strong><span className="tag">{clip.status}</span>{Boolean(clip.guest) && <span className="tag">For guests</span>}</summary>
          <div className="stack">
            {clip.status === 'ready' && <Link to={'/clip/' + clip.id}>Open clip</Link>}
            {clip.job_error && <p className="error preserve">{clip.job_error}</p>}
            {clip.status === 'failed' && <div className="actions">
              <button className="button quiet small" disabled={action.pending} onClick={() => change('/clips/' + clip.id + '/retry', 'POST', undefined, 'Clip sent back to the queue.')}>Retry video</button>
              <button className="button quiet small" disabled={action.pending} onClick={() => {
                if (window.confirm('Remove this failed upload?')) change('/clips/' + clip.id, 'DELETE', undefined, 'Failed clip removed.');
              }}>Remove failed clip</button>
            </div>}
            <form key={JSON.stringify(clip)} className="form-grid" onSubmit={event => submitForm(event, '/clips/' + clip.id, 'edit')}>
              <ClipFields clip={clip} series={info.series} />
              <button className="button primary" disabled={action.pending}>Save clip</button>
            </form>
          </div>
        </details>)}
      </>}
      {tab === 'series' && info && <>
        <h2>Add a series</h2>
        <form className="panel form-grid" onSubmit={event => submitForm(event, '/series', 'series')}>
          <label>Title<input name="title" required maxLength={120} /></label>
          <label>Category<input name="category" required maxLength={60} /></label>
          <label>About the series<textarea name="description" rows="2" required maxLength={1600} /></label>
          <label className="check"><input type="checkbox" name="random" /> Randomly Assembled (RA)</label>
          <button className="button primary" disabled={action.pending}>Add series</button>
        </form>
        {info.series.length > 0 && <ul className="lines panel">{info.series.map(show => <li className="split" key={show.id}>
          <Link to={'/series/' + show.id}>{show.title}</Link>
          <span className="tag">{show.random_order ? 'RA' : 'In date order'}</span>
        </li>)}</ul>}
      </>}
      {tab === 'feeds' && info && <>
        <h2>Add an RSS feed</h2>
        <form className="panel form-grid" onSubmit={event => submitForm(event, '/feeds', 'feed')}>
          <label>HTTPS feed URL<input name="url" type="url" required maxLength={2000} /></label>
          <label>Category<input name="category" required maxLength={60} /></label>
          <SeriesSelect series={info.series} />
          <label className="check"><input type="checkbox" name="guest" /> For guests</label>
          <button className="button primary" disabled={action.pending}>Add feed</button>
        </form>
        {info.feeds.map(feed => <article className="panel stack" key={feed.id}>
          <strong className="preserve">{feed.url}</strong>
          <span className="muted">{feed.category} · {feed.enabled ? 'On' : 'Paused'} · {feed.last_run ? `Last checked ${formatDate(feed.last_run)}` : 'Waiting to check'}</span>
          {feed.last_error && <p className="error preserve">{feed.last_error}</p>}
          <div className="actions">
            <button className="button quiet small" disabled={action.pending} onClick={() =>
              change('/feeds/' + feed.id, 'PATCH', { enabled: !feed.enabled, run: !feed.enabled }, feed.enabled ? 'Feed paused.' : 'Feed is on.')}>{feed.enabled ? 'Pause' : 'Turn on'}</button>
            {Boolean(feed.enabled) && <button className="button quiet small" disabled={action.pending} onClick={() =>
              change('/feeds/' + feed.id, 'PATCH', { run: true }, 'Feed will check soon.')}>Check now</button>}
          </div>
        </article>)}
      </>}
      {tab === 'users' && info && <>
        <h2>Watchers</h2>
        {info.users.length === 0 && <p className="muted">No more accounts.</p>}
        <ul className="lines panel">{info.users.map(user => <li className="split" key={user.id}>
          <div className="preserve"><strong>{user.name}</strong> <span className="tag">{user.role === 'admin' ? 'Admin' : user.banned_at ? 'Banned' : user.plan || (user.paid_override === 'unpaid' ? 'Unpaid' : 'Watcher')}</span>
            <p className="muted">{user.email}</p>
          </div>
          {user.role === 'watcher' && <div className="watcher-controls">
            <form className="inline" key={user.id + ':' + user.paid_override} onSubmit={event => {
              const access = formValues(event).get('access');
              change('/watchers/' + user.id + '/payment', 'PATCH', { access }, 'Payment access saved.');
            }}>
              <label>Payment access<select name="access" defaultValue={user.paid_override || 'automatic'}>
                <option value="automatic">Use subscription</option>
                <option value="unpaid">Unpaid</option>
                <option value="basic">Paid · Basic</option>
                <option value="premium">Paid · Premium</option>
              </select></label>
              <button className="button quiet small" disabled={action.pending}>Save access</button>
            </form>
            <button className="button quiet small" disabled={action.pending} onClick={() => {
            if (user.banned_at || window.confirm('Ban this Watcher?')) change('/watchers/' + user.id + '/ban', 'POST', { banned: !user.banned_at }, user.banned_at ? 'Watcher unbanned.' : 'Watcher banned.');
          }}>{user.banned_at ? 'Unban' : 'Ban'}</button></div>}
        </li>)}</ul>
        <div className="actions">
          {cursor && <button className="button quiet" onClick={() => setCursor(null)}>Newest accounts</button>}
          {info.nextUser && <button className="button quiet" onClick={() => setCursor(info.nextUser)}>Older accounts</button>}
        </div>
      </>}
    </section>
  );
}
