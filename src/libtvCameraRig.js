import * as THREE from "three";
// These pure functions are copied verbatim from libtv's published 0wsgf7e09dh0-.js.
// No React/remote service code is included.
const RK = "blockingStudioPathFor",
  RG = "blockingStudioPath",
  RZ = "blockingStudioWaypoint",
  RX = "blockingStudioPathAnchor",
  RJ = "blockingStudioPathAim",
  RY = "blockingStudioPathFocus",
  RQ = "blockingStudioDofFocus";
const R0 = 8176895,
  R1 = 30,
  R2 = 0.1,
  R5 = 2,
  R3 = 120,
  R4 = 12,
  _A = 8;
const R6 = {
  enabled: true,
  curve: "centripetal",
  tension: 0.5,
  closed: false,
  aim: "tangent",
  targetName: null,
  duration: 6,
  easing: "inout",
  bounce: false,
  roll: 0,
  presetId: null,
  intensity: 1,
  framing: "medium",
  speed: 1,
};
const R7 = ["centripetal", "chordal", "catmullrom"],
  R8 = ["tangent", "target", "fixed"],
  R9 = ["linear", "in", "out", "inout"],
  _e = ["close", "medium", "wide"];
function eiP(e) {
  let t = [];
  return (
    e.traverse((e) => {
      e.isCamera && t.push(e);
    }),
    t
  );
}
function eoE(e) {
  return Math.min(Math.max(e, 0), 1);
}
function eoj(e) {
  return e
    .trim()
    .toLocaleLowerCase()
    .replace(RegExp("[^\\p{L}\\p{N}]+", "gu"), "_")
    .replace(/^_+|_+$/g, "");
}
function eoT(e, t) {
  if (!t) return null;
  let n = e.getObjectByName(t);
  if (n) return n;
  let r = eoj(t),
    i = null;
  return (
    e.traverse((e) => {
      i || eoj(e.name) !== r || (i = e);
    }),
    i
  );
}
function eoP(e) {
  var t;
  return "string" == typeof (null == (t = e.userData) ? void 0 : t[RK]);
}
function eoR(e) {
  var t;
  return (null == (t = e.userData) ? void 0 : t[RZ]) === !0;
}
function eo_(e) {
  var t;
  return (null == (t = e.userData) ? void 0 : t[RJ]) === !0;
}
function eoI(e) {
  var t;
  return (null == (t = e.userData) ? void 0 : t[RY]) === !0;
}
function eoA(e) {
  return `Path_${e}`;
}
function eoN(e) {
  return `WP_${e + 1}`;
}
function eoD(e) {
  let t = [];
  return (
    e.traverse((e) => {
      eoP(e) && t.push(e);
    }),
    t
  );
}
function eoO(e, t) {
  var n;
  return null ==
    (n = eoD(e).find((e) => e.userData.blockingStudioPathFor === t))
    ? null
    : n;
}
function eoz(e) {
  let t = e;
  for (; t;) {
    if (eoP(t)) return t;
    t = t.parent;
  }
  return null;
}
function eoL(e) {
  return e.children.filter(eoR).sort((e, t) => {
    var n, r;
    return (
      (null == (n = e.userData.blockingStudioWaypointIndex) ? 0 : n) -
      (null == (r = t.userData.blockingStudioWaypointIndex) ? 0 : r)
    );
  });
}
function eoF(e, t) {
  let n = null;
  return (
    e.traverse((r) => {
      !n && r !== e && t(r) && (n = r);
    }),
    n
  );
}
function eoq(e, t, n, r) {
  t.updateWorldMatrix(!0, !1);
  let i = new e.Matrix4().copy(t.matrixWorld).invert(),
    o = eoF(t, eo_);
  (o ||
    (((o = new e.Object3D()).userData[RJ] = !0),
    o.position.copy(r.clone().applyMatrix4(i)),
    t.add(o)),
    (o.name = `Aim_${n}`));
  let a = eoF(t, eoI);
  return (
    a || (((a = new e.Object3D()).userData[RY] = !0), o.add(a)),
    (a.name = `Focus_${n}`),
    { aim: o, focus: a }
  );
}
function eoV(e) {
  e.updateWorldMatrix(!0, !1);
  let t = e.matrixWorld.elements;
  return { x: t[12], y: t[13], z: t[14] };
}
function eoW(e) {
  var t;
  let n = null == (t = e.userData) ? void 0 : t[RG],
    r = "object" == typeof n && n ? n : {},
    i = R6;
  return {
    enabled: "boolean" == typeof r.enabled ? r.enabled : i.enabled,
    curve: R7.includes(r.curve) ? r.curve : i.curve,
    tension: Number.isFinite(r.tension) ? eoE(r.tension) : i.tension,
    closed: "boolean" == typeof r.closed ? r.closed : i.closed,
    aim: R8.includes(r.aim) ? r.aim : i.aim,
    targetName:
      "string" == typeof r.targetName && r.targetName ? r.targetName : null,
    duration: Number.isFinite(r.duration)
      ? Math.max(r.duration, R2)
      : i.duration,
    easing: R9.includes(r.easing) ? r.easing : i.easing,
    bounce: "boolean" == typeof r.bounce ? r.bounce : i.bounce,
    roll: Number.isFinite(r.roll) ? r.roll : i.roll,
    presetId:
      "string" == typeof r.presetId && r.presetId ? r.presetId : i.presetId,
    intensity: Number.isFinite(r.intensity)
      ? Math.min(Math.max(r.intensity, 0.25), 2)
      : i.intensity,
    framing: _e.includes(r.framing) ? r.framing : i.framing,
    speed: Number.isFinite(r.speed) ? r.speed : i.speed,
  };
}
function eo$(e, t) {
  e.userData[RG] = { ...t };
}
function eoB(e) {
  let t = Math.max(e.duration, R2);
  return e.bounce ? 2 * t : t;
}
function eoH(e) {
  return e.reduce((e, t) => Math.max(e, eoB(eoW(t.group))), 0);
}
function eoK(e, t, n = !0) {
  var r;
  let i,
    o = Math.max(e.duration, R2),
    a = eoB(e),
    l = (n ? ((t % a) + a) % a : Math.min(Math.max(t, 0), a)) / o;
  return (
    (r = e.easing),
    (i = eoE(e.bounce && l > 1 ? 2 - l : Math.min(l, 1))),
    "in" === r
      ? i * i
      : "out" === r
        ? 1 - (1 - i) * (1 - i)
        : "inout" === r
          ? i < 0.5
            ? 2 * i * i
            : 1 - (-2 * i + 2) ** 2 / 2
          : i
  );
}
function eoG(e, t, n) {
  let r = new e.Object3D();
  return ((r.name = t), (r.userData[RZ] = !0), r.position.copy(n), r);
}
function eoZ(e, t = eoL(e)) {
  t.forEach((e, t) => {
    ((e.name = eoN(t)), (e.userData.blockingStudioWaypointIndex = t));
  });
}
function eoX(e, t, n) {
  t.updateWorldMatrix(!0, !1);
  let r = new e.Vector3().setFromMatrixPosition(t.matrixWorld),
    i = r.distanceTo(n);
  return { three: e, origin: r, focus: n.clone(), radius: i > 1e-4 ? i : 1 };
}
function eoJ(e, t) {
  return Array.isArray(t) && !(t.length < 3) && t.every(Number.isFinite)
    ? new e.Vector3(t[0], t[1], t[2])
    : null;
}
function eoY(e, t) {
  var n;
  let r = null == (n = t.userData) ? void 0 : n[RX],
    i = "object" == typeof r && r ? r : null,
    o = i ? eoJ(e, i.origin) : null,
    a = i ? eoJ(e, i.focus) : null;
  if (!o || !a) return null;
  let l = Number.isFinite(null == i ? void 0 : i.radius)
    ? i.radius
    : o.distanceTo(a);
  return { three: e, origin: o, focus: a, radius: l > 1e-4 ? l : 1 };
}
function eoQ(e, t) {
  e.userData[RX] = {
    origin: t.origin.toArray(),
    focus: t.focus.toArray(),
    radius: t.radius,
  };
}
function eo0(e) {
  return {
    settings: eoW(e),
    waypoints: eoL(e).map((e) => e.position.toArray()),
  };
}
function eo1(e, t, n) {
  let r = eoL(t);
  if (r.length < R5) return null;
  t.updateWorldMatrix(!0, !0);
  let i = r.map((t) => t.getWorldPosition(new e.Vector3()));
  return new e.CatmullRomCurve3(
    i,
    n.closed && i.length > 2,
    n.curve,
    n.tension,
  );
}
function eo2(e, t, n, r, i) {
  let o = eoE(r),
    a = t.getPointAt(o);
  if ("fixed" === n.aim) return { position: a, quaternion: null };
  let l =
    "target" === n.aim && i
      ? i.getWorldPosition(new e.Vector3())
      : new e.Vector3().copy(a).add(t.getTangentAt(o));
  if (1e-10 > l.distanceToSquared(a)) return { position: a, quaternion: null };
  let s = new e.Matrix4().lookAt(a, l, new e.Vector3(0, 1, 0)),
    u = new e.Quaternion().setFromRotationMatrix(s);
  return (
    0 !== n.roll &&
      u.multiply(
        new e.Quaternion().setFromAxisAngle(
          new e.Vector3(0, 0, 1),
          e.MathUtils.degToRad(n.roll),
        ),
      ),
    { position: a, quaternion: u }
  );
}
function eo4(e, t, n, r) {
  let i = eoW(n),
    o = eo1(e, n, i);
  if (!o || !r.name) return null;
  let a = eoB(i),
    l = Math.abs(i.speed) > 1e-4 ? Math.abs(i.speed) : 1,
    s = Math.min(a / l, 600),
    u = Math.min(2e3, Math.max(2, Math.round(s * R1) + 1)),
    c = eoT(t, i.targetName),
    d = r.parent,
    p = new e.Matrix4(),
    h = new e.Quaternion();
  d &&
    (d.updateWorldMatrix(!0, !1),
    p.copy(d.matrixWorld).invert(),
    d.getWorldQuaternion(h).invert());
  let f = [],
    m = [],
    g = [],
    v = r.quaternion.clone(),
    y = null;
  for (let t = 0; t < u; t += 1) {
    let n = (t / (u - 1)) * s,
      r = eo2(
        e,
        o,
        i,
        eoK(i, 0 === i.speed ? 0 : i.speed < 0 ? a - n * l : n * l, !1),
        c,
      ),
      d = r.position.clone().applyMatrix4(p),
      b = r.quaternion ? h.clone().multiply(r.quaternion) : v.clone();
    (y && 0 > y.dot(b) && b.set(-b.x, -b.y, -b.z, -b.w),
      (y = b),
      f.push(n),
      m.push(d.x, d.y, d.z),
      g.push(b.x, b.y, b.z, b.w));
  }
  return new e.AnimationClip(eoA(r.name), s, [
    new e.VectorKeyframeTrack(`${r.name}.position`, f, m),
    new e.QuaternionKeyframeTrack(`${r.name}.quaternion`, f, g),
  ]);
}
function eo6(e) {
  return {
    id: (function (e) {
      let t = e.userData.hf_id;
      if ("string" == typeof t && t) return t;
      let n = crypto.randomUUID();
      return ((e.userData.hf_id = n), n);
    })(e),
    name: e.name,
    transform:
      (e.quaternion.normalize(),
      {
        position: [e.position.x, e.position.y, e.position.z],
        rotation: [
          e.quaternion.x,
          e.quaternion.y,
          e.quaternion.z,
          e.quaternion.w,
        ],
        scale: [e.scale.x, e.scale.y, e.scale.z],
      }),
  };
}
function eo7(e, t) {
  let n = e.tracks.find((e) => e.name === `${t}.position`),
    r = e.tracks.find((e) => e.name === `${t}.quaternion`);
  return n || r ? { position: n, quaternion: r } : null;
}
function eo8(e, t) {
  var n;
  return null == (n = e.find((e) => eo7(e, t))) ? null : n;
}
function eo9(e, t, n) {
  let r = e.flatMap((e) => {
    let n = e.tracks.filter(
      (e) => e.name !== `${t}.position` && e.name !== `${t}.quaternion`,
    );
    if (n.length === e.tracks.length) return [e];
    if (0 === n.length) return [];
    let r = e.clone();
    return ((r.tracks = n), [r]);
  });
  return n ? [...r, n] : r;
}
function eae(e, t) {
  let n = new Set([0, e.length - 1]),
    r = [[0, e.length - 1]];
  for (; r.length > 0;) {
    let [i, o] = r.pop(),
      a = -1,
      l = 0;
    for (let t = i + 1; t < o; t += 1) {
      let n = (function (e, t, n) {
        let r = n.map((e, n) => e - t[n]),
          i = e.map((e, n) => e - t[n]),
          o = r[0] ** 2 + r[1] ** 2 + r[2] ** 2;
        if (o < 1e-12) return Math.hypot(...i);
        let a = eoE((i[0] * r[0] + i[1] * r[1] + i[2] * r[2]) / o);
        return Math.hypot(...i.map((e, t) => e - r[t] * a));
      })(e[t], e[i], e[o]);
      n > l && ((l = n), (a = t));
    }
    a < 0 || l <= t || (n.add(a), r.push([i, a], [a, o]));
  }
  return [...n].sort((e, t) => e - t);
}
function eat(e, t) {
  let n = `${eoj(e)}:${t}`,
    r = [0x811c9dc5, 0x1000193, 0x9e3779b9, 0x85ebca6b]
      .map((e) => {
        let t = e;
        for (let e = 0; e < n.length; e += 1)
          ((t ^= n.charCodeAt(e)), (t = Math.imul(t, 0x1000193)));
        return (t >>> 0).toString(16).padStart(8, "0");
      })
      .join("");
  return [
    r.slice(0, 8),
    r.slice(8, 12),
    r.slice(12, 16),
    r.slice(16, 20),
    r.slice(20, 32),
  ].join("-");
}
function ean(e, t, n, r) {
  let i = Math.round(1e6 * Math.min(Math.max(t, 0), 600)) / 1e6,
    o = e.times
      .map((t, n) => ({
        time: t,
        position: e.positions.slice(3 * n, 3 * n + 3),
        quaternion: e.quaternions.slice(4 * n, 4 * n + 4),
      }))
      .filter((e) => Math.abs(e.time - i) > 1e-6);
  if (
    (o.push({ time: i, position: n, quaternion: r }),
    o.sort((e, t) => e.time - t.time),
    o.length > 2e3)
  ) {
    let e = -1;
    for (let t = 1; t < o.length - 1; t++)
      o[t].time !== i &&
        (e < 0 || Math.abs(o[t].time - i) < Math.abs(o[e].time - i)) &&
        (e = t);
    e >= 0 && o.splice(e, 1);
  }
  return {
    ...e,
    duration: Math.max(e.duration, i),
    times: o.map((e) => e.time),
    positions: o.flatMap((e) => e.position),
    quaternions: o.flatMap((e) => e.quaternion),
  };
}
function ear(e, t, n, r, i) {
  let o = (function (e, t, n) {
      var r, i, o, a, l, s, u, c, d, p, h;
      if (!e) return null;
      let f = eo7(e, t);
      if (
        !f ||
        (f.position && 3 !== f.position.getValueSize()) ||
        (f.quaternion && 4 !== f.quaternion.getValueSize())
      )
        return null;
      let m = Math.min(
        2e3,
        Math.max(
          2,
          null == (r = null == (i = f.position) ? void 0 : i.times.length)
            ? 0
            : r,
          null == (o = null == (a = f.quaternion) ? void 0 : a.times.length)
            ? 0
            : o,
        ),
      );
      if (m < 2) return null;
      let g =
          null == (l = f.position)
            ? void 0
            : l.createInterpolant(new Float32Array(3)),
        v =
          null == (s = f.quaternion)
            ? void 0
            : s.createInterpolant(new Float32Array(4)),
        y = Math.max(e.duration, 0.001),
        b = (e) => Math.round(1e6 * e) / 1e6,
        x = [
          ...new Set(
            [
              0,
              ...(null == (u = null == (c = f.position) ? void 0 : c.times)
                ? []
                : u),
              ...(null == (d = null == (p = f.quaternion) ? void 0 : p.times)
                ? []
                : d),
              y,
            ].map(b),
          ),
        ].sort((e, t) => e - t),
        w =
          x.length <= 2e3
            ? x
            : Array.from({ length: m }, (e, t) => b((t * y) / (m - 1))),
        S = w.flatMap((e) => {
          var t, r;
          return Array.from(
            null ==
              (t =
                null == (r = null == g ? void 0 : g.evaluate(e))
                  ? null == n
                    ? void 0
                    : n.position.toArray()
                  : r)
              ? [0, 0, 0]
              : t,
            (e) => b(Number(e)),
          );
        }),
        k = w.flatMap((e) => {
          var t, r;
          return Array.from(
            null ==
              (t =
                null == (r = null == v ? void 0 : v.evaluate(e))
                  ? null == n
                    ? void 0
                    : n.quaternion.toArray()
                  : r)
              ? [0, 0, 0, 1]
              : t,
            (e) => b(Number(e)),
          );
        });
      return {
        name: e.name || eoA(t),
        duration: null == (h = w.at(-1)) ? b(y) : h,
        times: w,
        positions: S,
        quaternions: k,
      };
    })(eo8(r, t.name), t.name, t),
    a =
      "string" == typeof t.userData.blockingStudioDofFocus
        ? t.userData[RQ]
        : null;
  if (!n) return { aspect: i, dofFocusName: a, path: null, animation: o };
  let l = eoY(e, n),
    s = eoF(n, eo_),
    u = eoF(n, eoI);
  return {
    aspect: i,
    dofFocusName: a,
    path: {
      ...eo6(n),
      settings: eoW(n),
      anchor: l
        ? {
            origin: l.origin.toArray(),
            focus: l.focus.toArray(),
            radius: l.radius,
          }
        : null,
      waypoints: eoL(n).map(eo6),
      aim: s ? eo6(s) : null,
      focus: u ? eo6(u) : null,
      focusParent: u && s && u.parent === s ? "aim" : "path",
    },
    animation: o,
  };
}
function eai(e, t, n, r) {
  var i;
  let o = null == n ? new e.Object3D() : n;
  return (
    (o.userData.hf_id = r.id),
    (o.name = r.name),
    (o.userData.blockingStudioEntityName = r.name),
    t.add(o),
    (i = r.transform),
    o.position.set(...i.position),
    o.quaternion.set(...i.rotation).normalize(),
    o.scale.set(...i.scale),
    o
  );
}
function eao(e, t, n, r) {
  let i = eoO(t, n.name);
  if (r.path) {
    var o, a, l;
    let s,
      u = eai(e, t, i, r.path);
    ((u.userData[RK] = n.name),
      eo$(u, r.path.settings),
      r.path.anchor ? (u.userData[RX] = r.path.anchor) : delete u.userData[RX]);
    let c = new Map(u.children.map((e) => [e.userData.hf_id, e])),
      d = new Set();
    for (let [t, n] of r.path.waypoints.entries()) {
      let r = eai(e, u, null == (a = c.get(n.id)) ? null : a, n);
      ((r.userData[RZ] = !0),
        (r.userData.blockingStudioWaypointIndex = t),
        d.add(n.id));
    }
    let p = r.path.aim
      ? eai(e, u, null == (o = c.get(r.path.aim.id)) ? null : o, r.path.aim)
      : null;
    p && r.path.aim && ((p.userData[RJ] = !0), d.add(r.path.aim.id));
    let h = "aim" === r.path.focusParent && p ? p : u,
      f = r.path.focus
        ? eai(
            e,
            h,
            ((l = r.path.focus.id),
            (s = null),
            t.traverse((e) => {
              s || e.userData.hf_id !== l || (s = e);
            }),
            s),
            r.path.focus,
          )
        : null;
    f && r.path.focus && ((f.userData[RY] = !0), d.add(r.path.focus.id));
    let m = eoF(u, eoI);
    for (let e of (m &&
      (!r.path.focus || m.userData.hf_id !== r.path.focus.id) &&
      m.removeFromParent(),
    [...u.children])) {
      let t = e.userData.hf_id;
      "string" != typeof t || d.has(t) || e.removeFromParent();
    }
  } else null == i || i.removeFromParent();
  return (
    r.dofFocusName ? (n.userData[RQ] = r.dofFocusName) : delete n.userData[RQ],
    r.animation
      ? new e.AnimationClip(r.animation.name, r.animation.duration, [
          new e.VectorKeyframeTrack(
            `${n.name}.position`,
            r.animation.times,
            r.animation.positions,
          ),
          new e.QuaternionKeyframeTrack(
            `${n.name}.quaternion`,
            r.animation.times,
            r.animation.quaternions,
          ),
        ])
      : null
  );
}
function eaK(e) {
  var t;
  let { THREE: n } = e.modules;
  e.editableRoot.updateMatrixWorld(!0);
  let r = new n.Box3(),
    i = [],
    o = new n.Vector3(),
    a = new n.Vector3();
  if (
    (e.editableRoot.traverse((e) => {
      var t;
      if (!e.isMesh || !e.visible || !e.geometry) return;
      let l = e.isSkinnedMesh
        ? eaJ(n, null == (t = e.skeleton) ? void 0 : t.bones, a)
        : eaG(e);
      !l ||
        l.isEmpty() ||
        (r.union(l), i.push({ box: l, radius: l.getSize(o).length() / 2 }));
    }),
    i.length <= 1)
  )
    return r.isEmpty() ? new n.Box3().setFromObject(e.editableRoot) : r;
  let l = i.map((e) => e.radius).sort((e, t) => e - t),
    s = null == (t = l[Math.floor(l.length / 2)]) ? 0 : t;
  if (s <= 0) return r;
  let u = s * _A,
    c = new n.Box3();
  for (let e of i) e.radius <= u && c.union(e.box);
  return c.isEmpty() ? r : c;
}
function eaG(e) {
  var t, n;
  return (
    e.geometry.boundingBox || e.geometry.computeBoundingBox(),
    null ==
    (t =
      null == (n = e.geometry.boundingBox)
        ? void 0
        : n.clone().applyMatrix4(e.matrixWorld))
      ? null
      : t
  );
}
function eaZ(e) {
  let t = eaK(e);
  return t.isEmpty()
    ? e.controls.target.clone()
    : t.getCenter(new e.modules.THREE.Vector3());
}
function eaX(e) {
  let { THREE: t } = e.modules,
    n = eaZ(e);
  for (let r of eiP(e.editableRoot)) {
    if (!r.name || eoO(e.editableRoot, r.name)) continue;
    let i = eo8(e.animations, r.name),
      o = i
        ? (function (e, t, n, r) {
            var i;
            let o = n.tracks.find((e) => e.name === `${t.name}.position`);
            if (!o || 3 !== o.getValueSize() || o.times.length < 2) return null;
            let a = n.tracks.find((e) => e.name === `${t.name}.quaternion`),
              l = t.parent;
            null == l || l.updateWorldMatrix(!0, !1);
            let s = l ? new e.Matrix4().copy(l.matrixWorld) : new e.Matrix4(),
              u = l
                ? l.getWorldQuaternion(new e.Quaternion())
                : new e.Quaternion(),
              c = null == (i = o.times[o.times.length - 1]) ? 0 : i,
              d = Math.max(n.duration, c),
              p = Math.min(Math.max(o.times.length, 2), R3),
              h = o.createInterpolant(new Float32Array(3)),
              f =
                a && 4 === a.getValueSize()
                  ? a.createInterpolant(new Float32Array(4))
                  : null,
              m = [],
              g = [];
            for (let t = 0; t < p; t += 1) {
              let n = (d * t) / (p - 1),
                i = h.evaluate(n),
                o = new e.Vector3(i[0], i[1], i[2]).applyMatrix4(s);
              if ((m.push(o), !f)) continue;
              let a = f.evaluate(n),
                l = new e.Vector3(0, 0, -1).applyQuaternion(
                  new e.Quaternion(a[0], a[1], a[2], a[3]).premultiply(u),
                ),
                c = o.distanceTo(r);
              g.push(o.clone().addScaledVector(l, c > 0.001 ? c : 1));
            }
            let v = new e.Box3()
              .setFromPoints(m)
              .getSize(new e.Vector3())
              .length();
            if (v < 1e-4) return null;
            let y =
                g.length > 0
                  ? g
                      .reduce((e, t) => e.add(t), new e.Vector3())
                      .divideScalar(g.length)
                  : r.clone(),
              b = new e.Group();
            ((b.name = eoA(t.name)),
              (b.userData[RK] = t.name),
              (b.userData.hf_id = eat(t.name, "path")));
            let x = eoq(e, b, t.name, y);
            ((x.aim.userData.hf_id = eat(t.name, "aim")),
              (x.focus.userData.hf_id = eat(t.name, "focus")),
              "string" != typeof t.userData.blockingStudioDofFocus &&
                (t.userData[RQ] = x.focus.name));
            let w = (function (e, t) {
              if (e.length <= R5) return e.map((e, t) => t);
              let n = 0.01 * Math.max(t, 0),
                r = eae(e, n);
              for (; r.length > R4 && n < t;) ((n *= 1.8), (r = eae(e, n)));
              return r.length <= R4
                ? r
                : Array.from({ length: R4 }, (t, n) =>
                    Math.round((n * (e.length - 1)) / (R4 - 1)),
                  );
            })(
              m.map((e) => e.toArray()),
              v,
            );
            w.forEach((n, r) => {
              let i = eoG(e, eoN(r), m[n].clone());
              ((i.userData.hf_id = eat(t.name, `waypoint-${r}`)), b.add(i));
            });
            let S = m[w[0]].clone(),
              k = S.distanceTo(y);
            return (
              eoQ(b, {
                three: e,
                origin: S,
                focus: y.clone(),
                radius: k > 1e-4 ? k : 1,
              }),
              eo$(b, {
                ...R6,
                enabled: !1,
                duration: Math.max(d, R2),
                easing: "linear",
                aim: "target",
                targetName: x.aim.name,
                presetId: null,
              }),
              b
            );
          })(t, r, i, n)
        : null;
    o && e.editableRoot.add(o);
  }
}
function eaJ(e, t, n) {
  if (!t || 0 === t.length) return null;
  let r = new e.Box3();
  for (let e of t) r.expandByPoint(n.setFromMatrixPosition(e.matrixWorld));
  return r;
}
export const pathForCamera = eoO,
  pathAncestor = eoz,
  readPathSettings = eoW,
  makePathCurve = eo1;
export const bakeCameraPath = eo4,
  readCameraRig = ear,
  applyCameraRig = eao,
  replaceCameraAnimation = eo9,
  insertCameraKeyframe = ean;
export const ensureCameraPaths = (
  root,
  animations,
  controls = { target: new THREE.Vector3() },
) => eaX({ modules: { THREE }, editableRoot: root, animations, controls });
export const makePathPreview = (path) => {
  const settings = eoW(path);
  const curve = eo1(THREE, path, settings);
  return curve
    ? curve.getSpacedPoints(Math.min(Math.max(48 * eoL(path).length, 96), 640))
    : [];
};
// libtv eo3 refreshes geometry only when the path signature changes.
export const pathPreviewSignature = (path) => {
  path.updateWorldMatrix(true, true);
  const settings = eoW(path);
  return `${eoL(path).map(node=>node.position.toArray().map(value=>value.toFixed(4)).join(',')).join('|')}#${settings.curve}#${settings.tension}#${settings.closed}#${path.matrixWorld.elements.join(',')}`;
};

export const pathWaypoints = eoL;
export const sceneBounds = eaK;
export const pathDuration = (path) => eoB(eoW(path));
export const updatePathSettings = (path, patch) =>
  eo$(path, { ...eoW(path), ...patch });
export const sceneFocus = (root, controls) =>
  eaZ({ modules: { THREE }, editableRoot: root, controls });

// libtv r1: a new camera clip starts with two coincident states, fixed rotation.
export function createCameraPath(root, camera, focus, duration) {
  const existing = eoO(root, camera.name);
  if (existing) return existing;
  const path = new THREE.Group();
  path.name = eoA(camera.name);
  path.userData[RK] = camera.name;
  root.add(path);
  const position = path.worldToLocal(
    camera.getWorldPosition(new THREE.Vector3()),
  );
  for (let index = 0; index < R5; index++)
    path.add(eoG(THREE, eoN(index), position.clone()));
  const targets = eoq(THREE, path, camera.name, focus);
  eoQ(path, eoX(THREE, camera, focus));
  eo$(path, {
    ...R6,
    enabled: false,
    aim: "fixed",
    targetName: targets.aim.name,
    duration: Math.max(duration, R2),
    easing: "linear",
  });
  return path;
}

// libtv r5: insert at the nearest interval, using the camera's current world pose.
export function addPathKeyframe(path, camera, time) {
  const states = eoL(path);
  if (!states.length) return null;
  const index = Math.min(
    Math.max(
      Math.round(
        Math.min(Math.max(time / eoB(eoW(path)), 0), 1) * (states.length - 1),
      ),
      1,
    ),
    states.length - 1,
  );
  const next = eoG(
    THREE,
    eoN(states.length),
    path.worldToLocal(camera.getWorldPosition(new THREE.Vector3())),
  );
  path.add(next);
  states.splice(index, 0, next);
  eoZ(path, states);
  return next;
}
export function removePathKeyframe(path, id) {
  const states = eoL(path);
  if (states.length <= R5) return false;
  const state = states.find(
    (node) => node.uuid === id || node.userData.hf_id === id,
  );
  if (!state) return false;
  state.removeFromParent();
  eoZ(path);
  return true;
}

// libtv inline preset application in eiK's trajectoryPresets callback.
export function applyPathPreset(path, camera, id, focus) {
  const anchor = eoY(THREE, path) ?? eoX(THREE, camera, focus);
  const preset = RU.find((item) => item.id === id);
  if (!preset) return false;
  const { points, settings } = preset.build(anchor);
  if (points.length < R5) return false;
  const previous = eoW(path),
    intensity = Math.min(Math.max(previous.intensity, 0.25), 2);
  const framing = { close: 0.72, medium: 1, wide: 1.35 }[previous.framing];
  for (const state of eoL(path)) state.removeFromParent();
  path.updateWorldMatrix(true, false);
  const inverse = path.matrixWorld.clone().invert();
  const origin = anchor.origin
    .clone()
    .sub(anchor.focus)
    .multiplyScalar(framing)
    .add(anchor.focus);
  points.forEach((point, index) => {
    const position = point
      .clone()
      .sub(anchor.focus)
      .multiplyScalar(framing)
      .add(anchor.focus)
      .sub(origin)
      .multiplyScalar(intensity)
      .add(origin)
      .applyMatrix4(inverse);
    path.add(eoG(THREE, eoN(index), position));
  });
  eoZ(path);
  eoQ(path, anchor);
  eo$(path, {
    ...previous,
    closed: R6.closed,
    easing: R6.easing,
    ...settings,
    presetId: id,
  });
  return true;
}

// libtv eoC/RU geometric preset builders, complete native builders; eaO still exposes the same six cards.
function eox({ three: e, origin: t, focus: n, radius: r }) {
  let i = new e.Vector3(0, 1, 0),
    o = new e.Vector3().subVectors(t, n);
  1e-8 > o.lengthSq() && o.set(0, 0, Math.max(r, 1));
  let a = new e.Vector3().crossVectors(i, o);
  1e-8 > a.lengthSq() ? a.set(1, 0, 0) : a.normalize();
  let l = new e.Vector3(o.x, 0, o.z);
  return (
    1e-8 > l.lengthSq() ? l.crossVectors(a, i).normalize() : l.normalize(),
    {
      focus: n.clone(),
      offset: o,
      radius: Math.max(r, 0.001),
      up: i,
      right: a,
      horizontal: l,
      height: o.y,
    }
  );
}
function eow(e, t, n = 1, r = 0) {
  let i = e.offset.clone().applyAxisAngle(e.up, t).multiplyScalar(n);
  return ((i.y += e.radius * r), i.add(e.focus));
}
function eoS(e, t, n = 0, r = 0) {
  let i = e.offset.clone().multiplyScalar(t);
  return (
    (i.y += e.radius * n),
    i.add(e.right.clone().multiplyScalar(e.radius * r)),
    i.add(e.focus)
  );
}
function eok(e, t) {
  return t <= 1 ? 0 : e / (t - 1);
}
const RH = 2 * Math.PI;
const RU = [{id:"orbit-360",label:"Orbit 360",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:8},(e,n)=>eow(t,n/8*RH)),settings:{aim:"target",closed:!0,easing:"linear",duration:12}}}},{id:"orbit-half",label:"Orbit 180",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>eow(t,(eok(n,5)-.5)*Math.PI)),settings:{aim:"target",duration:8}}}},{id:"arc-left",label:"Arc left",group:"orbit",build:e=>{let t=eox(e);return{points:[.55,0,-.55].map((e,n)=>eow(t,e,1,.12*(1===n))),settings:{aim:"target",duration:6}}}},{id:"arc-right",label:"Arc right",group:"orbit",build:e=>{let t=eox(e);return{points:[-.55,0,.55].map((e,n)=>eow(t,e,1,.12*(1===n))),settings:{aim:"target",duration:6}}}},{id:"spiral-up",label:"Spiral up",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:10},(e,n)=>{let r=eok(n,10);return eow(t,r*RH*1.5,1-.35*r,.9*r)}),settings:{aim:"target",easing:"linear",duration:14}}}},{id:"spiral-down",label:"Spiral down",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:10},(e,n)=>{let r=eok(n,10);return eow(t,-r*RH*1.5,1+.35*r,.9-.9*r)}),settings:{aim:"target",easing:"linear",duration:14}}}},{id:"figure-eight",label:"Figure eight",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:8},(e,n)=>{let r=n/8*RH,i=t.horizontal.clone().multiplyScalar(.5*t.radius*Math.sin(2*r));return i.add(t.right.clone().multiplyScalar(t.radius*Math.sin(r))),i.y=t.height,i.add(t.focus)}),settings:{aim:"target",closed:!0,easing:"linear",duration:16}}}},{id:"dolly-in",label:"Dolly in",group:"dolly",build:e=>{let t=eox(e);return{points:[1.6,1.1,.6].map(e=>eoS(t,e)),settings:{aim:"target",duration:6}}}},{id:"dolly-out",label:"Dolly out",group:"dolly",build:e=>{let t=eox(e);return{points:[.6,1.1,1.6].map(e=>eoS(t,e)),settings:{aim:"target",duration:6}}}},{id:"push-in-low",label:"Low push in",group:"dolly",build:e=>{let t=eox(e);return{points:[eoS(t,1.7,-.35),eoS(t,1.1,-.1),eoS(t,.65,.15)],settings:{aim:"target",easing:"out",duration:7}}}},{id:"truck-left",label:"Truck left",group:"dolly",build:e=>{let t=eox(e);return{points:[.9,0,-.9].map(e=>eoS(t,1,0,e)),settings:{aim:"target",duration:7}}}},{id:"truck-right",label:"Truck right",group:"dolly",build:e=>{let t=eox(e);return{points:[-.9,0,.9].map(e=>eoS(t,1,0,e)),settings:{aim:"target",duration:7}}}},{id:"s-curve",label:"S curve",group:"dolly",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>{let r=eok(n,5);return eoS(t,1.5-.9*r,0,.35*Math.sin(r*RH))}),settings:{aim:"tangent",duration:8}}}},{id:"crane-up",label:"Crane up",group:"crane",build:e=>{let t=eox(e);return{points:[eoS(t,1.15,-.4),eoS(t,1,.25),eoS(t,.95,.95)],settings:{aim:"target",duration:8}}}},{id:"crane-down",label:"Crane down",group:"crane",build:e=>{let t=eox(e);return{points:[eoS(t,.95,.95),eoS(t,1,.25),eoS(t,1.15,-.4)],settings:{aim:"target",duration:8}}}},{id:"flyover",label:"Flyover",group:"aerial",build:e=>{let t=eox(e);return{points:[eoS(t,1.8,-.15),eoS(t,.8,.7),eoS(t,-.2,1.1),eoS(t,-1.2,.6)],settings:{aim:"target",easing:"linear",duration:10}}}},{id:"drone-pullback",label:"Drone pullback",group:"aerial",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>{let r=eok(n,5);return eoS(t,.5+1.8*r,-.2+1.1*r)}),settings:{aim:"target",easing:"in",duration:10}}}},{id:"reveal-behind",label:"Reveal",group:"reveal",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>{let r=eok(n,5);return eow(t,(1-r)*Math.PI*.75,1.3-.3*r,-.3+.3*r)}),settings:{aim:"target",easing:"out",duration:9}}}}];
export const cameraPathPresets = RU;
