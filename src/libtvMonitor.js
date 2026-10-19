import * as THREE from "three";
import { sceneBounds as eaK } from "./libtvCameraRig.js";
// libtv elU/elK/elH/el$: published monitor capture, scheduling and disposal.
const elF = 1000 / 24,
  elq = "topView",
  elV = "orbitView",
  elW = 16 / 9,
  _x = "blockingStudioAspect";
const eln = (runtime, id) => {
  const project = runtime.editableRoot.userData.libtvProjectAspect;
  if (Number.isFinite(project) && project > 0) return project;
  const aspect = runtime.editableRoot.getObjectByProperty("uuid", id)?.userData[
    _x
  ];
  return Number.isFinite(aspect) ? aspect : null;
};
// Adapter for ea3: clean offscreen render through the existing renderer and scene.
function ea3(size, runtime, id) {
  const view =
    id === "orbit"
      ? runtime.orbitCamera
      : runtime.editableRoot.getObjectByProperty("uuid", id);
  if (!view) return;
  runtime.grid.mesh.visible = false;
  runtime.pathContainer.visible = false;
  if (view.isPerspectiveCamera) {
    view.aspect = size.clientWidth / size.clientHeight;
    view.updateProjectionMatrix();
  }
  runtime.renderer.setScissorTest(false);
  runtime.renderer.setViewport(0, 0, size.clientWidth, size.clientHeight);
  runtime.renderer.clear();
  runtime.renderer.render(runtime.scene, view);
}
function elU(e, t, n, r) {
  let i = n === elq,
    o = n === elV,
    a = i
      ? null
      : o
        ? e.libtvMonitor3dView?.camera
        : e.editableRoot.getObjectByProperty("uuid", n);
  if (!i && !(null != a && (o || a.isCamera))) return null;
  let l = i || o ? null : eln(e, n);
  l > 0 || (l = elW);
  let s = e.renderer.getPixelRatio(),
    u = Math.floor(
      Math.min(2048, e.renderer.capabilities?.maxTextureSize || 2048) / s,
    ),
    c = Math.min(r > 0 ? Math.ceil(r / Math.min(l, elW)) : 96, u, u / l),
    d = Math.max(Math.round(c * l), 1);
  c = Math.max(Math.round(c), 1);
  let p = e.transformGizmos.group.visible,
    h = e.helpers.group.visible,
    f = e.grid.mesh.visible,
    m = e.pathContainer.visible,
    g = e.topView,
    v = e.orbitCamera,
    y = a && a.isPerspectiveCamera ? a.aspect : null;
  ((e.transformGizmos.group.visible = !1), (e.helpers.group.visible = !1));
  try {
    let t,
      r = Math.max(Math.round(d * s), 1),
      u = Math.max(Math.round(c * s), 1),
      p =
        ((t = e.libtvMonitorTarget)
          ? (t.width !== r || t.height !== u) && t.setSize(r, u)
          : (t = e.libtvMonitorTarget =
              new e.modules.THREE.WebGLRenderTarget(r, u)),
        t);
    (i
      ? ((e.topView = !0),
        (e.orbitCamera = (function (e, t) {
          let n = e.modules.THREE,
            r = e.libtvMonitorTopCamera;
          (r || (r = e.libtvMonitorTopCamera = e.orbitCamera.clone()),
            (r.fov = e.orbitCamera.fov),
            (r.aspect = t),
            r.up.set(0, 0, -1));
          let i = eaK(e);
          if (i.isEmpty())
            (r.position.set(0, 5, 0),
              (r.near = 0.1),
              (r.far = 1e3),
              r.lookAt(0, 0, 0));
          else {
            let e = i.getBoundingSphere(new n.Sphere()),
              o = i.getSize(new n.Vector3()),
              a = Math.tan(n.MathUtils.degToRad(r.fov) / 2),
              l =
                1.15 *
                Math.max(
                  Math.max(o.z / 2, 0.05) / a,
                  Math.max(o.x / 2, 0.05) / Math.max(t * a, 0.001),
                  o.y / 2,
                  0.1,
                );
            (r.position.copy(e.center).add(new n.Vector3(0, l, 0)),
              (r.near = Math.max((l - o.y / 2) / 1e3, 0.001)),
              (r.far = Math.max(l + o.y / 2 + 100 * e.radius, 100)),
              r.lookAt(e.center.x, e.center.y, e.center.z));
          }
          return (r.updateProjectionMatrix(), r.updateMatrixWorld(!0), r);
        })(e, l)))
      : o &&
        ((e.topView = !1),
        (e.orbitCamera = a),
        (a.aspect = l),
        a.updateProjectionMatrix()),
      e.renderer.setRenderTarget(p),
      (e.libtvMonitorCapturing = !0));
    try {
      ea3(
        { clientWidth: d, clientHeight: c },
        e,
        i || o ? "orbit" : n,
        null,
        !1,
      );
    } finally {
      ((e.libtvMonitorCapturing = !1), e.renderer.setRenderTarget(null));
    }
    return (function (e, t, n, r) {
      let i = e.libtvMonitorReadback;
      if (!i || i.width !== n || i.height !== r) {
        let t = i?.context || document.createElement("canvas").getContext("2d");
        if (!t) return null;
        ((t.canvas.width = n), (t.canvas.height = r));
        let o = new Uint8ClampedArray(n * r * 4),
          a = new Uint8ClampedArray(o.length);
        i = e.libtvMonitorReadback = {
          context: t,
          pixels: o,
          flipped: a,
          width: n,
          height: r,
          image: new ImageData(a, n, r),
        };
      }
      let { context: o, pixels: a, flipped: l, image: s } = i;
      e.renderer.readRenderTargetPixels(t, 0, 0, n, r, a);
      let u = 4 * n;
      for (let e = 0; e < r; e += 1)
        l.set(a.subarray((r - e - 1) * u, (r - e) * u), e * u);
      return (o.putImageData(s, 0, 0), o.canvas.toDataURL("image/jpeg", 0.72));
    })(e, p, r, u);
  } catch {
    return null;
  } finally {
    ((e.topView = g),
      (e.orbitCamera = v),
      (e.transformGizmos.group.visible = p),
      (e.helpers.group.visible = h),
      (e.grid.mesh.visible = f),
      (e.pathContainer.visible = m),
      null !== y && ((a.aspect = y), a.updateProjectionMatrix()),
      e.renderer.setScissorTest(!1),
      e.renderer.setViewport(
        0,
        0,
        Math.max(t.clientWidth, 1),
        Math.max(t.clientHeight, 1),
      ),
      (e.needsRender = !0));
  }
}
function elK(e, t, n, r, i = !0, o = !1, a = !1, l = null) {
  if (!n || "function" != typeof n.request || "function" != typeof n.emit)
    return;
  let s = n.request(),
    u = t.libtvMonitorState;
  if (o || !s) {
    (u &&
      (o || u.activeCameraId || Object.keys(u.frames).length) &&
      n.emit({
        cameras: o ? [] : u.cameras,
        frames: {},
        playbackCameraId: null,
        topView: !o && t.topView,
      }),
      elH(t));
    return;
  }
  u ||
    (u = t.libtvMonitorState =
      {
        frames: {},
        frameWidths: {},
        thumbnailWidth: null,
        stale: new Set(),
        signature: null,
        checkedAt: -1 / 0,
        activeCheckedAt: -1 / 0,
        activeCameraId: null,
        playbackCameraId: null,
        playbackCapturedAt: -1 / 0,
        cameras: [],
        cameraIds: new Set(),
        names: "",
        invalidated: !1,
        request: null,
        pending: !0,
        topView: t.topView,
      });
  let c =
    Number.isFinite(s.thumbnailWidth) && s.thumbnailWidth > 0
      ? Math.ceil(s.thumbnailWidth)
      : 0;
  u.thumbnailWidth !== c && ((u.thumbnailWidth = c), (u.pending = !0));
  let d = u.request !== s || u.topView !== t.topView;
  if (((u.topView = t.topView), r - u.checkedAt >= 500)) {
    let e, n, i, o;
    u.checkedAt = r;
    let a =
        ((e = 0),
        (n = []),
        (i = (t) => {
          e = (31 * e + (0 | Math.round(1e3 * (t || 0)))) | 0;
        }),
        (o = (e) => {
          e && (i(e.r), i(e.g), i(e.b));
        })(t.worldBackground),
        i(t.worldStrength),
        i(t.renderer.shadowMap?.enabled),
        t.editableRoot.traverse((r) => {
          var a = r.uuid;
          if ("string" == typeof a)
            for (let t = 0; t < a.length; t++)
              e = (31 * e + a.charCodeAt(t)) | 0;
          if (
            (i(r.visible ? 1 : 2),
            i(r.position.x),
            i(r.position.y),
            i(r.position.z),
            i(r.quaternion.x),
            i(r.quaternion.y),
            i(r.quaternion.z),
            i(r.quaternion.w),
            i(r.scale.x),
            i(r.scale.y),
            i(r.scale.z),
            r.isCamera)
          )
            for (let e of ((function (e, t) {
              for (let n = e; n; n = n.parent) {
                if (!1 === n.visible) return !1;
                if (n === t) break;
              }
              return !0;
            })(r, t.editableRoot) &&
              n.push({
                id: r.uuid,
                name: "string" == typeof r.name ? r.name : "",
              }),
            i(r.fov),
            i(r.zoom),
            i(r.near),
            i(r.far),
            i(r.userData?.[_x]),
            r.projectionMatrix?.elements || []))
              i(e);
          if ((o(r.color), i(r.intensity), r.material))
            for (let e of Array.isArray(r.material) ? r.material : [r.material])
              (i(e.id),
                i(e.opacity),
                i(e.side),
                i(e.transparent),
                i(e.alphaTest),
                i(e.depthTest),
                i(e.depthWrite),
                i(e.wireframe),
                i(e.emissiveIntensity),
                i(e.envMapIntensity),
                o(e.color),
                o(e.emissive),
                i(e.roughness),
                i(e.metalness));
        }),
        { signature: e, cameras: n }),
      l = JSON.stringify(a.cameras);
    ((d = d || l !== u.names),
      a.signature !== u.signature && (u.invalidated = !0),
      (u.signature = a.signature),
      (u.names = l),
      (u.cameras = a.cameras),
      (u.cameraIds = new Set(a.cameras.map((e) => e.id))));
  }
  let p = u.cameraIds.has(l) ? l : null;
  ((d = d || u.activeCameraId !== p), (u.activeCameraId = p));
  let h = a && s.cameraIds?.includes(p) ? p : null;
  u.playbackCameraId !== h &&
    (u.playbackCameraId && u.stale.add(u.playbackCameraId),
    (u.playbackCameraId = h),
    (u.playbackCapturedAt = -1 / 0),
    (u.pending = !0));
  let f = h && r - u.playbackCapturedAt >= elF,
    m = !i && a && r - u.activeCheckedAt >= 500;
  if (
    (m && (u.activeCheckedAt = r),
    !d && u.request === s && !m && !f && (!i || (!u.invalidated && !u.pending)))
  )
    return;
  u.request = s;
  let g = new Set();
  for (let e of (s.topView && g.add(elq),
  s.orbitView && t.libtvMonitor3dView && g.add(elV),
  s.cameraIds || []))
    u.cameraIds.has(e) && g.add(e);
  for (let e of Object.keys(u.frames))
    g.has(e) || (delete u.frames[e], delete u.frameWidths[e], (d = !0));
  for (let e of u.stale) g.has(e) || u.stale.delete(e);
  i &&
    u.invalidated &&
    ((u.stale = new Set(g)), (u.invalidated = !1), (d = !0));
  let v = 0;
  if (f) {
    let n = elU(t, e, h, c);
    ((u.frames[h] = n || u.frames[h] || ""),
      (u.frameWidths[h] = c),
      u.stale.delete(h),
      (u.playbackCapturedAt = r),
      (v += 1),
      (d = !0));
  }
  if (i || m)
    for (let n of g) {
      if (v >= 2) break;
      if (
        void 0 !== u.frames[n] &&
        u.frameWidths[n] === c &&
        (!i || !u.stale.has(n))
      )
        continue;
      let r = elU(t, e, n, c);
      ((u.frames[n] = r || u.frames[n] || ""),
        (u.frameWidths[n] = c),
        u.stale.delete(n),
        (v += 1),
        (d = !0));
    }
  for (let e of ((u.pending = !1), g))
    if (void 0 === u.frames[e] || u.frameWidths[e] !== c || u.stale.has(e)) {
      u.pending = !0;
      break;
    }
  d &&
    n.emit({
      cameras: u.cameras,
      frames: { ...u.frames },
      playbackCameraId: u.activeCameraId,
      topView: u.topView,
    });
}
function elH(e) {
  (e.libtvMonitorTarget?.dispose(), (e.libtvMonitorTarget = null));
  let t = e.libtvMonitorReadback;
  (t && (t.context.canvas.width = t.context.canvas.height = 0),
    (e.libtvMonitorReadback = null),
    (e.libtvMonitorTopCamera = null),
    (e.libtvMonitorState = null));
}
function el$(e) {
  let t = e.libtvMonitor3dView;
  if (!t) return;
  let n = e.orbitCamera.aspect;
  (e.orbitCamera.copy(t.camera, !1),
    (e.orbitCamera.aspect = n),
    e.orbitCamera.updateProjectionMatrix(),
    e.controls.target.copy(t.target),
    (e.controls.enableRotate = !0),
    e.controls.update(),
    (e.needsRender = !0),
    (e.libtvMonitor3dView = null));
}
export {
  elU as captureMonitorFrame,
  elK as updateMonitor,
  elH as disposeMonitor,
  el$ as restoreMonitor3D,
};
