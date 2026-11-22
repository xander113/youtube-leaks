import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export function useRouteScroll(ready) {
  const main = useRef(null);
  const positions = useRef(new Map());
  const { key, pathname } = useLocation();
  const navigation = useNavigationType();
  const lastPath = useRef(null);

  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    if (!ready || !main.current) return;
    const restore = navigation === 'POP' ? positions.current.get(key) || 0 : 0;
    const changedPage = lastPath.current !== pathname;
    lastPath.current = pathname;
    if (changedPage || navigation === 'POP') window.scrollTo({ top: 0, behavior: 'instant' });

    let pending = restore > 0;
    const observer = new ResizeObserver(() => {
      if (!pending || document.documentElement.scrollHeight - window.innerHeight < restore) return;
      stop();
      window.scrollTo({ top: restore, behavior: 'instant' });
    });
    function stop() {
      pending = false;
      observer.disconnect();
    }
    function record() {
      if (pending) return;
      if (positions.current.size >= 40 && !positions.current.has(key)) positions.current.delete(positions.current.keys().next().value);
      positions.current.set(key, window.scrollY);
    }
    let timeout;
    if (pending) {
      observer.observe(main.current);
      timeout = setTimeout(() => {
        if (!pending) return;
        stop();
        window.scrollTo({ top: restore, behavior: 'instant' });
      }, 1600);
    } else record();

    window.addEventListener('scroll', record, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    return () => {
      stop();
      clearTimeout(timeout);
      window.removeEventListener('scroll', record);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
    };
  }, [key, pathname, navigation, ready]);

  return main;
}
