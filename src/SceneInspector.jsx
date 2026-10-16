import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationHeader,
  AnimationControls,
  AnimationTransform,
} from "./CameraAnimationPanel.jsx";

export function Icon({ kind, size = 16 }) {
  const paths = {
    mesh: "M21 7.5 12 2 3 7.5v9L12 22l9-5.5v-9ZM3 7.5 12 13l9-5.5M12 13V22",
    group: "M12 3 2 8l10 5 10-5-10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
    camera: "M3 8h12v10H3zM15 11l6-3v10l-6-3M6 8V5h6v3",
    light:
      "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    waypoint: "m12 4 6 8-6 8-6-8 6-8Z",
    path: "M4 18c0-6 4-10 8-10s8 2 8 6",
    focus: "M12 2v4M12 18v4M2 12h4M18 12h4",
    aim: "M12 2v4M12 18v4M2 12h4M18 12h4",
    folder: "M3 7V5h7l2 3h9v12H3V7Z",
    chevron: "m6 9 6 6 6-6",
    edit: "m4 17-1 4 4-1L20 7l-3-3L4 17ZM15 6l3 3",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
    hidden: "M3 3l18 18M10 5c7-1 12 7 12 7l-4 4M6 6l-4 6s6 10 14 6",
    delete: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
    target: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 12h8M12 8v8",
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
    copy: "M8 8h13v13H8zM16 8V3H3v13h5",
    sphere: "M3 12h18M12 3c-6 6-6 12 0 18M12 3c6 6 6 12 0 18",
    pyramid: "m12 3 9 17H3L12 3ZM12 3v17",
    point:
      "M9 18h6M10 22h4M8.3 15.2A7 7 0 1 1 15.7 15.2c-.8.6-1.2 1.5-1.2 2.3h-5c0-.8-.4-1.7-1.2-2.3Z",
    spot: "m4 5 8 3-3 8-5-2V5ZM12 10l8-3M11 13l9 2M9 16v4",
    import: "M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind] || paths.mesh} />
      {["light", "sphere", "eye", "focus", "aim"].includes(kind) && (
        <circle
          cx="12"
          cy="12"
          r={
            kind === "sphere"
              ? 9
              : kind === "eye"
                ? 3
                : kind === "focus"
                  ? 8
                  : kind === "aim"
                    ? 7
                    : 4
          }
        />
      )}
    </svg>
  );
}

export function TransformField({
  label,
  field,
  values,
  unit,
  editor,
  disabled,
}) {
  const drag = useRef(null);
  return (
    <div data-preview-transform role="group" aria-label={label}>
      <span>
        {label}
        {field === "scale" && <Icon kind="lock" size={14} />}
      </span>
      <div>
        {values.map((value, index) => (
          <label key={index}>
            <span
              data-preview-scrub
              aria-hidden="true"
              onPointerDown={(event) => {
                if (event.button || disabled) return;
                drag.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  value,
                  index,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const start = drag.current;
                if (!start || start.id !== event.pointerId) return;
                const dx = event.clientX - start.x,
                  dy = start.y - event.clientY,
                  distance = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
                if (distance) {
                  editor?.setTransform(
                    field,
                    index,
                    Math.round(
                      (start.value +
                        distance *
                          (event.shiftKey
                            ? 0.001
                            : event.altKey
                              ? 0.1
                              : 0.01)) *
                        1000,
                    ) / 1000,
                  );
                  event.preventDefault();
                }
              }}
              onPointerUp={(event) => {
                drag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                editor?.flushSceneEdits();
              }}
              onPointerCancel={() => {
                drag.current = null;
                editor?.flushSceneEdits();
              }}
            >
              {["X", "Y", "Z"][index]}
            </span>
            <NumericInput
              disabled={disabled}
              label={`${label} ${["X", "Y", "Z"][index]}`}
              title={`${label} ${["X", "Y", "Z"][index]} (${unit})`}
              value={Number(value.toFixed(3))}
              onChange={(number) => editor?.setTransform(field, index, number)}
              onCommit={() => editor?.flushSceneEdits()}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function NumericInput({ value, onChange, onCommit, label, ...props }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      type="number"
      step="0.1"
      aria-label={label}
      {...props}
      value={draft ?? value}
      onFocus={() => setDraft(String(value))}
      onChange={(event) => {
        setDraft(event.target.value);
        if (Number.isFinite(event.target.valueAsNumber))
          onChange(event.target.valueAsNumber);
      }}
      onBlur={() => {
        setDraft(null);
        onCommit?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

const presets = [
  "#ffffff",
  "#99a0a8",
  "#4b5158",
  "#000000",
  "#ff5c5c",
  "#ffd93d",
  "#7ed957",
  "#4f7cff",
];
function hexToHsv(hex) {
  const rgb = hex.match(/\w\w/g).map((value) => parseInt(value, 16) / 255),
    max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min;
  let h = delta
    ? max === rgb[0]
      ? ((rgb[1] - rgb[2]) / delta) % 6
      : max === rgb[1]
        ? (rgb[2] - rgb[0]) / delta + 2
        : (rgb[0] - rgb[1]) / delta + 4
    : 0;
  return [(h * 60 + 360) % 360, max ? delta / max : 0, max];
}
function hsvToHex(h, s, v) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    "#" +
    rgb
      .map((number) =>
        Math.round((number + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function ColorControl({ value, editor, disabled }) {
  const [open, setOpen] = useState(false),
    [format, setFormat] = useState("hex"),
    [draft, setDraft] = useState(null),
    [picking, setPicking] = useState(false);
  const anchor = useRef(null),
    pickerController = useRef(null);
  const [h, s, v] = hexToHsv(value.slice(1)),
    rgb = value
      .slice(1)
      .match(/\w\w/g)
      .map((number) => parseInt(number, 16));
  useEffect(() => () => pickerController.current?.abort(), []);
  const change = (color) => editor?.setColor(color);
  const screen = async () => {
    const controller = new AbortController();
    pickerController.current = controller;
    setPicking(true);
    try {
      change(
        (await new window.EyeDropper().open({ signal: controller.signal }))
          .sRGBHex,
      );
    } catch (error) {
      if (error.name !== "AbortError") console.error(error);
    } finally {
      setPicking(false);
    }
  };
  return (
    <div className="color-control">
      <span>颜色</span>
      <button
        ref={anchor}
        className="color-trigger"
        disabled={disabled}
        aria-label={`颜色：${value}。打开颜色选择器`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i style={{ background: value }} />
        <strong>{value.toUpperCase()}</strong>
      </button>
      {open && (
        <>
          <button
            className="color-backdrop"
            aria-label="关闭颜色选择器"
            onClick={() => setOpen(false)}
          />
          <div className="color-picker" role="dialog" aria-label="颜色选择器">
            <div
              className="color-saturation"
              style={{ backgroundColor: hsvToHex(h, 1, 1) }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const rect = event.currentTarget.getBoundingClientRect();
                change(
                  hsvToHex(
                    h,
                    Math.max(
                      0,
                      Math.min(1, (event.clientX - rect.left) / rect.width),
                    ),
                    Math.max(
                      0,
                      Math.min(1, 1 - (event.clientY - rect.top) / rect.height),
                    ),
                  ),
                );
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                const rect = event.currentTarget.getBoundingClientRect();
                change(
                  hsvToHex(
                    h,
                    Math.max(
                      0,
                      Math.min(1, (event.clientX - rect.left) / rect.width),
                    ),
                    Math.max(
                      0,
                      Math.min(1, 1 - (event.clientY - rect.top) / rect.height),
                    ),
                  ),
                );
              }}
            >
              <i style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
            </div>
            <input
              className="color-hue"
              type="range"
              min={0}
              max={359}
              value={h}
              aria-label="色相"
              onChange={(event) =>
                change(hsvToHex(Number(event.target.value), s, v))
              }
            />
            <div className="color-presets">
              {presets.map((color) => (
                <button
                  key={color}
                  style={{ background: color }}
                  aria-label={`预设颜色 ${color}`}
                  onClick={() => change(color)}
                />
              ))}
            </div>
            <div className="color-tabs">
              <button
                disabled={!window.EyeDropper || picking}
                aria-label="从屏幕拾取颜色"
                onClick={screen}
              >
                ⌾
              </button>
              {["hex", "rgb"].map((tab) => (
                <button
                  key={tab}
                  aria-pressed={format === tab}
                  onClick={() => setFormat(tab)}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
            {format === "hex" ? (
              <label className="hex-field">
                <span>#</span>
                <input
                  aria-label="颜色 HEX"
                  value={draft ?? value.slice(1).toUpperCase()}
                  onFocus={() => setDraft(value.slice(1))}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (/^[\da-f]{6}$/i.test(event.target.value))
                      change(`#${event.target.value}`);
                  }}
                  onBlur={() => setDraft(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
            ) : (
              <div className="rgb-fields">
                {rgb.map((number, index) => (
                  <label key={index}>
                    <span>{["R", "G", "B"][index]}</span>
                    <NumericInput
                      label={["R", "G", "B"][index]}
                      min={0}
                      max={255}
                      step={1}
                      value={number}
                      onChange={(next) => {
                        if (!Number.isInteger(next) || next < 0 || next > 255)
                          return;
                        const copy = [...rgb];
                        copy[index] = next;
                        change(
                          "#" +
                            copy
                              .map((value) =>
                                value.toString(16).padStart(2, "0"),
                              )
                              .join(""),
                        );
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function SceneInspector({
  details,
  editor,
  addButton,
  onAdd,
  disabled,
  browsingOnly,
  bottom,
  width,
  onWidth,
  onError,
  onRequestDelete,
}) {
  disabled = disabled || browsingOnly;
  const animation = !browsingOnly && details.animation;
  const activeSelectedId = animation
    ? (animation.stateId ?? animation.cameraId)
    : details.selectedId;
  const selectRow = (id) =>
    animation ? editor?.selectAnimationNode(id) : editor?.select(id);
  const [collapsed, setCollapsed] = useState(new Set()),
    [renaming, setRenaming] = useState(null),
    [name, setName] = useState("");
  const [height, setHeight] = useState(
      () => Number(localStorage.getItem("3d-box:outliner-height")) || 160,
    ),
    [scrollTop, setScrollTop] = useState(0);
  const container = useRef(null),
    scroll = useRef(null),
    resize = useRef(null);
  const visible = useMemo(() => {
    let hiddenDepth = Infinity;
    return (details.objects || []).filter((row) => {
      if (row.depth > hiddenDepth) return false;
      hiddenDepth = Infinity;
      if (collapsed.has(row.id)) hiddenDepth = row.depth;
      return true;
    });
  }, [details.objects, collapsed]);
  const virtual = visible.length > 100,
    start = virtual ? Math.max(0, Math.floor(scrollTop / 44) - 4) : 0;
  const shown = virtual
    ? visible.slice(start, Math.ceil((scrollTop + height) / 44) + 4)
    : visible;
  const selected = details.objects?.find(
    (object) => object.id === details.selectedId,
  );
  const toggle = (row, recursive) =>
    setCollapsed((before) => {
      const next = new Set(before),
        close = !next.has(row.id);
      const index = details.objects.indexOf(row),
        children = [row];
      if (recursive)
        for (
          let i = index + 1;
          i < details.objects.length && details.objects[i].depth > row.depth;
          i++
        )
          children.push(details.objects[i]);
      for (const child of children)
        if (close) next.add(child.id);
        else next.delete(child.id);
      return next;
    });
  const focusRow = (row) => {
    if (!row) return;
    selectRow(row.id);
    const index = visible.findIndex((item) => item.id === row.id);
    if (index >= 0)
      scroll.current.scrollTop = Math.min(scroll.current.scrollTop, index * 44);
    requestAnimationFrame(() =>
      container.current
        ?.querySelector(`[data-outliner-id="${row.id}"]`)
        ?.focus(),
    );
  };
  const rename = () => {
    try {
      editor?.rename(renaming, name);
      setRenaming(null);
    } catch (error) {
      onError(error.message);
    }
  };
  const rowKey = (event, row) => {
    if (event.target.closest("input")) return;
    const index = visible.indexOf(row);
    if (event.key === "ArrowDown") focusRow(visible[index + 1]);
    else if (event.key === "ArrowUp") focusRow(visible[index - 1]);
    else if (event.key === "Home") focusRow(visible[0]);
    else if (event.key === "End") focusRow(visible.at(-1));
    else if (event.key === "ArrowRight") {
      if (row.childCount && collapsed.has(row.id)) toggle(row, event.altKey);
      else focusRow(visible[index + 1]);
    } else if (event.key === "ArrowLeft") {
      if (row.childCount && !collapsed.has(row.id)) toggle(row, event.altKey);
      else focusRow(visible.find((item) => item.id === row.parentId));
    } else return;
    event.preventDefault();
  };
  const beginResize = (event, type) => {
    resize.current = {
      id: event.pointerId,
      type,
      x: event.clientX,
      y: event.clientY,
      width,
      height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragResize = (event) => {
    const start = resize.current;
    if (!start || start.id !== event.pointerId) return;
    if (start.type === "width")
      onWidth(
        Math.max(
          240,
          Math.min(
            window.innerWidth - 320,
            start.width + start.x - event.clientX,
          ),
        ),
      );
    else
      setHeight(
        Math.max(
          80,
          Math.min(
            600,
            window.innerHeight - bottom - 140,
            start.height + event.clientY - start.y,
          ),
        ),
      );
  };
  const endResize = () => {
    resize.current = null;
    localStorage.setItem("3d-box:outliner-height", String(height));
  };
  return (
    <aside
      ref={container}
      className={`inspector${animation ? " animation-inspector" : ""}`}
      data-preview-panel={animation ? "animation-inspector" : "scene-inspector"}
      aria-label={animation ? "动画检查器" : "场景检查器"}
      style={{ bottom, width }}
    >
      <div
        className="inspector-width-resize"
        role="separator"
        aria-label="调整项目资产栏宽度"
        aria-orientation="vertical"
        tabIndex={0}
        aria-valuenow={width}
        aria-valuemin={240}
        onPointerDown={(event) => beginResize(event, "width")}
        onPointerMove={dragResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            onWidth(
              Math.max(
                240,
                Math.min(
                  window.innerWidth - 320,
                  width + (event.key === "ArrowLeft" ? 10 : -10),
                ),
              ),
            );
          }
        }}
      />
      <section
        data-scene-inspector-card
        data-preview-panel={animation ? "animation-settings" : undefined}
      >
        <div className="inspector-header" data-scene-inspector-header>
          <span>
            <Icon kind="folder" />
          </span>
          <span>项目资产</span>
          <button
            hidden={browsingOnly}
            className="add-button"
            ref={addButton}
            aria-label="添加到场景 · ⇧A"
            title="添加到场景 · ⇧A"
            disabled={disabled}
            onClick={onAdd}
          >
            +
          </button>
        </div>
        {animation && (
          <AnimationHeader
            animation={animation}
            editor={editor}
            disabled={disabled}
          />
        )}
        <div className={animation ? "animation-settings-scroll" : undefined}>
          {(!animation || animation.view !== "easing") && (
            <>
              <div
                className="asset-list"
                data-preview-outliner
                ref={scroll}
                style={{ height: animation ? 140 : height }}
                onScroll={(event) =>
                  setScrollTop(event.currentTarget.scrollTop)
                }
              >
                {!visible.length && (
                  <div className="empty-assets">
                    <p>空场景</p>
                    <span>添加几何体和灯光。</span>
                  </div>
                )}
                <div
                  role="tree"
                  aria-label="场景元素"
                  style={
                    virtual
                      ? {
                          paddingTop: start * 44,
                          paddingBottom:
                            (visible.length - start - shown.length) * 44,
                        }
                      : undefined
                  }
                >
                  {shown.map((row) => (
                    <div
                      key={row.id}
                      className="tree-row"
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-selected={activeSelectedId === row.id}
                      aria-expanded={
                        row.childCount ? !collapsed.has(row.id) : undefined
                      }
                      tabIndex={
                        activeSelectedId === row.id ||
                        (!activeSelectedId && row === visible[0])
                          ? 0
                          : -1
                      }
                      data-outliner-id={row.id}
                      style={{ paddingLeft: 6 + 24 * row.depth }}
                      onClick={() => selectRow(row.id)}
                      onKeyDown={(event) => rowKey(event, row)}
                    >
                      {Array.from({ length: row.depth }, (_, index) => (
                        <i
                          className="tree-guide"
                          key={index}
                          style={{ left: 14 + index * 24 }}
                        />
                      ))}
                      {row.childCount ? (
                        <button
                          className="tree-collapse"
                          tabIndex={-1}
                          aria-label={`${collapsed.has(row.id) ? "展开" : "收起"} ${row.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(row, event.altKey);
                          }}
                          style={{
                            transform: collapsed.has(row.id)
                              ? "rotate(-90deg)"
                              : undefined,
                          }}
                        >
                          <Icon kind="chevron" size={12} />
                        </button>
                      ) : (
                        <span className="tree-spacer" />
                      )}
                      <span
                        className="tree-label"
                        style={{
                          opacity:
                            row.hidden || row.hiddenByAncestorId ? 0.45 : 1,
                        }}
                      >
                        <Icon kind={row.kind} />
                        {renaming === row.id ? (
                          <input
                            aria-label="元素名称"
                            value={name}
                            autoFocus
                            maxLength={128}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setName(event.target.value)}
                            onBlur={rename}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === "Enter") rename();
                              if (event.key === "Escape") setRenaming(null);
                            }}
                          />
                        ) : (
                          <span
                            title={row.label}
                            onDoubleClick={(event) => {
                              if (disabled) return;
                              event.stopPropagation();
                              setName(row.name);
                              setRenaming(row.id);
                            }}
                          >
                            {row.label}
                          </span>
                        )}
                      </span>
                      <div className="tree-actions">
                        <button
                          disabled={disabled}
                          aria-label="元素名称"
                          title="元素名称"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            setName(row.name);
                            setRenaming(row.id);
                          }}
                        >
                          <Icon kind="edit" size={14} />
                        </button>
                        <button
                          disabled={disabled}
                          data-hidden={
                            row.hidden || !!row.hiddenByAncestorId || undefined
                          }
                          aria-label={
                            row.hiddenByAncestorId
                              ? "选中隐藏的父级"
                              : row.hidden
                                ? "显示元素"
                                : "隐藏元素"
                          }
                          title={row.hidden ? "显示 (H)" : "隐藏 (H)"}
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            row.hiddenByAncestorId
                              ? selectRow(row.hiddenByAncestorId)
                              : editor?.toggleHidden(row.id);
                          }}
                        >
                          <Icon
                            kind={
                              row.hidden || row.hiddenByAncestorId
                                ? "hidden"
                                : "eye"
                            }
                            size={14}
                          />
                        </button>
                        <button
                          disabled={disabled}
                          aria-label={`删除 ${row.label}`}
                          title="删除"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRequestDelete(row);
                          }}
                        >
                          <Icon kind="delete" size={14} />
                        </button>
                        <button
                          aria-label={`聚焦 ${row.label}`}
                          title="聚焦"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            editor?.focus(row.id);
                          }}
                        >
                          <Icon kind="target" size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {!animation && (
                <div
                  className="outliner-resize"
                  role="separator"
                  aria-label="调整项目资产列表高度"
                  aria-orientation="horizontal"
                  tabIndex={0}
                  aria-valuenow={height}
                  aria-valuemin={80}
                  aria-valuemax={600}
                  onPointerDown={(event) => beginResize(event, "height")}
                  onPointerMove={dragResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onKeyDown={(event) => {
                    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                      event.preventDefault();
                      setHeight((value) =>
                        Math.max(
                          80,
                          Math.min(
                            600,
                            value + (event.key === "ArrowDown" ? 10 : -10),
                          ),
                        ),
                      );
                    }
                  }}
                />
              )}
            </>
          )}
          {animation && (
            <AnimationControls
              animation={animation}
              details={details}
              editor={editor}
              disabled={disabled}
            />
          )}
        </div>
        {!animation && !browsingOnly && details.transform?.color && (
          <ColorControl
            key={details.selectedId}
            value={details.transform.color}
            editor={editor}
            disabled={disabled}
          />
        )}
      </section>
      {animation && (
        <AnimationTransform
          animation={animation}
          editor={editor}
          disabled={disabled}
        />
      )}
      {!animation && !browsingOnly && selected && details.transform && (
        <section data-object-state aria-label="元素状态">
          <div className="transform-fields">
            {[
              ["position", "位置", "m"],
              ["scale", "缩放", "×"],
              ["rotation", "旋转", "°"],
            ].map(([field, label, unit]) => (
              <TransformField
                key={`${selected.id}:${field}`}
                field={field}
                label={label}
                unit={unit}
                values={details.transform[field]}
                editor={editor}
                disabled={disabled}
              />
            ))}
          </div>
          <h2 className="state-heading">
            <Icon kind="waypoint" size={20} />
            状态
          </h2>
        </section>
      )}
    </aside>
  );
}
