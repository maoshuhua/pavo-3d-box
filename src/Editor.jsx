import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import "./style.css";
import { createViewport } from "./glb.js";
import Timeline from "./Timeline.jsx";
import MonitorPanel, { fitPanelWidths } from "./MonitorPanel.jsx";
import { useMonitor } from "./useMonitor.js";
import CameraPreview from "./CameraPreview.jsx";
import ExportPanel from "./ExportPanel.jsx";
import AgentPanel from "./AgentPanel.jsx";
import { AgentClient } from "./agentClient.js";
import { loadAgentArtifacts } from "./agentArtifacts.js";
import {useAnnotation, AnnotationOverlay, composeAnnotation} from './libtvAnnotation.js';
import MotionAnnotation from './MotionAnnotation.jsx';
import SceneInspector, { Icon } from "./SceneInspector.jsx";
import { createLocalAutosave, readLocalProject } from "./localProject.js";
import {saveStudioSnapshot,studioRequest,fetchStudioSnapshot} from './studioApi.js';
import ProjectNavigation from './ProjectNavigation.jsx';
import {createProjectNavigationActions} from './projectNavigationActions.js';
import {createFloatingLayout} from './agentFloatingLayout.js';

// Derived from libtv's published 0wsgf7e09dh0-.js:
// chrome.timelineVisible, data-preview-dock, PZ, previewViewportTools.
const TIMELINE_HEIGHT = 83; // libtv's default compose/photo workspace mode.
const TRANSITION = { duration: 0.24, ease: [0.32, 0.72, 0, 1] };

export default function Editor({project,serverSnapshot,history}) {
  const projectId=project.studioMeta.uuid,projectState=JSON.parse(project.config).animationPreview||{};
  const [projectTitle,setProjectTitle]=useState(project.studioMeta.name);
  const [floatingLayout]=useState(createFloatingLayout);
  const [generationSettings,setGenerationSettings]=useState(projectState.generationSettings||{aspectRatio:'16:9',durationSeconds:'auto',agentMode:'G6',reasoningModel:'g6'});
  const [navigationPending,setNavigationPending]=useState(null);
  const navigationDeps=useRef(null),navigation=useRef(null),agentSettled=useRef(Promise.resolve()),importSettled=useRef(Promise.resolve());
  if(!navigation.current)navigation.current=createProjectNavigationActions(()=>navigationDeps.current);
  const generatedResult=useRef(projectState.generation||null),initialGeneration=useRef(false);
  const [timelineVisible, setTimelineVisible] = useState(
    () => localStorage.getItem("3d-box:timeline-visible") !== "false",
  );
  const [inspectorPreferredWidth, setInspectorWidth] = useState(() =>
    Math.max(
      240,
      Math.min(
        window.innerWidth - 160,
        Number(localStorage.getItem("3d-box:inspector-width")) || 400,
      ),
    ),
  );
  const [monitorOpened, setMonitorOpened] = useState(false);
  const [inspectorOpened, setInspectorOpened] = useState(true);
  const [panelPriority, setPanelPriority] = useState(
    () => localStorage.getItem("3d-box:panel-priority") || undefined,
  );
  const [monitorWidth, setMonitorWidth] = useState(() =>
    Math.max(
      240,
      Math.min(
        400,
        Number(localStorage.getItem("3d-box:monitor-width")) || 240,
      ),
    ),
  );
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const update = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const changeMonitorWidth = (value) => {
    setMonitorWidth(value);
    setPanelPriority("left");
    localStorage.setItem("3d-box:panel-priority", "left");
    localStorage.setItem("3d-box:monitor-width", String(value));
  };
  const [restoring, setRestoring] = useState(true);
  const [saveStatus, setSaveStatus] = useState({ state: "loading" });
  const [deleteRequest, setDeleteRequest] = useState(null);
  const autosave = useRef(null),
    ready = useRef(false);
  const changeWidth = (value) => {
    const next = Math.max(
      240,
      Math.min(
        value,
        windowWidth -
          480 -
          (monitorOpened && monitorVisible ? effectiveMonitorWidth : 0),
      ),
    );
    setInspectorWidth(next);
    setPanelPriority("right");
    localStorage.setItem("3d-box:panel-priority", "right");
    localStorage.setItem("3d-box:inspector-width", String(next));
  };
  useEffect(() => {
    localStorage.setItem("3d-box:timeline-visible", String(timelineVisible));
  }, [timelineVisible]);
  const reducedMotion = useReducedMotion();
  const label = timelineVisible ? "关闭时间轴" : "打开时间轴";
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [agentRunning, setAgentRunning] = useState(history?.runStatus==='running');
  const [,agentRefresh]=useState(0);
  const [annotationActive, setAnnotationActive] = useState(false);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationAttachment, setAnnotationAttachment] = useState(null);
  const annotation = useAnnotation();
  const [agentClip, setAgentClip] = useState(null);
  const [agentClient] = useState(() => new AgentClient(projectId,{sessionId:projectState.sessionId,messages:history?.messages,generationSettings:projectState.generationSettings,latestRun:history?.latestRun,runStatus:history?.runStatus}));
  const agentController = useRef(null);
  const [rate, setRate] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [sceneDetails, setSceneDetails] = useState({
    duration: 15,
    cameras: [],
    shots: [],
    activeCameraId: null,
    cameraView: null,
  });
  const monitorVisible = !sceneDetails.previewMode;
  const inspectorVisible = inspectorOpened && !sceneDetails.previewMode;
  const panelWidths = fitPanelWidths(
    { left: monitorWidth, right: inspectorPreferredWidth },
    windowWidth,
    monitorOpened && monitorVisible,
    inspectorVisible,
    panelPriority,
  );
  const inspectorWidth = inspectorVisible ? panelWidths.right : 0;
  const monitorMax = Math.max(240, windowWidth - 480 - inspectorWidth);
  const effectiveMonitorWidth = panelWidths.left;
  const monitorLeft =
    monitorOpened && monitorVisible ? effectiveMonitorWidth : 0;
  const monitor = useMonitor(monitorOpened && monitorVisible, projectId);
  useEffect(() => {
    if (
      sceneDetails.cameraView &&
      monitorOpened &&
      monitorVisible &&
      !monitor.cameras.some((camera) => camera.id === sceneDetails.cameraView)
    )
      viewport.current?.setCameraView(null);
  }, [monitor.cameras, sceneDetails.cameraView, monitorOpened, monitorVisible]);
  const [exportPhase, setExportPhase] = useState(null);
  const [exportProgress, setExportProgress] = useState(0);
  const exportController = useRef(null);
  const [aspectMenu, setAspectMenu] = useState(null);
  const aspectButton = useRef(null);
  const duration = sceneDetails.duration;
  const dockHeight =
    sceneDetails.animation || sceneDetails.previewMode ? 111 : TIMELINE_HEIGHT;
  const sceneCamera = sceneDetails.cameras.find(
    (camera) => camera.id === sceneDetails.activeCameraId,
  );
  const setPipRect = useCallback(
    (rect) => viewport.current?.setPipRect(rect),
    [],
  );
  const togglePlay = useCallback(() => setPlaying((value) => !value), []);
  useEffect(() => {
    viewport.current?.setMonitorPlayback(playing && !scrubbing && !exportPhase);
  }, [playing, scrubbing, exportPhase]);
  useEffect(() => {
    viewport.current?.seek(time);
  }, [time]);
  useEffect(() => {
    if (!playing || scrubbing || exportPhase) return;
    let frame;
    let previous = performance.now();
    const tick = (now) => {
      const delta = ((now - previous) / 1000) * rate;
      previous = now;
      setTime((current) =>
        duration > 0 ? (current + delta) % duration : current + delta,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, rate, scrubbing, duration, exportPhase]);
  const host = useRef(null);
  const viewport = useRef(null);
  useLayoutEffect(() => {
    const workspace = host.current?.parentElement;
    const navigation = workspace?.querySelector('[data-preview-navigation]');
    const tools = workspace?.querySelector('.viewport-tools');
    const mode = workspace?.querySelector('.mode-toolbar');
    if (!workspace || !navigation || !tools || !mode) return;
    const update = () => {
      const bounds = workspace.getBoundingClientRect();
      const rect = navigation.getBoundingClientRect();
      // libtv: 6px after navigation, 10px after an open monitor; center 28px tools.
      const left = monitorLeft ? monitorLeft + 10 : rect.right - bounds.left + 6;
      workspace.style.setProperty('--preview-tools-left', `${left}px`);
      workspace.style.setProperty('--preview-tools-top', `${rect.top - bounds.top + (rect.height - 28) / 2}px`);
      // Center over the viewport, reserving space for the existing left controls.
      const desired = (monitorLeft + bounds.width - inspectorWidth - mode.offsetWidth) / 2;
      const minimum = left + tools.offsetWidth + 8;
      const maximum = bounds.width - (inspectorWidth || 96) - mode.offsetWidth - 8;
      const fits = minimum <= maximum;
      workspace.style.setProperty('--preview-mode-left', `${fits ? Math.max(minimum, Math.min(desired, maximum)) : Math.max(monitorLeft + 8, desired)}px`);
      workspace.style.setProperty('--preview-mode-top', fits ? '12px' : '60px');
    };
    update();
    const observer = new ResizeObserver(update);
    for (const element of [workspace, navigation, tools, mode]) observer.observe(element);
    return () => observer.disconnect();
  }, [monitorLeft, inspectorWidth]);
  navigationDeps.current={
    onPending:setNavigationPending,
    beforeLeave:async()=>{
      setPlaying(false);
      if(agentController.current){await agentClient.cancel();agentController.current?.abort(new DOMException('Cancelled','AbortError'));await agentSettled.current;}
      await importSettled.current;
    },
    save:async(force)=>{
      if(!ready.current||!autosave.current||!viewport.current)throw Error('场景仍在加载，请等待就绪后重试。');
      viewport.current.flushSceneEdits();
      if(force)autosave.current.changed();
      await autosave.current.flush();
    },
    deleteProject:async()=>{await studioRequest('/api/studio/delete',{method:'POST',body:{studioUuid:projectId}});autosave.current?.dispose();},
    navigate:url=>window.location.assign(url),
  };
  const pending = useRef(false);
  const input = useRef(null);
  const addButton = useRef(null);
  const [menu, setMenu] = useState(null);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const capturePending = useRef(false);
  const startAnnotation = () => {
    if(busy||restoring||exportPhase||agentRunning||navigation.current.pending)return;
    setPlaying(false);setAnnotationActive(true);
  };
  const exitAnnotation = () => {annotation.clear();setAnnotationActive(false)};
  const confirmAnnotation = async () => {
    if(annotationBusy)return;
    setAnnotationBusy(true);
    try{
      const frame=await viewport.current.renderCurrentFrame();
      const blob=await composeAnnotation({frame:frame.blob,stage:{width:host.current.clientWidth,height:host.current.clientHeight},shapes:annotation.shapes});
      setAnnotationAttachment(new File([blob],`运镜轨迹-${Date.now()}.png`,{type:'image/png'}));
      exitAnnotation();
    }catch(cause){setError(cause.message||'标注截图失败。')}
    finally{setAnnotationBusy(false)}
  };
  const generateAgent = async (payload, onEvent) => {
    if (agentController.current || busy || restoring || exportPhase || navigation.current.pending) return;
    let settleAgent;
    agentSettled.current=new Promise(resolve=>{settleAgent=resolve;});
    const controller = new AbortController();
    agentController.current = controller;
    setAgentRunning(true); setPlaying(false);
    viewport.current.setEditingLocked(true);
    try {
      const editor=viewport.current;
      if(!payload.resumeRun){editor.flushSceneEdits(); await autosave.current.flush();}
      let backup;
      if(!payload.resumeRun)backup={bytes:await (await editor.exportSceneGlb()).blob.arrayBuffer(),json:editor.exportSceneJson()};
      if(payload.reference?.type==='clip'){
        const camera=editor.find(payload.reference.cameraId);
        payload={...payload,reference:{...payload.reference,entityId:camera?.userData?.hf_id||payload.reference.cameraId}};
      }
      const handlers={signal:controller.signal,onEvent:()=>{onEvent?.();agentRefresh(n=>n+1);},onResult:async(result,signal,event)=>{
        if(event?.snapshotRevision){
          const saved=await fetchStudioSnapshot(projectId,signal);signal.throwIfAborted();if(!saved)throw Error('生成结果尚未保存');
          ready.current=false;
          try{await autosave.current.adoptSnapshot(saved);await editor.replaceAgentScene(saved);generatedResult.current=saved.generation||result;setTime(0);setAgentClip(null);}
          finally{ready.current=true;}
          return;
        }
        backup??={bytes:await (await editor.exportSceneGlb()).blob.arrayBuffer(),json:editor.exportSceneJson()};
        const artifacts=await loadAgentArtifacts(result,signal);
        const stagingHost=document.createElement('div');stagingHost.style.cssText='position:fixed;left:-10000px;width:640px;height:480px';document.body.append(stagingHost);
        const staging=createViewport(stagingHost,()=>{});
        let snapshot;
        try {
          await staging.replaceAgentScene({bytes:artifacts.bytes},artifacts.operations);
          staging.flushSceneEdits();
          snapshot={bytes:await (await staging.exportSceneGlb()).blob.arrayBuffer(),json:staging.exportSceneJson()};
        } finally {staging.dispose();stagingHost.remove();}
        signal.throwIfAborted();
        // Atomically commit both files before publishing the replacement scene.
        const priorResult=generatedResult.current;generatedResult.current=result;
        try{await autosave.current.replaceSnapshot(snapshot);}catch(cause){generatedResult.current=priorResult;throw cause;}
        try {await editor.replaceAgentScene(snapshot);backup=snapshot;setTime(0);setAgentClip(null);autosave.current.changed();}
        catch(cause){generatedResult.current=priorResult;await autosave.current.replaceSnapshot(backup);await editor.replaceAgentScene(backup);throw cause;}
      }};
      if(payload.resumeRun)await agentClient.resume(payload.resumeRun,handlers);
      else await agentClient.generate({...payload,scene:backup},handlers);
    } finally {
      agentController.current=null;setAgentRunning(false);
      viewport.current?.setEditingLocked(!!navigation.current.pending);
      settleAgent();
    }
  };
  const downloadResult = (result) => {
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${assets.at(-1)?.name || "3D-BOX"}.${result.extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function exportFile(format) {
    if (!viewport.current || busy || capturing || exportController.current)
      return;
    const controller = new AbortController();
    exportController.current = controller;
    setExportPhase("rendering");
    setExportProgress(0);
    setError("");
    document.activeElement?.blur();
    try {
      const editor = viewport.current;
      const result =
        format === "glb"
          ? await editor.exportSceneGlb(controller.signal)
          : format === "png"
            ? await editor.renderCurrentFrame()
            : await editor.renderTimelineVideo({
                format,
                signal: controller.signal,
                onProgress: setExportProgress,
              });
      controller.signal.throwIfAborted();
      downloadResult(result);
    } catch (cause) {
      if (cause.name !== "AbortError") setError(cause.message || "导出失败。");
    } finally {
      exportController.current = null;
      setExportPhase(null);
      setExportProgress(0);
    }
  }
  async function captureViewport() {
    if (
      !viewport.current ||
      busy ||
      exportController.current ||
      capturePending.current
    )
      return;
    capturePending.current = true;
    setCapturing(true);
    setError("");
    try {
      downloadResult(await viewport.current.renderCurrentFrame());
    } catch (cause) {
      setError(cause.message || "截取当前视窗失败。");
    } finally {
      capturePending.current = false;
      setCapturing(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    try {
      const editor = createViewport(host.current, setSceneDetails, {
        getMonitorRequests: monitor.getMonitorRequests,
        onMonitorFrames: monitor.onMonitorFrames,
        onPause: () => setPlaying(false),
        onSeek: setTime,
        onEdit: (operation) => {
          if (ready.current) autosave.current?.changed(operation);
        },
      });
      viewport.current = editor;
      autosave.current = createLocalAutosave(editor, setSaveStatus,{projectId,onSnapshot:async snapshot=>{
        let cover;
        try{const frame=await editor.renderCurrentFrame();const bitmap=await createImageBitmap(frame.blob),canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;const ctx=canvas.getContext('2d');ctx.fillStyle='#222';ctx.fillRect(0,0,480,270);const scale=Math.min(480/bitmap.width,270/bitmap.height);ctx.drawImage(bitmap,(480-bitmap.width*scale)/2,(270-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);bitmap.close();cover=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));}catch{}
        await saveStudioSnapshot(projectId,snapshot,{cover,generation:generatedResult.current,promptHandled:!!generatedResult.current});
      }});
      (async () => {
        try {
          const local=await readLocalProject(projectId);
          let snapshot=(serverSnapshot?.revision??-1)>=(local.snapshot?.revision??-1)?serverSnapshot:local.snapshot;
          const journal=local.journal?.revision>(snapshot?.revision??-1)?local.journal:null;
          let imported=false;
          if(!snapshot&&!journal&&projectState.glbUrl){const response=await fetch(projectState.glbUrl,{credentials:'omit'});if(!response.ok)throw Error('项目GLB读取失败');snapshot={bytes:await response.arrayBuffer(),revision:0};imported=true;}
          if (cancelled) return;
          await editor.restoreProject(snapshot, journal);
          const repairTimeline=!snapshot?.json?.entities?.some(entity=>entity.kind==='timeline')&&!journal&&Number.isFinite(projectState.generationSettings?.durationSeconds);
          if(repairTimeline)editor.changeTimeline({version:1,duration:projectState.generationSettings.durationSeconds,shots:[]});
          if(imported&&projectState.worldSettings)await editor.replayOperation({kind:'world.settings.set',payload:{settings:projectState.worldSettings}});
          if (cancelled) return;
          autosave.current.initialize(
            snapshot?.revision ?? 0,
            journal?.revision ?? snapshot?.revision ?? 0,
            journal?.operations ?? [],
          );
          ready.current = true;
          if(snapshot?.generation){generatedResult.current=snapshot.generation;agentClient.state.lastAppliedTaskId=snapshot.generation.task_id;agentClient.save();}
          editor.setEditingLocked(false);
          if(imported||repairTimeline)autosave.current.changed();
          if (!snapshot && !journal) {
            editor.ensureDefaultLight();
            if(projectState.generationSettings?.aspectRatio){const [w,h]=projectState.generationSettings.aspectRatio.split(':').map(Number);editor.setProjectAspect(w/h);}
            if(Number.isFinite(projectState.generationSettings?.durationSeconds))editor.changeTimeline({version:1,duration:projectState.generationSettings.durationSeconds,shots:[]});
            autosave.current.changed();
          }
        } catch (cause) {
          setError(cause.message || "本地项目恢复失败。");
        } finally {
          if (!cancelled) setRestoring(false);
        }
      })();
    } catch (cause) {
      setError(`无法初始化 3D 视窗：${cause.message}`);
      setRestoring(false);
    }
    const flush = () => {
      if (document.visibilityState === "hidden")
        autosave.current?.flush().catch(() => {});
    };
    const pagehide = () => autosave.current?.flush().catch(() => {});
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", pagehide);
    return () => {
      cancelled = true;
      ready.current = false;
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", pagehide);
      exportController.current?.abort();
      agentController.current?.abort(new DOMException('Detached','AbortError'));
      const lastSave=autosave.current,lastEditor=viewport.current;
      lastSave?.flush().catch(()=>{}).finally(()=>{lastSave.dispose();lastEditor?.dispose();});
      viewport.current = null;
    };
  }, []);
  useEffect(()=>{
    if(restoring||initialGeneration.current)return;
    initialGeneration.current=true;
    if(agentClient.needsRecovery()&&history?.latestRun){generateAgent({resumeRun:history.latestRun},()=>{}).catch(cause=>{if(cause.name!=='AbortError')setError(cause.message);});return;}
    if(history?.latestRun||(!projectState.prompt?.trim()&&!projectState.promptParts?.length))return;
    (async()=>{
      if(!agentClient.state.sessionId){const data=await studioRequest('/api/v1/project/session/create',{method:'POST',body:{projectId,canvasId:projectId,nodeKey:'animation-preview',agentName:'libtv_coding_agent',name:'libtv_coding_agent',sessionType:'Copilot'}});agentClient.state.sessionId=data.sessionId;agentClient.save();const root=JSON.parse(project.config);root.animationPreview.sessionId=data.sessionId;await studioRequest('/api/studio/update',{method:'POST',body:{studioUuid:projectId,config:JSON.stringify(root)}});}
      const prompt=projectState.prompt||'请根据参考素材创建三维动画预演。';
      await generateAgent({prompt,attachments:[],attachmentIds:(projectState.promptParts||[]).map(p=>p.assetId),attachmentParts:projectState.promptParts||[]},()=>{});
    })().catch(cause=>setError(cause.message));
  },[restoring]);
  useEffect(() => {
    viewport.current?.setEditingLocked(busy || restoring || !!exportPhase || agentRunning || !!navigationPending);
  }, [busy, restoring, exportPhase, agentRunning,navigationPending]);
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
        setAspectMenu(null);
      }
    };
    const reposition = () => {
      setMenu(null);
      setAspectMenu(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", reposition);
    };
  }, []);
  const openAdd = () => {
    const rect = addButton.current?.getBoundingClientRect();
    if (rect)
      setMenu(
        menu
          ? null
          : {
              left: Math.min(
                window.innerWidth - 118,
                Math.max(118, rect.left + rect.width / 2),
              ),
              top: rect.bottom + 12,
            },
      );
  };
  useEffect(() => {
    const key = (event) => {
      if(event.shiftKey && event.code==='KeyP' && !event.target.closest('input,textarea,select,[contenteditable=true]')){
        event.preventDefault();if(!annotationActive)startAnnotation();return;
      }
      if(annotationActive)return;
      if (
        exportController.current ||
        navigation.current.pending ||
        agentController.current ||
        busy ||
        restoring ||
        event.isComposing ||
        event.target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      const editor = viewport.current;
      if (event.key === "Escape") {
        editor?.setCameraView(null);
        if (sceneDetails.animation) editor?.closeCameraAnimation();
        setMenu(null);
        setDeleteRequest(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? editor?.redo() : editor?.undo();
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          editor?.redo();
        }
        if (
          !sceneDetails.cameraView &&
          event.key.toLowerCase() === "d" &&
          !event.shiftKey &&
          !event.repeat
        ) {
          event.preventDefault();
          editor?.duplicate();
        }
        if (
          !sceneDetails.cameraView &&
          event.key.toLowerCase() === "c" &&
          editor?.copySelection()
        )
          event.preventDefault();
        if (
          !sceneDetails.cameraView &&
          event.key.toLowerCase() === "v" &&
          editor?.paste()
        )
          event.preventDefault();
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          autosave.current?.flush().catch(() => {});
        }
        return;
      }
      if (!sceneDetails.cameraView && event.shiftKey && event.code === "KeyA") {
        event.preventDefault();
        openAdd();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        !sceneDetails.cameraView &&
        event.code === "KeyI" &&
        sceneDetails.animation &&
        !event.repeat
      ) {
        event.preventDefault();
        editor?.addKeyframe();
        return;
      }
      if (
        !sceneDetails.cameraView &&
        ["Delete", "Backspace"].includes(event.key) &&
        sceneDetails.animation?.view === "keyframe"
      ) {
        event.preventDefault();
        editor?.removeKeyframe();
        return;
      }
      if (
        event.code === "Space" &&
        !event.target.closest('button,[role="slider"],[role="menuitem"]')
      ) {
        event.preventDefault();
        togglePlay();
      }
      if (
        !sceneDetails.cameraView &&
        event.key.toLowerCase() === "h" &&
        sceneDetails.selectedId
      ) {
        event.preventDefault();
        editor?.toggleHidden(sceneDetails.selectedId);
      }
      if (
        !sceneDetails.cameraView &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        const row = sceneDetails.objects?.find(
          (object) => object.id === sceneDetails.selectedId,
        );
        if (row) {
          event.preventDefault();
          setDeleteRequest(row);
        }
      }
      if (
        !sceneDetails.cameraView &&
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        !event.repeat
      ) {
        event.preventDefault();
        editor?.duplicate();
        return;
      }
      if (
        !event.shiftKey &&
        ["t", "r", "y"].includes(event.key.toLowerCase())
      ) {
        const mode = { t: "translate", r: "rotate", y: "scale" }[
          event.key.toLowerCase()
        ];
        editor?.setMode(sceneDetails.transformMode === mode ? "all" : mode);
      }
      if (event.key.toLowerCase() === "f") editor?.focus();
      if (event.key.toLowerCase() === "c")
        editor?.setCameraView(
          sceneDetails.cameraView ? null : sceneDetails.activeCameraId,
        );
      if (event.key === "1") editor?.setCameraView(null);
      if (event.key === "3" && sceneDetails.activeCameraId)
        editor?.setCameraView(sceneDetails.activeCameraId);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [togglePlay, sceneDetails, menu, busy, restoring, annotationActive, agentRunning, exportPhase]);
  async function importFiles(files) {
    if (agentController.current || navigation.current.pending) return;
    if (pending.current || exportController.current || !viewport.current)
      return;
    pending.current = true;
    let settleImport;
    importSettled.current=new Promise(resolve=>{settleImport=resolve;});
    setBusy(true);
    setError("");
    setDragging(false);
    try {
      const list = Array.from(files);
      if (!list.length) return;
      for (const file of list) {
        const asset = await viewport.current.importFile(file);
        if (asset) setAssets((current) => [...current, asset]);
      }
    } catch (cause) {
      setError(cause.message || "GLB 导入失败。");
    } finally {
      pending.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
      settleImport();
    }
  }

  useLayoutEffect(()=>{
    const stage=host.current;if(!stage)return;
    const update=()=>floatingLayout.setStage(stage.clientWidth,Math.max(0,stage.clientHeight-(timelineVisible?dockHeight:0)));
    update();const observer=new ResizeObserver(update);observer.observe(stage);return()=>observer.disconnect();
  },[floatingLayout,timelineVisible,dockHeight]);
  const changeGenerationSettings=async settings=>{
    if(agentController.current)throw Error('请先停止生成');
    const latest=await studioRequest(`/api/studio/detail?uuid=${encodeURIComponent(projectId)}`),config=JSON.parse(latest.config);
    config.animationPreview={...config.animationPreview,generationSettings:settings};
    await studioRequest('/api/studio/update',{method:'POST',body:{studioUuid:projectId,config:JSON.stringify(config)}});
    agentClient.generationSettings=settings;setGenerationSettings(settings);
    if(!sceneDetails.objects?.some(row=>row.kind!=='light')){
      const [w,h]=settings.aspectRatio.split(':').map(Number);viewport.current?.setProjectAspect(w/h);
      if(Number.isFinite(settings.durationSeconds))viewport.current?.changeTimeline({version:1,duration:settings.durationSeconds,shots:[]});
    }
  };
  return (
    <main
      className="workspace"
      data-preview-workspace
      aria-label="动画预演编辑器"
      style={{
        "--preview-right-panel-width": `${inspectorWidth}px`,
        "--preview-left-panel-width": `${effectiveMonitorWidth}px`,
        "--monitor-left-width": `${monitorLeft}px`,
      }}
      onKeyDownCapture={(event) => {
        if (navigation.current.pending || (exportController.current && !event.target.closest(".export-area"))) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDownCapture={(event) => {
        if(navigation.current.pending){event.preventDefault();event.stopPropagation();}
      }}
      onClickCapture={(event) => {
        if(navigation.current.pending){event.preventDefault();event.stopPropagation();}
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          if (!busy) setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        importFiles(event.dataTransfer.files);
      }}
    >
      <div
        className="stage"
        ref={host}
        aria-label="3D 视窗"
        aria-busy={busy || restoring}
      />
      <ProjectNavigation name={projectTitle}
        disabled={!!exportPhase} busy={busy||restoring||agentRunning||!!navigationPending} pending={navigationPending}
        dirty={saveStatus.state!=='saved'}
        monitorOpened={monitorOpened&&monitorVisible} monitorVisible={monitorVisible}
        onToggleMonitor={()=>setMonitorOpened(value=>!value)} onError={setError}
        onRename={async name=>{const detail=await studioRequest('/api/studio/update',{method:'POST',body:{studioUuid:projectId,name}});setProjectTitle(detail.studioMeta.name);}}
        onSave={()=>navigation.current.save()}
        onGoHome={()=>navigation.current.leave('/')}
        onAllProjects={()=>navigation.current.leave('/3d-box')}
        onCreateProject={()=>{window.open(`/animation-preview?newProject=true&entryId=${crypto.randomUUID()}`,'_blank','noopener,noreferrer');}}
        onDeleteProject={()=>navigation.current.remove()}
      />
      <div
        className="mode-toolbar"
        role="toolbar"
        aria-label="3D-BOX 工具栏"
      >
        <button
          aria-label="场景调度"
          aria-pressed={!sceneDetails.previewMode}
          title="场景调度 · 1"
          onClick={() => viewport.current?.setCameraView(null)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="5" r="3" /><path d="M8 19v-5a4 4 0 0 1 8 0v5M10 14v6m4-6v6M6 17c-3 .6-5 1.6-5 2.5C1 21 6 22 12 22s11-1 11-2.5c0-.9-2-1.9-5-2.5" />
          </svg>
          场景调度
        </button>
        <button
          aria-label="成片预演"
          aria-pressed={!!sceneDetails.previewMode}
          title="成片预演 · 3"
          disabled={!sceneDetails.activeCameraId}
          onClick={() =>
            viewport.current?.setCameraView(sceneDetails.activeCameraId)
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="18" rx="3" /><path d="M7 3v18m10-18v18M2 9h5m-5 6h5m10-6h5m-5 6h5M7 7h10M7 17h10" />
          </svg>
          成片预演
        </button>
      </div>
      {exportPhase && <div className="export-blocker" />}
      <ExportPanel
        title={projectTitle}
        disabled={busy || capturing || agentRunning || !!navigationPending}
        details={sceneDetails.exportDetails}
        phase={exportPhase}
        progress={exportProgress}
        onExport={exportFile}
        onCancel={() => {
          if (exportController.current) {
            setExportPhase("cancelling");
            exportController.current.abort();
          }
        }}
      />
      {exportPhase && (
        <div
          className="exportProgressTrack"
          role="progressbar"
          aria-label="导出进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={exportProgress}
          style={{
            bottom: timelineVisible ? dockHeight : 0,
          }}
        >
          <div style={{ width: `${exportProgress}%` }} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {sceneCamera && !sceneDetails.cameraView && (
          <CameraPreview
            key="pip"
            label={sceneCamera.name}
            playing={playing}
            onPlay={togglePlay}
            onEnter={() => viewport.current?.setCameraView(sceneCamera.id)}
            stage={host}
            floatingLayout={floatingLayout}
            dockHeight={timelineVisible ? dockHeight : 0}
            onRect={setPipRect}
            transition={reducedMotion ? { duration: 0 } : TRANSITION}
          />
        )}
      </AnimatePresence>
      <div className="inspector-topbar" data-open={inspectorVisible} style={{ width: inspectorVisible ? inspectorWidth : sceneDetails.previewMode ? 80 : undefined }}>
        {!sceneDetails.previewMode && (
          <button type="button" className="inspector-toggle"
            aria-label={inspectorVisible ? "收起项目资产" : "展开项目资产"}
            title={inspectorVisible ? "收起项目资产" : "展开项目资产"}
            aria-expanded={inspectorVisible}
            disabled={!!exportPhase}
            onClick={() => { setInspectorOpened(value => !value); setAspectMenu(null); setMenu(null); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M10 2v12" /></svg>
          </button>
        )}
        <span
          className="save-indicator"
          role="status"
          data-save-state={saveStatus.state}
          title={saveStatus.error || "项目保存在本地 SQLite 数据库及 GLB／JSON 文件中"}
        >
          {
            {
              loading: "正在恢复…",
              pending: "待保存",
              saving: "正在保存…",
              saved: "已保存到本地",
              error: "保存失败",
            }[saveStatus.state]
          }
        </span>
      </div>
      <MonitorPanel
        showChrome={false}
        monitor={monitor}
        editor={viewport.current}
        opened={monitorOpened}
        visible={monitorVisible}
        width={effectiveMonitorWidth}
        maxWidth={monitorMax}
        onToggle={() => setMonitorOpened((value) => !value)}
        onWidth={changeMonitorWidth}
        bottom={timelineVisible ? dockHeight : 0}
        selectedId={
          sceneDetails.objects?.find(
            (row) => row.id === sceneDetails.selectedId,
          )?.kind === "camera"
            ? sceneDetails.selectedId
            : null
        }
        cameraView={sceneDetails.cameraView}
        disabled={busy || restoring || !!exportPhase || agentRunning}
      />
      {inspectorVisible && <SceneInspector
        details={sceneDetails}
        editor={viewport.current}
        addButton={addButton}
        onAdd={openAdd}
        disabled={busy || restoring || !!exportPhase || agentRunning}
        browsingOnly={!!sceneDetails.previewMode}
        bottom={timelineVisible ? dockHeight : 0}
        width={inspectorWidth}
        onWidth={changeWidth}
        onError={setError}
        onRequestDelete={setDeleteRequest}
      />}
      <AgentPanel client={agentClient} title={projectTitle}
        floatingLayout={floatingLayout} generationSettings={generationSettings} onSettings={changeGenerationSettings} modelOnly={!!(generatedResult.current||projectState.glbUrl||sceneDetails.objects?.some(row=>row.kind!=='light'))}
        hidden={annotationActive} onAnnotate={startAnnotation} attachment={annotationAttachment}
        running={agentRunning} disabled={busy || restoring || !!exportPhase || !!navigationPending}
        bottom={timelineVisible ? dockHeight : 0} left={monitorLeft} right={inspectorWidth}
        reference={(sceneDetails.animation && agentClip) || (sceneDetails.selectedId ? (()=>{const row=sceneDetails.objects?.find(row=>row.id===sceneDetails.selectedId);return row?{type:'element',id:row.entityId||row.id,uuid:row.id,label:row.label,kind:row.kind}:null})() : null)}
        onGenerate={generateAgent} onCancel={async()=>{try{await agentClient.cancel();agentController.current?.abort();}catch(cause){setError(cause.message);}}}/>
      {annotationActive && <>
        <div className="motion-annotation-surface" style={{left:monitorLeft,right:inspectorWidth,bottom:timelineVisible?dockHeight:0}}>
          <AnnotationOverlay controller={annotation} stage={host.current}/>
        </div>
        <MotionAnnotation controller={annotation} busy={annotationBusy} onExit={exitAnnotation} onConfirm={confirmAnnotation} bottom={timelineVisible?dockHeight:0} left={monitorLeft} right={inspectorWidth}/>
      </>}
      {deleteRequest && (
        <div className="confirm-overlay">
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-label="删除项目资产"
            aria-modal="true"
          >
            <h2>删除项目资产</h2>
            <p>
              确定删除「{deleteRequest.label}」
              {deleteRequest.childCount || deleteRequest.kind === "camera"
                ? "及其关联元素"
                : ""}
              ？
            </p>
            <div>
              <button onClick={() => setDeleteRequest(null)}>取消</button>
              <button
                autoFocus
                className="confirm-delete"
                onClick={async () => {
                  const request = deleteRequest;
                  setDeleteRequest(null);
                  setBusy(true);
                  try {
                    viewport.current?.setEditingLocked(false);
                    await viewport.current?.deleteEntity(request.id);
                  } catch (cause) {
                    setError(cause.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        onChange={(event) => importFiles(event.target.files)}
      />
      {menu && (
        <>
          <button
            className="menu-backdrop"
            aria-label="关闭添加菜单"
            onClick={() => setMenu(null)}
          />
          <div
            className="add-menu"
            role="menu"
            aria-label="添加到场景"
            style={menu}
          >
            <p>添加元素</p>
            {[
              ["sphere", "球体"],
              ["box", "立方体"],
              ["pyramid", "棱锥"],
              ["sun", "太阳光"],
              ["point", "点光源"],
              ["spot", "聚光灯"],
              ["camera", "机位"],
            ].map(([type, name]) => (
              <button
                role="menuitem"
                key={type}
                onClick={() => {
                  viewport.current?.addElement(type);
                  setMenu(null);
                }}
              >
                <Icon
                  kind={
                    type === "box" ? "mesh" : type === "sun" ? "light" : type
                  }
                />
                <span>{name}</span>
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                input.current.click();
              }}
            >
              <Icon kind="import" /> <span>导入 GLB</span>
            </button>
          </div>
        </>
      )}
      {aspectMenu && (
        <>
          <button
            className="menu-backdrop"
            aria-label="关闭画幅比菜单"
            onClick={() => setAspectMenu(null)}
          />
          <div
            className="aspect-popover"
            role="dialog"
            aria-label="项目画幅比"
            style={aspectMenu}
          >
            <div className="aspect-title">项目画幅比</div>
            <div className="aspect-ratios">
              {["16:9", "9:16", "3:4", "4:3", "1:1", "21:9"].map((ratio) => {
                const [width, height] = ratio.split(":").map(Number);
                const aspect = width / height;
                return (
                  <button
                    key={ratio}
                    aria-pressed={
                      Math.abs((sceneDetails.aspect ?? 16 / 9) - aspect) <
                      0.0001
                    }
                    onClick={() => {
                      viewport.current?.setProjectAspect(aspect);
                      setAspectMenu(null);
                    }}
                  >
                    {ratio}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      {dragging && (
        <div className="drop-overlay">
          <span>拖放以导入 GLB</span>
        </div>
      )}
      {(busy || restoring || error || saveStatus.state === "error") && (
        <div className="import-status" role={error ? "alert" : "status"}>
          {error ||
            saveStatus.error ||
            (restoring ? "正在恢复本地项目…" : "正在处理场景…")}
        </div>
      )}
      <div className="viewport-tools" role="group" aria-label="视窗操作">
        <button
          type="button"
          className="viewport-button"
          aria-label={label}
          aria-pressed={timelineVisible}
          title={label}
          onClick={() => setTimelineVisible((visible) => !visible)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M13 8.67a5 5 0 1 0-10 0 5 5 0 0 0 10 0M5.65 6.3c.2-.2.5-.2.7 0l2 2a.5.5 0 1 1-.7.71l-2-2a.5.5 0 0 1 0-.7M9.5 1a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1zM14 8.67a6 6 0 1 1-12 0 6 6 0 0 1 12 0"
              fill="currentColor"
            />
          </svg>
        </button>
        <button
          type="button"
          className="viewport-button"
          aria-label="截取当前视窗"
          title="截取当前视窗"
          disabled={busy || capturing}
          onClick={captureViewport}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M15.38 7.31c0-.93-.76-1.68-1.7-1.68h-.1c-.94 0-1.82-.48-2.34-1.26l-.17-.24a1.7 1.7 0 0 0-1.4-.75H8.33c-.57 0-1.1.28-1.4.75l-.17.24a2.8 2.8 0 0 1-2.34 1.25h-.1c-.94 0-1.7.76-1.7 1.7v5.62c0 .93.76 1.69 1.7 1.69h9.37a1.7 1.7 0 0 0 1.69-1.7zm-4.5 2.44a1.88 1.88 0 1 0-3.76 0 1.88 1.88 0 0 0 3.76 0m1.12 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0m4.5 3.19a2.8 2.8 0 0 1-2.81 2.81H4.3a2.8 2.8 0 0 1-2.81-2.81V7.3a2.8 2.8 0 0 1 2.82-2.8h.11c.57 0 1.1-.28 1.4-.75L6 3.5a2.8 2.8 0 0 1 2.34-1.25h1.34c.94 0 1.82.47 2.34 1.25l.17.25c.3.47.83.75 1.4.75h.1a2.8 2.8 0 0 1 2.82 2.81z" />
          </svg>
        </button>
        <button
          ref={aspectButton}
          type="button"
          className="viewport-button"
          aria-label="项目画幅比"
          title="项目画幅比"
          aria-haspopup="dialog"
          aria-expanded={!!aspectMenu}
          aria-pressed={!!aspectMenu}
          disabled={busy || capturing}
          onClick={() => {
            const rect = aspectButton.current.getBoundingClientRect();
            setAspectMenu(
              aspectMenu
                ? null
                : {
                    left: Math.max(
                      8,
                      Math.min(rect.left, window.innerWidth - 184),
                    ),
                    top: rect.bottom + 8,
                  },
            );
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="12" height="10" rx="2" />
            <path d="M6 13V8H2" />
          </svg>
        </button>
        <div className="aspect-history">
          <button
            type="button"
            aria-label="撤销"
            title="撤销"
            disabled={!sceneDetails.canUndo || busy || capturing}
            onClick={() => viewport.current?.undoAspect()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 2-4 3.5L6 9M2 5.5h7a5 5 0 0 1 0 10H3" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="重做"
            title="重做"
            disabled={!sceneDetails.canRedo || busy || capturing}
            onClick={() => viewport.current?.redoAspect()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m10 2 4 3.5L10 9m4-3.5H7a5 5 0 0 0 0 10h6" />
            </svg>
          </button>
        </div>
      </div>
      <div
        className="dock"
        data-preview-dock
        data-preview-dock-cn
        style={{
          height: timelineVisible ? dockHeight : 0,
        }}
      >
        <AnimatePresence initial={false}>
          {timelineVisible && (
            <motion.div
              key="timeline"
              className="timeline-shell"
              initial={{
                y: 24,
                opacity: 0,
                height: dockHeight,
              }}
              animate={{
                y: 0,
                opacity: 1,
                height: dockHeight,
              }}
              exit={{ y: 24, opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : TRANSITION}
            >
              <Timeline
                time={time}
                duration={duration}
                playing={playing}
                rate={rate}
                mode={
                  sceneDetails.previewMode || sceneDetails.animation
                    ? "video"
                    : "photo"
                }
                shots={sceneDetails.cameraTimelineItems ?? sceneDetails.shots}
                onSelectShot={(shot) => {
                  setAgentClip({type:'clip',id:shot.id,cameraId:shot.cameraId,label:shot.label,start:shot.start,end:shot.end});
                  const editor = viewport.current;
                  editor?.seek(shot.start);
                  setTime(shot.start);
                  editor?.setCameraView(null);
                  editor?.selectCamera(shot.cameraId);
                  editor?.openCameraAnimation(
                    shot.cameraId,
                    shot.end - shot.start,
                  );
                }}
                onTrimShot={(id, start, end) => {
                  setPlaying(false);
                  viewport.current?.trimShot(id, start, end);
                }}
                onRate={setRate}
                onPlay={togglePlay}
                onSeek={setTime}
                onScrub={setScrubbing}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
