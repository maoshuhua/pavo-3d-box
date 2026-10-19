import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";

export default function CameraPreview({
  label,
  playing,
  onPlay,
  onEnter,
  stage,
  dockHeight,
  onRect,
  transition,
  floatingLayout,
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [anchor, setAnchor] = useState({
    horizontal: "left",
    vertical: "bottom",
  });
  const [drag, setDrag] = useState(null);
  const pointer = useRef(null);
  const layout=useSyncExternalStore(floatingLayout.subscribe,floatingLayout.getSnapshot);
  useLayoutEffect(()=>{floatingLayout.setPipVisible(true);return()=>floatingLayout.setPipVisible(false)},[floatingLayout]);
  useLayoutEffect(()=>{floatingLayout.setPipAnchor(anchor)},[floatingLayout,anchor]);
  useLayoutEffect(() => {
    const host = stage.current;
    const update = () =>
      setSize({
        width: host.clientWidth,
        height: host.clientHeight,
        left: host.offsetLeft,
        top: host.offsetTop,
      });
    const observer = new ResizeObserver(update);
    observer.observe(host);
    update();
    return () => {
      observer.disconnect();
      onRect(null);
    };
  }, [stage, onRect]);
  // libtv Af: 260 x 146, 10px edge margin, 58px top safety area.
  const availableHeight = size.height - dockHeight;
  const width = Math.max(
    0,
    Math.min(260, size.width - 20, ((availableHeight - 58 - 10) * 260) / 146),
  );
  const height = (width * 146) / 260;
  const rect = drag ?? layout.pip ?? {
    left: anchor.horizontal === "left" ? 10 : size.width - 10 - width,
    top: anchor.vertical === "top" ? 58 : availableHeight - 10 - height,
    width,
    height,
  };
  useLayoutEffect(() => {
    onRect(rect);
  }, [rect.left, rect.top, rect.width, rect.height, onRect]);
  const finish = (event) => {
    if (pointer.current?.id !== event.pointerId) return;
    setAnchor(floatingLayout.pickPipAnchor(rect));
    pointer.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <motion.div
      data-preview-pip
      className="camera-preview"
      style={{
        ...rect,
        left: rect.left + (size.left || 0),
        top: rect.top + (size.top || 0),
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={transition}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        event.preventDefault();
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          rect,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag(rect);
      }}
      onPointerMove={(event) => {
        const start = pointer.current;
        if (!start || start.id !== event.pointerId) return;
        setDrag({
          ...start.rect,
          left: Math.max(
            10,
            Math.min(
              size.width - width - 10,
              start.rect.left + event.clientX - start.x,
            ),
          ),
          top: Math.max(
            58,
            Math.min(
              availableHeight - height - 10,
              start.rect.top + event.clientY - start.y,
            ),
          ),
        });
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <span data-preview-pip-label>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <rect x="1" y="3" width="9" height="10" rx="2" />
          <path d="m10 6 5-2v8l-5-2" />
        </svg>
        <span>{label}</span>
      </span>
      <div data-preview-pip-actions>
        <button
          type="button"
          aria-label={playing ? "暂停机位预览" : "播放机位预览"}
          aria-pressed={playing}
          title={`${playing ? "暂停" : "播放"} · Space`}
          onClick={onPlay}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            {playing ? (
              <path d="M4 3h3v10H4zm5 0h3v10H9z" />
            ) : (
              <path d="m5 3 8 5-8 5z" />
            )}
          </svg>
        </button>
        <button
          type="button"
          aria-label="在机位视角中打开预览"
          title="进入机位"
          onClick={onEnter}
        >
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M7 2h3v3M10 2 7 5M5 10H2V7m0 3 3-3" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
