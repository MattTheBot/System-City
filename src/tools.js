// ─────────────────────────────────────────────────────
//  tools.js  —  pluggable tool system + tool registrations
//
//  Camera conflict fix:
//    ArcRotateCamera uses LEFT mouse drag to orbit by default.
//    When road tool is active and user left-clicks to place
//    a start point, the camera ALSO receives that event and
//    starts orbiting — making everything feel frozen.
//
//    Fix: detach camera when road placement begins (phase 0→1).
//    Reattach when road is finished, cancelled, or tool changes.
//    rs.reset() always reattaches so there's no stuck state.
//
//  Snap dot fix:
//    Don't show snapDot in onActivate — its position is still
//    (0,0,0) at that moment, which puts a disc in the centre
//    of the terrain. Only show it once onMove has a real position.
// ─────────────────────────────────────────────────────

var TOOLS       = {};
var activeTool  = null;
var isShift     = false;
var isSculpting = false;

function registerTool(id, def) {
  TOOLS[id] = def;
}

function activateTool(id) {
  if (!TOOLS[id]) return;
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDeactivate)
    TOOLS[activeTool].onDeactivate();

  activeTool = id;
  var def    = TOOLS[id];

  Object.keys(TOOLS).forEach(function(k) {
    var b = document.getElementById("btn-" + k);
    if (b) b.classList.remove("active", "active-rd");
  });
  var ab = document.getElementById("btn-" + id);
  if (ab) ab.classList.add(id === "bulldoze" ? "active-rd" : "active");

  document.querySelectorAll(".panel").forEach(function(p) {
    p.style.display = "none";
  });
  if (def.panel) {
    var el = document.getElementById(def.panel);
    if (el) el.style.display = "block";
  }

  document.getElementById("mode-lbl").textContent = id;
  document.getElementById("info").textContent     = def.hint || "";
  if (def.onActivate) def.onActivate();
}

// ── Pointer routing ──────────────────────────────────
scene.onPointerMove = function() {
  var hit = pickTerrain();
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onMove)
    TOOLS[activeTool].onMove(hit);
};

scene.onPointerDown = function(evt) {
  var hit = pickTerrain();
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onDown)
    TOOLS[activeTool].onDown(evt, hit);
};

scene.onPointerUp = function() {
  isSculpting = false;
  if (activeTool && TOOLS[activeTool] && TOOLS[activeTool].onUp)
    TOOLS[activeTool].onUp();
};

canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });

// ── Keyboard ─────────────────────────────────────────
document.addEventListener("keydown", function(e) {
  if (e.key === "Shift") {
    isShift = true;
    // Only detach camera for terrain sculpting
    if (activeTool === "terrain" && cam) cam.detachControl(canvas);
    return;
  }
  if (e.key === "Escape") {
    if (typeof rs !== "undefined") rs.reset(); // rs.reset reattaches camera
    hideAllSnapNodes();
    activateTool("terrain");
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    Object.keys(TOOLS).forEach(function(k) {
      if (TOOLS[k].key && e.key.toLowerCase() === TOOLS[k].key.toLowerCase())
        activateTool(k);
    });
  }
});

document.addEventListener("keyup", function(e) {
  if (e.key === "Shift") {
    isShift     = false;
    isSculpting = false;
    // Only reattach if we're in terrain mode (that's where we detached)
    if (activeTool === "terrain" && cam) cam.attachControl(canvas, true);
  }
});

// ── Snap node visibility ──────────────────────────────
var _highlightedNode = null;

function updateSnapNodeVisibility(cursorPos) {
  if (typeof snapNodes === "undefined" || !snapNodes.length) return;
  var closest = null, closestDist = Infinity;

  for (var i = 0; i < snapNodes.length; i++) {
    var n    = snapNodes[i];
    var dist = BABYLON.Vector3.Distance(cursorPos, n.position);

    n.mesh.isVisible = (dist < NODE_SHOW_DIST);

    if (!n.isMid && dist < closestDist) {
      closestDist = dist;
      closest     = n;
    }
  }

  // Reset previous yellow highlight
  if (_highlightedNode && _highlightedNode !== closest) {
    refreshNodeAppearance(_highlightedNode);
    _highlightedNode = null;
  }

  // Highlight the node we'll snap to
  if (closest && closestDist < NODE_SNAP_DIST) {
    closest.mesh.material = _getMat("active");
    _highlightedNode      = closest;
  }
}

function hideAllSnapNodes() {
  if (typeof snapNodes === "undefined") return;
  for (var i = 0; i < snapNodes.length; i++)
    snapNodes[i].mesh.isVisible = false;
  if (_highlightedNode) {
    refreshNodeAppearance(_highlightedNode);
    _highlightedNode = null;
  }
}

// ═══════════════════════════════════════════════════
//  TOOL: TERRAIN
// ═══════════════════════════════════════════════════
registerTool("terrain", {
  key:   "T",
  panel: "tp",
  hint:  "Terrain — hold Shift + drag to sculpt  |  R-click to sample flatten height",

  onActivate: function() {
    // Hide snap dot and nodes — no position assigned yet
    if (snapDot) snapDot.isVisible = false;
    hideAllSnapNodes();
  },

  onDeactivate: function() {
    if (brushCircle) brushCircle.isVisible = false;
    isSculpting = false;
    // Reattach camera in case shift was held when switching tools
    if (cam) cam.attachControl(canvas, true);
  },

  onMove: function(hit) {
    if (!hit || !hit.hit) {
      if (brushCircle) brushCircle.isVisible = false;
      return;
    }
    var wp = hit.pickedPoint;
    if (brushCircle) {
      brushCircle.isVisible = true;
      brushCircle.position.set(wp.x, wp.y + 0.25, wp.z);
    }
    if (isShift && isSculpting) applyBrush(wp);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;
    if (evt.button === 2) { sampleHeight(hit.pickedPoint); return; }
    if (evt.button === 0 && isShift) {
      isSculpting = true;
      applyBrush(hit.pickedPoint);
    }
  },

  onUp: function() { isSculpting = false; }
});

// ═══════════════════════════════════════════════════
//  TOOL: ROAD
// ═══════════════════════════════════════════════════
registerTool("road", {
  key:   "R",
  panel: "rp",
  hint:  "Road — L-click start  •  L-click curve handle  •  R-click finish",

  onActivate: function() {
    // Do NOT show snapDot here — it's still at (0,0,0).
    // onMove will position and show it on first mouse move.
    if (snapDot) snapDot.isVisible = false;
  },

  onDeactivate: function() {
    rs.reset(); // rs.reset() reattaches camera
    if (snapDot) snapDot.isVisible = false;
    hideAllSnapNodes();
    var el = document.getElementById("road-len");
    if (el) el.textContent = "—";
  },

  onMove: function(hit) {
    if (!hit || !hit.hit) {
      if (snapDot) snapDot.isVisible = false;
      return;
    }
    var wp = hit.pickedPoint;

    // Update snap node visibility based on cursor position
    updateSnapNodeVisibility(wp);

    // Compute snapped endpoint
    var endSnap, end;
    if (rs.phase === 0) {
      endSnap = snapStart(wp);
    } else {
      endSnap = snapEnd(rs.A, wp);
    }
    end = endSnap.pos;

    // Position and show snap dot at the resolved endpoint
    if (snapDot) {
      snapDot.position.set(end.x, end.y + 0.3, end.z);
      snapDot.isVisible = true;
    }

    // Live length display when road is in progress
    if (rs.phase >= 1) {
      var el = document.getElementById("road-len");
      if (el) {
        if (endSnap.node) {
          var d = Math.round(BABYLON.Vector3.Distance(rs.A, end));
          el.textContent = d + " m  [snapped to node]";
        } else {
          var u = snapUnits(rs.A, wp);
          el.textContent = (u * UNIT) + " m  (" + u + " units)";
        }
      }
    }

    // Update preview ghost mesh
    if (rs.phase === 1) rs.updatePreview(rs.A, end, end);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, end);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      // ── RIGHT CLICK: finish road ──────────────────
      var endSnap = snapEnd(rs.A, hit.pickedPoint);
      var C       = endSnap.pos;

      if (rs.phase === 1) {
        var mid = new BABYLON.Vector3(
          (rs.A.x + C.x) * 0.5,
          (rs.A.y + C.y) * 0.5,
          (rs.A.z + C.z) * 0.5
        );
        buildRoad(rs.A, mid, C, rs.startNode, endSnap.node);
        rs.reset(); // reattaches camera
        hideAllSnapNodes();
      } else if (rs.phase === 2) {
        buildRoad(rs.A, rs.B, C, rs.startNode, endSnap.node);
        rs.reset(); // reattaches camera
        hideAllSnapNodes();
      } else {
        rs.reset();
      }
      return;
    }

    if (evt.button === 0) {
      // ── LEFT CLICK: place start or handle ─────────
      var wp = hit.pickedPoint;

      if (rs.phase === 0) {
        var startSnap = snapStart(wp);
        rs.A          = startSnap.pos;
        rs.startNode  = startSnap.node;
        rs.phase      = 1;
        rs.markerA    = rs.placeMarker(rs.A);

        // *** KEY FIX: detach camera so mouse drag moves
        //     the road handle, not the camera ***
        if (cam) cam.detachControl(canvas);

      } else if (rs.phase === 1) {
        // Handle floats free — shapes the curve, not an endpoint
        rs.B     = wp.clone();
        rs.phase = 2;
      }
      // Phase 2: nothing — right-click finishes
    }
  },

  onUp: function() {}
});

// ═══════════════════════════════════════════════════
//  TOOL: BULLDOZE  (stub — v0.5)
// ═══════════════════════════════════════════════════
registerTool("bulldoze", {
  key:   "X",
  panel: null,
  hint:  "Bulldoze — coming in v0.5",
  onActivate:   function() { if (snapDot) snapDot.isVisible = false; hideAllSnapNodes(); },
  onDeactivate: function() {},
  onMove:       function() {},
  onDown:       function() {},
  onUp:         function() {}
});
