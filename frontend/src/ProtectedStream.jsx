import { useEffect, useRef } from 'react';
import { api } from '@/Grabs';

const manifestType = 'application/vnd.apple.mpegurl';

export function useProtectedStream(player, id, quality, reload, handlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const video = player.current;
    if (!video) return;
    const abort = new AbortController();
    const native = Boolean(video.canPlayType(manifestType));
    let hls;
    let renewing = false;
    let renewed = false;
    let active = false;
    let timer;

    function detach() {
      active = false;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute('src');
      video.load();
    }

    function fail(error) {
      if (abort.signal.aborted) return;
      detach();
      latest.current.onFailure(error);
    }

    function recover(message) {
      if (abort.signal.aborted || !active || renewing) return;
      if (renewed) {
        fail(new Error(message));
        return;
      }
      renewed = true;
      renewing = true;
      latest.current.onRenew();
      detach();
      void start();
    }

    function mediaError() {
      if (native) recover('The video stream was interrupted.');
    }

    async function start(retries = 0) {
      try {
        const { manifest } = await api(`/playback/${id}/${quality}`, { method: 'POST', signal: abort.signal });
        if (abort.signal.aborted) return;
        if (native) {
          active = true;
          renewing = false;
          video.src = manifest;
          return;
        }

        const { default: Hls } = await import('hls.js/light');
        if (abort.signal.aborted) return;
        if (!Hls.isSupported()) {
          fail(new Error('This browser cannot play protected video. Try a current browser.'));
          return;
        }
        hls = new Hls({ maxBufferLength: 18, maxMaxBufferLength: 36, maxBufferSize: 8_000_000, backBufferLength: 18 });
        hls.on(Hls.Events.ERROR, (_event, error) => {
          if (!error.fatal || abort.signal.aborted) return;
          if (error.type === Hls.ErrorTypes.NETWORK_ERROR) recover('The video stream was interrupted.');
          else fail(new Error('The video could not be decoded.'));
        });
        active = true;
        renewing = false;
        hls.loadSource(manifest);
        hls.attachMedia(video);
      } catch (error) {
        if (abort.signal.aborted) return;
        if (error.status === 409 && retries < 7) {
          timer = setTimeout(() => void start(retries + 1), 2000);
          return;
        }
        fail(error);
      }
    }

    video.addEventListener('error', mediaError);
    latest.current.onOpen();
    void start();
    return () => {
      abort.abort();
      clearTimeout(timer);
      video.removeEventListener('error', mediaError);
      detach();
    };
  }, [player, id, quality, reload]);
}
