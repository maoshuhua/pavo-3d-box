import {commonCameraMotions,cameraPathPresets} from './cameraPathPresets.js';
import React from "react";
import { Icon, TransformField } from "./SceneInspector.jsx";

// libtv eaO/_I, eiQ/PE/Rw and eaq: same six cards, SVG paths and 2.4s motion previews.
const motions=commonCameraMotions;
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
      <span className="clip-time">{clock(animation.start??0)} - {clock((animation.start??0)+animation.duration)}</span>
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
      {animation.error&&<p role="alert">{animation.error}</p>}
      {animation.diagnostics?.length>0&&<p role="status">路径检查：{animation.diagnostics.some(d=>d.kind==='inside-subject-bounds')?'部分时刻进入主体包围范围，请检查穿模。':'部分时刻主体超出画幅，请检查构图。'}</p>}
      {animation.segments?.length>1&&<label className="animation-lookat"><span>路径片段</span><select aria-label="路径片段" value={animation.pathId} disabled={disabled} onChange={e=>editor?.openCameraAnimation(e.target.value)}>{animation.segments.map(s=><option key={s.id} value={s.id}>{clock(s.start)} · {s.label}</option>)}</select></label>}
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
                  duration: value * (Math.abs(animation.settings.speed)>1e-4?Math.abs(animation.settings.speed):1) / (animation.settings.bounce ? 2 : 1),
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
                value={animation.settings.aim==='fixed'?'__fixed__':animation.settings.aim==='tangent'?'':animation.settings.targetName??''}
                onChange={(event) =>
                  editor?.setPathSetting({
                    targetName: event.target.value==='__fixed__'?null:event.target.value||null,
                    aim: event.target.value==='__fixed__'?'fixed':event.target.value?'target':'tangent',
                  })
                }
              >
                <option value="">跟随路径</option>
                <option value="__fixed__">固定朝向</option>
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
          <label className="animation-lookat"><span>全部预设</span><select aria-label="全部轨迹预设" value={animation.settings.presetId??''} disabled={disabled} onChange={e=>{if(e.target.value)editor?.applyMotionPreset(e.target.value);}}><option value="">自定义路径</option>{cameraPathPresets.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label className="animation-lookat"><span>曲线</span><select aria-label="路径曲线" value={animation.settings.curve} disabled={disabled} onChange={e=>editor?.setPathSetting({curve:e.target.value})}><option value="centripetal">向心</option><option value="chordal">弦长</option><option value="catmullrom">Catmull-Rom</option></select></label>
          <RangeField label="运动速度" value={animation.settings.speed} min={-3} max={3} step={.1} format={v=>`${Number(v.toFixed(1))}×`} disabled={disabled} onChange={v=>editor?.setPathSetting({speed:v})}/>
          <RangeField label="运动幅度" value={animation.settings.intensity} min={.25} max={2} step={.05} format={v=>`${Number(v.toFixed(2))}×`} disabled={disabled||!animation.settings.presetId} onChange={v=>editor?.setPathSetting({intensity:v})}/>
          <label className="animation-lookat"><span>取景</span><select aria-label="路径取景" value={animation.settings.framing} disabled={disabled||!animation.settings.presetId} onChange={e=>editor?.setPathSetting({framing:e.target.value})}><option value="close">近景</option><option value="medium">中景</option><option value="wide">远景</option></select></label>
          <label className="animation-lookat"><span>往返</span><input type="checkbox" aria-label="路径往返" checked={animation.settings.bounce} disabled={disabled} onChange={e=>editor?.setPathSetting({bounce:e.target.checked})}/></label>
          <label className="animation-lookat"><span>跟随主体</span><select aria-label="跟随主体" disabled={disabled} value={animation.settings.follow?.entityId??''} onChange={e=>editor?.setPathFollow(e.target.value||null)}><option value="">静态路径</option>{details.objects.filter(r=>['mesh','group','character'].includes(r.kind)).map(r=><option key={r.id} value={r.entityId??r.id}>{r.label}</option>)}</select></label>
          {animation.settings.follow&&<label className="animation-lookat"><span>跟随坐标</span><select aria-label="跟随坐标" disabled={disabled} value={animation.settings.follow.positionSpace} onChange={e=>editor?.setPathSetting({follow:{...animation.settings.follow,positionSpace:e.target.value}})}><option value="world">世界（跟随平移）</option><option value="subject">主体（跟随平移与旋转）</option></select></label>}
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
