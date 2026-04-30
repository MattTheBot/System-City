// ─────────────────────────────────────────────────────
//  roads.js
//
//  GLB INSTANCING FIX:
//    After loading, the bounding box Z-extent of the mesh
//    is measured. That becomes SEGMENT_LEN for this type.
//    Instances are placed every SEGMENT_LEN metres — not
//    every UNIT — so there are zero gaps regardless of
//    the GLB's actual size.
//
//    Path3D provides exact tangent/normal at each placement
//    point so instances align perfectly on any curve.
//
//  FALLBACK:
//    ExtrudeShapeCustom creates ONE continuous mesh from a
//    cross-section profile. No instances, no gaps, no
//    rotation issues. Looks identical on straight or curved.
// ─────────────────────────────────────────────────────

var roads     = [];
var snapNodes = [];

// ── Road type definitions ────────────────────────────
var ROAD_TYPES = {
  street: {
    halfWidth: 2.5,
    kerbWidth: 0.4,
    kerbHeight: 0.05,
    modelPath: "models/road_2lane.glb"
  }
};
var DEFAULT_ROAD_TYPE = "street";

// ── Model cache ───────────────────────────────────────
// _roadModels[type]  = array of source meshes (setEnabled false)
// _segmentLen[type]  = Z-axis bounding box length of one segment
var _roadModels  = {};
var _segmentLen  = {};

function loadModelForType(typeName) {
  var def = ROAD_TYPES[typeName];
  if (!def || !def.modelPath) return;
  if (_roadModels[typeName] !== undefined) return;
  _roadModels[typeName] = null;

  var path = def.modelPath;
  var last = path.lastIndexOf("/");
  var root = last >= 0 ? path.substring(0, last + 1) : "./";
  var file = last >= 0 ? path.substring(last + 1)    : path;

  BABYLON.SceneLoader.ImportMesh("", root, file, scene,
    function(meshes) {
      var loaded = [];

      // Collect real meshes, skip __root__
      var real = meshes.filter(function(m) { return m.name !== "__root__"; });

      for (var i = 0; i < real.length; i++) {
        var m = real[i];
        m.computeWorldMatrix(true);
        m.bakeCurrentTransformIntoVertices();
        m.position = BABYLON.Vector3.Zero();
        m.rotation = BABYLON.Vector3.Zero();
        m.scaling  = BABYLON.Vector3.One();
        m.parent   = null;
        m.setEnabled(false);
        m.isPickable = false;
        loaded.push(m);
      }

      // Dispose __root__
      meshes.filter(function(m){ return m.name === "__root__"; })
            .forEach(function(m){ m.dispose(); });

      // ── Measure segment length from bounding box ───
      // After baking, the mesh sits at origin. We measure
      // how long it is along the Z axis (forward direction).
      var segLen = 1.0; // safe default
      if (loaded.length > 0) {
        loaded[0].computeWorldMatrix(true);
        var bb  = loaded[0].getBoundingInfo().boundingBox;
        var zExt = Math.abs(bb.maximumWorld.z - bb.minimumWorld.z);
        var xExt = Math.abs(bb.maximumWorld.x - bb.minimumWorld.x);
        // Use whichever axis is longer (handles models oriented either way)
        segLen = Math.max(zExt, xExt, 0.05);
        console.log("Segment bounding box Z:", zExt.toFixed(3),
                    "X:", xExt.toFixed(3), "→ using:", segLen.toFixed(3));
      }
      _segmentLen[typeName]  = segLen;
      _roadModels[typeName]  = loaded;

      var el = document.getElementById("model-status");
      if (el) el.textContent =
        "Road model: " + file +
        " | seg=" + segLen.toFixed(2) + "m" +
        " (" + loaded.length + " mesh)";

      console.log("Road model loaded:", file,
        "seg:", segLen.toFixed(2) + "m",
        "meshes:", loaded.length);
    },
    null,
    function(scene2, msg) {
      console.warn("Road model load failed:", msg);
      _roadModels[typeName] = [];
      var el = document.getElementById("model-status");
      if (el) el.textContent = "Ribbon fallback — model not found";
    }
  );
}

loadModelForType(DEFAULT_ROAD_TYPE);

// ── Node materials ────────────────────────────────────
var _mats = {};
function _getMat(type) {
  if (_mats[type]) return _mats[type];
  var m = new BABYLON.StandardMaterial("sn_" + type, scene);
  m.backFaceCulling = false;
  var c = {
    endpoint: [[0.15,0.70,1.0],[0.03,0.28,0.45]],
    mid:      [[0.15,0.45,0.65],[0.02,0.15,0.25]],
    junction: [[1.0, 0.55,0.05],[0.50,0.22,0.00]],
    active:   [[1.0, 0.95,0.10],[0.60,0.55,0.00]]
  }[type] || [[1,1,1],[0,0,0]];
  m.diffuseColor  = new BABYLON.Color3(c[0][0],c[0][1],c[0][2]);
  m.emissiveColor = new BABYLON.Color3(c[1][0],c[1][1],c[1][2]);
  if (type === "mid") m.alpha = 0.55;
  _mats[type] = m;
  return m;
}

var _jMat = null;
function getJMat() {
  if (_jMat) return _jMat;
  _jMat = new BABYLON.StandardMaterial("jmat", scene);
  _jMat.diffuseColor  = new BABYLON.Color3(0.17,0.17,0.17);
  _jMat.specularColor = new BABYLON.Color3(0.04,0.04,0.04);
  return _jMat;
}

// ── Nodes ─────────────────────────────────────────────
var _nc = 0;
function createNode(pos, roadId, curveIndex, isMid) {
  var mesh = BABYLON.MeshBuilder.CreateDisc("sn_"+_nc,
    {radius: isMid?0.5:1.0, tessellation:14}, scene);
  mesh.rotation.x = Math.PI/2;
  mesh.position   = pos.clone(); mesh.position.y += 0.35;
  mesh.isPickable = false; mesh.isVisible = false;
  mesh.material   = _getMat(isMid?"mid":"endpoint");
  var node = {
    id:"n_"+(_nc++), position:pos.clone(), roadId:roadId,
    curveIndex:curveIndex, isMid:isMid, connections:[], capMesh:null, mesh:mesh
  };
  snapNodes.push(node); return node;
}

function findNodeAt(pos) {
  for (var i=0;i<snapNodes.length;i++) {
    var n=snapNodes[i];
    if (n.isMid) continue;
    if (BABYLON.Vector3.Distance(pos,n.position)<0.1) return n;
  }
  return null;
}

function refreshNodeAppearance(node) {
  if (!node||node.isMid) return;
  if (node.connections.length>=2) {
    node.mesh.material=_getMat("junction"); node.mesh.scaling.x=node.mesh.scaling.z=1.5;
  } else {
    node.mesh.material=_getMat("endpoint"); node.mesh.scaling.x=node.mesh.scaling.z=1.0;
  }
}

// ── Junction cap ──────────────────────────────────────
function buildJunctionCap(node) {
  if (node.capMesh) { node.capMesh.dispose(); node.capMesh=null; }
  if (node.connections.length<2) return;
  var pts2D = [];
  for (var c=0;c<node.connections.length;c++) {
    var road=null;
    for (var r=0;r<roads.length;r++) if (roads[r].id===node.connections[c]){road=roads[r];break;}
    if (!road) continue;
    var td=ROAD_TYPES[road.typeName]||ROAD_TYPES[DEFAULT_ROAD_TYPE];
    var hw=td.halfWidth+td.kerbWidth, pts=road.curve;
    var isStart=(road.startNodeId===node.id);
    var idx=isStart?0:pts.length-1;
    var tang=isStart
      ? pts[Math.min(1,pts.length-1)].subtract(pts[0]).normalize()
      : pts[idx].subtract(pts[Math.max(0,idx-1)]).normalize();
    var perp=new BABYLON.Vector3(-tang.z,0,tang.x);
    var base=pts[idx];
    pts2D.push({x:base.x+perp.x*hw,z:base.z+perp.z*hw});
    pts2D.push({x:base.x-perp.x*hw,z:base.z-perp.z*hw});
  }
  pts2D.push({x:node.position.x,z:node.position.z});
  if (pts2D.length<3) return;
  var hull=convexHull2D(pts2D);
  if (!hull||hull.length<3) return;
  try {
    var gy=terrainYAt(node.position.x,node.position.z)+0.07;
    var corners=hull.map(function(p){return new BABYLON.Vector2(p.x,p.z);});
    var poly=new BABYLON.PolygonMeshBuilder("jcap_"+node.id,corners,scene,window.earcut||null);
    var cap=poly.build(false,0.12);
    cap.position.y=gy; cap.isPickable=false; cap.material=getJMat();
    node.capMesh=cap;
  } catch(e){ console.warn("Cap fail:",e.message); }
}

function convexHull2D(pts) {
  if (pts.length<3) return pts;
  var s=0;
  for (var i=1;i<pts.length;i++) if (pts[i].x<pts[s].x) s=i;
  var hull=[],cur=s;
  do {
    hull.push(pts[cur]);
    var nxt=0;
    for (var i=1;i<pts.length;i++) {
      if (nxt===cur){nxt=i;continue;}
      var ax=pts[nxt].x-pts[cur].x,az=pts[nxt].z-pts[cur].z;
      var bx=pts[i].x-pts[cur].x,  bz=pts[i].z-pts[cur].z;
      var cross=ax*bz-az*bx;
      if (cross<0) nxt=i;
      else if (cross===0&&(bx*bx+bz*bz)>(ax*ax+az*az)) nxt=i;
    }
    cur=nxt; if (hull.length>pts.length+2) break;
  } while (cur!==s);
  return hull;
}

// ── Road state machine ────────────────────────────────
var rs={phase:0,A:null,B:null,startNode:null,preview:null,markerA:null};
rs.reset=function(){
  rs.phase=0;rs.A=null;rs.B=null;rs.startNode=null;
  if(rs.preview){rs.preview.dispose();rs.preview=null;}
  if(rs.markerA){rs.markerA.dispose();rs.markerA=null;}
};
rs.placeMarker=function(pos){
  if(!pos||typeof pos.clone!=="function") return null;
  var m=BABYLON.MeshBuilder.CreateSphere("markerA",{diameter:2.2},scene);
  m.position=pos.clone();m.position.y+=1.1;m.isPickable=false;
  var mat=new BABYLON.StandardMaterial("mAmat",scene);
  mat.diffuseColor=new BABYLON.Color3(0.2,0.6,1);
  mat.emissiveColor=new BABYLON.Color3(0.05,0.2,0.5);
  m.material=mat;return m;
};
rs.updatePreview=function(A,handle,end){
  if(rs.preview){rs.preview.dispose();rs.preview=null;}
  if(!A||!end||typeof A.subtract!=="function") return;
  if(A.subtract(end).length()<0.5) return;
  try {
    var h=handle||A.add(end).scale(0.5);
    var curve=BABYLON.Curve3.CreateQuadraticBezier(A,h,end,30);
    var pts=curve.getPoints();
    for(var i=0;i<pts.length;i++) pts[i].y=terrainYAt(pts[i].x,pts[i].z)+0.18;
    rs.preview=BABYLON.MeshBuilder.CreateTube("roadPreview",
      {path:pts,radius:2.5,tessellation:6},scene);
    rs.preview.isPickable=false;
    var pm=new BABYLON.StandardMaterial("rpmat",scene);
    pm.diffuseColor=new BABYLON.Color3(0.3,0.5,0.9);pm.alpha=0.38;
    rs.preview.material=pm;
  }catch(e){}
};

// ── Build road ────────────────────────────────────────
function buildRoad(A,handle,C,startNodeRef,endNodeRef,typeName){
  if(!A||!C) return;
  typeName=typeName||DEFAULT_ROAD_TYPE;
  var td=ROAD_TYPES[typeName]||ROAD_TYPES[DEFAULT_ROAD_TYPE];
  var h=handle||A.add(C).scale(0.5);
  var curve=BABYLON.Curve3.CreateQuadraticBezier(A,h,C,128);
  var pts=curve.getPoints();
  for(var i=0;i<pts.length;i++) pts[i].y=terrainYAt(pts[i].x,pts[i].z)+0.08;

  var rid=roads.length, instances=[], supports=[];
  var models=_roadModels[typeName];

  if(models&&models.length>0){
    placeModelInstances(pts,rid,models,_segmentLen[typeName]||1.0,instances);
  } else {
    placeExtrudedRoad(pts,rid,td);
  }
  placeSupports(pts,rid,supports);

  var road={id:rid,typeName:typeName,A:A.clone(),handle:h.clone(),C:C.clone(),
    curve:pts,instances:instances,supports:supports,nodes:[],startNodeId:null,endNodeId:null};
  roads.push(road);

  var sNode=startNodeRef||(findNodeAt(pts[0])||createNode(pts[0],rid,0,false));
  sNode.connections.push(rid);refreshNodeAppearance(sNode);buildJunctionCap(sNode);
  road.startNodeId=sNode.id;road.nodes.push(sNode);

  var accum=0,NS=UNIT*2;
  for(var i=1;i<pts.length-1;i++){
    accum+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
    if(accum>=NS){accum-=NS;road.nodes.push(createNode(pts[i],rid,i,true));}
  }

  var eNode=endNodeRef||(findNodeAt(pts[pts.length-1])||createNode(pts[pts.length-1],rid,pts.length-1,false));
  eNode.connections.push(rid);refreshNodeAppearance(eNode);buildJunctionCap(eNode);
  road.endNodeId=eNode.id;road.nodes.push(eNode);

  if(sNode.connections.length>1) console.log("Junction @ start",sNode.id,"roads:",sNode.connections);
  if(eNode.connections.length>1) console.log("Junction @ end",  eNode.id,"roads:",eNode.connections);

  var totalLen=0;
  for(var i=1;i<pts.length;i++) totalLen+=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
  var el=document.getElementById("road-len");
  if(el) el.textContent=Math.round(totalLen)+" m  ("+Math.round(totalLen/UNIT)+" u)";
}

// ── GLB instancing with Path3D ────────────────────────
// Uses actual segment bounding box length as spacing.
// Path3D provides exact tangent at each point so instances
// are always flush against each other on any curve.
function placeModelInstances(pts,rid,models,segLen,instances){
  if(!segLen||segLen<0.001) segLen=1.0;

  var path3d = new BABYLON.Path3D(pts);
  var tangents = path3d.getTangents();
  var totalLen = 0;
  var segLens  = [];
  for(var i=1;i<pts.length;i++){
    var d=BABYLON.Vector3.Distance(pts[i],pts[i-1]);
    totalLen+=d; segLens.push(d);
  }

  var placed=0, accum=0, nextPlace=segLen*0.5; // start half-segment in

  for(var i=1;i<pts.length;i++){
    accum+=segLens[i-1];
    while(accum>=nextPlace&&nextPlace<=totalLen){
      // Interpolate position along this segment
      var t=(accum-segLens[i-1])/segLens[i-1]; // 0..1 within this pair
      // Use Path3D tangent at this curve sample index for rotation
      var tang=tangents[i]||tangents[tangents.length-1];
      var angle=Math.atan2(tang.x,tang.z);
      // Interpolate world position
      var pos=BABYLON.Vector3.Lerp(pts[i-1],pts[i],
        (nextPlace-(accum-segLens[i-1]))/segLens[i-1]);
      pos.y=terrainYAt(pos.x,pos.z)+0.08;

      for(var m=0;m<models.length;m++){
        var inst=models[m].createInstance("ri_"+rid+"_"+placed+"_"+m);
        inst.position   = pos;
        inst.rotation.y = angle;
        inst.isPickable = false;
        instances.push(inst);
      }
      placed++;
      nextPlace+=segLen;
    }
  }
}

// ── ExtrudeShape fallback (continuous, no gaps) ───────
// Defines a cross-section matching the Tinkercad road model
// look (road surface + raised kerb strips) and extrudes it
// along the curve. One mesh, perfect on any curve.
function placeExtrudedRoad(pts,rid,td){
  var hw=td.halfWidth, kw=td.kerbWidth, kh=td.kerbHeight||0.05;

  // Cross-section in local XZ plane (X=width, Y=height above road base)
  // Defined left-to-right
  var profile=[
    new BABYLON.Vector3(-(hw+kw),  0,   0),  // left kerb outer base
    new BABYLON.Vector3(-(hw+kw),  kh,  0),  // left kerb outer top
    new BABYLON.Vector3(-hw,       kh,  0),  // left kerb inner top
    new BABYLON.Vector3(-hw,       0,   0),  // road left edge
    new BABYLON.Vector3( hw,       0,   0),  // road right edge
    new BABYLON.Vector3( hw,       kh,  0),  // right kerb inner top
    new BABYLON.Vector3( hw+kw,    kh,  0),  // right kerb outer top
    new BABYLON.Vector3( hw+kw,    0,   0),  // right kerb outer base
  ];

  // Use Path3D to get clean tangents for the extrusion path
  var path3d   = new BABYLON.Path3D(pts);
  var tangents = path3d.getTangents();

  // Extrude — sideOrientation FRONTSIDE so normals point out
  var mesh=BABYLON.MeshBuilder.ExtrudeShapeCustom("road"+rid,{
    shape:            profile,
    path:             pts,
    sideOrientation:  BABYLON.Mesh.DOUBLESIDE,
    updatable:        false
  },scene);
  mesh.isPickable=false;

  // Multi-material: grey road surface, lighter kerb
  // Since ExtrudeShape gives one mesh, we use a single material
  // and rely on the geometry for visual separation.
  // Road surface colour matches asphalt, kerb is a touch lighter.
  var mat=new BABYLON.StandardMaterial("extmat"+rid,scene);
  mat.diffuseColor =new BABYLON.Color3(0.20,0.20,0.20);
  mat.specularColor=new BABYLON.Color3(0.04,0.04,0.04);
  mesh.material=mat;

  // Centre line dashes on top of the extrusion
  addCentreLine(pts,rid);
}

function addCentreLine(pts,rid){
  var mat=new BABYLON.StandardMaterial("cl"+rid,scene);
  mat.diffuseColor=new BABYLON.Color3(1,1,1);mat.emissiveColor=new BABYLON.Color3(0.4,0.4,0.4);
  for(var i=2;i<pts.length-2;i+=4){
    var p=pts[i],nxt=pts[Math.min(i+1,pts.length-1)];
    var dir=nxt.subtract(p).normalize();
    var d=BABYLON.MeshBuilder.CreateBox("cl"+i+"_"+rid,{width:0.18,depth:2.0,height:0.04},scene);
    d.position=p.clone();d.position.y+=0.14;d.rotation.y=Math.atan2(dir.x,dir.z);
    d.isPickable=false;d.material=mat;
  }
}

// ── Support columns ───────────────────────────────────
var COLUMN_THRESHOLD=0.8,_colSrc=null;
function getColSrc(){
  if(_colSrc) return _colSrc;
  _colSrc=BABYLON.MeshBuilder.CreateCylinder("colSrc",{diameter:0.6,height:1.0,tessellation:8},scene);
  _colSrc.setEnabled(false);_colSrc.isPickable=false;
  var cm=new BABYLON.StandardMaterial("colmat",scene);
  cm.diffuseColor=new BABYLON.Color3(0.55,0.52,0.48);_colSrc.material=cm;return _colSrc;
}
function placeSupports(pts,rid,supports){
  var src=getColSrc();
  for(var i=0;i<pts.length;i+=4){
    var gap=pts[i].y-terrainYAt(pts[i].x,pts[i].z);
    if(gap<COLUMN_THRESHOLD) continue;
    var col=src.createInstance("sup_"+rid+"_"+i);
    col.scaling.y=gap;col.position.x=pts[i].x;
    col.position.y=terrainYAt(pts[i].x,pts[i].z)+gap/2;
    col.position.z=pts[i].z;col.isPickable=false;supports.push(col);
  }
}
