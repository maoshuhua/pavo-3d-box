import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTO_CAMERA_VIEW, timelineCameraId, resolveCameraViewId} from '../src/timelineCamera.js';

const shots = [
  {cameraId:'a', start:0, end:4},
  {cameraId:'b', start:4, end:8},
  {cameraId:'c', start:8, end:10},
  {cameraId:'d', start:10, end:12},
];
const cameras = shots.map(shot => ({uuid:`uuid-${shot.cameraId}`,userData:{hf_id:shot.cameraId}}));

test('film preview follows every cut, scrubbing backwards, the end and loop restart', () => {
  for (const [time, id] of [[0,'a'],[3.999,'a'],[4,'b'],[7.999,'b'],[8,'c'],[10,'d'],[12,'d'],[5,'b'],[0,'a']]) {
    assert.equal(resolveCameraViewId(AUTO_CAMERA_VIEW,cameras,shots,time,12),`uuid-${id}`);
  }
});

test('an explicitly entered camera remains fixed across the same timeline', () => {
  for (const time of [0,4,8,10,12])
    assert.equal(resolveCameraViewId('uuid-b',cameras,shots,time,12),'uuid-b');
  assert.equal(resolveCameraViewId(null,cameras,shots,8,12),null);
});

test('libtv shot selection handles unsorted shots, overlaps, gaps and equal starts', () => {
  const sequence = [
    {cameraId:'late',start:9,end:12},
    {cameraId:'wide',start:1,end:5},
    {cameraId:'short',start:1,end:3},
    {cameraId:'overlap',start:2,end:4},
  ];
  for (const [time,id] of [[-1,'wide'],[1,'short'],[2,'overlap'],[4.5,'wide'],[7,'overlap'],[9,'late'],[20,'late']])
    assert.equal(timelineCameraId(sequence,time,12),id);
  assert.equal(timelineCameraId([],0,12),null);
  assert.equal(resolveCameraViewId(AUTO_CAMERA_VIEW,[],shots,0,12),null);
});
