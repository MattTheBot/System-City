// ─────────────────────────────────────────────────────
//  tools.js  —  pluggable tool system + registrations
//
//  Camera fix: core.js restricts camera to middle+right
//  mouse only, so NO detach/attach is needed anywhere.
//  Left mouse is free for tools at all times.
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
  // Shift+Alt+D — toggle debug panel
  if (e.shiftKey && e.altKey && e.key.toLowerCase() === "d") {
    toggleDebug();
    return;
  }

  if (e.key === "Shift") {
    isShift = true;
    // Only detach camera in terrain mode so shift+drag sculpts
    if (activeTool === "terrain" && cam) cam.detachControl(canvas);
    return;
  }

  if (e.key === "Escape") {
    if (typeof rs !== "undefined") rs.reset();
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
    if (cam) cam.attachControl(canvas, true);
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
    if (!n.isMid && dist < closestDist) { closestDist = dist; closest = n; }
  }

  if (_highlightedNode && _highlightedNode !== closest) {
    refreshNodeAppearance(_highlightedNode);
    _highlightedNode = null;
  }

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
//  DEBUG OVERLAY  (Shift + Alt + D to toggle)
// ═══════════════════════════════════════════════════
var _debugVisible  = false;
var _debugLines    = [];
var _MAX_DBG_LINES = 80;

// Intercept console.log / warn / error so they appear in overlay
(function() {
  var _origLog   = console.log.bind(console);
  var _origWarn  = console.warn.bind(console);
  var _origError = console.error.bind(console);

  function pushLine(prefix, args) {
    var text = prefix + Array.prototype.slice.call(args).map(function(a) {
      if (typeof a === "object") {
        try { return JSON.stringify(a); } catch(e) { return String(a); }
      }
      return String(a);
    }).join(" ");
    _debugLines.push({ text: text, time: Date.now() });
    if (_debugLines.length > _MAX_DBG_LINES) _debugLines.shift();
    if (_debugVisible) refreshDebugPanel();
  }

  console.log   = function() { _origLog.apply(console, arguments);   pushLine("",       arguments); };
  console.warn  = function() { _origWarn.apply(console, arguments);  pushLine("⚠ ",    arguments); };
  console.error = function() { _origError.apply(console, arguments); pushLine("✖ ",    arguments); };

  window.addEventListener("error", function(ev) {
    pushLine("✖ ", [ev.message + " (" + ev.filename + ":" + ev.lineno + ")"]);
  });
})();

function refreshDebugPanel() {
  var el = document.getElementById("debug-log");
  if (!el) return;

  var fps    = Math.round(engine.getFps());
  var nRoads = typeof roads     !== "undefined" ? roads.length     : 0;
  var nNodes = typeof snapNodes !== "undefined" ? snapNodes.length : 0;

  var stats = "FPS: " + fps
    + "  |  Roads: " + nRoads
    + "  |  Nodes: " + nNodes
    + "  |  Tool: " + (activeTool || "—")
    + "  |  Road phase: " + (typeof rs !== "undefined" ? rs.phase : "—");

  document.getElementById("debug-stats").textContent = stats;

  el.innerHTML = _debugLines.slice().reverse().map(function(l) {
    var isWarn  = l.text.indexOf("⚠") === 0;
    var isError = l.text.indexOf("✖") === 0;
    var col = isError ? "#ff6b6b" : isWarn ? "#ffd93d" : "#aaffaa";
    return '<div style="color:' + col + ';padding:1px 0;border-bottom:0.5px solid rgba(255,255,255,0.05)">'
      + escHtml(l.text) + '</div>';
  }).join("");
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toggleDebug() {
  _debugVisible = !_debugVisible;
  var panel = document.getElementById("debug-panel");
  if (panel) panel.style.display = _debugVisible ? "block" : "none";
  if (_debugVisible) {
    refreshDebugPanel();
    // Refresh stats every second while open
    if (!window._dbgTimer) {
      window._dbgTimer = setInterval(function() {
        if (_debugVisible) refreshDebugPanel();
      }, 1000);
    }
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
    if (snapDot) snapDot.isVisible = false;
    hideAllSnapNodes();
  },
  onDeactivate: function() {
    if (brushCircle) brushCircle.isVisible = false;
    isSculpting = false;
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
    if (evt.button === 0 && isShift) { isSculpting = true; applyBrush(hit.pickedPoint); }
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
    // Do NOT set snapDot visible here — it has no position yet.
    // onMove will show it on first frame the mouse is over terrain.
    if (snapDot) snapDot.isVisible = false;
  },

  onDeactivate: function() {
    rs.reset();
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

    // Show all nearby snap nodes, highlight closest
    updateSnapNodeVisibility(wp);

    // Compute the snapped endpoint position
    var endPos;
    if (rs.phase === 0) {
      // No road started yet — just show where start would snap
      endPos = snapStart(wp);
    } else {
      // Road in progress — snap end to node or length-snap from A
      endPos = snapEnd(rs.A, wp);
    }

    // Move and show snap dot at resolved position
    if (snapDot) {
      snapDot.position.set(endPos.x, endPos.y + 0.3, endPos.z);
      snapDot.isVisible = true;
    }

    // Live length display
    if (rs.phase >= 1) {
      var el = document.getElementById("road-len");
      if (el) {
        var endNode = snapEndNode(rs.A, wp);
        if (endNode) {
          var d = Math.round(BABYLON.Vector3.Distance(rs.A, endPos));
          el.textContent = d + " m  [→ node]";
        } else {
          var u = snapUnits(rs.A, wp);
          el.textContent = (u * UNIT) + " m  (" + u + " u)";
        }
      }
    }

    // Update preview ghost
    if (rs.phase === 1) rs.updatePreview(rs.A, endPos, endPos);
    if (rs.phase === 2) rs.updatePreview(rs.A, rs.B, endPos);
  },

  onDown: function(evt, hit) {
    if (!hit || !hit.hit) return;

    if (evt.button === 2) {
      // Right-click: finish road
      var endPos  = snapEnd(rs.A, hit.pickedPoint);
      var endNode = snapEndNode(rs.A, hit.pickedPoint);

      if (rs.phase === 1) {
        var mid = new BABYLON.Vector3(
          (rs.A.x + endPos.x) * 0.5,
          (rs.A.y + endPos.y) * 0.5,
          (rs.A.z + endPos.z) * 0.5
        );
        buildRoad(rs.A, mid, endPos, rs.startNode, endNode);
        rs.reset();
        hideAllSnapNodes();
      } else if (rs.phase === 2) {
        buildRoad(rs.A, rs.B, endPos, rs.startNode, endNode);
        rs.reset();
        hideAllSnapNodes();
      } else {
        rs.reset();
      }
      return;
    }

    if (evt.button === 0) {
      var wp = hit.pickedPoint;

      if (rs.phase === 0) {
        // Phase 0→1: place start point
        rs.A         = snapStart(wp);         // Vector3
        rs.startNode = snapStartNode(wp);     // node ref or null
        rs.phase     = 1;
        // Place blue start marker — guard: rs.A must be a valid Vector3
        if (rs.A && typeof rs.A.clone === "function") {
          rs.markerA = rs.placeMarker(rs.A);
        }

      } else if (rs.phase === 1) {
        // Phase 1→2: place bezier handle (free float, not snapped)
        rs.B     = wp.clone();
        rs.phase = 2;
      }
      // Phase 2: nothing — wait for right-click
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
