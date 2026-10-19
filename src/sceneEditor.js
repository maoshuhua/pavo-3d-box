import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { readImportedAsset } from "./localProject.js";
import {
  pathAncestor,
  pathForCamera,
  readCameraRig,
  insertCameraKeyframe,
  makePathPreview,
  pathPreviewSignature,
  readPathSettings,
  pathWaypoints,
  pathDuration,
  createCameraPath,
  addPathKeyframe,
  removePathKeyframe,
  applyPathPreset,
  updatePathSettings,
  sceneFocus,
} from "./libtvCameraRig.js";

// Ported from libtv 0wsgf7e09dh0-.js: eaW/elv/elx/rb/rx/rS/A8/eiz.
export const entityKind = (object) =>
  object.userData.blockingStudioCharacter
    ? "character"
    : object.isMesh
      ? "mesh"
      : object.isLight
        ? "light"
        : object.isCamera
          ? "camera"
          : object.userData.blockingStudioWaypoint
            ? "waypoint"
            : object.userData.blockingStudioPathAim
              ? "aim"
              : object.userData.blockingStudioPathFocus
                ? "focus"
                : object.userData.blockingStudioPathFor
                  ? "path"
                  : "group";
export const entityId = (object) => object.userData.hf_id || object.uuid;
export const transformOf = (object) => ({
  position: object.position.toArray(),
  rotation: object.quaternion.toArray(),
  scale: object.scale.toArray(),
});
export function assignEntityIds(root, prefix = crypto.randomUUID()) {
  let index = 0;
  root.traverse((object) => {
    if (
      !object.isBone &&
      !object.userData.libtvLightTarget &&
      !object.userData.hf_id
    )
      object.userData.hf_id = `${prefix}:${index}`;
    index++;
  });
}
function applyTransform(object, value) {
  if (!value) return;
  object.position.fromArray(value.position);
  object.quaternion.fromArray(value.rotation).normalize();
  object.scale.fromArray(value.scale);
  object.updateMatrixWorld(true);
}
function lightState(object) {
  return object.isLight
    ? {
        kind: object.isDirectionalLight
          ? "directional"
          : object.isSpotLight
            ? "spot"
            : object.isPointLight
              ? "point"
              : object.isHemisphereLight
                ? "hemisphere"
                : "ambient",
        color: `#${object.color.getHexString()}`,
        intensity: object.intensity,
        castShadow: object.castShadow,
        distance: object.distance ?? null,
        angle:
          object.angle === undefined
            ? null
            : THREE.MathUtils.radToDeg(object.angle),
        penumbra: object.penumbra ?? null,
      }
    : null;
}
const materialOf = (object) =>
  Array.isArray(object.material) ? object.material[0] : object.material;
const editableMaterial = (object) =>
  materialOf(object)?.isMeshStandardMaterial ? materialOf(object) : null;
const primitive = (type) =>
  new THREE.Mesh(
    type === "box"
      ? new THREE.BoxGeometry(1, 1, 1)
      : type === "uvSphere"
        ? new THREE.SphereGeometry(0.65, 40, 24)
        : new THREE.ConeGeometry(0.65, 1, 4),
    new THREE.MeshStandardMaterial({ color: 8176895, roughness: 0.45 }),
  );

function buildCameraIcon(object, material) {
  const proxy = new THREE.Group(),
    scale = new THREE.Group(),
    body = new THREE.Group();
  proxy.add(scale);
  scale.scale.setScalar(4);
  scale.add(body);
  body.scale.setScalar(0.55);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 658448,
    toneMapped: false,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const part = (geometry, position, rotation) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(position);
    if (rotation) mesh.rotation.fromArray(rotation);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 25),
      edgeMaterial,
    );
    edges.raycast = () => {};
    mesh.add(edges);
    body.add(mesh);
  };
  part(new THREE.BoxGeometry(0.72, 0.6, 0.9), [0, 0, 0.25]);
  part(new THREE.BoxGeometry(0.5, 0.44, 0.2), [0, -0.02, 0.82]);
  part(
    new THREE.CylinderGeometry(0.22, 0.22, 0.5, 18),
    [0, 0, -0.42],
    [Math.PI / 2, 0, 0],
  );
  part(
    new THREE.CylinderGeometry(0.32, 0.24, 0.28, 18),
    [0, 0, -0.81],
    [-Math.PI / 2, 0, 0],
  );
  part(new THREE.TorusGeometry(0.25, 0.055, 8, 20), [0, 0, -0.96]);
  part(new THREE.BoxGeometry(0.16, 0.09, 0.7), [0, 0.5, 0.2]);
  part(new THREE.BoxGeometry(0.13, 0.22, 0.13), [0, 0.4, -0.06]);
  part(new THREE.BoxGeometry(0.13, 0.22, 0.13), [0, 0.4, 0.46]);
  part(
    new THREE.CylinderGeometry(0.27, 0.27, 0.13, 20),
    [-0.42, 0.05, 0.3],
    [0, 0, Math.PI / 2],
  );
  part(new THREE.BoxGeometry(0.22, 0.2, 0.34), [0.36, 0.16, 0.4]);
  part(
    new THREE.CylinderGeometry(0.14, 0.1, 0.14, 12),
    [0.36, 0.16, 0.62],
    [Math.PI / 2, 0, 0],
  );
  part(new THREE.BoxGeometry(0.36, 0.1, 0.44), [0, -0.34, 0.28]);
  if (object.isPerspectiveCamera) {
    const tan = Math.tan(
      THREE.MathUtils.degToRad(THREE.MathUtils.clamp(object.fov, 1, 175)) / 2,
    );
    const depth = Math.min(1.15, 1 / tan),
      height = tan * depth;
    const width =
      height *
      THREE.MathUtils.clamp(
        object.userData.blockingStudioAspect ?? 16 / 9,
        0.2,
        4,
      );
    const z = -0.528 - depth,
      origin = [0, 0, -0.528],
      corners = [
        [-width, -height, z],
        [width, -height, z],
        [width, height, z],
        [-width, height, z],
      ];
    const points = [];
    corners.forEach((point, index) =>
      points.push(origin, point, point, corners[(index + 1) % 4]),
    );
    points.push(
      corners[3],
      [0, 1.34 * height, z],
      [0, 1.34 * height, z],
      corners[2],
    );
    const frustum = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(
        points.map((value) => new THREE.Vector3(...value)),
      ),
      new THREE.LineBasicMaterial({
        color: material.color,
        toneMapped: false,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    frustum.raycast = () => {};
    scale.add(frustum);
  }
  return proxy;
}
function disposeHelpers(group) {
  group.traverse((object) => {
    object.geometry?.dispose();
    (Array.isArray(object.material)
      ? object.material
      : [object.material]
    ).forEach((value) => value?.dispose());
  });
  group.clear();
}

export function createSceneEditor(runtime) {
  const { root, scene, renderer, camera, controls, past, future, loader } =
    runtime;
  let selected = null,
    mode = "all",
    locked = false,
    editing,
    dragStart,
    activeMode = null,
    hoverMode = null,
    deleted = false;
  let clipboard = null;
  const cloneEditable = (object) => {
    if (!creation(object)) return null;
    if (typeof object.userData.hf_asset === "string") return object.clone(true);
    const copy = object.clone(false);
    if (object.isMesh) {
      copy.geometry = object.geometry.clone();
      copy.material = Array.isArray(object.material)
        ? object.material.map((value) => value.clone())
        : object.material.clone();
    }
    return copy;
  };
  const helpers = new THREE.Group();
  helpers.name = "Scene helpers";
  scene.add(helpers);
  const pathPreviews = new THREE.Group();
  pathPreviews.name = "Camera path previews";
  scene.add(pathPreviews);
  const gizmos = new THREE.Group();
  gizmos.name = "Transform gizmo";
  scene.add(gizmos);
  const raycaster = new THREE.Raycaster();
  const viewRect = () => {
    const rect = renderer.domElement.getBoundingClientRect(),
      frame = runtime.frameRect();
    return {
      x: rect.left + frame.left,
      y: rect.top + frame.top,
      left: rect.left + frame.left,
      top: rect.top + frame.top,
      right: rect.left + frame.left + frame.width,
      bottom: rect.top + frame.top + frame.height,
      width: frame.width,
      height: frame.height,
    };
  };
  // Keep TransformControls' pointer normalization aligned with the effective frame.
  const controlElement = new Proxy(renderer.domElement, {
    get(target, key) {
      if (key === "getBoundingClientRect") return viewRect;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const sizes = { translate: 1.15, rotate: 0.68, scale: 0.36 };
  const excluded = {
    translate: ["XYZ"],
    rotate: ["E", "XYZE"],
    scale: ["XY", "YZ", "XZ"],
  };
  const sets = ["translate", "rotate", "scale"].map((type) => {
    const control = new TransformControls(camera, controlElement);
    control.setMode(type);
    control.setSize(sizes[type]);
    const helper = control.getHelper();
    gizmos.add(helper);
    const internal = helper.children.find(
      (object) => object.isTransformControlsGizmo,
    );
    for (const group of [internal.gizmo[type], internal.picker[type]])
      for (const child of [...group.children])
        if (excluded[type].includes(child.name)) group.remove(child);
    if (type === "translate")
      for (const child of internal.picker[type].children) {
        if (!["X", "Y", "Z"].includes(child.name)) continue;
        const direction = new THREE.Box3()
          .setFromBufferAttribute(child.geometry.getAttribute("position"))
          .getCenter(new THREE.Vector3())
          .normalize()
          .multiplyScalar(0.5);
        child.geometry.dispose();
        child.geometry = new THREE.SphereGeometry(0.14, 8, 6).translate(
          direction.x,
          direction.y,
          direction.z,
        );
      }
    return { type, control, helper, picker: internal.picker[type] };
  });
  const find = (id) => {
    let found;
    root.traverse((object) => {
      if (object.uuid === id || entityId(object) === id) found = object;
    });
    return found;
  };
  const notify = (operation) => {
    root.updateMatrixWorld(true);
    runtime.onChange(operation);
  };
  const record = (entry) => {
    const previous = past.at(-1),
      now = performance.now();
    if (
      entry.merge &&
      previous?.merge === entry.merge &&
      now - previous.at < 800
    ) {
      previous.redo = entry.redo;
      previous.at = now;
    } else {
      past.push({ ...entry, at: now });
      if (past.length > 100) past.shift();
    }
    future.length = 0;
  };
  const transformOperation = (object) => ({
    entityId: entityId(object),
    kind: "entity.transform.set",
    payload: { transform: transformOf(object) },
  });
  const creation = (object) => {
    const id = entityId(object),
      transform = transformOf(object),
      name = object.name;
    if (object.userData.hf_asset)
      return {
        entityId: id,
        kind: "object.create.from_glb",
        payload: { assetId: object.userData.hf_asset, name, transform },
      };
    if (object.isCamera)
      return {
        entityId: id,
        kind: "camera.create",
        payload: {
          name,
          transform,
          projection: {
            type: "perspective",
            verticalFov: THREE.MathUtils.degToRad(object.fov),
            near: object.near,
            far: object.far,
          },
        },
      };
    if (object.isLight)
      return {
        entityId: id,
        kind: "light.create",
        payload: {
          name,
          transform,
          properties: {
            type: lightState(object).kind,
            color: object.color.toArray(),
            intensity: object.intensity,
            castShadow: object.castShadow,
            range: object.distance > 0 ? object.distance : null,
            ...(object.isSpotLight
              ? {
                  innerConeAngle: object.angle * (1 - object.penumbra),
                  outerConeAngle: object.angle,
                }
              : {}),
          },
        },
      };
    if (object.userData.hf_primitive)
      return {
        entityId: id,
        kind: "object.create.primitive",
        payload: { primitive: object.userData.hf_primitive, name, transform },
      };
    return null;
  };
  const uniqueName = (name) => {
    const names = new Set();
    root.traverse((object) => names.add(object.name));
    let suffix = 1;
    while (names.has(`${name} ${suffix}`)) suffix++;
    return `${name} ${suffix}`;
  };
  const buildHelpers = () => {
    disposeHelpers(helpers);
    disposeHelpers(pathPreviews);
    const lightTargets = new Set();
    root.traverse((object) => {
      if (object.target) lightTargets.add(object.target);
    });
    root.traverse((object) => {
      if (object.userData.blockingStudioPathFor) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(makePathPreview(object)),
          new THREE.LineBasicMaterial({
            color: 8176895,
            toneMapped: false,
            transparent: true,
            opacity: 1,
            depthTest: false,
          }),
        );
        line.renderOrder = 998;
        line.frustumCulled = false;
        line.userData.path = object;
        line.userData.signature = pathPreviewSignature(object);
        line.geometry.computeBoundingSphere();
        pathPreviews.add(line);
      }
      if (lightTargets.has(object)) return;
      const kind = entityKind(object);
      if (!["camera", "light", "waypoint", "aim", "focus"].includes(kind))
        return;
      const color =
        kind === "camera"
          ? 8176895
          : kind === "light"
            ? 0xffcf87
            : kind === "focus"
              ? 0xff9ad1
              : 54783;
      const material = new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      let proxy;
      if (kind === "camera") proxy = buildCameraIcon(object, material);
      else {
        proxy = new THREE.Group();
        if (kind === "focus") {
          const geometry = new THREE.BoxGeometry(1.4, 0.07, 0.07);
          const x = new THREE.Mesh(geometry, material),
            y = new THREE.Mesh(geometry, material),
            z = new THREE.Mesh(geometry, material);
          y.rotation.z = Math.PI / 2;
          z.rotation.y = Math.PI / 2;
          proxy.add(
            x,
            y,
            z,
            new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), material),
          );
        } else if (kind === "waypoint")
          proxy.add(
            new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), material),
          );
        else
          proxy.add(
            new THREE.Mesh(
              new THREE.SphereGeometry(kind === "aim" ? 0.22 : 0.55, 16, 12),
              material,
            ),
            new THREE.Mesh(
              new THREE.OctahedronGeometry(
                kind === "aim" ? 0.85 : 0.95,
                kind === "aim" ? 1 : 0,
              ),
              new THREE.MeshBasicMaterial({
                color,
                wireframe: true,
                toneMapped: false,
              }),
            ),
          );
      }
      proxy.userData.pickerTargetUuid = object.uuid;
      proxy.userData.target = object;
      proxy.userData.baseColor = color;
      const tints = new Set();
      proxy.traverse((node) => {
        if (
          node.material?.isMeshBasicMaterial ||
          (node.material?.isLineBasicMaterial && node.material.opacity === 0.45)
        )
          tints.add(node.material);
      });
      proxy.userData.tints = [...tints];
      proxy.renderOrder = 999;
      helpers.add(proxy);
    });
  };
  const isVisible = (object) => {
    for (let node = object; node && node !== root; node = node.parent)
      if (!node.visible) return false;
    return true;
  };
  const syncGizmos = () => {
    const object = selected && find(selected),
      allowed = object && !locked && !runtime.cameraView();
    for (const set of sets) {
      if (allowed) set.control.attach(object);
      else set.control.detach();
      const visible =
        allowed &&
        (mode === "all" || mode === set.type) &&
        (!activeMode || activeMode === set.type);
      set.helper.visible = !!visible;
      set.control.enabled = !!visible && (!hoverMode || hoverMode === set.type);
    }
    gizmos.visible = !locked;
  };
  let animationSelection = null;
  const select = (id, preserveAnimation = false) => {
    api.flushSceneEdits();
    if (!preserveAnimation) animationSelection = null;
    selected = (id && find(id)?.uuid) || null;
    syncGizmos();
    runtime.onSelection(find(selected));
    runtime.publish();
    runtime.render();
  };
  const finishTransform = () => {
    if (!editing) return;
    const { object, before, rigBefore } = editing;
    editing = null;
    const after = transformOf(object);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    let rigAfter;
    if (rigBefore?.animation) {
      rigAfter = {
        ...rigBefore,
        animation: insertCameraKeyframe(
          rigBefore.animation,
          runtime.getTime(),
          after.position,
          after.rotation,
        ),
      };
      runtime.applyRig(object, rigAfter);
      notify({
        entityId: entityId(object),
        kind: "camera.rig.set",
        payload: { rig: rigAfter },
      });
    }
    const apply = (value, rig) => {
      if (rig) {
        runtime.applyRig(object, rig);
        notify({
          entityId: entityId(object),
          kind: "camera.rig.set",
          payload: { rig },
        });
      }
      applyTransform(object, value);
      notify(transformOperation(object));
    };
    record({
      merge: `transform:${object.uuid}`,
      undo: () => apply(before, rigBefore),
      redo: () => apply(after, rigAfter),
    });
    runtime.publish();
  };
  for (const set of sets) {
    set.control.addEventListener("dragging-changed", (event) => {
      if (event.value) {
        runtime.pause();
        dragStart = set.control.object && {
          transform: transformOf(set.control.object),
          rig: set.control.object.isCamera
            ? readCameraRig(
                THREE,
                set.control.object,
                pathForCamera(root, set.control.object.name),
                runtime.getClips(),
                set.control.object.userData.blockingStudioAspect ?? null,
              )
            : null,
        };
        activeMode = set.type;
        controls.enabled = false;
      } else {
        if (dragStart && set.control.object) {
          editing = {
            object: set.control.object,
            before: dragStart.transform,
            rigBefore: dragStart.rig,
          };
          finishTransform();
        }
        dragStart = null;
        activeMode = null;
        controls.enabled = !runtime.cameraView() && !locked;
      }
      syncGizmos();
      runtime.render();
    });
    set.control.addEventListener("objectChange", () => {
      if (set.control.object) notify(transformOperation(set.control.object));
    });
  }
  const hover = (event) => {
    if (activeMode || locked || !selected) return;
    const rect = viewRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    gizmos.updateMatrixWorld(true);
    let closest = Infinity;
    hoverMode = null;
    for (const set of sets) {
      if (mode !== "all" && mode !== set.type) continue;
      const hit = raycaster
        .intersectObject(set.picker, true)
        .find(
          (hit) =>
            hit.object.parent && !excluded[set.type].includes(hit.object.name),
        );
      if (hit && hit.distance < closest) {
        closest = hit.distance;
        hoverMode = set.type;
      }
    }
    syncGizmos();
  };
  let down,
    lastClick = { time: 0, x: 0, y: 0 };
  const pointerDown = (event) => {
    hover(event);
    down = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      gizmo: !!hoverMode,
      time: event.timeStamp,
    };
  };
  const pointerUp = (event) => {
    if (
      !down ||
      down.button !== 0 ||
      down.gizmo ||
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 ||
      runtime.cameraView() ||
      locked
    ) {
      down = null;
      return;
    }
    down = null;
    const rect = viewRect();
    root.updateMatrixWorld(true);
    helpers.updateMatrixWorld(true);
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    let object;
    for (const hit of raycaster.intersectObjects([helpers, root], true)) {
      if (!isVisible(hit.object)) continue;
      let proxy = hit.object;
      while (proxy && !proxy.userData.pickerTargetUuid && proxy !== helpers)
        proxy = proxy.parent;
      object = proxy?.userData.pickerTargetUuid
        ? find(proxy.userData.pickerTargetUuid)
        : hit.object;
      if (
        object.isMesh ||
        ["camera", "light", "waypoint", "aim", "focus"].includes(
          entityKind(object),
        )
      )
        break;
      object = null;
    }
    const double =
      event.timeStamp - lastClick.time < 400 &&
      Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 5;
    lastClick = {
      time: double ? 0 : event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    };
    if (object?.isMesh && object.parent !== root && !double)
      object = object.parent;
    if (
      animationSelection &&
      object?.userData.blockingStudioWaypoint &&
      pathAncestor(object) === animationContext()?.path
    )
      api.selectKeyframe(object.uuid);
    else select(object?.uuid);
  };
  renderer.domElement.addEventListener("pointermove", hover, true);
  renderer.domElement.addEventListener("pointerdown", pointerDown, true);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  const topology = () => {
    runtime.onTopology();
    buildHelpers();
    syncGizmos();
  };
  const insert = (object, parent = root, emit = true) => {
    animationSelection = null;
    parent.add(object);
    topology();
    selected = object.uuid;
    syncGizmos();
    runtime.onSelection(object);
    if (emit) notify(creation(object));
  };
  const remove = (object, emit = true) => {
    object.removeFromParent();
    if (selected === object.uuid || !find(selected)) selected = null;
    topology();
    if (emit)
      notify({
        entityId: entityId(object),
        kind: "entity.delete",
        payload: {},
      });
  };
  const putInView = (object) => {
    camera.updateMatrixWorld(true);
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const distance = Math.max(
      10 * camera.near,
      Math.min(
        0.25 * camera.far,
        0.6 * origin.distanceTo(controls.target) || 2,
      ),
    );
    object.position.copy(
      root.worldToLocal(
        origin.addScaledVector(
          camera.getWorldDirection(new THREE.Vector3()),
          distance,
        ),
      ),
    );
    if (object.isCamera)
      object.quaternion.copy(
        root
          .getWorldQuaternion(new THREE.Quaternion())
          .invert()
          .multiply(camera.getWorldQuaternion(new THREE.Quaternion())),
      );
  };
  const animationContext = () => {
    const path = animationSelection && find(animationSelection.pathId);
    const object =
      path && root.getObjectByName(path.userData.blockingStudioPathFor);
    return object?.isCamera ? { path, object } : null;
  };
  const cameraRig = (object) =>
    readCameraRig(
      THREE,
      object,
      pathForCamera(root, object.name),
      runtime.getClips(),
      object.userData.blockingStudioAspect ?? null,
    );
  // A rig and its clip are one history/persistence transaction, including topology and timeline.
  const editRig = (object, mutate, merge) => {
    if (locked || !object?.isCamera) return;
    api.flushSceneEdits();
    runtime.flushPaths();
    runtime.pause();
    const before = cameraRig(object),
      timelineBefore = structuredClone(runtime.getTimeline());
    const result = mutate();
    if (result === false) return;
    const path = pathForCamera(root, object.name);
    runtime.bakeRig(path, object);
    const after = cameraRig(object),
      timelineAfter = structuredClone(runtime.getTimeline());
    const emit = (rig) =>
      notify({
        entityId: entityId(object),
        kind: "camera.rig.set",
        payload: { rig },
      });
    const apply = (rig, timeline) => {
      runtime.flushPaths();
      runtime.applyRig(object, rig);
      runtime.setTimeline(structuredClone(timeline));
      const path = pathForCamera(root, object.name);
      animationSelection = path
        ? { pathId: path.uuid, stateId: null, view: "clip" }
        : null;
      selected = path?.uuid ?? object.uuid;
      topology();
      runtime.onSelection(object);
      emit(rig);
      runtime.seek(runtime.getTime());
    };
    record({
      merge,
      undo: () => apply(before, timelineBefore),
      redo: () => apply(after, timelineAfter),
    });
    topology();
    emit(after);
    return result;
  };
  const api = {
    select,
    find,
    helpers,
    gizmos,
    pathContainer: pathPreviews,
    topology,
    openCameraAnimation(id = selected, clipDuration) {
      if (locked) return;
      const node = find(id),
        ancestor = node && pathAncestor(node);
      const object = node?.isCamera
        ? node
        : ancestor
          ? root.getObjectByName(ancestor.userData.blockingStudioPathFor)
          : null;
      if (!object?.isCamera) return;
      let path = pathForCamera(root, object.name);
      if (!path)
        editRig(object, () => {
          path = createCameraPath(
            root,
            object,
            sceneFocus(root, controls),
            clipDuration ?? (runtime.getTimeline().duration || 6),
          );
        });
      animationSelection = { pathId: path.uuid, stateId: null, view: "clip" };
      select(object.uuid, true);
    },
    closeCameraAnimation() {
      animationSelection = null;
      select(null);
    },
    selectAnimationNode(id) {
      const context = animationContext(),
        node = find(id);
      if (context && pathWaypoints(context.path).includes(node))
        return api.selectKeyframe(id);
      if (node?.isCamera || node?.userData.blockingStudioPathFor)
        return api.openCameraAnimation(id);
      select(id);
    },
    selectKeyframe(id) {
      const context = animationContext();
      if (!context) return;
      const states = pathWaypoints(context.path),
        index = states.findIndex((node) => node.uuid === id);
      if (index < 0) return;
      runtime.pause();
      runtime.seek(
        (pathDuration(context.path) * index) / Math.max(states.length - 1, 1),
      );
      animationSelection = {
        pathId: context.path.uuid,
        stateId: id,
        view: "keyframe",
      };
      select(id, true);
    },
    addKeyframe() {
      const context = animationContext();
      if (!context) return;
      const next = editRig(context.object, () =>
        addPathKeyframe(context.path, context.object, runtime.getTime()),
      );
      if (!next) return;
      animationSelection = {
        pathId: context.path.uuid,
        stateId: next.uuid,
        view: "keyframe",
      };
      select(next.uuid, true);
    },
    removeKeyframe() {
      const context = animationContext();
      if (!context || !animationSelection.stateId) return;
      if (
        editRig(context.object, () =>
          removePathKeyframe(context.path, animationSelection.stateId),
        ) === false
      )
        return;
      animationSelection = {
        pathId: context.path.uuid,
        stateId: null,
        view: "clip",
      };
      select(context.path.uuid, true);
    },
    applyMotionPreset(id) {
      const context = animationContext();
      if (!context) return;
      editRig(context.object, () =>
        applyPathPreset(
          context.path,
          context.object,
          id,
          sceneFocus(root, controls),
        ),
      );
      animationSelection = {
        pathId: context.path.uuid,
        stateId: null,
        view: "clip",
      };
      select(context.path.uuid, true);
    },
    setPathSetting(patch) {
      const context = animationContext();
      if (!context) return;
      editRig(
        context.object,
        () => updatePathSettings(context.path, patch),
        `path-settings:${context.path.uuid}:${Object.keys(patch).join()}`,
      );
    },
    setAnimationFov(value) {
      const context = animationContext();
      if (!context || !Number.isFinite(value) || locked) return;
      const object = context.object,
        before = object.fov;
      const apply = (value) => {
        object.fov = value;
        object.updateProjectionMatrix();
        notify({
          entityId: entityId(object),
          kind: "camera.projection.set",
          payload: {
            projection: {
              verticalFov: THREE.MathUtils.degToRad(value),
              near: object.near,
              far: object.far,
            },
          },
        });
      };
      apply(Math.min(Math.max(value, 10), 150));
      record({
        merge: `camera-fov:${object.uuid}`,
        undo: () => apply(before),
        redo: () => apply(value),
      });
      runtime.publish();
    },
    editTransition() {
      if (!animationContext()) return;
      animationSelection = {
        ...animationSelection,
        stateId: null,
        view: "easing",
      };
      runtime.publish();
    },
    setAnimationTransform(field, axis, value) {
      const context = animationContext();
      if (!context) return;
      if (
        field === "rotation" &&
        readPathSettings(context.path).aim !== "fixed"
      )
        return;
      const node =
        field === "rotation"
          ? context.object
          : (find(animationSelection.stateId) ?? context.path);
      api.setTransform(field, axis, value, node);
    },
    setLocked(value) {
      locked = value;
      syncGizmos();
      controls.enabled = !value && !runtime.cameraView();
    },
    setMode(value) {
      mode = value;
      syncGizmos();
      runtime.publish();
      runtime.render();
    },
    updateHelpers(view = camera, hide = false) {
      helpers.visible = !hide;
      gizmos.visible = !hide && !locked;
      const activePath =
        animationContext()?.path ?? (selected && pathAncestor(find(selected)));
      pathPreviews.visible = !hide;
      for (const line of pathPreviews.children) {
        line.visible =
          line.userData.path === activePath && line.userData.path.visible;
        if (line.visible) {
          const signature = pathPreviewSignature(line.userData.path);
          if (signature !== line.userData.signature) {
            line.userData.signature = signature;
            line.geometry.setFromPoints(makePathPreview(line.userData.path));
            line.geometry.computeBoundingSphere();
          }
        }
      }
      const origin = view.getWorldPosition(new THREE.Vector3());
      const factor =
        (2 * Math.tan(THREE.MathUtils.degToRad(view.fov || camera.fov) / 2)) /
        Math.max(viewRect().height, 1);
      for (const proxy of helpers.children) {
        const object = proxy.userData.target;
        object.updateWorldMatrix(true, false);
        proxy.position.setFromMatrixPosition(object.matrixWorld);
        proxy.quaternion.setFromRotationMatrix(object.matrixWorld);
        const path = pathAncestor(object);
        for (const material of proxy.userData.tints)
          material.color.setHex(
            object.uuid === selected ? 54783 : proxy.userData.baseColor,
          );
        proxy.scale.setScalar(
          Math.max(origin.distanceTo(proxy.position) * factor * 20, 1e-4),
        );
        proxy.visible = isVisible(object) && (!path || path === activePath);
      }
    },
    details() {
      const rows = [],
        lightTargets = new Set();
      root.traverse((object) => {
        if (object.target) lightTargets.add(object.target);
      });
      function visit(parent, depth, hiddenBy = null) {
        for (const object of parent.children) {
          if (
            object.isBone ||
            object.userData.libtvLightTarget ||
            lightTargets.has(object)
          )
            continue;
          rows.push({
            id: object.uuid,
            entityId: entityId(object),
            name: object.name,
            label: object.name || `${entityKind(object)} ${rows.length + 1}`,
            kind: entityKind(object),
            depth,
            parentId: parent === root ? null : parent.uuid,
            childCount: object.children.filter(
              (child) =>
                !child.isBone &&
                !child.userData.libtvLightTarget &&
                !lightTargets.has(child),
            ).length,
            hidden: !object.visible,
            hiddenByAncestorId: hiddenBy,
            duplicable: !!creation(object),
          });
          if (!object.userData.blockingStudioCharacter)
            visit(object, depth + 1, !object.visible ? object.uuid : hiddenBy);
        }
      }
      visit(root, 0);
      const object = find(selected),
        material = object && editableMaterial(object);
      const context = animationContext();
      const animation = context
        ? {
            ...animationSelection,
            cameraId: context.object.uuid,
            cameraLabel: context.object.name,
            duration: pathDuration(context.path),
            settings: readPathSettings(context.path),
            fov: context.object.fov,
            states: pathWaypoints(context.path).map((node, index, all) => ({
              id: node.uuid,
              index,
              time:
                (pathDuration(context.path) * index) /
                Math.max(all.length - 1, 1),
            })),
            transform: {
              position: (
                find(animationSelection.stateId) ?? context.path
              ).position.toArray(),
              rotation: [
                context.object.rotation.x,
                context.object.rotation.y,
                context.object.rotation.z,
              ].map(THREE.MathUtils.radToDeg),
            },
          }
        : null;
      return {
        animation,
        objects: rows,
        selectedId: object?.uuid ?? null,
        transformMode: mode,
        transform: object
          ? {
              position: object.position.toArray(),
              rotation: [
                object.rotation.x,
                object.rotation.y,
                object.rotation.z,
              ].map(THREE.MathUtils.radToDeg),
              scale: object.scale.toArray(),
              color: material ? `#${material.color.getHexString()}` : null,
              light: lightState(object),
              camera: object.isPerspectiveCamera
                ? {
                    fov: object.fov,
                    focalLength: object.getFocalLength(),
                    near: object.near,
                    far: object.far,
                    aspect: object.userData.blockingStudioAspect ?? null,
                  }
                : null,
            }
          : null,
      };
    },
    addElement(type, placeInView = true) {
      if (locked) return;
      api.flushSceneEdits();
      runtime.pause();
      let object;
      const names = {
        sphere: "球体",
        box: "立方体",
        pyramid: "棱锥",
        sun: "太阳光",
        point: "点光源",
        spot: "聚光灯",
        camera: "机位",
      };
      if (["sphere", "box", "pyramid"].includes(type)) {
        object = primitive(
          type === "sphere" ? "uvSphere" : type === "pyramid" ? "cone" : "box",
        );
        object.userData.hf_primitive =
          type === "sphere" ? "uvSphere" : type === "pyramid" ? "cone" : "box";
      } else if (type === "camera")
        object = new THREE.PerspectiveCamera(45, 1, 0.01, 1e4);
      else if (type === "sun") object = new THREE.DirectionalLight(0xffffff, 3);
      else if (type === "point") object = new THREE.PointLight(0xffffff, 50);
      else if (type === "spot")
        object = new THREE.SpotLight(
          0xffffff,
          75,
          0,
          THREE.MathUtils.degToRad(45),
          0.25,
          2,
        );
      else return;
      object.name = uniqueName(names[type]);
      object.userData.hf_id = crypto.randomUUID();
      object.castShadow = object.receiveShadow = true;
      if (object.isLight) object.userData.hf_cast_shadow = true;
      if (object.isLight)
        object.position.set(
          type === "point" ? 2 : 4,
          type === "point" ? 3 : 6,
          3,
        );
      if ((object.isLight || object.isCamera) && placeInView) putInView(object);
      insert(object);
      if (object.isMesh) runtime.fitScene();
      record({
        undo: () => remove(object),
        redo: () => {
          insert(object);
          if (object.isMesh) runtime.fitScene();
        },
      });
      runtime.publish();
      return object.uuid;
    },
    addedImport(object, timelineBefore) {
      topology();
      select(object.uuid);
      notify(creation(object));
      const timelineAfter = structuredClone(runtime.getTimeline());
      record({
        undo: () => {
          remove(object);
          runtime.setTimeline(timelineBefore);
          notify();
        },
        redo: () => {
          insert(object);
          runtime.setTimeline(timelineAfter);
          notify();
        },
      });
      runtime.publish();
    },
    setTransform(field, axis, value, override) {
      const object = override ?? find(selected);
      if (!object || locked || !Number.isFinite(value)) return;
      if (!editing || editing.object !== object) {
        finishTransform();
        runtime.pause();
        editing = {
          object,
          before: transformOf(object),
          rigBefore: object.isCamera
            ? readCameraRig(
                THREE,
                object,
                pathForCamera(root, object.name),
                runtime.getClips(),
                object.userData.blockingStudioAspect ?? null,
              )
            : null,
        };
      }
      object[field][["x", "y", "z"][axis]] =
        field === "rotation" ? THREE.MathUtils.degToRad(value) : value;
      notify(transformOperation(object));
    },
    flushSceneEdits() {
      finishTransform();
    },
    setColor(value) {
      const object = find(selected),
        material = object && editableMaterial(object);
      if (!material || locked || !/^#[\da-f]{6}$/i.test(value)) return;
      const before = `#${material.color.getHexString()}`;
      if (before.toLowerCase() === value.toLowerCase()) return;
      runtime.pause();
      const apply = (color) => {
        material.color.set(color);
        notify({
          entityId: entityId(object),
          kind: "object.material.set",
          payload: {
            material: {
              baseColor: [...material.color.toArray(), material.opacity],
              metallic: material.metalness,
              roughness: material.roughness,
            },
          },
        });
      };
      apply(value);
      record({
        merge: `color:${object.uuid}`,
        undo: () => apply(before),
        redo: () => apply(value),
      });
      runtime.publish();
    },
    rename(id, value) {
      const object = find(id);
      if (!object || locked) return;
      const name = value.trim();
      if (!name || name.length > 128 || /[\[\].:/\\]/.test(name))
        throw new Error("名称须为 1–128 个字符，不能包含 [] . : / \\。");
      let duplicate = false;
      const sanitized = THREE.PropertyBinding.sanitizeNodeName(name);
      root.traverse((node) => {
        if (
          node !== object &&
          THREE.PropertyBinding.sanitizeNodeName(node.name) === sanitized
        )
          duplicate = true;
      });
      if (duplicate) throw new Error("场景中已存在同名元素。");
      const before = object.name;
      if (before === name) return;
      const apply = (next) => {
        const previous = object.name;
        object.name = next;
        object.userData.blockingStudioEntityName = next;
        root.traverse((node) => {
          for (const key of ["blockingStudioPathFor", "blockingStudioDofFocus"])
            if (node.userData[key] === previous) node.userData[key] = next;
          if (node.userData.blockingStudioPath?.targetName === previous)
            node.userData.blockingStudioPath.targetName = next;
        });
        for (const clip of runtime.getClips())
          for (const track of clip.tracks)
            if (previous && track.name.startsWith(`${previous}.`))
              track.name = next + track.name.slice(previous.length);
        runtime.rebindAnimations();
        notify({
          entityId: entityId(object),
          kind: "entity.rename",
          payload: { name: next },
        });
      };
      apply(name);
      record({ undo: () => apply(before), redo: () => apply(name) });
      runtime.publish();
    },
    toggleHidden(id) {
      const object = find(id);
      if (!object || locked) return;
      const before = object.visible;
      const apply = (value) => {
        object.visible = value;
        notify();
      };
      apply(!before);
      record({ undo: () => apply(before), redo: () => apply(!before) });
      runtime.publish();
    },
    changeTimeline(next) {
      const before = structuredClone(runtime.getTimeline()),
        after = structuredClone(next);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const apply = (timeline) => {
        runtime.setTimeline(structuredClone(timeline));
        root.userData.blockingStudioTimeline = JSON.stringify(timeline);
        notify({
          entityId: "__timeline__",
          kind: "timeline.shots.set",
          payload: { timeline },
        });
      };
      apply(after);
      record({
        merge: "timeline",
        undo: () => apply(before),
        redo: () => apply(after),
      });
      runtime.publish();
    },
    async deleteEntity(id) {
      const object = find(id);
      if (!object || locked) return;
      api.flushSceneEdits();
      runtime.pause();
      // Keep a local binary fragment for undo recovery after a later full save.
      const recoveryId = await runtime.cacheObject(object);
      if (deleted || !find(id)) return;
      const parent = object.parent,
        index = parent.children.indexOf(object),
        timelineBefore = structuredClone(runtime.getTimeline());
      const related = object.isCamera
        ? root.children.filter(
            (node) => node.userData.blockingStudioPathFor === object.name,
          )
        : [];
      const applyDelete = () => {
        for (const node of related) node.removeFromParent();
        runtime.setTimeline({
          ...timelineBefore,
          shots: timelineBefore.shots.filter(
            (shot) => shot.cameraId !== entityId(object),
          ),
        });
        remove(object);
      };
      const restore = () => {
        parent.add(object);
        parent.children.splice(parent.children.indexOf(object), 1);
        parent.children.splice(index, 0, object);
        root.add(...related);
        runtime.setTimeline(timelineBefore);
        topology();
        select(object.uuid);
        notify({
          entityId: entityId(object),
          kind: "object.create.from_glb",
          payload: {
            assetId: recoveryId,
            name: object.name,
            transform: transformOf(object),
          },
        });
      };
      applyDelete();
      record({ undo: restore, redo: applyDelete });
      runtime.publish();
    },
    copySelection() {
      const object = find(selected),
        template = object && cloneEditable(object);
      if (!template) return false;
      clipboard = { template, count: 0 };
      return true;
    },
    paste() {
      if (!clipboard) return false;
      clipboard.count++;
      return api.duplicate(clipboard.template, clipboard.count);
    },
    duplicate(id = selected, count = 1) {
      const object = typeof id === "object" ? id : find(id);
      if (!object || !creation(object) || locked) return false;
      const copy = cloneEditable(object);
      copy.traverse((node) => {
        node.userData.hf_id = crypto.randomUUID();
      });
      const base =
        `${(object.name || "Entity").replace(/_copy(?:_\d+)?$/, "")}_copy`.replace(
          /\s+/g,
          "_",
        );
      const names = new Set();
      root.traverse((node) => names.add(node.name));
      copy.name = base;
      for (let suffix = 2; names.has(copy.name); suffix++)
        copy.name = `${base}_${suffix}`;
      copy.position.x += 0.5 * count;
      copy.position.z += 0.5 * count;
      insert(copy);
      record({ undo: () => remove(copy), redo: () => insert(copy) });
      runtime.publish();
      return true;
    },
    focus(id = selected) {
      const object = find(id);
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty())
        box.setFromCenterAndSize(
          object.getWorldPosition(new THREE.Vector3()),
          new THREE.Vector3(2, 2, 2),
        );
      const sphere = box.getBoundingSphere(new THREE.Sphere()),
        distance =
          1.15 *
          Math.max(
            sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)),
            0.1,
          );
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() < 1e-8) direction.set(1, 1, 1);
      direction.normalize();
      const start = performance.now(),
        fromPosition = camera.position.clone(),
        fromTarget = controls.target.clone();
      function tick(now) {
        if (deleted) return;
        const progress = Math.min((now - start) / 320, 1),
          ease = 1 - (1 - progress) ** 3;
        controls.target.lerpVectors(fromTarget, sphere.center, ease);
        camera.position.lerpVectors(
          fromPosition,
          sphere.center.clone().addScaledVector(direction, distance),
          ease,
        );
        camera.near = Math.max(distance / 1000, 0.001);
        camera.far = Math.max(distance * 100, 100);
        camera.updateProjectionMatrix();
        controls.update();
        runtime.render();
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    },
    undo() {
      if (locked) return;
      api.flushSceneEdits();
      const entry = past.pop();
      if (!entry) return;
      entry.undo();
      future.push(entry);
      notify();
      runtime.publish();
    },
    redo() {
      if (locked) return;
      api.flushSceneEdits();
      const entry = future.pop();
      if (!entry) return;
      entry.redo();
      past.push(entry);
      notify();
      runtime.publish();
    },
    exportSceneJson() {
      const entities = [
        {
          id: "world",
          kind: "world",
          state: { settings: structuredClone(runtime.getWorld()) },
        },
      ];
      const targets = new Set();
      root.traverse((object) => {
        if (object.target) targets.add(object.target);
      });
      root.traverse((object) => {
        if (
          object === root ||
          object.isBone ||
          object.userData.libtvLightTarget ||
          targets.has(object)
        )
          return;
        const material = editableMaterial(object);
        entities.push({
          id: entityId(object),
          kind: entityKind(object),
          state: {
            name: object.name,
            parentId: object.parent === root ? null : entityId(object.parent),
            visible: object.visible !== false,
            transform: transformOf(object),
            color: material ? `#${material.color.getHexString()}` : null,
            light: lightState(object),
            camera: object.isPerspectiveCamera
              ? {
                  fov: object.fov,
                  focalLength: object.getFocalLength(),
                  near: object.near,
                  far: object.far,
                  aspect: object.userData.blockingStudioAspect ?? null,
                }
              : null,
          },
        });
      });
      const timeline = runtime.getTimeline();
      // Duration is editable even before the first camera shot exists.
      entities.push({
          id: "timeline",
          kind: "timeline",
          state: { timeline },
        });
      return { version: 1, savedAtMs: Date.now(), entities, operations: [] };
    },
    assetNodeIds() {
      const ids = {};
      root.traverse((object) => {
        if (!object.userData.hf_asset) return;
        const nodes = [];
        object.traverse((node) => nodes.push(entityId(node)));
        ids[entityId(object)] = nodes;
      });
      return ids;
    },
    localPathNodes() {
      const nodes = [];
      root.traverse((object) => {
        if (pathAncestor(object))
          nodes.push({
            id: entityId(object),
            parentId: object.parent === root ? null : entityId(object.parent),
            name: object.name,
            userData: structuredClone(object.userData),
            transform: transformOf(object),
          });
      });
      return nodes;
    },
    restorePathNodes(nodes = []) {
      for (const item of nodes) {
        let object = find(item.id);
        if (!object) {
          object = item.userData.blockingStudioPathFor
            ? new THREE.Group()
            : new THREE.Object3D();
          object.userData = structuredClone(item.userData);
          object.name = item.name;
          applyTransform(object, item.transform);
          (item.parentId ? find(item.parentId) : root)?.add(object);
        }
      }
    },
    async replayOperation(operation, metadata) {
      const payload = operation.payload || {},
        id = operation.entityId;
      let object = find(id);
      switch (operation.kind) {
        case "object.create.from_glb": {
          if (object) break;
          const asset = await readImportedAsset(payload.assetId);
          if (!asset) throw new Error("本地导入资产缺失，无法恢复编辑。");
          const gltf = await loader.parseAsync(asset.bytes.slice(0), "");
          object = gltf.scene;
          if (object.userData.libtvFragment && object.children.length === 1)
            object = object.children[0];
          const ids = metadata?.assetNodeIds?.[id];
          let index = 0;
          if (ids)
            object.traverse((node) => {
              if (ids[index]) node.userData.hf_id = ids[index];
              index++;
            });
          object.userData.hf_id = id;
          assignEntityIds(object, id);
          object.userData.hf_asset = payload.assetId;
          runtime.registerAnimations(object, gltf.animations);
          root.add(object);
          break;
        }
        case "object.create.primitive":
          if (!object) {
            object = primitive(payload.primitive);
            object.userData.hf_primitive = payload.primitive;
            object.userData.hf_id = id;
            object.userData.hf_primitive = payload.primitive;
            root.add(object);
          }
          break;
        case "camera.create":
          if (!object) {
            object = payload.projection.type === 'orthographic'
              ? new THREE.OrthographicCamera(-payload.projection.verticalSize/2,payload.projection.verticalSize/2,payload.projection.verticalSize/2,-payload.projection.verticalSize/2,payload.projection.near,payload.projection.far)
              : new THREE.PerspectiveCamera(
              THREE.MathUtils.radToDeg(payload.projection.verticalFov),
              1,
              payload.projection.near,
              payload.projection.far,
            );
            object.userData.hf_id = id;
            root.add(object);
          }
          break;
        case "light.create":
          if (!object) {
            object =
              payload.properties.type === "directional"
                ? new THREE.DirectionalLight()
                : payload.properties.type === "point"
                  ? new THREE.PointLight()
                  : new THREE.SpotLight();
            object.userData.hf_id = id;
            root.add(object);
          }
          break;
        case "entity.delete":
        case "object.delete":
          object?.removeFromParent();
          break;
        case "entity.rename":
        case "object.rename":
          if (object) {
            const previous = object.name;
            for(const clip of runtime.getClips())for(const track of clip.tracks)
              if(previous&&track.name.startsWith(`${previous}.`))track.name=payload.name+track.name.slice(previous.length);
            object.name = payload.name;
          }
          break;
        case "entity.transform.set":
        case "object.transform.set":
        case "camera.transform.set":
          if (object) applyTransform(object, payload.transform);
          break;
        case "object.material.set": {
          const material = object && editableMaterial(object),
            value = payload.material;
          if (material) {
            material.color.fromArray(value.baseColor);
            material.opacity = value.baseColor[3];
            material.transparent = material.opacity < 1;
            material.metalness = value.metallic;
            material.roughness = value.roughness;
          }
          break;
        }
        case "timeline.shots.set":
          runtime.setTimeline(payload.timeline);
          break;
        case "camera.rig.set":
          if (object) runtime.applyRig(object, payload.rig);
          break;
        case "camera.projection.set":
          if (object?.isPerspectiveCamera && payload.projection) {
            object.fov = THREE.MathUtils.radToDeg(
              payload.projection.verticalFov,
            );
            object.near = payload.projection.near;
            object.far = payload.projection.far;
            object.updateProjectionMatrix();
          } else if (object?.isOrthographicCamera && payload.projection?.type === 'orthographic') {
            const half = payload.projection.verticalSize / 2;
            object.left=-half;object.right=half;object.top=half;object.bottom=-half;
            object.near=payload.projection.near;object.far=payload.projection.far;object.updateProjectionMatrix();
          }
          break;
        case "camera.active.set":
          if(object?.isCamera)object.userData.hf_active_camera=true;
          break;
        case "light.properties.set":
          if(object?.isLight){
            const p=payload.properties;
            object.color.fromArray(p.color);object.intensity=p.intensity;object.castShadow=p.castShadow;
            if('distance' in object)object.distance=p.range||0;
            if(object.isSpotLight){object.angle=p.outerConeAngle??object.angle;object.penumbra=p.innerConeAngle!==undefined?1-p.innerConeAngle/object.angle:object.penumbra;}
          }
          break;
        case "world.settings.set":
          runtime.setWorld(payload.settings);
          break;
      }
      if (object && operation.kind.includes("create")) {
        object.name = payload.name || object.name;
        applyTransform(object, payload.transform);
        object.castShadow = object.receiveShadow = true;
        if (object.isLight) {
          const p = payload.properties;
          object.color.fromArray(p.color);
          object.intensity = p.intensity;
          object.castShadow = p.castShadow;
          if ("distance" in object) object.distance = p.range || 0;
          if (object.isSpotLight) {
            object.angle = p.outerConeAngle;
            object.penumbra = 1 - p.innerConeAngle / p.outerConeAngle;
          }
        }
      }
    },
    restoreSnapshot(json) {
      const entities = new Map(
        json.entities
          .filter((entity) => !entity.deleted)
          .map((entity) => [entity.id, entity]),
      );
      const targets = new Set();
      root.traverse((object) => {
        if (object.target) targets.add(object.target);
      });
      if (!entities.has("timeline"))
        runtime.setTimeline({ ...runtime.getTimeline(), shots: [] });
      for (const object of [...root.children]) {
        object.traverse((node) => {
          if (
            node.isBone ||
            node.userData.libtvLightTarget ||
            targets.has(node)
          )
            return;
          if (!entities.has(entityId(node)))
            node.userData.localRestoreDelete = true;
        });
      }
      const remove = [];
      root.traverse((node) => {
        if (node.userData.localRestoreDelete) remove.push(node);
      });
      remove.forEach((node) => {
        delete node.userData.localRestoreDelete;
        node.removeFromParent();
      });
      for (const entity of entities.values()) {
        if (entity.kind === "world") {
          runtime.setWorld(entity.state.settings);
          continue;
        }
        if (entity.kind === "timeline") {
          runtime.setTimeline(entity.state.timeline);
          continue;
        }
        const object = find(entity.id);
        if (!object) continue;
        const state = entity.state;
        const oldName = object.name;
        if (oldName !== state.name)
          for (const clip of runtime.getClips())
            for (const track of clip.tracks) {
              if (oldName && track.name.startsWith(`${oldName}.`))
                track.name = state.name + track.name.slice(oldName.length);
            }
        object.name = state.name;
        object.visible = state.visible !== false;
        applyTransform(object, state.transform);
        const parent = state.parentId ? find(state.parentId) : root;
        if (parent && object.parent !== parent) parent.add(object);
        const material = editableMaterial(object);
        if (material && state.color) material.color.set(state.color);
        if (object.isLight && state.light) {
          const p = state.light;
          object.color.set(p.color);
          object.intensity = p.intensity;
          object.castShadow = p.castShadow;
          object.userData.hf_cast_shadow = p.castShadow;
          if (p.distance !== null) object.distance = p.distance;
          if (p.angle !== null)
            object.angle = THREE.MathUtils.degToRad(p.angle);
          if (p.penumbra !== null) object.penumbra = p.penumbra;
        }
        if (object.isPerspectiveCamera && state.camera) {
          const p = state.camera;
          object.fov = p.fov;
          object.near = Math.max(p.near, 1e-4);
          object.far = Math.max(p.far, 1.001 * object.near);
          if (p.aspect === null) delete object.userData.blockingStudioAspect;
          else {
            object.userData.blockingStudioAspect = p.aspect;
            object.aspect = p.aspect;
          }
          object.updateProjectionMatrix();
        }
      }
      runtime.rebindAnimations();
      topology();
      runtime.publish();
      runtime.render();
    },
    dispose() {
      deleted = true;
      renderer.domElement.removeEventListener("pointermove", hover, true);
      renderer.domElement.removeEventListener("pointerdown", pointerDown, true);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      for (const set of sets) {
        set.control.detach();
        set.control.dispose();
      }
      gizmos.removeFromParent();
      helpers.removeFromParent();
      disposeHelpers(helpers);
      pathPreviews.removeFromParent();
      disposeHelpers(pathPreviews);
    },
  };
  buildHelpers();
  return api;
}
