// Turns per-frame tracking snapshots into the few events worth logging.
// Pure: no DOM, so it is unit tested.
//
// A snapshot is:
//   { state, owner, face, bodyInFront, hands: { Left?: {...}, Right?: {...} } }
// where each hand is { state, ratio, cm } and extra fields pass through.

export function changes(previous, next) {
  const events = [];
  for (const side of ['Left', 'Right']) {
    const before = previous?.hands?.[side], after = next.hands[side];
    if (!before && after) events.push({ event: 'hand.appear', side, ...after });
    else if (before && !after) events.push({ event: 'hand.lost', side, last: before.state });
    else if (before && after && before.state !== after.state) events.push({ event: 'hand.state', side, from: before.state, ...after });
  }
  if (previous && (previous.state !== next.state || previous.owner !== next.owner)) {
    events.push({ event: 'object', from: previous.state, to: next.state, owner: next.owner, ...next.object });
  }
  if (Boolean(previous?.face) !== Boolean(next.face)) events.push({ event: next.face ? 'face.appear' : 'face.lost' });
  if (Boolean(previous?.bodyInFront) !== Boolean(next.bodyInFront)) events.push({ event: 'body.occlusion', on: Boolean(next.bodyInFront) });
  return events;
}
