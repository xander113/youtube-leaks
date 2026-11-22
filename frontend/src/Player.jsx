import { useEffect, useRef, useState } from 'react';
import { usePage } from '@/Grabs';

function clock(value) {
  const seconds = Math.floor(value || 0);
  const hour = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hour ? hour + ':' : ''}${hour ? String(minutes).padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function Control({ label, symbol, ...props }) {
  return <button type="button" aria-label={label} title={label} className="player-button" {...props}>{symbol}</button>;
}

export default function Player({ clip, startPlaying }) {
  const page = usePage();
  const auth = usePage().props;
  const premium = page.paid && auth.tier === 'premium';
  const high = premium || auth.role === 'admin';
  const [wanted, setWanted] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [controls, setControls] = useState(true);
  const [failed, setFailed] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [reload, setReload] = useState(0);
  const player = useRef(null);
  const frame = useRef(null);
  const timer = useRef(null);
  const resume = useRef({ time: 0, play: startPlaying });
  const quality = (wanted === 'high' && high) || (wanted === 'hd' && auth.canWatch) || wanted === 'guest'
    ? wanted : auth.canWatch ? 'hd' : 'guest';

  useEffect(() => () => clearTimeout(timer.current), []);

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
    wake();
  }

  function shift(seconds) {
    seek((player.current?.currentTime || 0) + seconds);
  }

  function playPause() {
    if (!player.current) return;
    if (player.current.paused) player.current.play().catch(() => setControls(true));
    else player.current.pause();
    wake();
  }

  function mute() {
    if (!player.current) return;
    player.current.muted = !player.current.muted;
    wake();
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (frame.current?.requestFullscreen) await frame.current.requestFullscreen();
      else player.current?.webkitEnterFullscreen?.();
    } catch {
      player.current?.webkitEnterFullscreen?.();
    }
  }

  function remember() {
    const element = player.current;
    resume.current = { time: element?.currentTime || position, play: Boolean(element && !element.paused) };
  }

  return (
    <section className="cinema" ref={frame} tabIndex={0} aria-label="Video player"
      data-controls={controls || !playing || failed} onPointerMove={wake}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const keys = { ' ': playPause, k: playPause, ArrowLeft: () => shift(-10), ArrowRight: () => shift(10), m: mute, f: fullscreen };
        const action = keys[event.key];
        if (action) { event.preventDefault(); action(); }
      }}>
      <video key={quality + ':' + reload} ref={player} className="player" playsInline
        src={`/api/media/${clip.id}/${quality}`} poster={clip.poster} preload={premium ? 'auto' : 'metadata'}
        onError={() => { setFailed(true); setBuffering(false); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => { setBuffering(false); setPlaying(true); wake(); }}
        onPause={() => { setPlaying(false); setControls(true); }}
        onEnded={() => { setPlaying(false); setControls(true); }}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }}
        onLoadedMetadata={event => {
          const element = event.currentTarget;
          if (Number.isFinite(element.duration)) {
            setDuration(element.duration);
            element.currentTime = Math.min(resume.current.time, element.duration);
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
        {!playing && !failed && <span aria-hidden="true" className="player-big-play"><span className="play-mark" /></span>}
      </button>
      {buffering && playing && <span className="player-wait" role="status">Loading video…</span>}
      {failed && <div className="player-error">
        <p role="alert">The video could not load.</p>
        <button className="button primary small" onClick={() => { remember(); setFailed(false); setReload(value => value + 1); }}>Retry</button>
      </div>}
      <div className="player-title">{clip.title}</div>
      <div className="player-tools">
        <input type="range" className="player-seek" aria-label="Seek" aria-valuetext={clock(position)} min="0" max={duration || 0}
          step="0.1" value={position} disabled={!duration} onChange={event => seek(Number(event.target.value))} />
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
              setFailed(false);
              setWanted(event.target.value);
            }}>
              <option value="guest">SD</option><option value="hd">HD</option>{high && <option value="high">High</option>}
            </select>}
            <Control label="Toggle fullscreen" symbol="⛶" onClick={fullscreen} />
          </div>
        </div>
      </div>
    </section>
  );
}
