// Adapted from libtv published _7 / _S and composer positioning hooks.
import * as IS from 'react';
import {cameraPreviewSize} from './timelineCamera.js';
    function _S({
        hostWidth: e,
        composerWidth: t,
        leftPanel: n,
        rightPanel: r
    }) {
        let i = n + (e - n - r - t) / 2;
        return {
            left: Math.min(n + 16, i),
            center: i,
            right: Math.max(e - r - 16 - t, i)
        }
    }
    export function createFloatingLayout() {
        let e = 0,
            t = 0,
            n = 0,
            r = 0,
            i = 0,
            o = !1,
            pipAspect = 16 / 9,
            a = {
                horizontal: "left",
                vertical: "bottom"
            },
            l = {
                anchor: "center",
                width: 0,
                height: 0,
                bottom: 16,
                visible: !1,
                collapsed: !1,
                minimumHeight: 124
            },
            s = new Set,
            u = () => {
                let n = 1 / 0,
                    s = 0,
                    u = Math.min(l.width, Math.max(0, e - 32)),
                    c = Math.min(l.height, Math.max(0, t - 58 - l.bottom)),
                    d = "center" === l.anchor ? (e - u) / 2 : "left" === l.anchor ? 16 : e - 16 - u,
                    f = {
                        left: Math.max(0, d),
                        top: Math.max(58, t - l.bottom - c),
                        width: u,
                        height: c
                    },
                    h = cameraPreviewSize(pipAspect,e-20,t-58-10).width,
                    p = h / pipAspect,
                    m = o && h > 0 ? {
                        left: "left" === a.horizontal ? 10 : e - 10 - h,
                        top: "top" === a.vertical ? 58 : t - 10 - p,
                        width: h,
                        height: p
                    } : null;
                if (m && l.visible && u > 0 && "bottom" === a.vertical && l.anchor === a.horizontal && m.top < f.top + c && m.top + p > f.top) {
                    let o = r < i,
                        c = o ? m : f,
                        d = o ? f : m,
                        p = e - 26 - u - 10;
                    p >= 120 && p < h && (m.width = h = p, m.height = h / pipAspect, m.top = t - 10 - m.height, m.left = "left" === a.horizontal ? 10 : e - 10 - h), u + m.width + 10 + 26 <= e ? d.left = "left" === a.horizontal ? c.left + c.width + 10 : c.left - 10 - d.width : (d === f && (m.height = Math.min(m.height, Math.max(0, t - 58 - 20 - l.minimumHeight)), m.width = pipAspect * m.height, m.top = t - 10 - m.height, m.left = "left" === a.horizontal ? 10 : e - 10 - m.width, n = Math.max(0, c.top - 10 - 58), s = c.top - 10 - (t - l.bottom)), d.height = Math.min(d.height, Math.max(0, c.top - 10 - 58)), d === m && (d.width = pipAspect * d.height, d.left = "left" === a.horizontal ? 10 : e - 10 - d.width), d.top = Math.max(58, c.top - 10 - d.height))
                }
                return {
                    pip: m,
                    composer: f,
                    composerX: f.left - d,
                    composerY: s,
                    composerHeightLimit: n,
                    anchor: a,
                    width: e,
                    height: t
                }
            },
            c = u(),
            d = () => {
                c = u(), s.forEach(e => e())
            };
        return {
            getSnapshot: () => c,
            pickPipAnchor: n => {
                let r = c.pip ?? n,
                    i = (e, t, n, r, i, o, a) => {
                        if (e <= a + 4) return !0;
                        if (e + t >= i - 10 - 4) return !1;
                        let l = e + t / 2 - n - r / 2;
                        if (24 >= Math.abs(l)) return o;
                        let s = e + t / 2 < i / 2;
                        return s !== o && (s && l > 0 || !s && l < 0) ? o : s
                    };
                return {
                    horizontal: i(n.left, n.width, r.left, r.width, e, "left" === a.horizontal, 10) ? "left" : "right",
                    vertical: i(n.top, n.height, r.top, r.height, t, "top" === a.vertical, 58) ? "top" : "bottom"
                }
            },
            pickComposerAnchor: t => {
                let n = c.composer.width;
                if (t <= 20) return "left";
                if (t + n >= e - 20) return "right";
                let r = t - c.composer.left;
                if (24 >= Math.abs(r)) return l.anchor;
                let i = {
                        left: 16,
                        center: (e - n) / 2,
                        right: e - n - 16
                    },
                    o = l.anchor,
                    a = 1 / 0;
                for (let e of ["left", "center", "right"]) {
                    let n = Math.abs(t - i[e]);
                    n < a && (o = e, a = n)
                }
                return "left" === l.anchor && r < 0 || "right" === l.anchor && r > 0 ? l.anchor : o
            },
            subscribe: e => (s.add(e), () => {
                s.delete(e)
            }),
            setStage: (n, r) => {
                (e !== n || t !== r) && (e = Math.max(0, n), t = Math.max(0, r), d())
            },
            setPipAspect: value => {
                const next=Number.isFinite(value)&&value>0?value:16/9;
                if(next!==pipAspect){pipAspect=next;d();}
            },
            setPipVisible: e => {
                o !== e && (o = e, e && !r && (r = ++n), d())
            },
            setPipAnchor: e => {
                (e.horizontal !== a.horizontal || e.vertical !== a.vertical) && (a = e, r = ++n, d())
            },
            setComposer: e => {
                Object.keys(e).every(t => l[t] === e[t]) || ((e.anchor && e.anchor !== l.anchor || l.collapsed && !1 === e.collapsed) && (i = ++n), l = {
                    ...l,
                    ...e
                }, d())
            }
        }
    }
export const useComposerPosition = function(e, t, n, r, i, o, a = !1, l = 16) {
                let [s, u] = (0, IS.useState)("center"), [c, d] = (0, IS.useState)(null), [f, h] = (0, IS.useState)({
                    host: 0,
                    composer: 0
                }), p = (0, IS.useRef)(null), m = (0, IS.useRef)(null);
                (0, IS.useLayoutEffect)(() => {
                    let t = e.current;
                    if (!t || !o) return;
                    o.setComposer({
                        anchor: s,
                        collapsed: r,
                        visible: !r && !a,
                        bottom: l
                    });
                    let n = () => {
                            t.hasAttribute("data-morphing") || o.setComposer({
                                width: t.offsetWidth,
                                height: t.offsetHeight
                            })
                        },
                        i = () => {
                            let {
                                composerX: e,
                                composerY: n
                            } = o.getSnapshot();
                            t.style.setProperty("--preview-composer-avoid-x", `${r||null!==c?0:e}px`), t.style.setProperty("--preview-composer-avoid-y", `${r||null!==c?0:n}px`)
                        };
                    n(), i();
                    let u = o.subscribe(i),
                        d = new ResizeObserver(n);
                    return d.observe(t), () => {
                        d.disconnect(), u()
                    }
                }, [o, e, s, r, a, l, c]), (0, IS.useEffect)(() => () => o?.setComposer({
                    visible: !1
                }), [o]), (0, IS.useLayoutEffect)(() => {
                    let t = e.current,
                        n = t?.parentElement;
                    if (!t || !n) return;
                    let r = () => {
                        t.hasAttribute("data-morphing") || h({
                            host: n.clientWidth,
                            composer: t.offsetWidth
                        })
                    };
                    r();
                    let i = new ResizeObserver(r);
                    return i.observe(n), i.observe(t), window.addEventListener("resize", r), () => {
                        i.disconnect(), window.removeEventListener("resize", r)
                    }
                }, [e, r]);
                let g = (0, IS.useMemo)(() => _S({
                        hostWidth: f.host,
                        composerWidth: f.composer,
                        leftPanel: t,
                        rightPanel: n
                    }), [f.host, f.composer, t, n]),
                    v = g[s] - g.center,
                    y = r ? 0 : c ?? v,
                    b = (0, IS.useRef)({
                        size: f,
                        anchor: s,
                        offset: y,
                        compact: r
                    });
                b.current = {
                    size: f,
                    anchor: s,
                    offset: y,
                    compact: r
                }, (0, IS.useEffect)(() => {
                    if (i) return i.subscribe(() => {
                        let t = e.current;
                        if (!t) return;
                        let n = i.get(),
                            r = b.current;
                        if (!n) {
                            delete t.dataset.panelResizing, t.style.setProperty("--preview-composer-slide", `${r.offset}px`);
                            return
                        }
                        let o = _S({
                            hostWidth: r.size.host,
                            composerWidth: r.size.composer,
                            leftPanel: n.left,
                            rightPanel: n.right
                        });
                        t.dataset.panelResizing = "", t.style.setProperty("--preview-composer-slide", `${r.compact?0:o[r.anchor]-o.center}px`)
                    })
                }, [i, e]);
                let x = (0, IS.useCallback)(() => {
                        let e = p.current;
                        p.current = null, e && m.current?.hasPointerCapture(e.id) && m.current.releasePointerCapture(e.id), d(null)
                    }, []),
                    w = (0, IS.useCallback)(e => {
                        m.current = e, e || (p.current = null, d(null))
                    }, []),
                    k = null !== c;
                (0, IS.useEffect)(() => {
                    if (!k) return;
                    let e = e => {
                            "Escape" === e.key && (e.preventDefault(), e.stopPropagation(), x())
                        },
                        t = () => {
                            document.hidden && x()
                        };
                    return window.addEventListener("keydown", e, !0), window.addEventListener("blur", x), document.addEventListener("visibilitychange", t), () => {
                        window.removeEventListener("keydown", e, !0), window.removeEventListener("blur", x), document.removeEventListener("visibilitychange", t)
                    }
                }, [k, x]);
                let C = (e, n) => {
                    let r = p.current;
                    if (r?.id === e.pointerId) {
                        var a;
                        let e, l;
                        p.current = null, n && r.moved && u(o ? o.pickComposerAnchor(g.center + r.offset - (i?.get()?.left ?? t)) : (a = r.offset, e = g.left - g.center, l = g.right - g.center, e < 0 && a < e / 2 ? "left" : l > 0 && a > l / 2 ? "right" : "center")), d(null)
                    }
                };
                return {
                    anchor: s,
                    offset: y,
                    sliding: null !== c,
                    handleProps: {
                        ref: w,
                        onPointerDown: e => {
                            p.current && !e.currentTarget.hasPointerCapture(p.current.id) && x(), 0 !== e.button || p.current || e.target instanceof Element && e.target.closest('button, a, input, textarea, [role="separator"], [role="slider"]') || g.left !== g.right && (e.preventDefault(), e.currentTarget.setPointerCapture(e.pointerId), p.current = {
                                id: e.pointerId,
                                x: e.clientX,
                                offset: v + (o?.getSnapshot().composerX ?? 0),
                                moved: !1
                            })
                        },
                        onPointerMove: e => {
                            var t;
                            let n = p.current;
                            if (n?.id !== e.pointerId) return;
                            let r = e.clientX - n.x;
                            if (!n.moved) {
                                if (3 > Math.abs(r)) return;
                                n.moved = !0
                            }
                            e.preventDefault(), t = n.offset + r, n.offset = Math.min(g.right - g.center, Math.max(g.left - g.center, t)), n.x = e.clientX, d(n.offset)
                        },
                        onPointerUp: e => {
                            let t = p.current?.id === e.pointerId;
                            C(e, !0), t && e.currentTarget.hasPointerCapture(e.pointerId) && e.currentTarget.releasePointerCapture(e.pointerId)
                        },
                        onPointerCancel: e => C(e, !1),
                        onLostPointerCapture: e => C(e, !1)
                    }
                }
            };
