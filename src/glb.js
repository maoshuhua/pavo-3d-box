import {randomUUID} from './uuid.js';
import * as THREE from "three";
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {prepareLightingExport,restoreLightingNodes,remapLightingIds,updateLightingRuntime} from './lightingRuntime.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { createSceneEditor, assignEntityIds, entityId } from "./sceneEditor.js";
import { createStudioGrid } from "./studioGrid.js";
import {normalizeCameraPathBindings} from './cameraPathBindings.js';
import {findMotionEntity} from './cameraPathSampling.js';
import {AUTO_CAMERA_VIEW, timelineCameraId, resolveCameraViewId,cameraFrameAspect} from './timelineCamera.js';
import {
  updateMonitor,
  disposeMonitor,
  restoreMonitor3D,
} from "./libtvMonitor.js";
import { sceneBounds } from "./libtvCameraRig.js";
import {
  ensureCameraPaths,
  pathAncestor,
  pathForCamera,
  bakeCameraPath,
  readCameraRig,
  applyCameraRig,
  replaceCameraAnimation,
} from "./libtvCameraRig.js";

export async function readGlb(file) {
  if (!file.name.toLowerCase().endsWith(".glb"))
    throw new Error("请选择 .glb 文件。");
  if (file.size > 0x6400000) throw new Error("GLB 文件不能超过 100 MiB。");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength < 12) throw new Error("文件不是完整的 glTF 2.0 GLB。");
  const header = new DataView(bytes);
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error("文件不是完整的 glTF 2.0 GLB。");
  return bytes;
}

// Local replacement for libtv's onUploadSceneAsset. No network/backend upload.
export async function saveAsset(file, bytes, id) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("3d-box-local-assets", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("assets", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("assets", "readwrite");
      transaction
        .objectStore("assets")
        .put({ id, name: file.name, bytes, savedAt: Date.now() });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("本地保存失败。"));
    });
  } finally {
    db.close();
  }
}

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

export function createViewport(host, onDetails = () => {}, callbacks = {}) {
  RectAreaLightUniformsLib.init();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#83888e");
  let worldSettings = {
    type: "solid",
    color: scene.background.toArray(),
    strength: 1,
  };
  const grid = createStudioGrid();
  scene.add(grid.mesh);
  let editor,
    restoring = false;
  const setWorld = (settings) => {
    worldSettings = structuredClone(settings);
    scene.background.setRGB(...settings.color);
    const environmentScene = settings.environment?.preset==='studio'?new RoomEnvironment():new THREE.Scene();
    if(!settings.environment||settings.environment.preset==='solid')environmentScene.background = settings.environment?.color?new THREE.Color().fromArray(settings.environment.color):scene.background.clone();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment?.dispose();
    scene.environment = pmrem.fromScene(environmentScene).texture;
    pmrem.dispose();
    environmentScene.dispose?.();
    scene.environmentIntensity = settings.environment?.strength??settings.strength;
    renderer.toneMapping=settings.toneMapping==='none'?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=settings.exposure??1;
  };
  setWorld(worldSettings);
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000);
  camera.position.setFromSphericalCoords(
    5,
    THREE.MathUtils.degToRad(72),
    THREE.MathUtils.degToRad(35),
  );
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(4, 8, 5);
  light.castShadow = true;
  light.visible = false;
  scene.add(light); // Only an import-fit shadow helper; editable lights live in root.
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const loader = new GLTFLoader()
    .setDRACOLoader(draco)
    .setMeshoptDecoder(MeshoptDecoder);
  // GLB imports are self-contained. Never fetch an embedded external URI.
  loader.manager.setURLModifier((url) => {
    if (/^(blob:|data:)/i.test(url)) return url;
    throw new Error("请使用纹理和资源内嵌的 GLB 文件。");
  });
  let disposed = false;
  let monitorContext,
    monitorFrame,
    monitorPlaying = false,
    lastInteraction = 0;
  let topView = false,
    previewMode = false;
  const mixers = [];
  let exporting = false;
  let exportCameraOverride;
  let cameras = [],
    shots = [],
    duration = 15,
    time = 0,
    selectedCamera = null,
    cameraView = null,
    pipRect = null;
  const past = [],
    future = [];
  const getProjectAspect = () => {
    const value = root.userData.libtvProjectAspect;
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const applyProjectAspect = () => {
    const aspect = getProjectAspect();
    if (aspect === null) return;
    root.traverse((value) => {
      if (!value.isCamera) return;
      value.userData.blockingStudioAspect = aspect;
      if (value.isPerspectiveCamera) value.aspect = aspect;
      if (value.isOrthographicCamera) {
        const center = (value.left + value.right) / 2;
        const halfWidth = ((value.top - value.bottom) * aspect) / 2;
        value.left = center - halfWidth;
        value.right = center + halfWidth;
      }
      value.updateProjectionMatrix();
    });
  };
  const target = new THREE.WebGLRenderTarget(1, 1);
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const overlayMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      preview: { value: target.texture },
      size: { value: new THREE.Vector2(1, 1) },
      radius: { value: 12 },
    },
    vertexShader:
      "varying vec2 previewUv; void main(){previewUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
    fragmentShader:
      "uniform sampler2D preview; uniform vec2 size; uniform float radius; varying vec2 previewUv; void main(){vec2 edgeDistance=min(previewUv*size,(1.0-previewUv)*size);if(edgeDistance.x<radius&&edgeDistance.y<radius){vec2 cornerDistance=vec2(radius)-edgeDistance;if(dot(cornerDistance,cornerDistance)>radius*radius) discard;}gl_FragColor=texture2D(preview,previewUv);}",
  });
  overlayScene.add(
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMaterial),
  );
  const activeCamera = () => {
    const shotId = timelineCameraId(shots, time, duration);
    return (
      (monitorPlaying || cameraView === AUTO_CAMERA_VIEW
        ? cameras.find((value) => value.userData.hf_id === shotId)
        : null) ??
      cameras.find((value) => value.uuid === selectedCamera) ??
      cameras.find((value) => value.userData.hf_id === shotId) ??
      cameras.find(value=>value.userData.hf_active_camera) ?? cameras[0] ??
      null
    );
  };
  const viewedCameraId = () =>
    resolveCameraViewId(cameraView, cameras, shots, time, duration);
  const publish = () =>
    onDetails({
      ...editor?.details(),
      duration,
      aspect:
        getProjectAspect() ??
        cameras.find(
          (value) =>
            Number.isFinite(value.userData.blockingStudioAspect) &&
            value.userData.blockingStudioAspect > 0,
        )?.userData.blockingStudioAspect ??
        16 / 9,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      exportDetails: getExportDetails(),
      cameras: cameras.map((value) => ({
        id: value.uuid,
        name: value.name || "Camera",
        aspect: cameraFrameAspect(getProjectAspect(),value),
      })),
      activeCameraId: activeCamera()?.uuid ?? null,
      cameraView: viewedCameraId(),
      topView,
      previewMode,
      shots: shots.map((shot, index) => {
        const value = cameras.find(
          (camera) => camera.userData.hf_id === shot.cameraId,
        );
        return {
          ...shot,
          id: `shot-${index}`,
          cameraId: value?.uuid,
          label: value?.name || "Camera",
          kind: "camera",
        };
      }),
      // Static cameras have no baked animation yet. Make their existing camera
      // view expose a camera item so libtv r1 can create the rig on item click.
      // This is derived from the locally saved camera, not an additional UI entry
      // or a replacement of the project's saved shot sequence.
      cameraTimelineItems: (() => {
        const active = activeCamera();
        if (active && !shots.some((shot) => shot.cameraId === entityId(active)))
          return [
            {
              id: `camera-${entityId(active)}`,
              cameraId: active.uuid,
              label: active.name || "Camera",
              start: 0,
              end: Math.max(duration, 0.1),
              kind: "camera",
              trimmable: false,
            },
          ];
        return shots.map((shot, index) => ({
          ...shot,
          id: `shot-${index}`,
          cameraId: cameras.find((camera) => entityId(camera) === shot.cameraId)
            ?.uuid,
          label:
            cameras.find((camera) => entityId(camera) === shot.cameraId)
              ?.name || "Camera",
          kind: "camera",
          trimmable: true,
        }));
      })(),
    });
  const frameRect = (viewId = viewedCameraId()) => {
    const width = Math.max(host.clientWidth, 1),
      height = Math.max(host.clientHeight, 1);
    const viewed = cameras.find((value) => value.uuid === viewId);
    const aspect = viewed ? cameraFrameAspect(getProjectAspect(),viewed) : getProjectAspect();
    if (!Number.isFinite(aspect) || aspect <= 0)
      return { left: 0, top: 0, width, height };
    const frameWidth =
      width / height > aspect ? Math.round(height * aspect) : width;
    const frameHeight =
      width / height > aspect ? height : Math.round(width / aspect);
    return {
      left: Math.floor((width - frameWidth) / 2),
      top: Math.floor((height - frameHeight) / 2),
      width: frameWidth,
      height: frameHeight,
    };
  };
  const render = (includePreview = true) => {
    if (disposed) return;
    updateLightingRuntime(root,time);
    const width = host.clientWidth,
      height = host.clientHeight;
    grid.update(camera, controls.target);
    editor?.updateHelpers(camera, !includePreview || !!cameraView);
    grid.mesh.visible = includePreview && !cameraView;
    const viewed = cameras.find(
      (value) =>
        value.uuid ===
        (exportCameraOverride === undefined
          ? viewedCameraId()
          : exportCameraOverride),
    );
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    // libtv ea3: compose/orbit fills the stage; camera views and clean exports use the project frame.
    if (viewed || (!includePreview && getProjectAspect() !== null)) {
      const aspect = cameraFrameAspect(getProjectAspect(),viewed);
      const viewWidth = Math.min(width, height * aspect),
        viewHeight = viewWidth / aspect;
      renderer.setClearColor(0x000000);
      renderer.clear();
      renderer.setViewport(
        (width - viewWidth) / 2,
        (height - viewHeight) / 2,
        viewWidth,
        viewHeight,
      );
      renderer.setScissor(
        (width - viewWidth) / 2,
        (height - viewHeight) / 2,
        viewWidth,
        viewHeight,
      );
      renderer.setScissorTest(true);
      const mainCamera = viewed ?? camera;
      const originalAspect = mainCamera.aspect;
      if (mainCamera.isPerspectiveCamera) {
        mainCamera.aspect = aspect;
        mainCamera.updateProjectionMatrix();
      }
      renderer.render(scene, mainCamera);
      if(mainCamera.isPerspectiveCamera){mainCamera.aspect=originalAspect;mainCamera.updateProjectionMatrix();}
      renderer.setScissorTest(false);
    } else {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
    const previewCamera = activeCamera();
    if (includePreview && !viewed && previewCamera && pipRect) {
      const { left, top, width: w, height: h } = pipRect;
      const pixelRatio = renderer.getPixelRatio();
      target.setSize(
        Math.max(1, Math.round(w * pixelRatio)),
        Math.max(1, Math.round(h * pixelRatio)),
      );
      const aspect = cameraFrameAspect(getProjectAspect(),previewCamera);
      const originalAspect = previewCamera.aspect;
      if (previewCamera.isPerspectiveCamera) {
        previewCamera.aspect = aspect;
        previewCamera.updateProjectionMatrix();
      }
      const helperVisible = editor?.helpers.visible,
        gizmoVisible = editor?.gizmos.visible,
        pathVisible = editor?.pathContainer.visible,
        gridVisible = grid.mesh.visible;
      if (editor) {
        editor.helpers.visible = false;
        editor.gizmos.visible = false;
        editor.pathContainer.visible = false;
      }
      grid.mesh.visible = false;
      renderer.setRenderTarget(target);
      // WebGLRenderer applies devicePixelRatio to viewport/scissor itself.
      // The target uses physical pixels; these coordinates stay in CSS pixels.
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      const clearColor = renderer.getClearColor(new THREE.Color()).clone(),
        clearAlpha = renderer.getClearAlpha();
      // libtv PiP compositor letterbox background (724240 / #0b0d10).
      renderer.setClearColor(724240, 1);
      renderer.clear();
      renderer.setClearColor(clearColor, clearAlpha);
      const previewWidth = Math.min(w, h * aspect),
        previewHeight = previewWidth / aspect;
      const previewLeft = (w - previewWidth) / 2,
        previewBottom = (h - previewHeight) / 2;
      renderer.setViewport(
        previewLeft,
        previewBottom,
        previewWidth,
        previewHeight,
      );
      renderer.setScissor(
        previewLeft,
        previewBottom,
        previewWidth,
        previewHeight,
      );
      renderer.setScissorTest(true);
      renderer.render(scene, previewCamera);
      if(previewCamera.isPerspectiveCamera){previewCamera.aspect=originalAspect;previewCamera.updateProjectionMatrix();}
      renderer.setScissorTest(false);
      if (editor) {
        editor.helpers.visible = helperVisible;
        editor.gizmos.visible = gizmoVisible;
        editor.pathContainer.visible = pathVisible;
      }
      grid.mesh.visible = gridVisible;
      renderer.setRenderTarget(null);
      renderer.setViewport(left, height - top - h, w, h);
      renderer.setScissor(left, height - top - h, w, h);
      renderer.setScissorTest(true);
      overlayMaterial.uniforms.size.value.set(w, h);
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlayScene, overlayCamera);
      renderer.autoClear = oldAutoClear;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
    }
  };
  let orbitFrame;
  let monitorDirty = false,
    monitorAspectDirty = false;
  const invalidateMonitor = (aspectChanged = false) => {
    monitorDirty = true;
    monitorAspectDirty ||= aspectChanged;
  };
  const flushMonitorInvalidation = () => {
    const state = monitorContext?.libtvMonitorState;
    if (!monitorDirty || !state) return;
    // Finish libtv's two-frames-per-tick batch before starting another one.
    // Restarting stale on every pointer/input event starves later cameras.
    if (state.pending && state.stale.size) return;
    // libtv's project-aspect dirty callback drops camera frames immediately.
    if (monitorAspectDirty)
      for (const id of state.cameraIds) delete state.frames[id];
    monitorDirty = false;
    monitorAspectDirty = false;
    state.invalidated = true;
    state.pending = true;
    state.request = null;
    state.checkedAt = -Infinity;
    state.activeCheckedAt = -Infinity;
    state.playbackCapturedAt = -Infinity;
  };
  controls.addEventListener("change", () => {
    lastInteraction = performance.now();
    render();
    cancelAnimationFrame(orbitFrame);
    orbitFrame = requestAnimationFrame(() => {
      if (!disposed) controls.update();
    });
  });
  const sizeFor = (frame) => {
    const ratio = renderer.getPixelRatio();
    const width = Math.max(frame.width * ratio, 2),
      height = Math.max(frame.height * ratio, 2);
    const scale = Math.min(1, 1920 / Math.max(width, height));
    return {
      width: Math.max(2, 2 * Math.floor((width * scale) / 2)),
      height: Math.max(2, 2 * Math.floor((height * scale) / 2)),
    };
  };
  const videoView = () => viewedCameraId() ?? activeCamera()?.uuid ?? null;
  const getExportDetails = () => ({
    ...sizeFor(frameRect()),
    videoSize: sizeFor(frameRect(videoView())),
    durationSeconds:
      mixers.some((value) => value.actions.length) ||
      shots.length ||
      cameras.length
        ? duration
        : 0,
  });
  const copyFrame = (context, size, frame) => {
    const aspect = size.width / size.height,
      ratio = renderer.getPixelRatio();
    const width = Math.min(frame.width, frame.height * aspect),
      height = Math.min(frame.height, frame.width / aspect);
    render(false);
    context.drawImage(
      renderer.domElement,
      (frame.left + (frame.width - width) / 2) * ratio,
      (frame.top + (frame.height - height) / 2) * ratio,
      width * ratio,
      height * ratio,
      0,
      0,
      size.width,
      size.height,
    );
  };
  const resize = () => {
    const width = Math.max(host.clientWidth, 1),
      height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
    publish();
  };
  const getClips = () =>
    mixers.flatMap((value) => value.actions.map((action) => action.getClip()));
  const registerAnimations = (model, clips) => {
    if (!clips.length) return;
    const mixer = new THREE.AnimationMixer(model);
    const actions = clips.map((clip) => mixer.clipAction(clip).reset().play());
    mixers.push({ model, mixer, actions });
  };
  const setClips = (clips) => {
    for (const item of mixers) {
      item.mixer.stopAllAction();
      item.mixer.uncacheRoot(item.model);
    }
    mixers.length = 0;
    registerAnimations(root, clips);
    if (!shots.length && clips.length)
      duration = Math.max(...clips.map((clip) => clip.duration));
  };
  const evaluateClips = () => {
    for (const { mixer, actions } of mixers) {
      for (const action of actions) {
        action.paused = false;
        action.enabled = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.time = Math.min(time, action.getClip().duration);
      }
      mixer.update(0);
    }
    root.updateMatrixWorld(true);
  };
  const applyRig = (object, rig) => {
    const clip = applyCameraRig(THREE, root, object, rig);
    setClips(replaceCameraAnimation(getClips(), object.name, clip));
    evaluateClips();
  };
  const refreshCameraClip = (object, clip, oldDuration = duration) => {
    if (!clip) return;
    setClips(replaceCameraAnimation(getClips(), object.name, clip));
    if (!shots.length) {
      duration = Math.max(
        clip.duration,
        ...getClips().map((value) => value.duration),
      );
      shots = [{ cameraId: entityId(object), start: 0, end: duration }];
    } else if (
      shots.length === 1 &&
      shots[0].cameraId === entityId(object) &&
      shots[0].start === 0 &&
      shots[0].end === oldDuration
    ) {
      duration = Math.max(
        clip.duration,
        ...getClips().map((value) => value.duration),
      );
      shots = [{ ...shots[0], end: duration }];
    } else {
      duration = Math.max(
        duration,
        ...getClips().map((value) => value.duration),
      );
    }
    root.userData.blockingStudioTimeline = JSON.stringify({
      version: 1,
      duration,
      shots,
    });
    time = Math.min(time, duration);
    evaluateClips();
    callbacks.onSeek?.(time);
  };
  const pendingPaths = new Map();
  const bakePath = (path) => {
    const object = root.getObjectByName(path.userData.blockingStudioPathFor);
    if (!object?.isCamera) return;
    const clip = bakeCameraPath(THREE, root, path, object,getClips());
    refreshCameraClip(object, clip);
    root.traverse(p=>{if(p.userData.blockingStudioPathFor===object.name)p.userData.pathPreviewRevision=(p.userData.pathPreviewRevision??0)+1;});
    if (!restoring)
      callbacks.onEdit?.({
        entityId: entityId(object),
        kind: "camera.rig.set",
        payload: {
          rig: readCameraRig(
            THREE,
            object,
            path,
            getClips(),
            object.userData.blockingStudioAspect ?? null,
          ),
        },
      });
    publish();
    render();
  };
  const flushPaths = () => {
    for (const [path, timer] of pendingPaths) {
      clearTimeout(timer);
      pendingPaths.delete(path);
      bakePath(path);
    }
    pendingPaths.clear();
  };
  const onPathMutation = (operation) => {
    if (!operation?.entityId) return;
    const object = editor.find(operation.entityId),
      path = object && pathAncestor(object);
    const paths = path ? [path] : [];
    if (!path && object && operation.kind?.endsWith(".transform.set"))
      root.traverse((node) => {
        const settings=node.userData.blockingStudioPath;
        if (!node.userData.blockingStudioPathFor || !settings) return;
        const targets=[findMotionEntity(root,settings.targetId,settings.targetName),findMotionEntity(root,settings.follow?.entityId),root.getObjectByName(node.userData.blockingStudioPathFor)?.parent];
        if(targets.some(target=>{for(let p=target;p;p=p.parent)if(p===object)return true;return false;}))paths.push(node);
      });
    for (const changedPath of paths) {
      if(path&&object?.userData.blockingStudioWaypoint)changedPath.userData.blockingStudioPath={...changedPath.userData.blockingStudioPath,presetId:null,enabled:true};
      clearTimeout(pendingPaths.get(changedPath));
      pendingPaths.set(
        changedPath,
        setTimeout(() => {
          pendingPaths.delete(changedPath);
          try{bakePath(changedPath);}catch(error){editor.reportPathError(error);}
        }, 500),
      );
    }
  };
  const onTopology = () => {
    normalizeCameraPathBindings(root);
    ensureCameraPaths(root, getClips(), controls);
    cameras = [];
    root.traverse((object) => {
      if (object.isCamera) cameras.push(object);
    });
    shots = shots.filter((shot) =>
      cameras.some((object) => entityId(object) === shot.cameraId),
    );
    applyProjectAspect();
    if (cameraView !== AUTO_CAMERA_VIEW && !cameras.some((object) => object.uuid === cameraView) ||
        cameraView === AUTO_CAMERA_VIEW && !cameras.length)
      cameraView = null;
    if (!cameras.some((object) => object.uuid === selectedCamera))
      selectedCamera = null;
    root.traverse((object) => {
      if (!object.isLight || !object.shadow) return;
      const shadowSettings=object.userData.studioShadow||{};
      object.shadow.mapSize.set(shadowSettings.mapSize??2048,shadowSettings.mapSize??2048);
      object.shadow.bias = shadowSettings.bias??-0.0004;
      object.shadow.normalBias = shadowSettings.normalBias??0.02;
      object.shadow.radius=shadowSettings.radius??3;
      const box = new THREE.Box3().setFromObject(root),
        sphere = (object.userData.lightingShadowBounds||object.userData.productShadowBounds)?new THREE.Sphere(new THREE.Vector3(...(object.userData.lightingShadowBounds||object.userData.productShadowBounds).center),(object.userData.lightingShadowBounds||object.userData.productShadowBounds).radius):box.isEmpty()
          ? new THREE.Sphere(new THREE.Vector3(), 1)
          : box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.001),
        c = object.shadow.camera;
      c.near = Math.max(0.02 * radius, 0.001);
      c.far = Math.max(
        object.position.distanceTo(sphere.center) + 2 * radius,
        8 * radius,
      );
      if (c.isOrthographicCamera) {
        c.left = c.bottom = -1.6 * radius;
        c.right = c.top = 1.6 * radius;
      }
      c.updateProjectionMatrix();
    });
    controls.enabled = !cameraView;
  };
  const createExportScene = (object = root, fragment = false) => {
    root.userData.blockingStudioWorldSettings=structuredClone(worldSettings);
    editor?.flushSceneEdits();
    flushPaths();
    root.userData.blockingStudioTimeline = JSON.stringify({
        version: 1,
        duration,
        shots,
      });
    const copy = cloneSkeleton(object);
    const originalNodes = [],
      copiedNodes = [];
    object.traverse((node) => originalNodes.push(node));
    copy.traverse((node) => copiedNodes.push(node));
    const nodeCopies = new Map(
      originalNodes.map((node, index) => [node, copiedNodes[index]]),
    );
    // GLTFExporter awaits image encoding. Freeze material values for this revision.
    const materialCopies = new Map();
    copy.traverse((node) => {
      if (node.material)
        node.material = Array.isArray(node.material)
          ? node.material.map(cloneMaterial)
          : cloneMaterial(node.material);
    });
    for (const original of originalNodes) {
      if (!original.isDirectionalLight && !original.isSpotLight) continue;
      const node = nodeCopies.get(original);
      node.target = nodeCopies.get(original.target) || original.target.clone();
      if (!node.target.parent)
        node.target.position.copy(
          original.target.getWorldPosition(new THREE.Vector3()),
        );
      node.target.userData.libtvLightTarget = true;
      node.target.userData.libtvLightTargetFor = entityId(original);
      delete node.target.userData.hf_id;
    }
    function cloneMaterial(material) {
      if (!materialCopies.has(material))
        materialCopies.set(material, material.clone());
      return materialCopies.get(material);
    }
    const exportScene = new THREE.Scene();
    exportScene.userData = structuredClone(
      object === root ? root.userData : {},
    );
    exportScene.userData.libtvStudioRoot = true;
    if (fragment) {
      exportScene.userData.libtvFragment = true;
      exportScene.add(copy);
    } else while (copy.children.length) exportScene.add(copy.children[0]);
    const lights = [];
    exportScene.traverse((node) => {
      if (node.isDirectionalLight || node.isSpotLight) lights.push(node);
    });
    for (const node of lights)
      if (!node.target.parent) {
        node.target.userData.libtvLightTarget = true;
        exportScene.add(node.target);
      }
    exportScene.updateMatrixWorld(true);
    prepareLightingExport(exportScene);
    return {
      scene: exportScene,
      animations: getClips().map((clip) => clip.clone()),
      materials: [...materialCopies.values()],
    };
  };
  const serializeGlb = async (signal, source = createExportScene()) => {
    signal?.throwIfAborted();
    if (disposed) throw new Error("场景尚未准备好。");
    try {
      const bytes = await new GLTFExporter().parseAsync(source.scene, {
        animations: source.animations,
        binary: true,
        onlyVisible: false,
      });
      signal?.throwIfAborted();
      if (!(bytes instanceof ArrayBuffer))
        throw new Error("GLB 导出未产生有效数据。");
      return {
        blob: new Blob([bytes], { type: "model/gltf-binary" }),
        extension: "glb",
      };
    } finally {
      source.materials.forEach((material) => material.dispose());
    }
  };
  editor = createSceneEditor({
    root,
    scene,
    renderer,
    camera,
    controls,
    host,
    past,
    future,
    loader,
    getClips,
    registerAnimations,
    onTopology,
    render,
    publish,
    applyRig,
    flushPaths,
    bakeRig: (path, object) => {
      for(const [pending,timer] of pendingPaths)if(pending.userData.blockingStudioPathFor===object.name){clearTimeout(timer);pendingPaths.delete(pending);}
      refreshCameraClip(object, bakeCameraPath(THREE, root, path, object,getClips()));
    },
    seek: (value) => {
      time = Math.min(Math.max(value, 0), duration);
      evaluateClips();
      callbacks.onSeek?.(time);
      render();
      publish();
    },
    getTime: () => time,
    frameRect: () =>
      cameraView
        ? frameRect()
        : {
            left: 0,
            top: 0,
            width: host.clientWidth,
            height: host.clientHeight,
          },
    fitScene: () => {
      if (topView) {
        fitTopView();
        return;
      }
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere()),
        distance =
          1.15 *
          Math.max(
            sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)),
            0.1,
          );
      controls.target.copy(sphere.center);
      camera.position
        .copy(sphere.center)
        .add(
          new THREE.Vector3().setFromSphericalCoords(
            distance,
            THREE.MathUtils.degToRad(72),
            THREE.MathUtils.degToRad(35),
          ),
        );
      camera.near = Math.max(distance / 1000, 0.001);
      camera.far = Math.max(100 * distance, 100);
      camera.updateProjectionMatrix();
      controls.update();
      render();
    },
    rebindAnimations: () => {
      for (const item of mixers) {
        const clips = item.actions.map((action) => action.getClip());
        item.mixer.stopAllAction();
        item.mixer.uncacheRoot(item.model);
        item.actions = clips.map((clip) => item.mixer.clipAction(clip).play());
      }
    },
    cameraView: viewedCameraId,
    pause: () => callbacks.onPause?.(),
    onSelection: (object) => {
      const path = object && pathAncestor(object);
      const owner =
        path && root.getObjectByName(path.userData.blockingStudioPathFor);
      selectedCamera = object?.isCamera ? object.uuid : (owner?.uuid ?? null);
    },
    getWorld: () => worldSettings,
    setWorld,
    getTimeline: () => ({ version: 1, duration, shots }),
    setTimeline: (value) => {
      duration = value.duration;
      shots = value.shots;
      root.userData.blockingStudioTimeline = JSON.stringify(value);
    },
    onChange: (operation) => {
      onTopology();
      invalidateMonitor();
      publish();
      render();
      if (!restoring) {
        onPathMutation(operation);
        callbacks.onEdit?.(operation);
      }
    },
    cacheObject: async (object) => {
      const id = randomUUID(),
        result = await serializeGlb(undefined, createExportScene(object, true));
      await saveAsset(
        { name: "recovery.glb" },
        await result.blob.arrayBuffer(),
        id,
      );
      return id;
    },
  });
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  monitorContext = {
    modules: { THREE },
    editableRoot: root,
    scene,
    renderer,
    orbitCamera: camera,
    controls,
    transformGizmos: { group: editor.gizmos },
    helpers: { group: editor.helpers },
    grid,
    pathContainer: editor.pathContainer,
    topView: false,
    needsRender: false,
  };
  const fitTopView = () => {
    const box = sceneBounds(monitorContext);
    camera.up.set(0, 0, -1);
    controls.enableRotate = false;
    if (box.isEmpty()) {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 5, 0);
    } else {
      const sphere = box.getBoundingSphere(new THREE.Sphere()),
        size = box.getSize(new THREE.Vector3());
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const height =
        1.15 *
        Math.max(
          Math.max(size.z / 2, 0.05) / tangent,
          Math.max(size.x / 2, 0.05) / Math.max(camera.aspect * tangent, 0.001),
          size.y / 2,
          0.1,
        );
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).add(new THREE.Vector3(0, height, 0));
      camera.near = Math.max((height - size.y / 2) / 1000, 0.001);
      camera.far = Math.max(height + size.y / 2 + 100 * sphere.radius, 100);
    }
    camera.updateProjectionMatrix();
    controls.update();
  };
  const leaveTopView = () => {
    topView = false;
    monitorContext.topView = false;
    restoreMonitor3D(monitorContext);
    controls.enableRotate = true;
  };
  const monitorLoop = (now) => {
    if (disposed) return;
    flushMonitorInvalidation();
    monitorContext.topView = topView;
    monitorContext.worldBackground = scene.background;
    monitorContext.worldStrength = worldSettings.strength;
    const shotId = timelineCameraId(shots, time, duration);
    const activeId =
      cameras.find((value) => entityId(value) === shotId)?.uuid ??
      viewedCameraId() ??
      activeCamera()?.uuid;
    updateMonitor(
      host,
      monitorContext,
      {
        request: () => callbacks.getMonitorRequests?.(),
        emit: (value) => callbacks.onMonitorFrames?.(value),
      },
      now,
      !monitorPlaying && now - lastInteraction > 100,
      exporting || restoring,
      monitorPlaying,
      monitorPlaying ? activeId : null,
    );
    updateLightingRuntime(root,time);
    if (monitorContext.needsRender) {
      monitorContext.needsRender = false;
      render();
    }
    monitorFrame = requestAnimationFrame(monitorLoop);
  };
  monitorFrame = requestAnimationFrame(monitorLoop);

  return {
    setMonitorPlayback(value) {
      monitorPlaying = !!value;
      publish();
      render();
    },
    setTopView(value) {
      if (disposed || exporting) return;
      cameraView = null;
      previewMode = false;
      editor.closeCameraAnimation();
      if (value) {
        if (!topView)
          monitorContext.libtvMonitor3dView = {
            camera: camera.clone(),
            target: controls.target.clone(),
          };
        topView = true;
        monitorContext.topView = true;
        fitTopView();
      } else leaveTopView();
      controls.enabled = true;
      publish();
      render();
    },
    focusMonitorCamera(id) {
      if (disposed || exporting) return;
      const object = editor.find(id);
      if (!object?.isCamera) return;
      if (topView) leaveTopView();
      cameraView = null;
      previewMode = false;
      controls.enabled = true;
      const shot = shots.find((value) => value.cameraId === entityId(object));
      if (shot) {
        this.seek(shot.start);
        callbacks.onSeek?.(shot.start);
      }
      editor.select(object.uuid);
      const sphere = sceneBounds(monitorContext).getBoundingSphere(
        new THREE.Sphere(),
      );
      const distance = Math.max(0.5 * sphere.radius, 2);
      controls.target.copy(object.getWorldPosition(new THREE.Vector3()));
      camera.up.set(0, 1, 0);
      camera.position
        .copy(controls.target)
        .add(
          new THREE.Vector3().setFromSphericalCoords(
            distance,
            THREE.MathUtils.degToRad(72),
            THREE.MathUtils.degToRad(35),
          ),
        );
      camera.near = Math.max(distance / 1000, 0.001);
      camera.far = Math.max(1000 * distance, 100);
      camera.updateProjectionMatrix();
      controls.enableRotate = true;
      controls.update();
      publish();
      render();
    },
    enterMonitorCamera(id) {
      if (disposed || exporting || !editor.find(id)?.isCamera) return;
      if (topView) leaveTopView();
      cameraView = id;
      previewMode = false;
      controls.enabled = false;
      publish();
      render();
    },
    getExportDetails,
    ...editor,
    flushSceneEdits() {
      editor.flushSceneEdits();
      flushPaths();
    },
    createExportScene,
    exportSceneGlb: serializeGlb,
    exportLocalMetadata: () => ({
      rootUserData: structuredClone(root.userData),
      assetNodeIds: editor.assetNodeIds(),
      pathNodes: editor.localPathNodes(),
      // A crash can occur inside libtv's 500ms path rebake debounce. Recover only
      // these edited paths, preserving untouched imported camera animation samples.
      dirtyCameraPaths: [...pendingPaths.keys()].map(
        (path) => path.userData.blockingStudioPathFor,
      ),
    }),
    isBusy: () => exporting,
    async replaceAgentScene(snapshot, operations = []) {
      // Parsing can fail (including decoder/resource failures). Keep the live
      // scene intact until that asynchronous work has succeeded.
      const prepared=snapshot?.bytes?await loader.parseAsync(snapshot.bytes.slice(0), ""):null;
      if(disposed){if(prepared)disposeObject(prepared.scene);throw Error('3D 视窗已关闭。');}
      this.flushSceneEdits();
      editor.closeCameraAnimation();
      editor.select(null);
      for (const value of mixers) value.mixer.stopAllAction();
      mixers.length = 0;
      for (const timer of pendingPaths.values()) clearTimeout(timer);
      pendingPaths.clear();
      disposeObject(root);
      root.clear();
      root.userData = {};
      past.length = 0;
      future.length = 0;
      shots = [];
      duration = 15;
      time = 0;
      cameraView = null;
      previewMode = false;
      topView = false;
      controls.enableRotate = true;
      camera.up.set(0, 1, 0);
      monitorContext.libtvMonitor3dView = null;
      disposeMonitor(monitorContext);
      await this.restoreProject(snapshot,undefined,prepared);
      for (const operation of operations) await editor.replayOperation(operation);
      editor.topology();
      this.seek(0);
      const bounds = new THREE.Box3().setFromObject(root);
      if (!bounds.isEmpty()) {
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        controls.target.copy(sphere.center);
        camera.position.copy(sphere.center).add(new THREE.Vector3(1, .7, 1).normalize().multiplyScalar(Math.max(sphere.radius * 3, 2)));
        controls.update();
      }
      invalidateMonitor(true);
    },
    trimShot(id, start, end) {
      const index = Number(id.replace("shot-", ""));
      if (!shots[index] || !Number.isFinite(start) || !Number.isFinite(end))
        return;
      const before = shots[index - 1]?.end ?? 0,
        after = shots[index + 1]?.start ?? duration;
      start = Math.max(before, Math.min(start, end - 1 / 30));
      end = Math.min(after, Math.max(end, start + 1 / 30));
      const next = shots.map((shot, i) =>
        i === index
          ? {
              ...shot,
              start: Math.round(start * 1000) / 1000,
              end: Math.round(end * 1000) / 1000,
            }
          : shot,
      );
      editor.changeTimeline({ version: 1, duration, shots: next });
    },
    setEditingLocked(value) {
      editor.setLocked(value);
    },
    async restoreProject(snapshot, journal, prepared) {
      restoring = true;
      try {
        if (snapshot?.bytes) {
          const gltf = prepared || await loader.parseAsync(snapshot.bytes.slice(0), "");
          const model = restoreLightingNodes(gltf.scene);
          root.userData = { ...model.userData };
          if(model.userData.blockingStudioWorldSettings)setWorld(model.userData.blockingStudioWorldSettings);
          assignEntityIds(model);
          while (model.children.length) root.add(model.children[0]);
          registerAnimations(root, gltf.animations);
          const targets = [];
          root.traverse((node) => {
            if (node.userData.libtvLightTargetFor) targets.push(node);
          });
          for (const target of targets) {
            const object = editor.find(target.userData.libtvLightTargetFor);
            if (!object?.isLight) continue;
            if (object.target !== target && object.target.parent === object)
              object.target.removeFromParent();
            object.target = target;
          }
        }
        if (snapshot?.json) editor.restoreSnapshot(snapshot.json);
        if (journal) {
          editor.restorePathNodes(journal.metadata?.pathNodes);
          for (const operation of journal.operations
            .filter((item) => item.sequence > (snapshot?.revision ?? -1))
            .sort((a, b) => a.sequence - b.sequence))
            await editor.replayOperation(operation, journal.metadata);
          editor.restorePathNodes(journal.metadata?.pathNodes);
          if (journal.metadata?.rootUserData)
            root.userData = structuredClone(journal.metadata.rootUserData);
          editor.restoreSnapshot(journal.json);
          for (const name of journal.metadata?.dirtyCameraPaths ?? []) {
            const path = pathForCamera(root, name);
            if (path) bakePath(path);
          }
        }
        let timeline = root.userData.blockingStudioTimeline;
        try {
          if (typeof timeline === "string") timeline = JSON.parse(timeline);
        } catch {
          timeline = null;
        }
        if (!journal && timeline) {
          duration = timeline.duration;
          shots = timeline.shots;
        }
        if (!timeline && !shots.length && getClips().length)
          duration = Math.max(...getClips().map((clip) => clip.duration));
        root.traverse((object) => {
          if (object.isMesh) {
            object.castShadow = object.receiveShadow = true;
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              material.side = THREE.DoubleSide;
          }
        });
        editor.topology();
        resize();
        this.seek(time);
      } finally {
        restoring = false;
      }
    },
    ensureDefaultLight() {
      if (!cameras.length && !root.children.length) {
        const id = editor.addElement("sun", false);
        editor.select(null);
        past.length = 0;
        future.length = 0;
        publish();
        return id;
      }
    },
    async renderTimelineVideo({ format, signal, onProgress }) {
      signal.throwIfAborted();
      if (exporting) throw new Error("视频正在导出。");
      const details = getExportDetails();
      if (!(details.durationSeconds > 0))
        throw new Error("请先导入动画或相机片段。");
      if (typeof VideoEncoder === "undefined")
        throw new Error("浏览器不支持视频编码，请使用新版 Chrome 或 Edge。");
      exporting = true;
      const originalTime = time,
        originalView = cameraView;
      const { width, height } = details.videoSize;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      let output, source;
      const channel = new MessageChannel();
      const yieldFrame = () =>
        new Promise((resolve) => {
          channel.port1.onmessage = resolve;
          channel.port2.postMessage(0);
        });
      try {
        const {
          BufferTarget,
          CanvasSource,
          getFirstEncodableVideoCodec,
          Mp4OutputFormat,
          WebMOutputFormat,
          Output,
          QUALITY_HIGH,
        } = await import("mediabunny");
        signal.throwIfAborted();
        const codec = await getFirstEncodableVideoCodec(
          format === "mp4" ? ["avc"] : ["vp9", "av1"],
          { width, height, bitrate: QUALITY_HIGH },
        );
        if (!codec)
          throw new Error(`浏览器无法编码 ${format.toUpperCase()} 视频。`);
        if (!context) throw new Error("无法创建导出画布。");
        const container =
          format === "mp4"
            ? new Mp4OutputFormat({ fastStart: "in-memory" })
            : new WebMOutputFormat();
        const target = new BufferTarget();
        output = new Output({ format: container, target });
        source = new CanvasSource(canvas, {
          codec,
          bitrate: QUALITY_HIGH,
          keyFrameInterval: 2,
        });
        output.addVideoTrack(source, { frameRate: 30 });
        await output.start();
        const count = Math.max(1, Math.ceil(details.durationSeconds * 30));
        for (let frame = 0; frame < count; frame++) {
          signal.throwIfAborted();
          this.seek(
            Math.min(frame / 30, Math.max(details.durationSeconds - 0.0001, 0)),
          );
          // libtv continuous preview: use the shot at this exact frame time.
          const shotId = timelineCameraId(shots, time, duration);
          exportCameraOverride =
            (originalView === AUTO_CAMERA_VIEW ? null : originalView) ??
            cameras.find((value) => value.userData.hf_id === shotId)
              ?.uuid ??
            activeCamera()?.uuid ??
            null;
          copyFrame(
            context,
            { width, height },
            frameRect(exportCameraOverride),
          );
          await source.add(frame / 30, 1 / 30);
          onProgress?.(Math.floor(((frame + 1) / count) * 100));
          await yieldFrame();
        }
        signal.throwIfAborted();
        source.close();
        await output.finalize();
        signal.throwIfAborted();
        if (!target.buffer) throw new Error("视频导出未产生数据。");
        return {
          blob: new Blob([target.buffer], {
            type: format === "mp4" ? "video/mp4" : "video/webm",
          }),
          extension: format,
        };
      } finally {
        source?.close();
        if (output && !["canceled", "finalized"].includes(output.state))
          await output.cancel().catch(() => {});
        channel.port1.close();
        channel.port2.close();
        exportCameraOverride = undefined;
        exporting = false;
        this.seek(originalTime);
        render();
      }
    },
    setProjectAspect(aspect) {
      if (
        disposed ||
        exporting ||
        ![16 / 9, 9 / 16, 3 / 4, 4 / 3, 1, 21 / 9].includes(aspect)
      )
        return false;
      if (getProjectAspect() === aspect) return true;
      const previous = getProjectAspect();
      const snapshots = cameras.map((value) => ({
        value,
        aspect: value.userData.blockingStudioAspect,
        projectionAspect: value.aspect,
        left: value.left,
        right: value.right,
      }));
      const redo = () => {
        root.userData.libtvProjectAspect = aspect;
        applyProjectAspect();
      };
      const undo = () => {
        if (previous === null) delete root.userData.libtvProjectAspect;
        else root.userData.libtvProjectAspect = previous;
        for (const snapshot of snapshots) {
          const value = snapshot.value;
          if (snapshot.aspect === undefined)
            delete value.userData.blockingStudioAspect;
          else value.userData.blockingStudioAspect = snapshot.aspect;
          if (value.isPerspectiveCamera)
            value.aspect = snapshot.projectionAspect;
          if (value.isOrthographicCamera) {
            value.left = snapshot.left;
            value.right = snapshot.right;
          }
          value.updateProjectionMatrix();
        }
      };
      redo();
      past.push({ undo, redo });
      future.length = 0;
      editor.topology();
      invalidateMonitor(true);
      callbacks.onEdit?.();
      publish();
      render();
      return true;
    },
    undoAspect: editor.undo,
    redoAspect: editor.redo,
    async renderCurrentFrame() {
      if (disposed) throw new Error("场景尚未准备好。");
      // libtv ip/eom/eog/ne: redraw without the PiP, copy the effective frame
      // from WebGL into a 2D canvas, clamp long edge to 1920, use even dimensions.
      const frame = frameRect();
      const pixelRatio = renderer.getPixelRatio();
      const sourceWidth = Math.max(2, frame.width * pixelRatio);
      const sourceHeight = Math.max(2, frame.height * pixelRatio);
      const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(2, 2 * Math.floor((sourceWidth * scale) / 2));
      const height = Math.max(2, 2 * Math.floor((sourceHeight * scale) / 2));
      const aspect = width / height;
      const cropWidth = Math.min(frame.width, frame.height * aspect);
      const cropHeight = Math.min(frame.height, frame.width / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建导出画布。");
      try {
        render(false);
        context.drawImage(
          renderer.domElement,
          (frame.left + (frame.width - cropWidth) / 2) * pixelRatio,
          (frame.top + (frame.height - cropHeight) / 2) * pixelRatio,
          cropWidth * pixelRatio,
          cropHeight * pixelRatio,
          0,
          0,
          width,
          height,
        );
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error("PNG 导出未产生数据。")),
            "image/png",
          ),
        );
        return { blob, width, height, extension: "png" };
      } finally {
        render();
      }
    },
    seek(value) {
      time = Math.max(0, Math.min(duration, value));
      // libtv ea2: absolute clip time, LoopOnce, clamp at the clip's end.
      for (const { model, mixer, actions } of mixers) {
        if (model !== root && !root.getObjectByProperty("uuid", model.uuid))
          continue;
        for (const action of actions) {
          action.paused = false;
          action.enabled = true;
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.time = Math.min(time, action.getClip().duration);
        }
        mixer.update(0);
      }
      root.updateMatrixWorld(true);
      updateLightingRuntime(root,time);
      if (!monitorPlaying) invalidateMonitor();
      publish();
      render();
    },
    setPipRect(rect) {
      pipRect = rect;
      render();
    },
    selectCamera(id) {
      selectedCamera = id;
      publish();
      render();
    },
    setCameraView(id) {
      if (topView) leaveTopView();
      cameraView = id;
      previewMode = !!id;
      controls.enabled = !id;
      editor.setLocked(false);
      publish();
      render();
    },
    setFilmPreview() {
      this.setCameraView(shots.length ? AUTO_CAMERA_VIEW : activeCamera()?.uuid ?? null);
    },
    async importFile(file) {
      const timelineBefore = {
        version: 1,
        duration,
        shots: structuredClone(shots),
      };
      const bytes = await readGlb(file);
      const gltf = await loader.parseAsync(bytes.slice(0), "");
      const model = restoreLightingNodes(gltf.scene);
      if (disposed) {
        disposeObject(model);
        return null;
      }
      const id = randomUUID();
      try {
        await saveAsset(file, bytes, id);
      } catch (error) {
        disposeObject(model);
        throw error;
      }
      if (disposed) {
        disposeObject(model);
        return null;
      }
      model.userData.hf_id = id;
      model.userData.localAssetId = id;
      model.userData.hf_asset = id;
      assignEntityIds(model, id);
      // An imported scene is a new instance. Keep its node identities distinct
      // even when importing the same GLB again; pending recovery uses this ID map.
      const existingIds = new Set();
      root.traverse((node) => existingIds.add(entityId(node)));
      const remappedIds = new Map();
      model.traverse((node) => {
        const previous = node.userData.hf_id;
        if (!previous) return;
        if (existingIds.has(previous)) {
          node.userData.hf_id = randomUUID();
          remappedIds.set(previous, node.userData.hf_id);
        }
        existingIds.add(node.userData.hf_id);
      });
      remapLightingIds(model,remappedIds);
      model.traverse((node) => {
        let timeline = node.userData.blockingStudioTimeline;
        const text = typeof timeline === "string";
        try {
          if (text) timeline = JSON.parse(timeline);
        } catch {
          return;
        }
        if (!timeline?.shots) return;
        timeline = {
          ...timeline,
          shots: timeline.shots.map((shot) => ({
            ...shot,
            cameraId: remappedIds.get(shot.cameraId) ?? shot.cameraId,
          })),
        };
        node.userData.blockingStudioTimeline = text
          ? JSON.stringify(timeline)
          : timeline;
      });
      registerAnimations(model, gltf.animations);
      model.traverse((object) => {
        if (object.isCamera) {
          object.userData.captureAspect = object.aspect;
          if (!object.userData.hf_id) object.userData.hf_id = object.uuid;
          cameras.push(object);
        }
        let timeline = object.userData.blockingStudioTimeline;
        try {
          if (typeof timeline === "string") timeline = JSON.parse(timeline);
        } catch {
          timeline = null;
        }
        if (
          timeline?.version === 1 &&
          Number.isFinite(timeline.duration) &&
          timeline.duration >= 0 &&
          timeline.duration <= 600 &&
          Array.isArray(timeline.shots) &&
          timeline.shots.length <= 256
        ) {
          let previousEnd = 0;
          const valid = timeline.shots.every((shot) => {
            const accepted =
              typeof shot.cameraId === "string" &&
              /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(shot.cameraId) &&
              Number.isFinite(shot.start) &&
              Number.isFinite(shot.end) &&
              shot.start >= previousEnd &&
              shot.end > shot.start &&
              shot.end <= timeline.duration;
            previousEnd = shot.end;
            return accepted;
          });
          if (valid) {
            duration = timeline.duration;
            shots = timeline.shots;
          }
        }
      });
      if (!shots.length && gltf.animations.length)
        duration = Math.max(
          ...mixers.flatMap((value) =>
            value.actions.map((action) => action.getClip().duration),
          ),
        );
      const base = file.name.replace(/\.glb$/i, "").trim() || "Imported";
      const names = new Set();
      root.traverse((object) => names.add(object.name));
      model.name = base;
      for (let suffix = 1; names.has(model.name); suffix++)
        model.name = `${base}_${suffix}`;
      model.traverse((object) => {
        if (object.isMesh) {
          object.castShadow = object.receiveShadow = true;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          }
        }
        if (object.isLight)
          object.castShadow =
            typeof object.userData.hf_cast_shadow === "boolean"
              ? object.userData.hf_cast_shadow
              : true;
      });
      // libtv rC: align X/Z center to the orbit target and bottom to scene floor.
      const existing = new THREE.Box3().setFromObject(root);
      const floor = existing.isEmpty() ? 0 : existing.min.y;
      root.add(model);
      if(existing.isEmpty()&&model.userData.blockingStudioWorldSettings)setWorld(model.userData.blockingStudioWorldSettings);
      if (
        getProjectAspect() === null &&
        Number.isFinite(model.userData.libtvProjectAspect) &&
        model.userData.libtvProjectAspect > 0
      )
        root.userData.libtvProjectAspect = model.userData.libtvProjectAspect;
      applyProjectAspect();
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      if (!bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        const position = model
          .getWorldPosition(new THREE.Vector3())
          .add(
            new THREE.Vector3(
              controls.target.x - center.x,
              floor - bounds.min.y,
              controls.target.z - center.z,
            ),
          );
        model.position.copy(root.worldToLocal(position));
      }
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      if (!box.isEmpty()) {
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 0.001);
        // libtv eaY: fit the full scene without changing model scale.
        const distance =
          1.15 *
          Math.max(
            radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)),
            0.1,
          );
        const direction = camera.position
          .clone()
          .sub(controls.target)
          .normalize();
        controls.target.copy(sphere.center);
        camera.position
          .copy(sphere.center)
          .addScaledVector(direction, distance);
        camera.near = Math.max(distance / 1000, 0.001);
        camera.far = Math.max(100 * distance, 100);
        camera.updateProjectionMatrix();
        for (const object of [
          light,
          ...root.children.flatMap((child) => {
            const lights = [];
            child.traverse((node) => {
              if (node.isLight) lights.push(node);
            });
            return lights;
          }),
        ]) {
          if (!object.castShadow || !object.shadow) continue;
          object.shadow.map?.dispose();
          object.shadow.map = null;
          object.shadow.mapSize.set(2048, 2048);
          object.shadow.bias = -0.0004;
          object.shadow.normalBias = 0.02;
          const shadowCamera = object.shadow.camera;
          shadowCamera.near = Math.max(0.02 * radius, 0.001);
          shadowCamera.far = Math.max(
            object.position.distanceTo(sphere.center) + 2 * radius,
            8 * radius,
          );
          if (shadowCamera.isOrthographicCamera) {
            shadowCamera.left = shadowCamera.bottom = -1.6 * radius;
            shadowCamera.right = shadowCamera.top = 1.6 * radius;
          }
          shadowCamera.updateProjectionMatrix();
        }
      }
      controls.update();
      if (topView) fitTopView();
      this.seek(time);
      editor.addedImport(model, timelineBefore);
      return { id, name: model.name };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(monitorFrame);
      disposeMonitor(monitorContext);
      for (const timer of pendingPaths.values()) clearTimeout(timer);
      cancelAnimationFrame(orbitFrame);
      editor.dispose();
      scene.environment?.dispose();
      observer.disconnect();
      controls.dispose();
      draco.dispose();
      for (const { mixer } of mixers) mixer.stopAllAction();
      target.dispose();
      disposeObject(overlayScene);
      disposeObject(scene);
      light.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
