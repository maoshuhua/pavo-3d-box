# Studio director

Direct a scene from the user's intent to an editable, inspected delivery. Apply
this method to any subject, location, style, duration or number of shots. This
skill supplies a process, never a fixed character, action or scene template.

## Plan only what the task needs

Read the available scene API and existing project context. Preserve unrelated
work when editing an existing scene. Convert explicit requirements into required
acceptance criteria; optional decoration must not block delivery. For a small
edit use a compact plan describing the affected shot and result.

Use `coding_todo_write` with `op: "set_plan"` to persist intent, duration,
aspectRatio, generic subjects and constraints, ordered contiguous shots, and
structural / visual / motion criteria. Each shot records its narrative purpose,
action, framing and camera movement. Its cameraRef must be the actual stable
camera ID used in the scene. State units, coordinate directions, subject
orientation, paths and contact relationships where they matter. Do not prescribe
every implementation detail before seeing a frame.

Create result-oriented tasks with `op: "update_tasks"`. Use dependencies when
one result actually requires another. Keep task IDs stable. Every mutation needs
a unique requestId; use the returned state revision as expectedRevision when
available. Read `coding_todo_write({op:"read"})` or `/agent-state.json` after a
conflict or recovery. This file is server-owned and read-only. A previous run's
plan is context, not accepted work for this request.

## Make the action and image work

Work from spatial arrangement and key actions to composition and lighting, then
optional detail. Decide what each shot must reveal before choosing its camera.
Generate source through the documented scene API without imports or hidden
helpers. Do not assume a reusable actor or motion library exists.

Use `preview_3D_scene` with target `draft` before exporting. Inspect actual pixels;
tool success only proves rendering succeeded. Use batch frames where useful.
Look for visibility, framing, light, occlusion, scale and readable contact. A
hand interaction needs the hand, object and other subject to meet in world space
and remain visible in the relevant shot. Check action before, during and after
the important beat; one still frame cannot establish motion.

Sample representative shot frames, action beats, both sides of a cut and the
ending. Examine continuity, facing direction, contact and silhouette. Fix the
specific cause, then inspect the affected shot and any dependent action. Do not
repeat the full context or rebuild a GLB for every source adjustment.

## Keep observations separate from completion

Record each inspection using `op: "record_reviews"`, with the server-issued
evidence IDs and an observation of what is actually visible. A review verdict
is pass, fail or unverified. A review task can be completed when its inspection
found a failure; record the failure first, then create or reopen corrective work.
Never mark a failed criterion pass merely to close its task.

Structural requirements use build checks; visual requirements need actual frames
for their shots; motion requirements need different times for each relevant
shot. Do not invent evidence IDs or treat missing images as evidence. New source,
plan or delivery versions can invalidate old acceptance. Historical evidence
remains useful for diagnosis but cannot certify a different version.

## Inspect and deliver the exported result

Build when the draft supports the intended result. The last successful build
stays available if later work fails. Use target `build` to inspect the actual
immutable GLB, not merely its source preview. Confirm duration, aspect ratio,
camera cuts, animation and critical visual requirements survived export.

Record final reviews against current build evidence. One correct build is
sufficient; build count is a cost statistic, not a quality gate. End when all
required criteria have passed with current delivery evidence. Optional polish
must not create an endless review loop. A normal execution can still produce a
partial result. On a budget, error or cancellation, retain the successful
artifact, failed observations and outstanding issues. Report what succeeded,
what did not, and the actual delivery status without claiming unseen quality.
