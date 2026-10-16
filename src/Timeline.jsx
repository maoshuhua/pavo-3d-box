import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const format = (value) => {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

// Layout, tick spacing and pointer/keyboard behavior follow libtv's AV component.
export default function Timeline({
  time,
  duration,
  playing,
  rate,
  onRate,
  onPlay,
  onSeek,
  onScrub,
  mode = "photo",
  shots = [],
  onSelectShot,
  onTrimShot,
}) {
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(1600);
  const [rateMenu, setRateMenu] = useState(false);
  const scroll = useRef(null);
  const track = useRef(null);
  const pointer = useRef(null);
  const trim = useRef(null);
  const safeDuration = Math.max(1, duration);
  const progress = (time / safeDuration) * 100;
  const targetStep =
    safeDuration / Math.max(1, Math.floor((width * zoom) / 120));
  const step =
    STEPS.find((value) => value >= targetStep) ??
    300 * Math.ceil(targetStep / 300);
  const ticks = Array.from(
    { length: Math.floor((safeDuration / step) * 4) + 1 },
    (_, index) => ({
      time: Number(((index * step) / 4).toFixed(3)),
      major: index % 4 === 0,
    }),
  );
  useLayoutEffect(() => {
    const element = scroll.current;
    const update = () => setWidth(element.clientWidth || 1600);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (pointer.current !== null) onScrub(false);
    };
  }, [onScrub]);
  const seekPointer = (event) => {
    const rect = track.current.getBoundingClientRect();
    onSeek(
      Math.min(
        duration,
        Math.max(0, (event.clientX - rect.left) / rect.width) * safeDuration,
      ),
    );
  };
  const release = (event) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    onScrub(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      className="timeline"
      data-preview-timeline-cn
      data-mode={mode}
      onKeyDown={(event) => {
        if (
          [" ", "Enter"].includes(event.key) &&
          event.target.closest('button, [role="menuitem"]')
        )
          event.stopPropagation();
      }}
    >
      <div className="transport">
        <div className="transport-buttons">
          <button
            type="button"
            className="play"
            aria-label={playing ? "暂停" : "播放"}
            aria-pressed={playing}
            onClick={onPlay}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              {playing ? (
                <path d="M4 3h3v10H4zm5 0h3v10H9z" />
              ) : (
                <path
                  d="M2.61.28A1.69 1.69 0 0 0 0 1.69v5.6A1.69 1.69 0 0 0 2.61 8.7L6.9 5.9a1.7 1.7 0 0 0 0-2.82z"
                  transform="translate(5.1712 3.5088)"
                />
              )}
            </svg>
          </button>
          <div className="rate-anchor">
            <button
              className="speed"
              aria-label="播放速度"
              aria-expanded={rateMenu}
              onClick={() => setRateMenu((open) => !open)}
            >
              {rate}x
            </button>
            {rateMenu &&
              createPortal(
                <>
                  <button
                    className="rate-backdrop"
                    aria-label="关闭播放速度菜单"
                    onClick={() => setRateMenu(false)}
                  />
                  <div
                    className="rate-menu"
                    role="menu"
                    aria-label="播放速度"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRateMenu(false);
                    }}
                  >
                    {RATES.map((value) => (
                      <button
                        role="menuitem"
                        key={value}
                        aria-current={value === rate ? "true" : undefined}
                        onClick={() => {
                          onRate(value);
                          setRateMenu(false);
                        }}
                      >
                        {value}x
                      </button>
                    ))}
                  </div>
                </>,
                document.body,
              )}
          </div>
        </div>
        <span className="time">
          {format(time)} / {format(duration)}
        </span>
        <label className="zoom">
          <input
            type="range"
            aria-label="时间轴缩放"
            min="1"
            max="4"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(event.currentTarget.valueAsNumber)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <span className="zoom-track" aria-hidden="true">
            <span style={{ width: `${((zoom - 1) / 3) * 100}%` }} />
          </span>
          <span
            className="zoom-thumb"
            style={{ left: `${((zoom - 1) / 3) * 100}%` }}
            aria-hidden="true"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="6" fill="white" />
              <circle cx="6" cy="6" r="1" fill="#1a1a1a" />
            </svg>
          </span>
        </label>
      </div>
      <div className="scroll" ref={scroll}>
        <div
          className="track"
          ref={track}
          style={{ width: `${zoom * 100}%` }}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={time}
          aria-valuetext={`${time.toFixed(1)}秒`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (
              event.target !== event.currentTarget ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey
            )
              return;
            const delta = event.shiftKey ? 1 : 0.1;
            if (event.key === "ArrowLeft") onSeek(Math.max(0, time - delta));
            else if (event.key === "ArrowRight")
              onSeek(Math.min(duration, time + delta));
            else if (event.key === "Home") onSeek(0);
            else if (event.key === "End") onSeek(duration);
            else if (event.key === " ") onPlay();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              pointer.current !== null ||
              event.target.closest("button")
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            pointer.current = event.pointerId;
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            onScrub(true);
            seekPointer(event);
          }}
          onPointerMove={(event) => {
            if (pointer.current === event.pointerId) seekPointer(event);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
        >
          <div className="ruler" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.time}
                className={tick.major ? "tick-label" : "dot"}
                style={{ left: `${(tick.time / safeDuration) * 100}%` }}
                data-edge={
                  tick.time === 0
                    ? "start"
                    : tick.time === safeDuration
                      ? "end"
                      : undefined
                }
              >
                {tick.major ? `${tick.time}s` : null}
              </span>
            ))}
          </div>
          {mode === "video" && (
            <div className="shots" aria-label="镜头片段">
              {shots.map((shot) => (
                <button
                  className="shot"
                  key={shot.id}
                  aria-label={`${shot.label}，${format(shot.end - shot.start)}`}
                  aria-pressed={time >= shot.start && time < shot.end}
                  title={`${shot.label} · ${format(shot.start)} – ${format(shot.end)}`}
                  style={{
                    left: `${(shot.start / safeDuration) * 100}%`,
                    width: `calc(${((shot.end - shot.start) / safeDuration) * 100}% - 2px)`,
                  }}
                  onClick={() => onSelectShot?.(shot)}
                >
                  {shot.trimmable !== false &&
                    ["start", "end"].map((edge) => (
                      <span
                        key={edge}
                        className={`shot-trim shot-trim-${edge}`}
                        role="slider"
                        tabIndex={0}
                        aria-label={`${shot.label}片段${edge === "start" ? "起点" : "终点"}`}
                        aria-valuemin={0}
                        aria-valuemax={duration}
                        aria-valuenow={shot[edge]}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          trim.current = {
                            id: event.pointerId,
                            x: event.clientX,
                            shot: { ...shot },
                            edge,
                          };
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          onScrub(true);
                        }}
                        onPointerMove={(event) => {
                          const initial = trim.current;
                          if (!initial || initial.id !== event.pointerId)
                            return;
                          event.stopPropagation();
                          const value =
                            initial.shot[edge] +
                            ((event.clientX - initial.x) /
                              track.current.getBoundingClientRect().width) *
                              safeDuration;
                          onTrimShot?.(
                            shot.id,
                            edge === "start" ? value : initial.shot.start,
                            edge === "end" ? value : initial.shot.end,
                          );
                        }}
                        onPointerUp={(event) => {
                          event.stopPropagation();
                          trim.current = null;
                          onScrub(false);
                          if (
                            event.currentTarget.hasPointerCapture(
                              event.pointerId,
                            )
                          )
                            event.currentTarget.releasePointerCapture(
                              event.pointerId,
                            );
                        }}
                        onPointerCancel={() => {
                          trim.current = null;
                          onScrub(false);
                        }}
                        onKeyDown={(event) => {
                          if (!["ArrowLeft", "ArrowRight"].includes(event.key))
                            return;
                          event.stopPropagation();
                          event.preventDefault();
                          const value =
                            shot[edge] +
                            (event.key === "ArrowRight" ? 1 : -1) *
                              (event.shiftKey ? 1 : 0.1);
                          onTrimShot?.(
                            shot.id,
                            edge === "start" ? value : shot.start,
                            edge === "end" ? value : shot.end,
                          );
                        }}
                      />
                    ))}
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1" y="3" width="9" height="10" rx="2"/><path d="m10 6 5-2v8l-5-2"/></svg>
                  <span className="shot-label">{shot.label}</span>
                  <span className="shot-duration">{format(shot.start)} – {format(shot.end)}</span>
                </button>
              ))}
            </div>
          )}
          <div
            className="playhead"
            style={{ left: `${progress}%` }}
            aria-hidden="true"
          >
            <span className="line" />
          </div>
          <span
            className="badge"
            style={{ left: `clamp(22px, ${progress}%, calc(100% - 22px))` }}
            aria-hidden="true"
          >
            {time.toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}
