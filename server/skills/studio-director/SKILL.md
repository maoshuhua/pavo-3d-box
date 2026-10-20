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

Include result-oriented `tasks` in the same `op: "set_plan"` call. Use dependencies when
one result actually requires another. Keep task IDs stable. Every mutation needs
a unique requestId; use the returned state revision as expectedRevision when
available. Successful tool responses already include state and current evidence;
do not add routine read-back calls. Read `coding_todo_write({op:"read"})` or `/agent-state.json` after a
conflict or recovery. This file is server-owned and read-only. A previous run's
plan is context, not accepted work for this request.
If a task update fails, read the saved state and repair that update. Do not
continue with an empty task list. Final delivery needs completed implementation
work with current evidence and completed review tasks covering every required
criterion. Rendered frame IDs can prove implementation work; they do not by
themselves turn a review into a pass.

## Make the action and image work

Work from spatial arrangement and key actions to composition and lighting, then
optional detail. Decide what each shot must reveal before choosing its camera.
Generate source through the documented scene API without imports or hidden
helpers. Do not assume a reusable actor or motion library exists.

As soon as the complete source is ready, call `build_3D_scene` to display a
playable first version. Do not delay this result for source screenshot reviews.
Then inspect `preview_3D_scene({target:"build"})`. Without explicit frames this
captures only missing minimum coverage, up to 12 frames at once. Use returned
`missing_frames` to decide whether another batch is needed; no state read is
required. Static shots start with one representative image; shots with required
motion criteria need at least two times. These are minimum coverage, not proof
that every action is correct. Add exact before/during/after action beats when
needed. A `target:"draft"` preview is an optional debugging escape hatch, never
a prerequisite for the first build or a substitute for GLB acceptance.

Inspect actual pixels; tool success only proves rendering succeeded.
Look for visibility, framing, light, occlusion, scale and readable contact. A
hand interaction needs the hand, object and other subject to meet in world space
and remain visible in the relevant shot. Check action before, during and after
the important beat; one still frame cannot establish motion.
For numeric spatial requirements, verify coordinates and transformed positions
from the implementation as well as the image. Perspective alone cannot prove
an exact distance. Define each subject's local forward axis, check its world
direction against the intended target, and check attached objects after parent
transforms and animation. Seeing a face in the camera does not prove two
subjects face each other. Record ambiguous or unmeasured results as unverified.

Examine continuity, facing direction, contact and silhouette. Reuse current
evidence; requesting the same build/camera/time returns the saved image and ID
without rendering. Batch observations and fix their concrete causes together,
then rebuild once. Request additional close action samples only for affected
shots and dependencies. Every new export still needs its own minimum coverage;
old-source or old-build images cannot certify it. Do not repeatedly sample the
whole timeline at extra times or rebuild unchanged source.
When animation writes a camera or subject transform, its sampled track overrides
the static declaration. Trace every writer before changing composition or pose;
changing only the static camera cannot fix a baked trajectory. Prefer one
authored trajectory function shared by initial placement and sampled frames, so
the two cannot drift. Inspect exported frames rather than trusting comments.

## Keep observations separate from completion

Record each inspection using `op: "record_reviews"`, with the server-issued
evidence IDs and an observation of what is actually visible. Include `tasks`
in that same call to complete implementation/inspection tasks, open corrective
work, or close delivery once acceptance is satisfied. Reviews validate before
task updates and the whole request commits atomically. If any entry fails,
neither reviews nor task updates were saved; repair the batch before retrying.
A review verdict
is pass, fail or unverified. A review task can be completed when its inspection
found a failure; record the failure and create or reopen corrective work together.
Never mark a failed criterion pass merely to close its task.

Structural requirements use build checks; visual requirements need actual frames
for their shots; motion requirements need different times for each relevant
shot. Do not invent evidence IDs or treat missing images as evidence. New source,
plan or delivery versions can invalidate old acceptance. Historical evidence
remains useful for diagnosis but cannot certify a different version.
After any source edit, use fresh frames for every criterion you pass, including
unchanged cameras. A motion review needs at least two distinct current times
inside each relevant shot, using that shot's camera. If a review batch is
rejected, none of that batch was saved. Read the error's missing camera/time
coverage, render the missing samples, and retry with their returned IDs; do not
retry the same insufficient evidence. Keep numeric implementation details in a
plan consistent with the corrected source, or phrase criteria as intended
behavior rather than baking a particular angle or direction into them.

## Inspect and deliver the exported result

The first build is displayed while inspection continues; display is not
acceptance. The last successful build stays available if later work fails.
Use target `build` to inspect the actual
immutable GLB, not merely its source preview. Confirm duration, aspect ratio,
camera cuts, animation and critical visual requirements survived export.

Record final reviews against current build evidence. One correct build is
sufficient; build count is a cost statistic, not a quality gate. End when all
required criteria have passed with current delivery evidence. Optional polish
must not create an endless review loop. Default to the first build and at most
two concentrated correction builds, subject to the runtime's returned limits.
Stop with explicit partial status and remaining failures when that budget is
exhausted; never weaken criteria to force acceptance. A normal execution can still produce a
partial result. On a budget, error or cancellation, retain the successful
artifact, failed observations and outstanding issues. Report what succeeded,
what did not, and the actual delivery status without claiming unseen quality.
