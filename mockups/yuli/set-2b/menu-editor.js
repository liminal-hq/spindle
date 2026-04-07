/* ═══════════════════════════════════════════════════════
     INTERACTIVE BEHAVIOURS
     ─────────────────────────────────────────────────────
     Vanilla JS for prototyping. In production, these would
     be React components with state managed by the Spindle
     project store.

     Sections:
     1. State variables
     2. View switching (Editor ↔ Map)
     3. Menu selection (left nav + map sync)
     4. Canvas button interaction (select + drag)
     5. Preview toggle (compile overlay)
     6. Tool switching
     7. Canvas overlays (safe areas, nav arrows)
     8. Inspector toggle
     9. Template picker
     10. Visual state chips
     11. Inspector ↔ canvas position sync
     12. Action editor sync
     13. Connection click-to-jump
     14. Auto-navigation calculation
     15. Dynamic map SVG connections
     16. Background editing
     17. Generate menus
     18. Collapsible inspector sections
     19. Button style state tabs
     20. Text style alignment + toggles
     21. Highlight mode toggle
     22. Keyboard shortcuts
     ═══════════════════════════════════════════════════════ */
(function() {
	'use strict';

	// ── 1. State variables ──────────────────────────────
	let currentView = 'editor';     // 'editor' | 'map'
	let selectedBtn = 'btn-1';       // currently selected canvas button
	let inspectorVisible = true;
	let safeAreasVisible = false;
	let navArrowsVisible = false;
	let previewMode = false;
	let templateOpen = false;
	let activeTool = 'select';
	let autoNavEnabled = true;       // auto vs manual navigation

	// Button metadata (would come from MenuDocument in production)
	const btnData = {
		'btn-1': { name: 'Play Ceremony',  action: 'playTitle', target: 'Ceremony',       navDown: 'Play Recep...' },
		'btn-2': { name: 'Play Reception',  action: 'playTitle', target: 'Reception',      navUp: 'Play Cerem...', navDown: 'Chapter Se...' },
		'btn-3': { name: 'Chapter Select',  action: 'showMenu',  target: 'Chapter Select', navUp: 'Play Recep...', navDown: 'Audio Setup' },
		'btn-4': { name: 'Audio Setup',     action: 'showMenu',  target: 'Audio Setup',    navUp: 'Chapter Se...' }
	};

	// ── Element refs ────────────────────────────────────
	const editorView       = document.getElementById('editorView');
	const navMapView       = document.getElementById('navMapView');
	const canvas           = document.getElementById('menuCanvas');
	const inspector        = document.getElementById('inspector');
	const editorBody       = document.getElementById('editorBody');
	const mapEditorBody    = document.getElementById('mapEditorBody');
	const mapInspector     = document.getElementById('mapInspector');
	const navArrowsOverlay = document.getElementById('navArrowsOverlay');
	const compileOverlay   = document.getElementById('compileOverlay');
	const safeAction       = document.getElementById('safeAction');
	const safeTitle        = document.getElementById('safeTitle');
	const canvasTools      = document.getElementById('canvasTools');


	// ── 2. View switching (Editor ↔ Map) ────────────────
	document.querySelectorAll('[data-nav-view]').forEach(btn => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('[data-nav-view]').forEach(b => b.classList.remove('nav-view-btn--active'));
			btn.classList.add('nav-view-btn--active');
			currentView = btn.dataset.navView;

			if (currentView === 'editor') {
				editorView.style.display = '';
				navMapView.classList.remove('nav-map-view--visible');
			} else {
				editorView.style.display = 'none';
				navMapView.classList.add('nav-map-view--visible');
			}
		});
	});

	// Mini-map "Expand" button → switch to full Map view
	document.getElementById('expandMapBtn').addEventListener('click', () => {
		document.querySelector('[data-nav-view="map"]').click();
	});

	// Map inspector toggle (matches editor inspector toggle)
	document.getElementById('toggleMapInspectorBtn').addEventListener('click', () => {
		mapInspector.classList.toggle('inspector--hidden');
		mapEditorBody.classList.toggle('editor-body--no-inspector');
		// Redraw connections after layout change
		setTimeout(drawMapConnections, 50);
	});


	// ── 3. Menu selection (left nav + map sync) ─────────
	document.querySelectorAll('.menu-item').forEach(item => {
		item.addEventListener('click', () => {
			// Update left nav selection
			document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('menu-item--selected'));
			item.classList.add('menu-item--selected');

			const menuId = item.dataset.menu;
			const name = item.querySelector('.menu-item__name').textContent;
			document.getElementById('menuNameInput').value = name;

			// Sync mini-map node selection
			document.querySelectorAll('.map-node').forEach(n => n.classList.remove('map-node--selected'));
			const mapNode = document.querySelector(`.map-node[data-menu="${menuId}"]`);
			if (mapNode) mapNode.classList.add('map-node--selected');

			// Sync full map card selection
			document.querySelectorAll('.map-menu-card').forEach(c => c.classList.remove('map-menu-card--selected'));
			const mapCard = document.querySelector(`.map-menu-card[data-map-menu="${menuId}"]`);
			if (mapCard) mapCard.classList.add('map-menu-card--selected');

			// Update map inspector
			document.getElementById('mapInspectorName').textContent = name;
			document.getElementById('mapInspName').textContent = name;
		});
	});

	// Mini-map node clicks → select that menu
	document.querySelectorAll('.map-node').forEach(node => {
		node.addEventListener('click', () => {
			const menuItem = document.querySelector(`.menu-item[data-menu="${node.dataset.menu}"]`);
			if (menuItem) menuItem.click();
		});
	});

	// Full map card clicks → select that menu
	document.querySelectorAll('.map-menu-card').forEach(card => {
		card.addEventListener('click', () => {
			const menuItem = document.querySelector(`.menu-item[data-menu="${card.dataset.mapMenu}"]`);
			if (menuItem) menuItem.click();
		});

		// Double-click → switch to editor for that menu
		card.addEventListener('dblclick', () => {
			document.querySelector('[data-nav-view="editor"]').click();
		});
	});


	// ── 4. Canvas button interaction ────────────────────
	document.querySelectorAll('.scene-btn').forEach(btn => {
		// Click to select
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('scene-btn--selected'));
			btn.classList.add('scene-btn--selected');
			selectedBtn = btn.dataset.btn;

			// Update inspector with button data
			const data = btnData[selectedBtn];
			document.getElementById('inspectorName').textContent = data.name;
			document.getElementById('insp-x').value = parseInt(btn.style.left);
			document.getElementById('insp-y').value = parseInt(btn.style.top);
			document.getElementById('insp-w').value = parseInt(btn.style.width);
			document.getElementById('insp-h').value = parseInt(btn.style.height);
			document.getElementById('insp-action-type').value = data.action;
			document.getElementById('insp-action-target').value = data.target;
			document.getElementById('actionSummary').textContent = data.action + ': "' + data.target + '"';
			document.getElementById('actionBadge').textContent = data.action;
			document.getElementById('navGridCenter').textContent = selectedBtn;

			// Update nav grid
			const downBtn = document.querySelector('[data-dir="down"]');
			const upBtn = document.querySelector('[data-dir="up"]');
			downBtn.textContent = data.navDown || '(none)';
			upBtn.textContent = data.navUp || '(none)';
		});

		// Drag to move
		let dragging = false, startX, startY, origLeft, origTop;

		btn.addEventListener('mousedown', (e) => {
			if (e.target.classList.contains('resize-handle')) return;
			if (activeTool !== 'select') return;
			dragging = true;
			startX = e.clientX;
			startY = e.clientY;
			origLeft = parseInt(btn.style.left);
			origTop = parseInt(btn.style.top);
			btn.style.cursor = 'grabbing';
			e.preventDefault();
		});

		document.addEventListener('mousemove', (e) => {
			if (!dragging) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			btn.style.left = (origLeft + dx) + 'px';
			btn.style.top = (origTop + dy) + 'px';

			// Live-sync inspector position
			if (btn.classList.contains('scene-btn--selected')) {
				document.getElementById('insp-x').value = parseInt(btn.style.left);
				document.getElementById('insp-y').value = parseInt(btn.style.top);
			}
		});

		document.addEventListener('mouseup', () => {
			if (dragging) {
				dragging = false;
				btn.style.cursor = 'move';
			}
		});
	});

	// Deselect on canvas background click
	canvas.addEventListener('click', (e) => {
		if (e.target === canvas || e.target.classList.contains('canvas-bg-layer')) {
			document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('scene-btn--selected'));
			document.getElementById('inspectorName').textContent = '(No selection)';
		}
	});


	// ── 5. Preview toggle (compile overlay) ─────────────
	document.getElementById('previewToggle').addEventListener('click', () => {
		previewMode = !previewMode;
		document.getElementById('previewToggle').classList.toggle('preview-toggle--active', previewMode);
		canvas.classList.toggle('menu-canvas--preview', previewMode);
		compileOverlay.classList.toggle('compile-overlay--visible', previewMode);

		// Dim tools in preview mode (not interactive)
		canvasTools.style.opacity = previewMode ? '0.3' : '';
		canvasTools.style.pointerEvents = previewMode ? 'none' : '';
	});


	// ── 6. Tool switching ───────────────────────────────
	document.querySelectorAll('.canvas-tool-btn[data-tool]').forEach(btn => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.canvas-tool-btn[data-tool]').forEach(b => b.classList.remove('canvas-tool-btn--active'));
			btn.classList.add('canvas-tool-btn--active');
			activeTool = btn.dataset.tool;
		});
	});


	// ── 7. Canvas overlays ──────────────────────────────

	// Safe area guides toggle
	document.getElementById('toggleSafeBtn').addEventListener('click', () => {
		safeAreasVisible = !safeAreasVisible;
		safeAction.classList.toggle('safe-guide--visible', safeAreasVisible);
		safeTitle.classList.toggle('safe-guide--visible', safeAreasVisible);
		document.getElementById('toggleSafeBtn').classList.toggle('canvas-tool-btn--active', safeAreasVisible);
	});

	// Navigation arrows toggle
	document.getElementById('toggleNavArrows').addEventListener('click', () => {
		navArrowsVisible = !navArrowsVisible;
		navArrowsOverlay.classList.toggle('nav-arrows-overlay--visible', navArrowsVisible);
		document.getElementById('toggleNavArrows').classList.toggle('canvas-tool-btn--active', navArrowsVisible);
	});


	// ── 8. Inspector toggle ─────────────────────────────
	function toggleInspector() {
		inspectorVisible = !inspectorVisible;
		inspector.classList.toggle('inspector--hidden', !inspectorVisible);
		editorBody.classList.toggle('editor-body--no-inspector', !inspectorVisible);
	}

	document.getElementById('toggleInspectorBtn').addEventListener('click', toggleInspector);
	document.getElementById('closeInspectorBtn').addEventListener('click', toggleInspector);

	// Map inspector close
	document.getElementById('closeMapInspectorBtn').addEventListener('click', () => {
		mapInspector.classList.toggle('inspector--hidden');
		mapEditorBody.classList.toggle('editor-body--no-inspector');
	});


	// ── 9. Template picker ──────────────────────────────
	document.getElementById('templateToggle').addEventListener('click', () => {
		templateOpen = !templateOpen;
		document.getElementById('templateList').classList.toggle('template-list--open', templateOpen);
		document.getElementById('templateChevron').classList.toggle('template-toggle__chevron--open', templateOpen);
	});

	document.querySelectorAll('.template-option').forEach(opt => {
		opt.addEventListener('click', () => {
			// Flash green to confirm selection
			opt.style.background = 'rgba(46,198,106,0.1)';
			opt.style.color = 'var(--brand-green)';
			setTimeout(() => { opt.style.background = ''; opt.style.color = ''; }, 600);
		});
	});


	// ── 10. Visual state chips ──────────────────────────
	document.querySelectorAll('.state-chip').forEach(chip => {
		chip.addEventListener('click', () => {
			document.querySelectorAll('.state-chip').forEach(c => c.classList.remove('state-chip--active'));
			chip.classList.add('state-chip--active');

			const state = chip.dataset.state;
			const selected = document.querySelector('.scene-btn--selected');
			if (!selected) return;

			// Update canvas button appearance to match state
			if (state === 'normal') {
				selected.style.borderColor = 'rgba(255,255,255,0.2)';
				selected.style.background = 'rgba(255,255,255,0.06)';
				selected.style.boxShadow = 'none';
			} else if (state === 'focus') {
				selected.style.borderColor = 'var(--brand-orange)';
				selected.style.background = 'rgba(255,170,64,0.08)';
				selected.style.boxShadow = '0 0 0 1px var(--brand-orange), 0 0 16px rgba(255,170,64,0.12)';
			} else if (state === 'activate') {
				selected.style.borderColor = 'var(--brand-green)';
				selected.style.background = 'rgba(46,198,106,0.1)';
				selected.style.boxShadow = '0 0 0 1px var(--brand-green), 0 0 16px rgba(46,198,106,0.12)';
			}
		});
	});


	// ── 11. Inspector ↔ canvas position sync ────────────
	['insp-x', 'insp-y', 'insp-w', 'insp-h'].forEach(id => {
		const input = document.getElementById(id);
		if (!input) return;
		input.addEventListener('input', () => {
			const selected = document.querySelector('.scene-btn--selected');
			if (!selected) return;
			const prop = { 'insp-x': 'left', 'insp-y': 'top', 'insp-w': 'width', 'insp-h': 'height' }[id];
			selected.style[prop] = input.value + 'px';
		});
	});


	// ── 12. Action editor sync ──────────────────────────
	document.getElementById('insp-action-type').addEventListener('change', updateActionSummary);
	document.getElementById('insp-action-target').addEventListener('change', updateActionSummary);

	function updateActionSummary() {
		const type = document.getElementById('insp-action-type').value;
		const target = document.getElementById('insp-action-target').value;
		document.getElementById('actionSummary').textContent = type + ': "' + target + '"';
		document.getElementById('actionBadge').textContent = type;

		// Update canvas button action badge
		const selected = document.querySelector('.scene-btn--selected');
		if (selected) {
			const badge = selected.querySelector('.scene-btn__action-badge');
			if (badge) {
				badge.textContent = type;
				badge.className = 'scene-btn__action-badge';
				if (type.startsWith('play')) badge.classList.add('action-badge--play');
				else if (type === 'showMenu') badge.classList.add('action-badge--menu');
				else badge.classList.add('action-badge--audio');
			}
		}
	}


	// ── 13. Connection click-to-jump ────────────────────
	document.querySelectorAll('.conn-entry[data-target-menu]').forEach(entry => {
		entry.addEventListener('click', () => {
			const targetMenu = entry.dataset.targetMenu;
			const menuItem = document.querySelector(`.menu-item[data-menu="${targetMenu}"]`);
			if (menuItem) {
				menuItem.click();
				// Flash highlight for feedback
				entry.style.background = 'rgba(34,211,238,0.1)';
				setTimeout(() => { entry.style.background = ''; }, 400);
			}
		});
	});


	// ── 14. Auto-navigation calculation ─────────────────
	// Mirrors Spindle's autoCalculateNavigation():
	// For each button, find the nearest button in each
	// cardinal direction based on centre-point geometry.

	function flashButton(el, duration) {
		el.classList.add('auto-nav-btn--flash');
		setTimeout(() => el.classList.remove('auto-nav-btn--flash'), duration);
	}

	function flashRecalc(el, duration) {
		el.classList.add('recalc-btn--flash');
		setTimeout(() => el.classList.remove('recalc-btn--flash'), duration);
	}

	function runAutoNav() {
		// In production: iterate all buttons, compute geometric
		// neighbours for up/down/left/right, update interaction graph.
		// For this mockup, just flash confirmation.

		flashButton(document.getElementById('autoNavAllBtn'), 800);
		flashRecalc(document.getElementById('recalcNavBtn'), 800);

		// Show nav arrows briefly if not already visible
		if (!navArrowsVisible) {
			navArrowsOverlay.classList.add('nav-arrows-overlay--visible');
			setTimeout(() => {
				if (!navArrowsVisible) {
					navArrowsOverlay.classList.remove('nav-arrows-overlay--visible');
				}
			}, 1500);
		}
	}

	// Toolbar "Auto Nav" button
	document.getElementById('autoNavAllBtn').addEventListener('click', runAutoNav);

	// Inspector "Recalculate" button
	document.getElementById('recalcNavBtn').addEventListener('click', runAutoNav);

	// Auto/Manual badge toggle
	document.getElementById('autoNavBadge').addEventListener('click', () => {
		autoNavEnabled = !autoNavEnabled;
		const badge = document.getElementById('autoNavBadge');
		badge.textContent = autoNavEnabled ? 'Auto' : 'Manual';
		badge.classList.toggle('auto-badge--on', autoNavEnabled);
		badge.classList.toggle('auto-badge--off', !autoNavEnabled);
	});


	// ── 15. Dynamic map SVG connections ─────────────────
	// Computes edge midpoints of actual card DOM elements
	// and draws bezier curves between them. Called when
	// map view is shown or layout changes.

	const mapConnections = [
		{ from: 'main-menu',      to: 'chapter-select',  type: 'show',   fromEdge: 'right',  toEdge: 'left' },
		{ from: 'main-menu',      to: 'audio-setup',     type: 'show',   fromEdge: 'right',  toEdge: 'left' },
		{ from: 'main-menu',      to: 'title-1',         type: 'play',   fromEdge: 'bottom', toEdge: 'top' },
		{ from: 'chapter-select',  to: 'main-menu',      type: 'return', fromEdge: 'left',   toEdge: 'right' },
		{ from: 'chapter-select',  to: 'title-1',        type: 'play',   fromEdge: 'bottom', toEdge: 'top' },
		{ from: 'audio-setup',     to: 'subtitle-setup', type: 'show',   fromEdge: 'bottom', toEdge: 'top' },
	];

	function getCardEdge(menuId, edge) {
		const card = document.querySelector(`.map-menu-card[data-map-menu="${menuId}"]`);
		const wrap = document.getElementById('mapCanvasWrap');
		if (!card || !wrap) return { x: 0, y: 0 };

		const cardRect = card.getBoundingClientRect();
		const wrapRect = wrap.getBoundingClientRect();

		// Positions relative to the map container
		const left   = cardRect.left - wrapRect.left;
		const top    = cardRect.top - wrapRect.top;
		const right  = left + cardRect.width;
		const bottom = top + cardRect.height;
		const midX   = left + cardRect.width / 2;
		const midY   = top + cardRect.height / 2;

		switch (edge) {
			case 'left':   return { x: left,  y: midY };
			case 'right':  return { x: right, y: midY };
			case 'top':    return { x: midX,  y: top };
			case 'bottom': return { x: midX,  y: bottom };
			default:       return { x: midX,  y: midY };
		}
	}

	function drawMapConnections() {
		const svg = document.getElementById('mapConnSvg');
		// Clear existing paths (keep defs)
		svg.querySelectorAll('path.map-conn-line').forEach(p => p.remove());

		// For each connection, compute a bezier curve
		mapConnections.forEach(conn => {
			const from = getCardEdge(conn.from, conn.fromEdge);
			const to   = getCardEdge(conn.to,   conn.toEdge);

			// Control point offset (determines curve shape)
			const dx = Math.abs(to.x - from.x);
			const dy = Math.abs(to.y - from.y);
			const offset = Math.max(dx, dy) * 0.4;

			let cp1x, cp1y, cp2x, cp2y;

			if (conn.fromEdge === 'right' && conn.toEdge === 'left') {
				cp1x = from.x + offset; cp1y = from.y;
				cp2x = to.x - offset;   cp2y = to.y;
			} else if (conn.fromEdge === 'left' && conn.toEdge === 'right') {
				// Return connections: curve upward to avoid overlap
				cp1x = from.x - offset; cp1y = from.y - offset * 0.5;
				cp2x = to.x + offset;   cp2y = to.y - offset * 0.3;
			} else if (conn.fromEdge === 'bottom' && conn.toEdge === 'top') {
				cp1x = from.x; cp1y = from.y + offset;
				cp2x = to.x;   cp2y = to.y - offset;
			} else {
				cp1x = from.x + offset; cp1y = from.y;
				cp2x = to.x - offset;   cp2y = to.y;
			}

			const d = `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;

			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', d);
			path.setAttribute('class', `map-conn-line map-conn-line--${conn.type}`);
			path.setAttribute('marker-end', `url(#arrow-${conn.type})`);
			svg.appendChild(path);
		});
	}

	// Redraw connections when map view becomes visible
	const origMapClick = document.querySelector('[data-nav-view="map"]');
	origMapClick.addEventListener('click', () => {
		// Wait for layout to settle
		requestAnimationFrame(() => requestAnimationFrame(drawMapConnections));
	});

	// Redraw on window resize
	window.addEventListener('resize', () => {
		if (currentView === 'map') drawMapConnections();
	});


	// ── 16. Background editing ──────────────────────────
	document.querySelectorAll('[data-bg-mode]').forEach(chip => {
		chip.addEventListener('click', () => {
			document.querySelectorAll('[data-bg-mode]').forEach(c => c.classList.remove('bg-mode-chip--active'));
			chip.classList.add('bg-mode-chip--active');

			const mode = chip.dataset.bgMode;
			document.getElementById('bgModeBadge').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);

			// Show/hide appropriate controls
			document.getElementById('bgSolidControls').style.display = mode === 'solid' ? '' : 'none';
			document.getElementById('bgImageControls').style.display = mode === 'image' ? '' : 'none';
			document.getElementById('bgVideoControls').style.display = mode === 'video' ? '' : 'none';
			document.getElementById('bgAudioControls').style.display = mode === 'audio' ? '' : 'none';

			// Update canvas background hint
			if (mode === 'video') {
				canvas.style.background = 'linear-gradient(160deg, #1a1828 0%, #0f0e1a 50%, #181520 100%)';
				canvas.style.boxShadow = '0 8px 40px rgba(0,0,0,0.5), inset 0 0 60px rgba(167,139,250,0.04)';
			} else {
				canvas.style.boxShadow = '';
			}
		});
	});

	// Colour input sync
	document.getElementById('bgColourInput')?.addEventListener('input', (e) => {
		document.getElementById('bgColourSwatch').style.background = e.target.value;
	});


	// ── 17. Generate menus ───────────────────────────────
	// Simulates auto-generation (GitHub issue #20).
	// In production: calls Rust backend to slice project
	// entities into paginated groups, then spawns
	// MenuDocument scenes with pre-wired navigation.

	document.querySelectorAll('[data-generate]').forEach(btn => {
		btn.addEventListener('click', () => {
			const type = btn.dataset.generate;
			btn.classList.add('generate-flash');
			setTimeout(() => btn.classList.remove('generate-flash'), 800);

			// Simulate adding a menu to the list (visual feedback)
			const detail = btn.querySelector('.generate-btn__detail');
			if (detail) {
				const origText = detail.textContent;
				detail.textContent = 'Generated!';
				setTimeout(() => { detail.textContent = origText; }, 1200);
			}
		});
	});


	// ── 18. Collapsible inspector sections ──────────────
	// Each section toggles independently via its header.
	// Expand All / Collapse All buttons affect all sections
	// in the currently visible inspector.

	document.querySelectorAll('.insp-section__header').forEach(header => {
		header.addEventListener('click', (e) => {
			// Don't toggle when clicking interactive children (badges, auto-nav toggle)
			if (e.target.closest('.auto-badge') || e.target.closest('.badge')) return;
			const section = header.closest('.insp-section');
			section.classList.toggle('insp-section--open');
		});
	});

	document.getElementById('expandAllBtn')?.addEventListener('click', () => {
		document.querySelectorAll('#inspectorBody .insp-section').forEach(s => s.classList.add('insp-section--open'));
	});

	document.getElementById('collapseAllBtn')?.addEventListener('click', () => {
		document.querySelectorAll('#inspectorBody .insp-section').forEach(s => s.classList.remove('insp-section--open'));
	});


	// ── 19. Button style state tabs ─────────────────────
	document.querySelectorAll('.style-state-tab').forEach(tab => {
		tab.addEventListener('click', () => {
			document.querySelectorAll('.style-state-tab').forEach(t => t.classList.remove('style-state-tab--active'));
			tab.classList.add('style-state-tab--active');
			// In production: switch which state's styles are shown in the controls below
		});
	});


	// ── 20. Text style alignment buttons ────────────────
	document.querySelectorAll('.align-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('align-btn--active'));
			btn.classList.add('align-btn--active');
		});
	});

	// Text style toggle pills (bold, italic, underline)
	document.querySelectorAll('.style-pill').forEach(pill => {
		pill.addEventListener('click', () => {
			pill.classList.toggle('style-pill--active');
		});
	});


	// ── 21. Highlight mode toggle ───────────────────────
	document.getElementById('highlightModeSelect')?.addEventListener('change', (e) => {
		const animControls = document.getElementById('highlightAnimControls');
		if (animControls) {
			animControls.style.display = e.target.value === 'Animated' ? '' : 'none';
		}
	});


	// ── 22. Keyboard shortcuts ──────────────────────────
	document.addEventListener('keydown', (e) => {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

		switch(e.key.toLowerCase()) {
			case 'v': document.querySelector('[data-tool="select"]')?.click(); break;
			case 't': document.querySelector('[data-tool="text"]')?.click(); break;
			case 'b': document.querySelector('[data-tool="button"]')?.click(); break;
			case 'i': document.querySelector('[data-tool="image"]')?.click(); break;
			case 'r': document.querySelector('[data-tool="shape"]')?.click(); break;
			case 's': document.getElementById('toggleSafeBtn')?.click(); break;
			case 'n': document.getElementById('toggleNavArrows')?.click(); break;
			case 'p': document.getElementById('previewToggle')?.click(); break;
			case 'a': runAutoNav(); break;
			case 'm':
				// Toggle between Editor and Map views
				const target = currentView === 'editor' ? 'map' : 'editor';
				document.querySelector(`[data-nav-view="${target}"]`)?.click();
				break;
			case 'escape':
				if (previewMode) {
					document.getElementById('previewToggle')?.click();
				} else {
					document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('scene-btn--selected'));
					document.getElementById('inspectorName').textContent = '(No selection)';
				}
				break;
		}
	});
})();
