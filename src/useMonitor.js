import * as _$ from "react";
const AG = [],
  AZ = {},
  Av = {
    PREVIEW_MONITOR_TOP_VIEW: "topView",
    PREVIEW_MONITOR_ORBIT_VIEW: "orbitView",
  };
// libtv monitor request hook: observers, frame cache and active-camera scrolling.
export const useMonitor = function (e, t) {
  let [n, r] = (0, _$.useState)({ sceneKey: t, cameras: AG, frames: AZ }),
    i = n.sceneKey === t && !!n.topView,
    o = (0, _$.useRef)({ enabled: e, sceneKey: t, topViewActive: i });
  o.current = { enabled: e, sceneKey: t, topViewActive: i };
  let a = (0, _$.useRef)(new Set()),
    l = (0, _$.useRef)(new Map()),
    s = (0, _$.useRef)(new Map()),
    u = (0, _$.useRef)(new Map()),
    c = (0, _$.useRef)(new Map()),
    d = (0, _$.useRef)(null),
    p = (0, _$.useRef)(null),
    h = (0, _$.useRef)(!0);
  (0, _$.useEffect)(() => {
    h.current = !0;
  }, [i]);
  let f = (0, _$.useCallback)(() => {
      if (!o.current.enabled || 0 === a.current.size) return null;
      if (h.current) {
        let e = 0;
        for (let t of a.current) e = Math.max(e, u.current.get(t) ?? 0);
        ((p.current = {
          topView:
            a.current.has(Av.PREVIEW_MONITOR_TOP_VIEW) &&
            !o.current.topViewActive,
          ...(a.current.has(Av.PREVIEW_MONITOR_TOP_VIEW) &&
          o.current.topViewActive
            ? { orbitView: !0 }
            : {}),
          cameraIds: [...a.current].filter(
            (e) => e !== Av.PREVIEW_MONITOR_TOP_VIEW,
          ),
          ...(e > 0 ? { thumbnailWidth: e } : {}),
        }),
          (h.current = !1));
      }
      return p.current;
    }, []),
    m = (0, _$.useCallback)(
      (e) => {
        o.current.sceneKey === t &&
          o.current.enabled &&
          r((n) => ({
            sceneKey: t,
            cameras:
              n.sceneKey === t &&
              n.cameras.length === e.cameras.length &&
              n.cameras.every(
                (t, n) =>
                  t.id === e.cameras[n]?.id && t.name === e.cameras[n]?.name,
              )
                ? n.cameras
                : e.cameras,
            frames: e.frames,
            topView: e.topView ?? !1,
            playbackCameraId: e.playbackCameraId ?? null,
          }));
      },
      [t],
    );
  (0, _$.useEffect)(() => {
    ((h.current = !0),
      r((n) =>
        n.sceneKey !== t
          ? { sceneKey: t, cameras: AG, frames: AZ }
          : !e && (n.frames !== AZ || n.playbackCameraId)
            ? { ...n, frames: AZ, playbackCameraId: null }
            : n,
      ));
  }, [e, t]);
  let g = (0, _$.useCallback)((e, t) => {
      let n = (t) => {
        if (!Number.isFinite(t) || t <= 0) return;
        let n = Math.ceil(t);
        u.current.get(e) !== n && (u.current.set(e, n), (h.current = !0));
      };
      if (
        (n(t.clientWidth), "u" > typeof ResizeObserver && !s.current.has(e))
      ) {
        let r = new ResizeObserver((t) => {
          if (s.current.get(e) === r) for (let e of t) n(e.contentRect.width);
        });
        (s.current.set(e, r), r.observe(t));
      }
      if ("u" < typeof IntersectionObserver) {
        (a.current.add(e), (h.current = !0));
        return;
      }
      if (l.current.has(e)) return;
      let r = new IntersectionObserver(
        (i) => {
          if (l.current.get(e) === r)
            for (let r of i)
              a.current.has(e) !== r.isIntersecting &&
                (r.isIntersecting
                  ? (a.current.add(e), n(t.clientWidth))
                  : a.current.delete(e),
                (h.current = !0));
        },
        { root: null, rootMargin: "64px" },
      );
      (l.current.set(e, r), r.observe(t));
    }, []),
    v = (0, _$.useCallback)(
      (e) => (t) => {
        (l.current.get(e)?.disconnect(),
          l.current.delete(e),
          s.current.get(e)?.disconnect(),
          s.current.delete(e),
          u.current.delete(e),
          c.current.delete(e),
          a.current.delete(e),
          (h.current = !0),
          t && (c.current.set(e, t), g(e, t)));
      },
      [g],
    );
  (0, _$.useEffect)(() => {
    for (let [e, t] of c.current) g(e, t);
    let e = l.current,
      t = s.current,
      n = u.current,
      r = a.current;
    return () => {
      for (let t of e.values()) t.disconnect();
      for (let n of (e.clear(), t.values())) n.disconnect();
      (t.clear(), n.clear(), r.clear(), (p.current = null), (h.current = !0));
    };
  }, [g]);
  let y = n.sceneKey === t ? n.cameras : AG,
    b = e && n.sceneKey === t ? n.frames : AZ,
    x = e && n.sceneKey === t ? (n.playbackCameraId ?? null) : null;
  return (
    (0, _$.useEffect)(() => {
      if (!x) return;
      let e = d.current,
        t = c.current.get(x);
      if (!e || !t) return;
      let n = e.getBoundingClientRect(),
        r = t.getBoundingClientRect();
      if (n.height <= 0 || r.height <= 0) return;
      let i = r.top < n.top ? r.top - n.top : Math.max(r.bottom - n.bottom, 0);
      i && e.scrollBy({ top: i, behavior: "smooth" });
    }, [x, y]),
    (0, _$.useMemo)(
      () => ({
        cameras: y,
        frames: b,
        topViewActive: i,
        playbackCameraId: x,
        scrollContainerRef: d,
        getMonitorRequests: f,
        onMonitorFrames: m,
        observe: v,
      }),
      [y, b, i, x, f, m, v],
    )
  );
};
