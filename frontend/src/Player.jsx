import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { playbackPath, usePage } from '@/Grabs';
import { progressKey, readProgress, saveProgress } from '@/WatchProgress';
import { useProtectedStream } from '@/ProtectedStream';

function clock(value) {
  const seconds = Math.floor(value || 0);
  const hour = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hour ? hour + ':' : ''}${hour ? String(minutes).padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function Control({ label, symbol, ...props }) {
  return <button type="button" aria-label={label} title={label} className="player-button" {...props}>{symbol}</button>;
}

export default function Player({ clip, startPlaying, restart, next }) {
  const page = usePage();
  const auth = usePage().props;
  const premium = page.paid && auth.tier === 'premium';
  const high = premium || auth.role === 'admin';
  const location = useLocation();
  const storageKey = progressKey(auth.id);
  const [saved] = useState(() => readProgress(storageKey).find(entry => entry.id === clip.id));
  const [ended, setEnded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fullscreenActive = nativeFullscreen || expanded;
  const [wanted, setWanted] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [controls, setControls] = useState(true);
  const [failed, setFailed] = useState('');
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [reload, setReload] = useState(0);
  const player = useRef(null);
  const frame = useRef(null);
  const timer = useRef(null);
  const fullButton = useRef(null);
  const resume = useRef({ time: restart ? 0 : saved?.time || 0, play: startPlaying });
  const watch = useRef({ time: 0, duration: 0, tracking: false, lastWrite: 0 });
  const quality = (wanted === 'high' && high) || (wanted === 'hd' && auth.canWatch) || wanted === 'guest'
    ? wanted : auth.canWatch ? 'hd' : 'guest';

  useProtectedStream(player, clip.id, quality, reload, {
    onOpen() { setBuffering(true); },
    onRenew() { remember(); setBuffering(true); },
    onFailure(error) {
      setFailed(error.message || 'The video could not load.');
      setBuffering(false);
      setPlaying(false);
      setControls(true);
    }
  });

  useEffect(() => {
    function syncFullscreen() {
      setNativeFullscreen(document.fullscreenElement === frame.current);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setExpanded(false);
        fullButton.current?.focus();
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [expanded]);

  useEffect(() => {
    const checkpoint = watch.current;
    function flush() {
      if (checkpoint.tracking) saveProgress(storageKey, clip.id, checkpoint.time, checkpoint.duration);
    }
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [storageKey, clip.id]);

  function checkpoint(element, force = false) {
    const progress = watch.current;
    progress.time = element.currentTime;
    progress.duration = element.duration;
    const intervalElapsed = Math.abs(progress.time - progress.lastWrite) >= 2;
    if (progress.tracking && (force || intervalElapsed)) {
      saveProgress(storageKey, clip.id, progress.time, progress.duration);
      progress.lastWrite = progress.time;
    }
  }

  function wake() {
    clearTimeout(timer.current);
    setControls(true);
    if (!player.current?.paused) timer.current = setTimeout(() => setControls(false), 3000);
  }

  function seek(value) {
    const element = player.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.min(Math.max(value, 0), element.duration);
    setPosition(element.currentTime);
    setEnded(false);
    if (watch.current.tracking) checkpoint(element, true);
    wake();
  }

  function shift(seconds) {
    seek((player.current?.currentTime || 0) + seconds);
  }

  function playPause() {
    if (!player.current) return;
    if (player.current.paused) {
      resume.current.play = true;
      setEnded(false);
      if (player.current.readyState >= 1) player.current.play().catch(() => setControls(true));
    } else {
      resume.current.play = false;
      player.current.pause();
    }
    wake();
  }

  function mute() {
    if (!player.current) return;
    player.current.muted = !player.current.muted;
    wake();
  }

  async function fullscreen() {
    wake();
    if (expanded) {
      setExpanded(false);
      fullButton.current?.focus();
      return;
    }
    if (document.fullscreenElement === frame.current) {
      await document.exitFullscreen().catch(() => {});
      fullButton.current?.focus();
      return;
    }
    try {
      if (!frame.current?.requestFullscreen) throw new Error('Fullscreen is unavailable.');
      await frame.current.requestFullscreen();
    } catch {
      setExpanded(true);
    }
  }

  function remember() {
    const element = player.current;
    if (!element) return;
    resume.current = {
      time: element.readyState >= 1 ? element.currentTime : watch.current.time || position,
      play: !element.paused || (element.readyState < 1 && resume.current.play)
    };
  }

  return (
    <section className="cinema" ref={frame} tabIndex={0} aria-label="Video player"
      data-controls={controls || !playing || Boolean(failed)} data-fullscreen={fullscreenActive} data-expanded={expanded}
      onPointerMove={wake} onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (expanded && event.key === 'Tab') {
          const stops = event.currentTarget.querySelectorAll(
            'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled])'
          );
          const target = event.shiftKey ? stops[0] : stops[stops.length - 1];
          if (event.target === target) {
            event.preventDefault();
            (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
          }
        }
        if (event.target !== event.currentTarget) return;
        const keys = { ' ': playPause, k: playPause, ArrowLeft: () => shift(-10), ArrowRight: () => shift(10), m: mute, f: fullscreen };
        const action = keys[event.key];
        if (action) { event.preventDefault(); action(); }
      }}>
      <video ref={player} className="player" playsInline controlsList="nodownload noremoteplayback"
        disablePictureInPicture disableRemotePlayback poster={clip.poster} preload={premium ? 'auto' : 'metadata'}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => {
          watch.current.tracking = true;
          setEnded(false);
          setBuffering(false);
          setPlaying(true);
          wake();
        }}
        onPause={event => { checkpoint(event.currentTarget, true); setPlaying(false); setControls(true); }}
        onEnded={event => { checkpoint(event.currentTarget, true); setEnded(true); setPlaying(false); setControls(true); }}
        onTimeUpdate={event => {
          setPosition(event.currentTarget.currentTime);
          checkpoint(event.currentTarget);
        }}
        onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }}
        onLoadedMetadata={event => {
          setBuffering(false);
          const element = event.currentTarget;
          if (Number.isFinite(element.duration)) {
            setDuration(element.duration);
            const at = resume.current.time;
            if (at && at < element.duration) element.currentTime = at;
          }
          element.volume = volume;
          element.muted = muted;
          if (resume.current.play) element.play().catch(() => setControls(true));
        }}>
        Your browser cannot play this video.
      </video>
      <button type="button" tabIndex={-1} className="player-surface" onClick={event => {
        if (playing && !controls && event.nativeEvent.pointerType === 'touch') wake();
        else playPause();
      }} aria-label={playing ? 'Pause video' : 'Play video'}>
        {!playing && !failed && !ended && !buffering && <span aria-hidden="true" className="player-big-play"><span className="play-mark" /></span>}
      </button>
      {ended && !failed && <div className="player-end">
        {next && <div><span className="meta">Up next</span><strong>{next.title}</strong></div>}
        <div className="actions">
          {next && <Link className="button primary small" to={playbackPath(next)} state={location.state} replace>
            <span className="play-mark" aria-hidden="true" />Next clip
          </Link>}
          <button className="button quiet small" type="button" onClick={() => { seek(0); playPause(); }}>Replay</button>
        </div>
      </div>}
      {buffering && !failed && <div className="player-wait" role="status">
        <span className="player-spinner" aria-hidden="true" />Loading video…
      </div>}
      {failed && <div className="player-error">
        <p role="alert">{failed}</p>
        <button className="button primary small" onClick={() => { remember(); setFailed(''); setReload(value => value + 1); }}>Retry</button>
      </div>}
      {fullscreenActive && <div className="player-title">
        <button className="round-control" type="button" onClick={fullscreen} aria-label="Return to clip">‹</button>
        <strong>{clip.title}</strong>
      </div>}
      <div className="player-tools">
        <div className="player-timeline">
          <progress aria-hidden="true" max={duration || 1} value={position} />
          <input type="range" className="player-seek" aria-label="Seek" aria-valuetext={clock(position)} min="0" max={duration || 0}
            step="0.1" value={position} disabled={!duration} onChange={event => seek(Number(event.target.value))} />
        </div>
        <div className="player-actions">
          <Control label={playing ? 'Pause' : 'Play'} symbol={<span className={playing ? 'pause-mark' : 'play-mark'} aria-hidden="true" />} onClick={playPause} />
          <Control label="Back 10 seconds" symbol="−10" onClick={() => shift(-10)} />
          <Control label="Forward 10 seconds" symbol="+10" onClick={() => shift(10)} />
          <div className="player-audio">
            <Control label={muted ? 'Unmute' : 'Mute'} symbol={<span className={'speaker' + (muted || !volume ? ' speaker-muted' : '')} />} onClick={mute} />
            <input type="range" aria-label="Volume" min="0" max="1" step=".05" value={muted ? 0 : volume} onChange={event => {
              if (!player.current) return;
              player.current.muted = false;
              player.current.volume = Number(event.target.value);
              wake();
            }} />
          </div>
          <span className="player-time">{clock(position)} / {clock(duration)}</span>
          <div className="player-extra">
            {auth.canWatch && <select aria-label="Video quality" value={quality} onChange={event => {
              remember();
              setFailed('');
              setWanted(event.target.value);
            }}>
              <option value="guest">SD</option><option value="hd">HD</option>{high && <option value="high">High</option>}
            </select>}
            <Control ref={fullButton} label={fullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen'}
              symbol={<span className="fullscreen-mark" aria-hidden="true" />} onClick={fullscreen} />
          </div>
        </div>
      </div>
    </section>
  );
}
