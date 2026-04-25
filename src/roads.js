// ─────────────────────────────────────────────────────
//  roads.js  —  road network graph
//
//  Roads are EDGES. Nodes are VERTICES.
//  Two roads that share a position share the same node
//  object — node.connections[] grows, appearance updates.
// ─────────────────────────────────────────────────────

var roads     = [];
var snapNodes = [];

// ── Shared node materials (created once) ─────────────
var _matEndpoint   = null;
var _matMid        = null;
var _matJunction   = null;
var _matSnapActive = null;

function _getMat(type) {
  if (type === "endpoint") {
    if (!_matEndpoint) {
      _matEndpoint = new BABYLON.StandardMaterial("snEnd", scene);
      _matEndpoint.diffuseColor    = new BABYLON.Color3(0.15, 0.70, 1.0);
      _matEndpoint.emissiveColor   = new BABYLON.Color3(0.03, 0.28, 0.45);
      _matEndpoint.backFaceCulling = false;
    }
    return _matEndpoint;
  }
  if (type === "mid") {
    if (!_matMid) {
      _matMid = new BABYLON.StandardMaterial("snMid", scene);
      _matMid.diffuseColor    = new BABYLON.Color3(0.15, 0.45, 0.65);
      _matMid.emissiveColor   = new BABYLON.Color3(0.02, 0.15, 0.25);
      _matMid.alpha           = 0.6;
      _matMid.backFaceCulling = false;
    }
    return _matMid;
  }
  if (type === "junction") {
    if (!_matJunction) {
      _matJunction = new BABYLON.StandardMaterial("snJunction", scene);
      _matJunction.diffuseColor    = new BABYLON.Color3(1.0, 0.65, 0.1);
      _matJunction.emissiveColor   = new BABYLON.Color3(0.5, 0.25, 0.0);
      _matJunction.backFaceCulling = false;
    }
    return _matJunction;
  }
  if (type === "active") {
    if (!_matSnapActive) {
      _matSnapActive = new BABYLON.StandardMaterial("snActive", scene);
      _matSnapActive.diffuseColor    = new BABYLON.Color3(1.0, 0.95, 0.1);
      _matSnapActive.emissiveColor   = new BABYLON.Color3(0.6, 0.55, 0.0);
      _matSnapActive.backFaceCulling = false;
    }
    return _matSnapActive;
  }
}

// ── Node creation ─────────────────────────────────────
var _nodeCounter = 0;

function createNode(pos, roadId, curveIndex, isMid) {
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_" + _nodeCounter, {
    radius: isMid ? 0.55 : 0.95, tessellation: 14
  }, scene);
  mesh.rotation.x    = Math.PI / 2;
  mesh.position      = pos.clone();
  mesh.position.y   += 0.35;
  mesh.isPickable    = false;
  mesh.isVisible     = false;
  mesh.material      = _getMat(isMid ? "mid" : "endpoint");

  var node = {
    id:          "n_" + (_nodeCounter++),
    position:    pos.clone(),
    roadId:      roadId,
    curveIndex:  curveIndex,
    isMid:       isMid,
    connections: [],
    mesh:        mesh
  };
  snapNodes.push(node);
  return node;
}

function findNodeAt(pos) {
  for (var i = 0; i < snapNodes.length; i++) {
    var n = snapNodes[i];
    if (n.isMid) continue;
    if (BABYLON.Vector3.Distance(pos, n.position) < 0.1) return n;
  }
  return null;
}

function refreshNodeAppearance(node) {
  if (!node || node.isMid) return;
  var count = node.connections.length;
  if (count >= 2) {
    node.mesh.material    = _getMat("junction");
    node.mesh.scaling.x   = node.mesh.scaling.z = 1.4;
  } else {
    node.mesh.material    = _getMat("endpoint");
    node.mesh.scaling.x   = node.mesh.scaling.z = 1.0;
  }
}

// ── Road placement state machine ─────────────────────
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
  // Always reattach camera when road placement is cancelled or finished
  if (typeof cam !== "undefined" && cam) cam.attachControl(canvas, true);
};

rs.placeMarker = function(pos) {
  var m  = BABYLON.MeshBuilder.CreateSphere("markerA", { diameter: 2.2 }, scene);
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
  if (!A || !end) return;
  if (A.subtract(end).length() < 0.5) return;
  try {
    var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, end, 30);
    var pts   = curve.getPoints();
    for (var i = 0; i < pts.length; i++)
      pts[i].y = terrainYAt(pts[i].x, pts[i].z) + 0.18;
    rs.preview = BABYLON.MeshBuilder.CreateTube("roadPreview", {
      path: pts, radius: 2.5, tessellation: 6
    }, scene);
    rs.preview.isPickable = false;
    var pm = new BABYLON.StandardMaterial("rpmat", scene);
    pm.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
    pm.alpha        = 0.38;
    rs.preview.material = pm;
  } catch(e) { /* degenerate curve */ }
};

// ── Road model (GLB) ──────────────────────────────────
// Path is relative to index.html. The file is at models/road_2lane.glb in the repo.
var roadModelPath   = "models/road_2lane.glb";
var roadModelMeshes = [];

function loadRoadModelFromPath(path) {
  roadModelMeshes.forEach(function(m) { m.dispose(); });
  roadModelMeshes = [];

  // SceneLoader.ImportMesh needs rootUrl + filename separately
  var lastSlash = path.lastIndexOf("/");
  var rootUrl   = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : "./";
  var filename  = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;

  BABYLON.SceneLoader.ImportMesh(
    "",          // load all meshes
    rootUrl,     // e.g. "models/"
    filename,    // e.g. "road_2lane.glb"
    scene,
    function(meshes) {
      for (var i = 0; i < meshes.length; i++) {
        meshes[i].setEnabled(false);
        meshes[i].isPickable = false;
        roadModelMeshes.push(meshes[i]);
      }
      var el = document.getElementById("model-status");
      if (el) el.textContent =
        "Model loaded: " + filename + " (" + meshes.length + " mesh)";
    },
    null, // progress callback (not needed)
    function(scene, msg) {
      console.warn("Road model load failed:", msg);
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Load failed — using ribbon fallback";
    }
  );
}

// ── Build road ────────────────────────────────────────
function buildRoad(A, handle, C, startNodeRef, endNodeRef) {
  var curve = BABYLON.Curve3.CreateQuadraticBezier(A, handle, C, 64);
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
    handle:      handle.clone(),
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
  var sNode = startNodeRef
    ? startNodeRef
    : (findNodeAt(pts[0]) || createNode(pts[0], rid, 0, false));
  sNode.connections.push(rid);
  refreshNodeAppearance(sNode);
  road.startNodeId = sNode.id;
  road.nodes.push(sNode);

  // ── Mid nodes every UNIT along curve ─────────────
  var accum = 0;
  for (var i = 1; i < pts.length - 1; i++) {
    accum += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
    if (accum >= UNIT) {
      accum -= UNIT;
      var mn = createNode(pts[i], rid, i, true);
      road.nodes.push(mn);
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

  // ── HUD update ────────────────────────────────────
  var totalLen = 0;
  for (var i = 1; i < pts.length; i++)
    totalLen += BABYLON.Vector3.Distance(pts[i], pts[i-1]);
  var el = document.getElementById("road-len");
  if (el) el.textContent =
    Math.round(totalLen) + " m  (" + Math.round(totalLen / UNIT) + " units)";
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
    var prev = pts[Math.max(0, i-1)];
    var next = pts[Math.min(pts.length-1, i+1)];
    var tang = next.subtract(prev).normalize();
    var perp = new BABYLON.Vector3(-tang.z, 0, tang.x);
    left.push( pts[i].add(perp.scale( halfW)));
    right.push(pts[i].add(perp.scale(-halfW)));
    lk.push(   pts[i].add(perp.scale( halfW + kerbW)));
    rk.push(   pts[i].add(perp.scale(-halfW - kerbW)));
  }
  var road = BABYLON.MeshBuilder.CreateRibbon("road" + rid,
    { pathArray:[left, right], closePath:false, closeArray:false }, scene);
  road.isPickable = false;
  var rm = new BABYLON.StandardMaterial("rm" + rid, scene);
  rm.diffuseColor  = new BABYLON.Color3(0.18, 0.18, 0.18);
  rm.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  road.material    = rm;

  var lkm = BABYLON.MeshBuilder.CreateRibbon("lk" + rid,
    { pathArray:[lk, left], closePath:false, closeArray:false }, scene);
  var rkm = BABYLON.MeshBuilder.CreateRibbon("rk" + rid,
    { pathArray:[right, rk], closePath:false, closeArray:false }, scene);
  var km = new BABYLON.StandardMaterial("km" + rid, scene);
  km.diffuseColor  = new BABYLON.Color3(0.70, 0.68, 0.63);
  km.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
  lkm.material = rkm.material = km;
  lkm.isPickable = rkm.isPickable = false;
  addCentreLine(pts, rid);
}

function addCentreLine(pts, rid) {
  var mat = new BABYLON.StandardMaterial("cl" + rid, scene);
  mat.diffuseColor  = new BABYLON.Color3(1, 1, 1);
  mat.emissiveColor = new BABYLON.Color3(0.4, 0.4, 0.4);
  for (var i = 2; i < pts.length - 2; i += 4) {
    var p   = pts[i];
    var nxt = pts[Math.min(i+1, pts.length-1)];
    var dir = nxt.subtract(p).normalize();
    var d   = BABYLON.MeshBuilder.CreateBox("cl" + i + "_" + rid,
      { width:0.18, depth:2.0, height:0.04 }, scene);
    d.position   = p.clone();
    d.position.y += 0.14;
    d.rotation.y  = Math.atan2(dir.x, dir.z);
    d.isPickable  = false;
    d.material    = mat;
  }
}

// ── Support columns ───────────────────────────────────
var COLUMN_THRESHOLD = 0.8;
var _colSrc          = null;

function getColSrc() {
  if (_colSrc) return _colSrc;
  _colSrc = BABYLON.MeshBuilder.CreateCylinder("colSrc",
    { diameter:0.6, height:1.0, tessellation:8 }, scene);
  _colSrc.setEnabled(false);
  _colSrc.isPickable = false;
  var cm = new BABYLON.StandardMaterial("colmat", scene);
  cm.diffuseColor  = new BABYLON.Color3(0.55, 0.52, 0.48);
  cm.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  _colSrc.material = cm;
  return _colSrc;
}

function placeSupports(pts, rid, supports) {
  var src = getColSrc();
  for (var i = 0; i < pts.length; i += 4) {
    var roadY   = pts[i].y;
    var groundY = terrainYAt(pts[i].x, pts[i].z);
    var gap     = roadY - groundY;
    if (gap < COLUMN_THRESHOLD) continue;
    var col = src.createInstance("sup_" + rid + "_" + i);
    col.scaling.y  = gap;
    col.position.x = pts[i].x;
    col.position.y = groundY + gap / 2;
    col.position.z = pts[i].z;
    col.isPickable  = false;
    supports.push(col);
  }
}

// ── Load road model on startup ────────────────────────
// This fires as soon as roads.js is parsed.
// If the file doesn't exist yet the error handler shows
// "Load failed — using ribbon fallback" in the UI.
if (roadModelPath) {
  loadRoadModelFromPath(roadModelPath);
}
