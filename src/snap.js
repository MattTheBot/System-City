// ─────────────────────────────────────────────────────
//  snap.js  —  road snapping
//
//  All snap functions return plain Vector3 values.
//  Node references are retrieved separately via
//  snapStartNode() / snapEndNode() so there is no
//  {pos, node} object confusion anywhere.
// ─────────────────────────────────────────────────────

var UNIT           = 8;
var NODE_SNAP_DIST = UNIT * 0.65;    // 5.2m — hard lock radius
var NODE_SHOW_DIST = UNIT * 3.0;     // 24m  — visibility radius
var ANGLE_SOFT_DEG = 6 * Math.PI / 180;

// ── Terrain height via downward ray ──────────────────
function terrainYAt(x, z) {
  var ray = new BABYLON.Ray(
    new BABYLON.Vector3(x, 500, z),
    new BABYLON.Vector3(0, -1, 0), 1000
  );
  var hit = scene.pickWithRay(ray, function(m) {
    return m.name === "terrain";
  });
  return (hit && hit.hit) ? hit.pickedPoint.y : 0;
}

// ── Find nearest connectable (non-mid) snap node ─────
function nearestConnectableNode(pos, threshold) {
  if (typeof snapNodes === "undefined") return null;
  var best = null, bestDist = threshold;
  for (var i = 0; i < snapNodes.length; i++) {
    var n = snapNodes[i];
    if (n.isMid) continue;
    var d = BABYLON.Vector3.Distance(pos, n.position);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

// ── snapStart: position for road start ───────────────
// Returns Vector3. Hard-locks to nearby node, else free.
function snapStart(rawCursor) {
  var node = nearestConnectableNode(rawCursor, NODE_SNAP_DIST);
  if (node) return node.position.clone();
  var p = rawCursor.clone();
  p.y   = terrainYAt(rawCursor.x, rawCursor.z);
  return p;
}

// ── snapStartNode: which node we locked to (or null) ─
function snapStartNode(rawCursor) {
  return nearestConnectableNode(rawCursor, NODE_SNAP_DIST);
}

// ── snapEnd: position for road end ───────────────────
// Node snap overrides length snap if close to a node.
function snapEnd(A, rawCursor) {
  var node = nearestConnectableNode(rawCursor, NODE_SNAP_DIST);
  if (node) return node.position.clone();
  return snapLength(A, rawCursor);
}

// ── snapEndNode ───────────────────────────────────────
function snapEndNode(A, rawCursor) {
  return nearestConnectableNode(rawCursor, NODE_SNAP_DIST);
}

// ── snapLength: free direction, whole-unit length ────
function snapLength(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  var len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.5) return A.clone();

  var nx = dx / len, nz = dz / len;

  // Soft angle snap
  var rawAngle  = Math.atan2(nx, nz);
  var cands     = getCandidateAngles(A);
  var bestAngle = rawAngle, bestDiff = Infinity;
  for (var i = 0; i < cands.length; i++) {
    var diff = Math.abs(angleDelta(rawAngle, cands[i]));
    if (diff < bestDiff) { bestDiff = diff; bestAngle = cands[i]; }
  }
  if (bestDiff < ANGLE_SOFT_DEG) {
    nx = Math.sin(bestAngle); nz = Math.cos(bestAngle);
  }

  var snappedLen = Math.max(UNIT, Math.round(len / UNIT) * UNIT);
  var ex = A.x + nx * snappedLen;
  var ez = A.z + nz * snappedLen;
  return new BABYLON.Vector3(ex, terrainYAt(ex, ez), ez);
}

// Integer unit count for HUD
function snapUnits(A, rawCursor) {
  var dx  = rawCursor.x - A.x;
  var dz  = rawCursor.z - A.z;
  var len = Math.sqrt(dx * dx + dz * dz);
  return Math.max(1, Math.round(len / UNIT));
}

// ── Candidate angles for soft snap ───────────────────
function getCandidateAngles(fromPos) {
  if (typeof snapNodes !== "undefined") {
    for (var i = 0; i < snapNodes.length; i++) {
      var n = snapNodes[i];
      if (BABYLON.Vector3.Distance(fromPos, n.position) > UNIT * 1.5) continue;
      if (typeof roads === "undefined") break;
      for (var j = 0; j < roads.length; j++) {
        if (roads[j].id !== n.roadId) continue;
        var pts = roads[j].curve;
        if (!pts || pts.length < 2) break;
        var idx  = Math.min(n.curveIndex, pts.length - 1);
        var prev = pts[Math.max(0, idx - 1)];
        var next = pts[Math.min(pts.length - 1, idx + 1)];
        var tang = next.subtract(prev).normalize();
        return makeAngles(Math.atan2(tang.x, tang.z));
      }
    }
  }
  return makeAngles(0);
}

function makeAngles(base) {
  var out = [];
  for (var k = 0; k < 8; k++) out.push(base + k * Math.PI / 4);
  return out;
}

function angleDelta(from, to) {
  var d = to - from;
  while (d >  Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
