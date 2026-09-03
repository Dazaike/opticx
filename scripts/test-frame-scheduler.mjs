import { FrameScheduler } from '../src/renderer/frame-scheduler.ts';

function makeFrame(timestamp) {
  const frame = {
    timestamp,
    closed: false,
    close() {
      frame.closed = true;
    },
  };
  return frame;
}

let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failed++;
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function runPacing({
  label,
  srcIntervalUs,
  vsyncUs,
  expectedPresentUs,
  frameCount,
  minGapUs,
  maxGapUs,
}) {
  const scheduler = new FrameScheduler();
  const frames = [];
  const jitterAmp = Math.min(srcIntervalUs - minGapUs, maxGapUs - srcIntervalUs) / 2;
  for (let i = 0; i < frameCount; i++) {
    const frame = makeFrame(i * srcIntervalUs);
    frame.arrival =
      i < 2 ? 0 : Math.max(0, (i - 2) * srcIntervalUs + jitterAmp * Math.sin(i * 2.399));
    frames.push(frame);
  }

  const presentTimes = [];
  const lastArrival = frames[frames.length - 1].arrival;
  const maxNow = lastArrival + srcIntervalUs * 4 + vsyncUs * 8;
  const maxTicks = Math.ceil(maxNow / vsyncUs) + 1;
  let next = 0;

  for (let tick = 0; tick < maxTicks; tick++) {
    const nowUs = tick * vsyncUs;
    while (next < frames.length && frames[next].arrival <= nowUs) {
      scheduler.push(frames[next]);
      next++;
    }
    const got = scheduler.acquireForPresent(nowUs, vsyncUs);
    if (got) presentTimes.push(nowUs);
  }

  const measured = presentTimes.slice(2);
  const intervals = [];
  for (let i = 1; i < measured.length; i++) {
    intervals.push(measured[i] - measured[i - 1]);
  }

  const tolUs = 2000;
  const good = intervals.filter((dt) => Math.abs(dt - expectedPresentUs) <= tolUs);
  check(
    label,
    good.length >= 20,
    `good=${good.length} samples=${intervals.length} expected=${expectedPresentUs.toFixed(1)}us`,
  );
}

runPacing({
  label: 'pacing 30fps non-null presents ~33.33ms',
  srcIntervalUs: 1e6 / 30,
  vsyncUs: 1e6 / 60,
  expectedPresentUs: 1e6 / 30,
  frameCount: 30,
  minGapUs: 25000,
  maxGapUs: 45000,
});

runPacing({
  label: 'pacing 60fps presents ~16.667ms',
  srcIntervalUs: 1e6 / 60,
  vsyncUs: 1e6 / 60,
  expectedPresentUs: 1e6 / 60,
  frameCount: 40,
  minGapUs: 12000,
  maxGapUs: 21000,
});

{
  const scheduler = new FrameScheduler(3);
  const frames = [0, 1, 2, 3].map((i) => makeFrame(i * 1000));
  for (const frame of frames) scheduler.push(frame);
  check('overflow drops oldest', frames[0].closed === true);
  check('overflow increments dropped', scheduler.dropped === 1);
  check('overflow keeps capacity', scheduler.size === 3);
  check('overflow peek is next oldest', scheduler.peek() === frames[1]);
}

{
  const scheduler = new FrameScheduler();
  const first = makeFrame(5000);
  const second = makeFrame(5000);
  scheduler.push(first);
  scheduler.push(second);
  check('duplicate closes previous', first.closed === true && second.closed === false);
  check('duplicate counts as dropped', scheduler.dropped === 1);
  check('duplicate keeps newer object', scheduler.peek() === second && scheduler.size === 1);
}

{
  const interval = 1e6 / 60;
  const half = interval / 2;
  const ts = 100000;
  const scheduler = new FrameScheduler();
  const frame = makeFrame(ts);
  scheduler.push(frame);
  const got = scheduler.acquireForPresent(ts + half - 1, interval);
  check('late frame within half interval is returned', got === frame);
  check('acquired frame is removed from queue', scheduler.size === 0);
}

{
  const interval = 1e6 / 60;
  const half = interval / 2;
  const scheduler = new FrameScheduler();
  const frame = makeFrame(100000);
  scheduler.push(frame);
  const got = scheduler.acquireForPresent(100000 + half + 4000, interval);
  check('sole late frame beyond half is held', got === frame);
}

{
  const interval = 1e6 / 60;
  const scheduler = new FrameScheduler();
  const late = makeFrame(0);
  const future = makeFrame(100000);
  scheduler.push(late);
  scheduler.push(future);
  const got = scheduler.acquireForPresent(40000, interval);
  check('late frame dropped when newer exists', got === null && late.closed === true);
  check('future frame stays queued', scheduler.peek() === future && future.closed === false);
}

{
  const scheduler = new FrameScheduler();
  check('empty acquire returns null', scheduler.acquireForPresent(0, 16667) === null);
  const a = makeFrame(1);
  const b = makeFrame(2);
  scheduler.push(a);
  scheduler.push(b);
  scheduler.clear();
  check('clear closes remaining frames', a.closed && b.closed);
  check('clear empties queue', scheduler.size === 0 && scheduler.peek() === null);
}

{
  const scheduler = new FrameScheduler();
  const frame = makeFrame(0);
  scheduler.push(frame);
  const first = scheduler.acquireForPresent(0, 16667);
  const second = scheduler.acquireForPresent(16667, 16667);
  check('never returns the same frame twice', first === frame && second === null);
}

if (failed > 0) {
  console.log(`FAIL ${failed} check(s)`);
  process.exit(1);
}

console.log('PASS');
