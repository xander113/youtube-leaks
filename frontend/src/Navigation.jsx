import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ErrorText, useAction, usePage } from '@/Grabs';

export default function Navigation() {
  const page = usePage();
  const auth = usePage().props;
  const action = useAction();
  const navigate = useNavigate();
  return (
    <header className="top">
      <div className="wrap top-inner">
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true" />Youtube <span className="brand-last">Leaks</span></Link>
        <nav aria-label="Main">
          <NavLink to="/" end>Browse</NavLink>
          <NavLink to="/search">Search</NavLink>
          {auth.canWatch && <NavLink to="/library">Playlists</NavLink>}
          {auth.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          {auth.id && <NavLink to="/support">Help</NavLink>}
          {(page.paid || auth.hasBilling) && auth.role !== 'admin' && <NavLink to="/plans">Plans</NavLink>}
        </nav>
        <div className="account-link">
          {auth.id
            ? <button className="button small quiet" disabled={action.pending} onClick={() => action.run(async () => {
              await page.signOut();
              navigate('/');
            })}>Sign out</button>
            : <Link className="button small quiet" to="/signin">Sign in</Link>}
        </div>
        <ErrorText error={action.error} />
      </div>
    </header>
  );
}
