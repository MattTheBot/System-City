// ─────────────────────────────────────────────────────
//  roads.js  —  road network graph
//
//  Node spacing: one every 2*UNIT (16m) along the curve,
//  plus always at start and end. This halves node count
//  while keeping snap coverage dense enough (since
//  NODE_SNAP_DIST is 6.8m, a 16m gap still catches any
//  cursor within 6.8m of either node).
//
//  Connection tracking: when road B starts or ends at a
//  node belonging to road A, that node's connections[]
//  array gets road B's id. Appearance updates to orange
//  junction style. This is the data that intersection
//  mesh generation will read in v0.4.
// ─────────────────────────────────────────────────────

var roads     = [];
var snapNodes = [];

// ── Shared node materials ────────────────────────────
var _mats = {};
function _getMat(type) {
  if (_mats[type]) return _mats[type];
  var m = new BABYLON.StandardMaterial("sn_" + type, scene);
  m.backFaceCulling = false;
  if (type === "endpoint") {
    m.diffuseColor  = new BABYLON.Color3(0.15, 0.70, 1.0);
    m.emissiveColor = new BABYLON.Color3(0.03, 0.28, 0.45);
  } else if (type === "mid") {
    m.diffuseColor  = new BABYLON.Color3(0.15, 0.45, 0.65);
    m.emissiveColor = new BABYLON.Color3(0.02, 0.15, 0.25);
    m.alpha         = 0.55;
  } else if (type === "junction") {
    m.diffuseColor  = new BABYLON.Color3(1.0, 0.55, 0.05);
    m.emissiveColor = new BABYLON.Color3(0.5, 0.22, 0.0);
  } else if (type === "active") {
    m.diffuseColor  = new BABYLON.Color3(1.0, 0.95, 0.1);
    m.emissiveColor = new BABYLON.Color3(0.6, 0.55, 0.0);
  }
  _mats[type] = m;
  return m;
}

var _nodeCounter = 0;

function createNode(pos, roadId, curveIndex, isMid) {
  var r    = isMid ? 0.5 : 1.0;
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_" + _nodeCounter, {
    radius: r, tessellation: 14
  }, scene);
  mesh.rotation.x  = Math.PI / 2;
  mesh.position    = pos.clone();
  mesh.position.y += 0.35;
  mesh.isPickable  = false;
  mesh.isVisible   = false;
  mesh.material    = _getMat(isMid ? "mid" : "endpoint");

  var node = {
    id:          "n_" + (_nodeCounter++),
    position:    pos.clone(),
    roadId:      roadId,
    curveIndex:  curveIndex,
    isMid:       isMid,
    connections: [],   // road IDs that connect here
    mesh:        mesh
  };
  snapNodes.push(node);
  return node;
}

// Find existing endpoint node at an exact position (within 0.1m)
function findNodeAt(pos) {
  for (var i = 0; i < snapNodes.length; i++) {
    var n = snapNodes[i];
    if (n.isMid) continue;
    if (BABYLON.Vector3.Distance(pos, n.position) < 0.1) return n;
  }
  return null;
}

// Update node appearance based on how many roads connect to it
function refreshNodeAppearance(node) {
  if (!node || node.isMid) return;
  if (node.connections.length >= 2) {
    node.mesh.material  = _getMat("junction");
    node.mesh.scaling.x = node.mesh.scaling.z = 1.5;
  } else {
    node.mesh.material  = _getMat("endpoint");
    node.mesh.scaling.x = node.mesh.scaling.z = 1.0;
  }
}

// ── Road state machine ────────────────────────────────
var rs = {
  phase:     0,
  A:         null,
  B:         null,
  startNode: null,
  preview:   null,
  markerA:   null
};

rs.reset = function() {
  rs.phase     = 0;
  rs.A         = null;
  rs.B         = null;
  rs.startNode = null;
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (rs.markerA) { rs.markerA.dispose(); rs.markerA = null; }
};

rs.placeMarker = function(pos) {
  if (!pos || typeof pos.clone !== "function") return null;
  var m   = BABYLON.MeshBuilder.CreateSphere("markerA", { diameter:2.2 }, scene);
  m.position   = pos.clone();
  m.position.y += 1.1;
  m.isPickable  = false;
  var mat = new BABYLON.StandardMaterial("markerAmat", scene);
  mat.diffuseColor  = new BABYLON.Color3(0.2, 0.6, 1.0);
  mat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.5);
  m.material = mat;
  return m;
};

rs.updatePreview = function(A, handle, end) {
  if (rs.preview) { rs.preview.dispose(); rs.preview = null; }
  if (!A || !end || typeof A.subtract !== "function") return;
  if (A.subtract(end).length() < 0.5) return;
  try {
    var h     = handle || A.add(end).scale(0.5);
    var curve = BABYLON.Curve3.CreateQuadraticBezier(A, h, end, 30);
    var pts   = curve.getPoints();
    for (var i = 0; i < pts.length; i++)
      pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.18;
    rs.preview = BABYLON.MeshBuilder.CreateTube("roadPreview", {
      path:pts, radius:2.5, tessellation:6
    }, scene);
    rs.preview.isPickable = false;
    var pm = new BABYLON.StandardMaterial("rpmat", scene);
    pm.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
    pm.alpha        = 0.38;
    rs.preview.material = pm;
  } catch(e) { /* degenerate */ }
};

// ── Road model ────────────────────────────────────────
var roadModelPath   = "models/road_2lane.glb";
var roadModelMeshes = [];

function loadRoadModelFromPath(path) {
  roadModelMeshes.forEach(function(m) { m.dispose(); });
  roadModelMeshes = [];

  var last     = path.lastIndexOf("/");
  var rootUrl  = last >= 0 ? path.substring(0, last + 1) : "./";
  var filename = last >= 0 ? path.substring(last + 1) : path;

  BABYLON.SceneLoader.ImportMesh("", rootUrl, filename, scene,
    function(meshes) {
      for (var i = 0; i < meshes.length; i++) {
        // Skip the __root__ node Babylon adds automatically
        if (meshes[i].name === "__root__") continue;
        meshes[i].setEnabled(false);
        meshes[i].isPickable = false;
        roadModelMeshes.push(meshes[i]);
      }
      console.log("Road model loaded:", filename, "(" + roadModelMeshes.length + " meshes)");
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Model: " + filename + " (" + roadModelMeshes.length + " mesh)";
    },
    null,
    function(scene2, msg) {
      console.warn("Road model load failed — using ribbon:", msg);
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Ribbon fallback (model not found at models/road_2lane.glb)";
    }
  );
}

// ── Build road ────────────────────────────────────────
function buildRoad(A, handle, C, startNodeRef, endNodeRef) {
  if (!A || !C) return;

  var h     = handle || A.add(C).scale(0.5);
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A, h, C, 64);
  var pts   = curve.getPoints();
  for (var i = 0; i < pts.length; i++)
    pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.08;

  var rid       = roads.length;
  var instances = [];
  var supports  = [];

  if (roadModelMeshes.length > 0) {
    placeModelInstances(pts, rid, instances);
  } else {
    placeRibbonRoad(pts, rid);
  }
  placeSupports(pts, rid, supports);

  var road = {
    id:          rid,
    A:           A.clone(),
    handle:      h.clone(),
    C:           C.clone(),
    curve:       pts,
    instances:   instances,
    supports:    supports,
    nodes:       [],
    startNodeId: null,
    endNodeId:   null
  };
  roads.push(road);

  // ── Start node ────────────────────────────────────
  // If we snapped to an existing node, reuse it (shared connection).
  // Otherwise create a new one (or merge with one at the same position).
  var sNode = startNodeRef
    ? startNodeRef
    : (findNodeAt(pts[0]) || createNode(pts[0], rid, 0, false));
  sNode.connections.push(rid);
  refreshNodeAppearance(sNode);
  road.startNodeId = sNode.id;
  road.nodes.push(sNode);

  // ── Mid nodes every 2*UNIT along curve ───────────
  // Half the density of before — still covers the snap radius.
  var NODE_SPACING = UNIT * 2;
  var accum = 0;
  for (var i = 1; i < pts.length - 1; i++) {
    accum += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
    if (accum >= NODE_SPACING) {
      accum -= NODE_SPACING;
      road.nodes.push(createNode(pts[i], rid, i, true));
    }
  }

  // ── End node ──────────────────────────────────────
  var eNode = endNodeRef
    ? endNodeRef
    : (findNodeAt(pts[pts.length-1]) || createNode(pts[pts.length-1], rid, pts.length-1, false));
  eNode.connections.push(rid);
  refreshNodeAppearance(eNode);
  road.endNodeId = eNode.id;
  road.nodes.push(eNode);

  // ── Log connection info ───────────────────────────
  if (sNode.connections.length > 1)
    console.log("Junction at start node", sNode.id, "— roads:", sNode.connections);
  if (eNode.connections.length > 1)
    console.log("Junction at end node",   eNode.id, "— roads:", eNode.connections);

  // ── HUD ───────────────────────────────────────────
  var totalLen = 0;
  for (var i = 1; i < pts.length; i++)
    totalLen += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
  var el = document.getElementById("road-len");
  if (el) el.textContent =
    Math.round(totalLen) + " m  (" + Math.round(totalLen/UNIT) + " u)";
}

// ── GLB instancing ────────────────────────────────────
function placeModelInstances(pts, rid, instances) {
  var accum = 0, placed = 0;
  for (var i = 1; i < pts.length; i++) {
    accum += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
    if (accum >= UNIT) {
      accum -= UNIT;
      var tang  = pts[i].subtract(pts[i-1]).normalize();
      var angle = Math.atan2(tang.x, tang.z);
      for (var m = 0; m < roadModelMeshes.length; m++) {
        var inst = roadModelMeshes[m].createInstance(
          "ri_" + rid + "_" + placed + "_" + m
        );
        inst.position   = pts[i].clone();
        inst.rotation.y = angle;
        inst.isPickable = false;
        instances.push(inst);
      }
      placed++;
    }
  }
}

// ── Ribbon fallback ───────────────────────────────────
function placeRibbonRoad(pts, rid) {
  var halfW = 2.5, kerbW = 0.4;
  var left = [], right = [], lk = [], rk = [];
  for (var i = 0; i < pts.length; i++) {
    var prev = pts[Math.max(0,i-1)];
    var next = pts[Math.min(pts.length-1,i+1)];
    var tang = next.subtract(prev).normalize();
    var perp = new BABYLON.Vector3(-tang.z, 0, tang.x);
    left.push( pts[i].add(perp.scale( halfW)));
    right.push(pts[i].add(perp.scale(-halfW)));
    lk.push(   pts[i].add(perp.scale( halfW + kerbW)));
    rk.push(   pts[i].add(perp.scale(-halfW - kerbW)));
  }
  var road = BABYLON.MeshBuilder.CreateRibbon("road"+rid,
    {pathArray:[left,right],closePath:false,closeArray:false}, scene);
  road.isPickable = false;
  var rm = new BABYLON.StandardMaterial("rm"+rid, scene);
  rm.diffuseColor  = new BABYLON.Color3(0.18,0.18,0.18);
  rm.specularColor = new BABYLON.Color3(0.04,0.04,0.04);
  road.material    = rm;
  var lkm = BABYLON.MeshBuilder.CreateRibbon("lk"+rid,
    {pathArray:[lk,left],closePath:false,closeArray:false},scene);
  var rkm = BABYLON.MeshBuilder.CreateRibbon("rk"+rid,
    {pathArray:[right,rk],closePath:false,closeArray:false},scene);
  var km = new BABYLON.StandardMaterial("km"+rid, scene);
  km.diffuseColor  = new BABYLON.Color3(0.70,0.68,0.63);
  km.specularColor = new BABYLON.Color3(0.03,0.03,0.03);
  lkm.material = rkm.material = km;
  lkm.isPickable = rkm.isPickable = false;
  addCentreLine(pts, rid);
}

function addCentreLine(pts, rid) {
  var mat = new BABYLON.StandardMaterial("cl"+rid, scene);
  mat.diffuseColor  = new BABYLON.Color3(1,1,1);
  mat.emissiveColor = new BABYLON.Color3(0.4,0.4,0.4);
  for (var i=2; i<pts.length-2; i+=4) {
    var p=pts[i], nxt=pts[Math.min(i+1,pts.length-1)];
    var dir=nxt.subtract(p).normalize();
    var d=BABYLON.MeshBuilder.CreateBox("cl"+i+"_"+rid,
      {width:0.18,depth:2.0,height:0.04},scene);
    d.position=p.clone(); d.position.y+=0.14;
    d.rotation.y=Math.atan2(dir.x,dir.z);
    d.isPickable=false; d.material=mat;
  }
}

// ── Support columns ───────────────────────────────────
var COLUMN_THRESHOLD = 0.8, _colSrc = null;
function getColSrc() {
  if (_colSrc) return _colSrc;
  _colSrc = BABYLON.MeshBuilder.CreateCylinder("colSrc",
    {diameter:0.6,height:1.0,tessellation:8},scene);
  _colSrc.setEnabled(false); _colSrc.isPickable=false;
  var cm=new BABYLON.StandardMaterial("colmat",scene);
  cm.diffuseColor=new BABYLON.Color3(0.55,0.52,0.48);
  _colSrc.material=cm; return _colSrc;
}
function placeSupports(pts, rid, supports) {
  var src=getColSrc();
  for (var i=0; i<pts.length; i+=4) {
    var gap=pts[i].y - terrainYAt(pts[i].x,pts[i].z);
    if (gap<COLUMN_THRESHOLD) continue;
    var col=src.createInstance("sup_"+rid+"_"+i);
    col.scaling.y=gap;
    col.position.x=pts[i].x;
    col.position.y=terrainYAt(pts[i].x,pts[i].z)+gap/2;
    col.position.z=pts[i].z;
    col.isPickable=false; supports.push(col);
  }
}

// ── Auto-load GLB on startup ──────────────────────────
if (roadModelPath) loadRoadModelFromPath(roadModelPath);
