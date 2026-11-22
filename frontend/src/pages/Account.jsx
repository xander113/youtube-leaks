import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ErrorText, formValues, useAction, usePage } from '@/Grabs';

export function SignIn({ mode }) {
  const page = usePage();
  const auth = usePage().props;
  const action = useAction();
  const navigate = useNavigate();
  const joining = mode === 'register';
  function submit(event) {
    const body = Object.fromEntries(formValues(event));
    action.run(async () => {
      await api('/auth/' + mode, { method: 'POST', body });
      page.resetSession();
      navigate(joining && page.paid ? '/plans' : '/');
    });
  }
  return (
    <section className="stack narrow">
      <h1>{joining ? 'Join' : 'Sign in'}</h1>
      {auth.id ? <p>You are signed in as {auth.name}. <Link to="/">Browse clips</Link></p> : <>
        {joining && <p>{page.paid ? 'Make an account, then pick a plan to watch.' : 'Make a free account to watch all clips.'}</p>}
        <form key={mode} className="stack panel" onSubmit={submit}>
          {joining && <label>Name<input name="name" autoComplete="nickname" maxLength={48} required /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <label>Password<input name="password" type="password" autoComplete={joining ? 'new-password' : 'current-password'}
            minLength={joining ? 12 : 1} maxLength={128} required /></label>
          {joining && <p className="muted">Use at least 12 characters.</p>}
          <ErrorText error={action.error} />
          <button className="button primary" disabled={action.pending}>{joining ? 'Make an account' : 'Sign in'}</button>
        </form>
        <Link to={joining ? '/signin' : '/join'}>{joining ? 'I have an account' : 'Make an account'}</Link>
      </>}
    </section>
  );
}

const offers = [
  { id: 'basic', name: 'Basic', monthly: '$2.99', yearly: '$35.88', features: ['HD video', 'Playlists', 'Comments'] },
  { id: 'premium', name: 'Premium', monthly: '$4.99', yearly: '$59.88', features: ['Highest video quality', 'Video loads ahead', 'Priority help', 'Playlists and comments'] }
];

export function Plans() {
  const page = usePage();
  const auth = usePage().props;
  const refresh = page.refresh;
  const [query] = useSearchParams();
  const [yearly, setYearly] = useState(false);
  const action = useAction();
  const pendingCheckout = query.get('checkout') === 'done' && !auth.tier;
  useEffect(() => {
    if (!pendingCheckout) return;
    const id = setInterval(refresh, 3000);
    const timeout = setTimeout(() => clearInterval(id), 60000);
    return () => { clearInterval(id); clearTimeout(timeout); };
  }, [pendingCheckout, refresh]);

  function billing(path, body) {
    action.run(async () => {
      const { url } = await api('/billing/' + path, { method: 'POST', body });
      window.location.assign(url);
    });
  }

  return (
    <section className="stack">
      <h1>Plans</h1>
      {!page.paid && <p>Watching is free right now. <Link to={auth.id ? '/' : '/join'}>{auth.id ? 'Browse clips' : 'Join for free'}</Link></p>}
      {auth.tier && page.paid && <p>Your plan is <strong className="capitalize">{auth.tier}</strong>.</p>}
      {pendingCheckout && <p role="status">Waiting for Stripe to confirm your plan.</p>}
      {query.get('checkout') === 'done' && auth.tier && <Link className="button primary" to="/">Start watching</Link>}
      <ErrorText error={action.error} />
      {page.billingAvailable && auth.hasBilling && <button className="button quiet" disabled={action.pending} onClick={() => billing('portal')}>Manage plan</button>}
      {page.paid && <>
        <label className="check"><input type="checkbox" checked={yearly} onChange={event => setYearly(event.target.checked)} /> Pay yearly</label>
        <div className="plan-grid">
          {offers.map(plan => <article className="panel stack plan" key={plan.id}>
            <h2>{plan.name}</h2>
            <p className="price">{yearly ? plan.yearly : plan.monthly} <span>USD / {yearly ? 'year' : 'month'}</span></p>
            <ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
            {!auth.id ? <Link className="button primary" to="/join">Join to pick a plan</Link>
              : auth.role === 'watcher' && !auth.tier && <button className="button primary"
                disabled={!page.billingAvailable || action.pending} onClick={() => billing('checkout', { plan: plan.id, cycle: yearly ? 'yearly' : 'monthly' })}>
                Choose {plan.name}
              </button>}
          </article>)}
        </div>
      </>}
    </section>
  );
}
