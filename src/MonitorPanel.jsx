import React, * as _$ from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import styles from "./Monitor.module.css";
import { Icon } from "./SceneInspector.jsx";
const _W = { jsx, jsxs },
  In = { default: styles },
  Av = {
    PREVIEW_MONITOR_TOP_VIEW: "topView",
    PREVIEW_MONITOR_ORBIT_VIEW: "orbitView",
  };
const labels = {
  previewMonitorLocateCamera: "定位相机",
  previewMonitorReturn3dView: "返回3D视图",
  previewMonitorEnterTopView: "进入俯视图",
  previewMonitor3dView: "3D视图",
  previewMonitorTopView: "俯视图",
  previewMonitorExitCamera: "退出机位",
  previewMonitorEnterCamera: "进入机位",
};
const _B = {
  useI18n: () => ({
    t: (key, args) =>
      labels[key.replace("common:", "")] ?? `相机 ${args?.index ?? ""}`,
  }),
};
const _Z = {
  Icons: {
    PreviewCameraLocate: () => <Icon kind="target" />,
    PreviewCameraFocus: () => <Icon kind="camera" />,
    EditorArrowMinimize: () => (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
      >
        <path d="M1 5h4V1m10 10h-4v4M5 5 1 1m10 10 4 4" />
      </svg>
    ),
  },
};
// libtv Ay/Ab: monitor card selection, hover actions and view switching.
function Ay({
  monitorKey: e,
  label: t,
  frame: n,
  observe: r,
  onSelect: i,
  onDoubleClick: o,
  disabled: a,
  isSelected: l = !1,
  isTopView: s = !1,
  actions: u,
  aspect = 16 / 9,
}) {
  let c = (0, _$.useMemo)(() => r(e), [r, e]);
  return (0, _W.jsxs)("div", {
    className: `${In.default.monitorItem}${l ? ` ${In.default.monitorItemSelected}` : ""}`,
    ref: c,
    "data-disabled": a || void 0,
    onClick:
      a || s
        ? void 0
        : (e) => {
            e.target instanceof Element && !e.target.closest("button") && i();
          },
    onDoubleClick: a ? void 0 : o,
    children: [
      (0, _W.jsxs)("span", {
        className: In.default.monitorThumb,
        style: {aspectRatio: Number.isFinite(aspect)&&aspect>0?aspect:16/9},
        children: [
          (0, _W.jsx)("button", {
            type: "button",
            disabled: a,
            className: In.default.monitorThumbButton,
            onClick: i,
            title: t,
            "aria-pressed": s ? void 0 : l,
            children: n
              ? (0, _W.jsx)("img", { src: n, alt: "", draggable: !1 })
              : (0, _W.jsx)("span", {
                  className: In.default.monitorThumbEmpty,
                }),
          }),
          u,
        ],
      }),
      (0, _W.jsx)("span", { className: In.default.monitorLabel, children: t }),
    ],
  });
}
function Ab({
  disabled: e,
  cameras: t,
  frames: n,
  observe: r,
  cameraViewId: i = null,
  topViewActive: o = !1,
  selectedCameraId: a = null,
  playbackCameraId: l = null,
  onSelectTopView: s,
  onSelect3DView: u,
  onSelectCamera: c,
  onEnterCameraView: d,
  onToggleCameraView: p,
}) {
  let { t: h } = (0, _B.useI18n)(),
    f = h("common:previewMonitorLocateCamera"),
    m = h(
      o
        ? "common:previewMonitorReturn3dView"
        : "common:previewMonitorEnterTopView",
    );
  return (0, _W.jsxs)("div", {
    className: In.default.monitorList,
    children: [
      (0, _W.jsx)(Ay, {
        disabled: e,
        monitorKey: Av.PREVIEW_MONITOR_TOP_VIEW,
        label: h(
          o ? "common:previewMonitor3dView" : "common:previewMonitorTopView",
        ),
        frame:
          n[o ? Av.PREVIEW_MONITOR_ORBIT_VIEW : Av.PREVIEW_MONITOR_TOP_VIEW],
        observe: r,
        isTopView: !0,
        isSelected: o,
        onSelect: o ? (u ?? s) : s,
        actions: (0, _W.jsx)("span", {
          className: `${In.default.monitorActions} ${In.default.monitorTopActions}`,
          children: (0, _W.jsxs)("button", {
            type: "button",
            disabled: e,
            className: `${In.default.monitorEnterAction}${o ? ` ${In.default.monitorEnterActionActive}` : ""}`,
            "aria-label": m,
            onClick: o ? (u ?? s) : s,
            children: [
              o
                ? (0, _W.jsx)(_Z.Icons.EditorArrowMinimize, {
                    height: 16,
                    width: 16,
                    "aria-hidden": !0,
                  })
                : (0, _W.jsx)(_Z.Icons.PreviewCameraFocus, {
                    height: 16,
                    width: 16,
                    "aria-hidden": !0,
                  }),
              (0, _W.jsx)("span", {
                className: In.default.monitorEnterLabel,
                children: m,
              }),
            ],
          }),
        }),
      }),
      t.map((t, o) => {
        let s = i === t.id;
        return (0, _W.jsx)(
          Ay,
          {
            disabled: e,
            monitorKey: t.id,
            aspect: t.aspect,
            label:
              t.name.trim() ||
              h("common:previewMonitorCamera", { index: o + 1 }),
            frame: n[t.id],
            observe: r,
            isSelected: (l ?? a ?? i) === t.id,
            onSelect: () => c(t.id),
            onDoubleClick: () => (d ?? p)?.(t.id),
            actions: (0, _W.jsxs)("span", {
              className: In.default.monitorActions,
              children: [
                (0, _W.jsx)("button", {
                  type: "button",
                  disabled: e,
                  className: In.default.monitorLocateAction,
                  "aria-label": f,
                  title: f,
                  onClick: () => c(t.id),
                  onDoubleClick: (e) => e.stopPropagation(),
                  children: (0, _W.jsx)(_Z.Icons.PreviewCameraLocate, {
                    height: 16,
                    width: 16,
                    "aria-hidden": !0,
                  }),
                }),
                (0, _W.jsxs)("button", {
                  type: "button",
                  disabled: e,
                  className: `${In.default.monitorEnterAction}${s ? ` ${In.default.monitorEnterActionActive}` : ""}`,
                  "aria-pressed": s,
                  onClick: () => p?.(t.id),
                  onDoubleClick: (e) => e.stopPropagation(),
                  children: [
                    (0, _W.jsx)(_Z.Icons.PreviewCameraFocus, {
                      height: 16,
                      width: 16,
                      "aria-hidden": !0,
                    }),
                    (0, _W.jsx)("span", {
                      className: In.default.monitorEnterLabel,
                      children: h(
                        s
                          ? "common:previewMonitorExitCamera"
                          : "common:previewMonitorEnterCamera",
                      ),
                    }),
                  ],
                }),
              ],
            }),
          },
          t.id,
        );
      }),
    ],
  });
}
export default function MonitorPanel({
  monitor,
  editor,
  opened,
  visible,
  width,
  maxWidth,
  onToggle,
  onWidth,
  bottom,
  selectedId,
  cameraView,
  disabled,
  showChrome=true,
}) {
  const drag = React.useRef(null);
  const [preview, setPreview] = React.useState(null);
  const cancel = React.useCallback(() => {
    const state = drag.current;
    drag.current = null;
    if (state?.target.hasPointerCapture(state.id))
      state.target.releasePointerCapture(state.id);
    setPreview(null);
  }, []);
  React.useEffect(() => {
    if (preview === null) return;
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    const hide = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [preview, cancel]);
  React.useEffect(() => cancel(), [width, maxWidth, cancel]);
  const clamped = (value) =>
    Math.max(240, Math.min(maxWidth, Math.round(value)));
  const actual = preview ?? width;
  React.useLayoutEffect(() => {
    const root = document.querySelector("[data-preview-workspace]");
    root?.style.setProperty(
      "--monitor-preview-width",
      `${opened && visible ? actual : 0}px`,
    );
    return () => root?.style.removeProperty("--monitor-preview-width");
  }, [opened, visible, actual]);
  return (
    <>
      <div
        className="monitor-chrome"
        data-open={opened && visible}
        hidden={!visible||!showChrome}
        style={opened ? { width: actual } : undefined}
      >
        <button
          type="button"
          aria-label={opened ? "收起监视器" : "展开监视器"}
          aria-expanded={opened}
          onClick={onToggle}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
          >
            <rect x="1.5" y="2" width="13" height="12" rx="2" />
            <path d="M6 2v12" />
          </svg>
        </button>
      </div>
      <aside
        className={styles.monitorPanel}
        style={{ width: actual, bottom }}
        hidden={!opened || !visible}
        aria-label="监视器"
      >
        <div className={styles.panelTitle}>
          <Icon kind="camera" size={16} />
          监视器
        </div>
        <div className={styles.monitorContent} ref={monitor.scrollContainerRef}>
          <Ab
            disabled={disabled}
            cameras={monitor.cameras}
            frames={monitor.frames}
            observe={monitor.observe}
            selectedCameraId={selectedId}
            cameraViewId={cameraView}
            topViewActive={monitor.topViewActive}
            playbackCameraId={monitor.playbackCameraId}
            onSelectTopView={() => editor?.setTopView(true)}
            onSelect3DView={() => editor?.setTopView(false)}
            onSelectCamera={(id) => editor?.focusMonitorCamera(id)}
            onEnterCameraView={(id) => editor?.enterMonitorCamera(id)}
            onToggleCameraView={(id) =>
              cameraView === id
                ? editor?.setTopView(true)
                : editor?.enterMonitorCamera(id)
            }
          />
        </div>
      </aside>
      {opened && visible && (
        <div
          className="monitor-resize"
          role="separator"
          tabIndex={0}
          aria-label="调整监视器宽度"
          aria-orientation="vertical"
          aria-valuemin={240}
          aria-valuemax={maxWidth}
          aria-valuenow={actual}
          style={{ left: actual - 4, bottom }}
          onPointerDown={(e) => {
            if (e.button || drag.current) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              id: e.pointerId,
              x: e.clientX,
              width,
              target: e.currentTarget,
            };
            setPreview(width);
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (start && start.id === e.pointerId) {
              e.preventDefault();
              setPreview(clamped(start.width + e.clientX - start.x));
            }
          }}
          onPointerUp={(e) => {
            const start = drag.current;
            if (!start || start.id !== e.pointerId) return;
            const value = clamped(start.width + e.clientX - start.x);
            cancel();
            onWidth(value);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(e) => {
            let next;
            if (e.key === "Home") next = 240;
            else if (e.key === "End") next = maxWidth;
            else if (e.key === "ArrowLeft") next = width - 10;
            else if (e.key === "ArrowRight") next = width + 10;
            else return;
            e.preventDefault();
            e.stopPropagation();
            onWidth(clamped(next));
          }}
        />
      )}
      {preview !== null && (
        <div
          className="monitor-resize-overlay"
          style={{ cursor: "ew-resize" }}
        />
      )}
    </>
  );
}

// libtv paired-sidebar width allocation and resize priority.
export const fitPanelWidths = function (e, t, n, r, i) {
  if (!t) return e;
  let o = ["left", "right"].filter((e) => ("left" === e ? n : r)),
    a = Math.max(240 * o.length, t - 480),
    l = o.reduce((t, n) => t + e[n], 0);
  if (l <= a) return e;
  let s = { ...e };
  if (i && o.includes(i)) {
    s[i] = Math.min(e[i], a - (o.length - 1) * 240);
    let t = "left" === i ? "right" : "left";
    return (o.includes(t) && (s[t] = Math.min(e[t], a - s[i])), s);
  }
  let u = a - 240 * o.length,
    c = l - 240 * o.length;
  for (let t of o) s[t] = 240 + Math.floor(((e[t] - 240) * u) / c);
  return s;
};
