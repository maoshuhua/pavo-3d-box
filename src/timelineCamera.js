// Ported from libtv's published eiA / "auto" view resolution.
// Prefer the latest-starting covering shot, then the latest preceding shot,
// then the earliest shot. This also defines cuts, overlaps, gaps and the end.
export const AUTO_CAMERA_VIEW = "auto";

export function timelineCameraId(shots, time, duration) {
  if (!shots.length) return null;
  const at = duration > 0
    ? Math.min(Math.max(time, 0), duration)
    : Math.max(time, 0);
  let covering = null, preceding = null, earliest = shots[0];
  for (const shot of shots) {
    if (shot.start < earliest.start) earliest = shot;
    if (shot.start <= at && (!preceding || shot.start > preceding.start))
      preceding = shot;
    if (at >= shot.start && at <= shot.end &&
        (!covering || shot.start > covering.start ||
          shot.start === covering.start && shot.end < covering.end))
      covering = shot;
  }
  return (covering ?? preceding ?? earliest).cameraId;
}

export function resolveCameraViewId(view, cameras, shots, time, duration) {
  if (view !== AUTO_CAMERA_VIEW) return view;
  const id = timelineCameraId(shots, time, duration);
  return cameras.find(camera => camera.userData.hf_id === id)?.uuid ?? null;
}
