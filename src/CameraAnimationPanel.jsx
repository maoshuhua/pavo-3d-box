import React from "react";
import { Icon, TransformField } from "./SceneInspector.jsx";

// libtv eaO/_I, eiQ/PE/Rw and eaq: same six cards, SVG paths and 2.4s motion previews.
const motions = [
  ["arc-right", "弧线", "围绕主体扫过", "M 8 31 Q 34 2 72 25"],
  ["dolly-in", "推进", "聚焦主体", "M 8 31 L 72 12"],
  ["truck-left", "横移", "横向穿过场景", "M 72 25 Q 40 14 8 25"],
  ["crane-up", "升降", "升高并展开视野", "M 10 33 Q 30 32 70 7"],
  ["flyover", "飞越", "从场景上方飞过", "M 8 32 Q 38 2 72 17"],
  ["reveal-behind", "揭示", "从后方显露", "M 8 34 C 14 5 55 5 72 25"],
];
const easings = [
  ["linear", "线性", "linear", "M8 32 L72 8"],
  ["ease", "缓动", "inout", "M8 32 C20 32 18 8 72 8"],
  ["ease-in", "缓入", "in", "M8 32 C40 32 56 28 72 8"],
  ["ease-out", "缓出", "out", "M8 32 C24 12 40 8 72 8"],
  ["ease-in-out", "缓入缓出", "inout", "M8 32 C30 32 50 8 72 8"],
  ["smooth", "平滑", "inout", "M8 32 C20 32 20 27 29 23 C40 17 54 18 72 8"],
];
// libtv eiw (animation panel time uses tenths; the CN transport uses mm:ss).
const clock = (value) =>
  !Number.isFinite(value) || value < 0
    ? "0:00.0"
    : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}.${Math.floor((10 * value) % 10)}`;
function Curve({ path, active, easing = false }) {
  return (
    <svg
      viewBox="0 0 80 40"
      aria-hidden="true"
      className={`preset-curve${active ? " active" : ""}`}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <circle cx="8" cy={easing ? 32 : 31} r="2.5" className="curve-origin" />
      <circle r="3" className="curve-point">
        <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
      </circle>
    </svg>
  );
}
export function AnimationHeader({ animation, editor, disabled }) {
  return (
    <div className="animation-header">
      <button
        aria-label="关闭动画设置"
        title="关闭"
        onClick={() => editor?.closeCameraAnimation()}
      >
        ×
      </button>
      <span className="clip-time">00:00 - {clock(animation.duration)}</span>
      {animation.view !== "easing" ? (
        <button
          disabled={
            disabled ||
            (animation.view === "keyframe" && animation.states.length <= 2)
          }
          aria-label={
            animation.view === "keyframe" ? "删除关键帧" : "添加关键帧 · I"
          }
          title={
            animation.view === "keyframe"
              ? "删除关键帧（至少保留两个）"
              : "添加关键帧 · I"
          }
          onClick={() =>
            animation.view === "keyframe"
              ? editor?.removeKeyframe()
              : editor?.addKeyframe()
          }
        >
          <Icon kind="waypoint" />
          {animation.view === "keyframe" ? <b>−</b> : <b>+</b>}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  format,
}) {
  return (
    <label className="animation-range">
      <i
        style={{
          width: `${Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100)}%`,
        }}
      />
      <span>{label}</span>
      <span>{format(value)}</span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={format(value)}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}
export function AnimationControls({ animation, details, editor, disabled }) {
  const easingActive = {
    linear: "linear",
    in: "ease-in",
    out: "ease-out",
    inout: "ease-in-out",
  }[animation.settings.easing];
  return (
    <div className="animation-controls">
      {animation.view !== "easing" ? (
        <>
          <div className="animation-clip-controls">
            <RangeField
              label="片段时长"
              value={animation.duration}
              min={0.1}
              max={Math.max(30, animation.duration)}
              step={0.1}
              format={(value) => `${Number(value.toFixed(1))}s`}
              disabled={disabled}
              onChange={(value) =>
                editor?.setPathSetting({
                  duration: value / (animation.settings.bounce ? 2 : 1),
                })
              }
            />
            <RangeField
              label="视野角度"
              value={animation.fov}
              min={10}
              max={150}
              step={1}
              format={(value) => String(Math.round(value))}
              disabled={disabled}
              onChange={(value) => editor?.setAnimationFov(value)}
            />
            <label className="animation-lookat">
              <span>看向</span>
              <select
                aria-label="看向"
                disabled={disabled}
                value={animation.settings.targetName ?? ""}
                onChange={(event) =>
                  editor?.setPathSetting({
                    targetName: event.target.value || null,
                    aim: event.target.value ? "target" : "tangent",
                  })
                }
              >
                <option value="">跟随路径</option>
                {animation.settings.targetName &&
                  !details.objects.some(
                    (row) =>
                      row.name === animation.settings.targetName &&
                      ["mesh", "group", "character"].includes(row.kind),
                  ) && (
                    <option value={animation.settings.targetName}>
                      {animation.settings.targetName}
                    </option>
                  )}
                {details.objects
                  .filter(
                    (row) =>
                      row.name &&
                      ["mesh", "group", "character"].includes(row.kind),
                  )
                  .map((row) => (
                    <option key={row.id} value={row.name}>
                      {row.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <h2 className="animation-heading">轨迹预设</h2>
          <div className="animation-presets" aria-label="轨迹预设">
            {motions.map(([id, label, title, path]) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                title={title}
                disabled={disabled}
                aria-pressed={animation.settings.presetId === id}
                onClick={() => editor?.applyMotionPreset(id)}
              >
                <Curve
                  path={path}
                  active={animation.settings.presetId === id}
                />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 className="animation-heading">过渡</h2>
          <div className="transition-curve">
            <Curve
              path={easings.find((item) => item[0] === easingActive)[3]}
              active
              easing
            />
          </div>
          <h2 className="animation-heading">预设</h2>
        </>
      )}
      <div className="animation-presets easing-presets" aria-label="缓动预设">
        {easings.map(([id, label, easing, path]) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            disabled={disabled}
            aria-pressed={easingActive === id}
            onClick={() => editor?.setPathSetting({ easing })}
          >
            <Curve path={path} active={easingActive === id} easing />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function AnimationTransform({ animation, editor, disabled }) {
  if (animation.view === "easing") return null;
  const adapter = {
    setTransform: (...args) => editor?.setAnimationTransform(...args),
    flushSceneEdits: () => editor?.flushSceneEdits(),
  };
  return (
    <section
      data-preview-panel="animation-transform"
      className="transform-fields"
    >
      <TransformField
        label="位置"
        field="position"
        unit="m"
        values={animation.transform.position}
        editor={adapter}
        disabled={disabled}
      />
      <TransformField
        label="旋转"
        field="rotation"
        unit="°"
        values={animation.transform.rotation}
        editor={adapter}
        disabled={disabled || animation.settings.aim !== "fixed"}
      />
    </section>
  );
}
