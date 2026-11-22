import { useCallback, useEffect, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { api, ErrorText, live, PageContext, socket, useResource, Waiting } from '@/Grabs';
import Navigation from '@/Navigation';
import PreviewProvider from '@/Preview';
import { useRouteScroll } from '@/RouteScroll';

export default function Layout() {
  const { pathname } = useLocation();
  const viewer = useResource('viewer', signal => live('viewer:get', null, '/viewer', { signal }), ['access:changed']);

  useEffect(() => {
    socket.connect();
    return () => { socket.disconnect(); };
  }, []);

  const main = useRouteScroll(Boolean(viewer.data));

  const refresh = viewer.refresh;
  const resetSession = useCallback(() => {
    socket.disconnect();
    socket.connect();
    refresh();
  }, [refresh]);

  useEffect(() => {
    const resetAfterKick = reason => {
      if (reason === 'io server disconnect') resetSession();
    };
    const onFocus = () => refresh();
    socket.on('disconnect', resetAfterKick);
    window.addEventListener('focus', onFocus);
    return () => {
      socket.off('disconnect', resetAfterKick);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, resetSession]);

  const page = useMemo(() => viewer.data && {
    props: viewer.data.auth, paid: viewer.data.paid, billingAvailable: viewer.data.billingAvailable,
    refresh, resetSession,
    signOut: async () => { await api('/auth/logout', { method: 'POST' }); resetSession(); }
  }, [viewer.data, refresh, resetSession]);

  if (!page) return <main className="wrap">{viewer.error
    ? <ErrorText error={viewer.error} retry={viewer.refresh} /> : <Waiting />}</main>;

  return (
    <PageContext.Provider value={page}>
      <PreviewProvider>
        <a className="skip" href="#content">Skip to content</a>
        <Navigation />
        <main id="content" className={pathname === '/' ? 'browse-main' : 'wrap'} ref={main}>
          <ErrorText error={viewer.error} retry={viewer.refresh} />
          <div key={pathname} className="route-scene"><Outlet /></div>
        </main>
        <footer className="wrap footer">Youtube Leaks</footer>
      </PreviewProvider>
    </PageContext.Provider>
  );
}
