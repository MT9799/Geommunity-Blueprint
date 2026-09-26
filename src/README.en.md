# Geommunity Blueprint

[中文](../README.md) | [English](#)

A geometry-construction playground that runs entirely in the browser: solve the bundled levels, draw freely on the board, build your own problems, and let the built-in solver work out a construction for you. No dependencies, no install — **just open the page**.

> Live site: <https://mt9799.github.io/Geommunity-Blueprint/>

---

## The four workspaces

| Workspace | What it is for |
| --- | --- |
| **Board** | Free drawing with every tool unlocked — sketch and study constructions. |
| **Levels** | Play the bundled levels (346 of them); match the `L / E` step limits to clear a level. |
| **Maker** | Create your own problem: mark the givens and the goal, then test-play it. |
| **Solver** | Give a few figures and let the program find a construction that meets the goal. |

---

## Interface and gameplay

### Level list and search

- The pack overview page and each pack page have a search box at the top; tapping it opens the search page. Space-separated terms are combined with AND, and you can search titles, subtitles, keywords and L / E steps (`5L`, `6E`, `5` all work). Suggested searches come with hit counts; entering from a pack page searches inside that pack by default.
- Level lists show 20 levels per page, and the page number lives in the `page` query parameter, so a single page can be linked or bookmarked.
- **Going back from a level returns you to where you were**, not to the top of the list (pack, search terms and page number each remember their own position). Going up one more level discards it.

### Playing a level

- **Goal**: produce the level's `result`; the matching figures light up in gold on the canvas. When the thumbnail is collapsed, the level's target (e.g. `5L 6E`) shows in a small badge on the top-left of the diagram — black while unmet, gold once met. Opening the thumbnail moves that line next to "Target:" followed by the done / L / E / V ticks (black while unmet, gold once met).
- **On phones**: the thumbnail moves to the row under the top-right buttons so it never covers undo / redo; the tool panel has the same height as its buttons, and the L / E counters, construct-tab badge and completion card all shrink with the screen. The completion card's width is computed from the screen too (on narrow screens the four ticks stay on one line instead of wrapping over the image).
- **L / E only light up after you produce a solution** (as long as the goal is unmet, few steps don't count). Once produced they stay lit even if you later exceed the limits (the step line gets a "reached before" mark). If the goal leaves the canvas (undone, canvas cleared), the ticks go out and the record is cleared; producing it again re-evaluates.
- **Completion card**: slides in each time you genuinely produce another solution, showing your steps against the target (e.g. `L 1 / 5 ✓　E 1 / 6 ✓`); it retracts after 5 seconds, and immediately when you undo back to an unsolved state.
- **Viewing answers**: the "View answers" menu item asks for confirmation, then lists the recorded solution diagrams for that level (tap one to zoom). Levels without recorded answers have the menu item greyed out, and tapping it explains why.
- **Tool restrictions**: some levels are straightedge-only (move, point, line, intersection) or compass-only (move, point, circle, intersection) — the toolbar then only offers the allowed tools. Unrestricted levels get everything.
- **Undo**: if a tool is half-way through (a translucent preview is following the cursor), undo **only cancels that half-finished construction**; it won't also undo your previous step. While a construction is in progress the undo button is enabled even with no history.
- **Clear canvas / restart level**: discard the current drawing, restore the level's initial figure and reset progress.
- **Explore view**: shows the other set of content described by the gmt's `explore=`; figures you draw in the explore view are kept and survive switching back and forth, while the level's own solution figures stay hidden.
- **Design mode**: reveals every hidden figure in the level and marks the givens and goals for you, handy for editing the problem or studying the construction.
- **Open the solver**: only available once you have produced at least one solution (otherwise the menu item is grey and tapping it explains why). The whole figure is carried over (including the parts hidden in the level), and only the "given" and "goal (judged)" marks are kept.

### Maker and solver

- **Marking tools** live in the top menu bar: "Mark given" offers given / labelled given / movepoints, and "Mark goal" offers goal (judged) / goal (shown) / explore (shown). After opening one, the toolbar turns into a row of options; switching back to any tool category leaves marking mode.

  | Tool | Option | Option colour | On the canvas | Exported to gmt |
  | --- | --- | --- | --- | --- |
  | Mark given | given (default) | black | black | `initial=` |
  | | labelled given | black | black + label; a naming dialog appears (leave empty to use the object name; a single letter / digit only) | `named=` |
  | | movepoints | blue | blue | `movepoints=` |
  | Mark goal | goal (judged, default) | gold | gold | before the `result=` colon |
  | | goal (shown) | gold | gold | after the `result=` colon |
  | | explore (shown) | gold | gold | `explore=` |

- **What turns gold**: by default only the figures marked as "goal (judged)" are gold; selecting "goal (shown)" highlights just the corresponding display figures, and "explore (shown)" highlights the explore objects. The given / movepoint colours (black / blue) are always kept — switching the highlight range only moves the gold around, it never turns a given figure back to grey / red.
- **Marked objects**: the mark panel lists them grouped by given / goal / explore. Click an object on the canvas to add or remove its mark; the ✕ next to a group clears every mark in it (including explore and the extra solutions, and collapses the solution count back to 1).
- **Only draggable free points can be movepoints**: trying to mark a point that follows other objects (intersection, point on an object, midpoint …) shows a notice at the top explaining why it can't be marked.
- Points drawn in the maker and solver are unlabelled by default (you can turn labels on in "Point style"); labelled givens still show their own labels.
- **Multiple solutions**: after selecting "Mark goal" or "goal (shown)", a solution selector appears in the switch bar: `1`, `+`, `−` by default. Tap a number to switch the active solution, `+` adds a group and `−` removes the last one (together with its marks).
- **Import / export gmt**: the "Export gmt" menu item lets you view the code, download a file or file an issue; "Import gmt" accepts pasted code or a file.
- **Loading can be undone step by step**: when a level is loaded, a gmt is imported, or figures are carried from the play page into the maker, the loaded figures count as having been constructed one by one — undo peels them off from the last object to an empty canvas, instead of only jumping back to the state before loading.
- The **solver** only needs the "given" and "goal (judged)" marks (its mark panel has just those two sections), shown in gold.
- **On phones the panels move into a bottom sheet**: two round buttons sit in the top-left of the canvas — the upper one is "Marked objects" (the given / goal / explore groups) and the lower one is "Solver parameters" (only in the solver). Tapping a button pulls its sheet up from the bottom; the ✕ in the sheet's title bar retracts it. On desktop the two panels stay floating over the canvas as before.
- The **solver panel** (inside the sheet) sets the maximum number of steps, the tools available (compass & straightedge / straightedge only / compass only), the time limit and how many solutions to look for; then press "Start".
- **The search treats only objects marked as "given" as known**: opening the solver merges the level's "given / labelled given / movepoints" into a single "given" section (for the search they are all just "what the problem provides") — so figures the level **hides or pre-draws** (say a hidden midpoint) never slip into the conditions and can't produce fake solutions that use points the problem never gave (e.g. 4E on a level whose real bound is 5E). With no given marks at all (drawing directly on the solver page) every object except the goal counts as a condition.
- **The goal is whatever is marked "goal (judged)"** — a line, a circle, a point, or several at once.
- **Solutions are drawn on the canvas** in magenta, step by step (which line, circle or intersection came at which step). When several solutions are requested the right-hand side lists "Solution 1 (N steps) …"; picking one switches to it, "previous / next step" walks through it manually (stepping back removes the last figure drawn, with "step k / n" shown next to it), and "Clear solution" removes them. The solution is only an overlay: it can't be selected or exported, and it never touches your own drawing.
- **Solutions follow the figure**: the magenta overlay is not a fixed picture but is re-evaluated from the construction steps in real time — drag a given point (or the endpoint of a given line) and the circles, lines and intersections it built move with it, which makes it easy to check whether a construction really holds. If a step can't be built at the current position (say two circles no longer meet), that step's figure **disappears for the moment** (matching how the board treats invalid objects) and grows back when you drag it home.
- **Text steps**: each solution has a "Text steps" button that opens a Chinese explanation — which objects are known, which circle at which step is centred where and through which point (or which two points a line passes through), which point each pair of lines meets at, and which line / point the goal maps to. The search outputs a construction, not a proof, so the text says "how", never "why it works".
- **The step limit is the number of steps you ask for**: the search returns as soon as it finds something, so it does not guarantee the shortest solution — ask for fewer steps to get shorter ones. When the time limit runs out it stops and reports how many solutions it found. While searching the button becomes "Stop"; pressing it again interrupts the search instead of waiting for the time limit.
- **Coming from a level / test-play and going back**: the back button returns you to where you came from and restores the previous state (figures, marks, steps) — a round trip never loses your work.
- **Test-play**: the page behaves exactly like playing a level — only the givens are shown and everything else (including the solution) stays hidden until you produce it or the goal check passes. Going back to the maker restores the editing state, so the problem you just drew is not lost.
- **Credits**: the solver's search core was developed by [Ander](https://github.com/Aricler-Ander) and zzzzzz; this project uses its JavaScript port.

### Tools and styles

- **Tool categories**: the top bar is split into general / point / line / circle / construct. The little badge on the construct button always shows the advanced tool currently selected in that category.
- **Style brush** (maker / solver: in the general tab, right next to the eraser): first pick a figure as the **style source**; every figure you pick afterwards copies its **colour, width (point size) and label visibility**. Clicking empty space does nothing.
- **Switch line type** (maker / solver: last in the line tab): once selected, clicking a line, ray or segment on the canvas changes it to the next type (line → ray → segment → line); the cursor is a ring while this tool is active.
- **Identical figures are never drawn twice**: if the line or circle about to be created already exists on the canvas (only the figure itself is compared, not how it was built), the construction is cancelled — nothing is added and play mode doesn't count a step. So "connect AB again", dropping a point on `a` to draw a parallel to `a`, or using the three-point compass with centre A and radius AB all fail to create a second copy. Lines, rays and segments don't count as duplicates of each other (a line and a ray on the same line are two different figures).
- **The three-point compass's third point (the centre) may coincide with the first two**: to draw the circle centred at A with radius AB, just tap A or B as the third click (the first two still can't be the same point).
- **Dragging figures directly**: with the move tool, if a figure's defining points are **all free points** (points defined by coordinates), dragging it translates the whole figure — those defining points move together and the lines, circles, etc. built from them follow. If any defining point is fixed (intersection, point on an object …) or still carries other figures, dragging pans the canvas instead.
- **Switching tools clears the half-finished selection of the previous tool**, so switching back never finds the previously picked figure still attached; re-selecting the current tool keeps it (it won't clear what you are picking).
- **Undo / redo**: each style-brush step, figure drag and line-type switch is recorded separately and can be stepped back one at a time.

### Canvas, cursor and preview

- **The canvas zooms and pans without any practical limit**; the initial view is fairly wide, and "Reset view" recentres it if you get lost.
- **Cursor hints**: near an object the cursor becomes a finger and a "name · type" hint floats up showing what a click would select; over empty space it is a four-way arrow (drag to pan the canvas); while panning with the middle button it is a grabbing hand; with a half-finished construction it is a cross.
- **Preview point**: construction tools show a translucent preview point styled like a point figure, following the cursor and **snapping**:

  | Priority | Snaps to |
  | --- | --- |
  | 1 | an existing point, or the intersection of two figures (**including "hidden intersections" that have no point object yet**); if both are in range, the nearer one wins |
  | 2 | otherwise, the nearest line / circle (this is where the point tool drops a point on an object) |

- **The figure is drawn wherever the preview point snapped**: both the draft line and the final point follow the snap position, so you can draw straight onto a hidden intersection — including "the last point lands on a hidden intersection", which never ends up unable to place a point or draw a figure.
- **Who gets picked when objects overlap**: points beat segments, segments beat rays, rays beat lines, and circles come last (intersections often sit on lines / circles, hence points first). Several points at the same spot: a **draggable free point** wins, the rest are taken in **reverse construction order** (the most recently drawn first); this only affects what the mouse picks, not drawing order.
- **Delete button under the move tool**: once the move tool has selected an object the trash button in the switch bar lights up; tapping it deletes the object together with **all objects built from it**, and the deletion can be undone.
- **The circle-centre tool** ignores the cursor position and previews the centre of the circle the cursor is near, styled like the point preview; it disappears when you leave the circle.
- **Free points are never treated as special points**: a free point that happens to lie on (or very near) a line or circle is still an ordinary free point — judgements like "a circle's defining point" only accept points that were really constructed (point on an object, intersection …), so a coincidental position never changes which intersection is picked (otherwise an intersection would suddenly jump to the other side while dragging).
- **Copy compass**: pick a circle first, then the centre follows the cursor and the radius is the picked circle's radius.
- **The two-line angle bisector** never shows a preview point under the cursor; after picking the first line, both bisectors are previewed once you approach the second line.
- Previews **vanish immediately when leaving the object**, leaving no ghost (the circle-centre tool redraws as soon as it leaves the circle, the bisector as soon as it leaves the second line).
- Notices and confirmations use the site's own styling (top notice bar and in-page dialogs), never browser alert boxes.

### Other

- **Help**: "Menu → Help" in all four workspaces (board, levels, maker, solver) explains the current screen, and hovering the menu and buttons fills the information bar with a description.
- **Project notes**: the "Project notes" button at the top-right of the home page fetches this file and renders it as a dialog in the site's style.
- **Chinese / English**: switchable from the top-right of the home page; the choice is remembered.
- **L / E / V**: L and E are the step requirements (e.g. `5L / 6E`) and V means multiple solutions (produce them all). Single-solution levels don't show V, and a tick is hidden when there is no matching target.

---

## Advanced: running locally and authoring levels

> The rest is aimed at contributors / problem authors who want to **run the site themselves**, **add or remove levels**, or **edit gmt directly**. Regular players can stop here.

### Local preview and deployment

Run `python -m http.server 8000` in the repository root, then open `http://localhost:8000`. For GitHub Pages, publish from the repository root.

The root `package.json` only carries two convenience scripts: `npm start` (start a local static server) and `npm run check` (syntax-check the scripts).

### Where the level data lives

| Path | Contents |
| --- | --- |
| `data/levels/<pack id>/<3-digit index>.<level id>.gmt` | the GMT figure definition of each level |
| `data/diagrams/<pack id>/<3-digit index>.<level id>.png / .jpg` | the level diagram (list thumbnail) |
| `data/packcovers/<pack id>.png / .jpg / .webp` | pack covers (the large image on the left of an overview card) |
| `data/levelpacks.json` | the **pack** list (10 packs) |
| `data/levels.json` | the flat **level** list (345 levels) |
| `data/answers/<pack id>/<3-digit index>.<level id>/…` | recorded solution diagrams (one folder per level; file names are the star labels such as `5L.png` / `6E.png`) |

**The level id is the short name**: `ewp11`, `xmath2020-1`, `Conway Circle`, `inc-circumc-re-trapezoid` and so on — no more `pack:dir/file.gmt` paths. The file name, diagram and answer folder all use the same id. In the `c-s-pzls-other`, `euc-addit`, `from-baidu-tieba` and `straightedge-only-pzls` packs all three carry a **3-digit index matching the order shown on the site** (`001.xxx.gmt` / `001.xxx.png` / `answers/<pack id>/001.xxx/`), so the directory lines up with the number in the level list; the other packs (`ewp`, `xmath`, `mingjing-forum`, `xeuclidea-puzzle`, `sprfes`, `xewpc`) carry no index. Looking up anything about a level only needs its id. The id derives from the title: strip a trailing `(5,6,2)` L / E / V bracket and a leading `025.` index, turn `_` into `-`, and lowercase the whole string when it has no spaces (`EWP11` → `ewp11`, `XMath2020_1` → `xmath2020-1`); English titles that already read well are kept as they are (`Conway Circle`, `Malfatti's Problem`). For levels with a Chinese title the first gmt line (`#name`, the author's own English short name such as `#double_degrees`) is used; only when that is Chinese too is a fresh short name invented (`重叠大小地图` → `OverlapMaps`). Duplicates inside a pack are told apart by the directory number in the source material (`EWP53` and `EWP289` share a title → `ewp53` / `ewp289`; `SprFes` has an `01`–`05` set in each of two years → `sprfes2024-01` / `sprfes2025-01`; `XEP18` and `XEP18 (2)` → `xep18` / `xep18-2`).

The two JSON files each own one thing and there is no extra override table: one describes packs, one describes levels, and the pages read them directly.

### Adjusting level information

Edit those two files directly — whatever you write there is what the page shows; anything you leave out falls back to a page default.

**`data/levelpacks.json` (packs, an array; the order is the overview order)**

| Field | Purpose | When omitted |
| --- | --- | --- |
| `id` | pack id (the `pack` field of a level refers to it) | — |
| `name` | pack name (overview card, level list title) | — |
| `description` | pack description (overview card, level list subtitle) | card: "Geometry problems from the source archive."; list: "N levels — pick one to start." |
| `cover` | overview card cover (relative to `data/`; any image path) | tries `data/packcovers/<pack id>.png` / `.jpg` / `.webp` in turn |
| `icon` | fallback image when no cover is found (relative to `data/`) | the pack's first level that has a diagram |
| `source` | where the material came from, for reference only | — |

**`data/levels.json` (levels, a flat array; the order inside a pack is the list order)**

| Field | Purpose | When omitted |
| --- | --- | --- |
| `id` | level id (short name, also the file name) | — |
| `pack` | owning pack id | — |
| `file` | GMT file path (relative to `data/`) | — |
| `title` | level title (list, level-page thumbnail title, page title) | — |
| `subtitle` | description inside the level-page thumbnail | hidden; entering through the board's "Test play" defaults to "GMT loaded" |
| `targetSteps` | steps (right of the list, bottom of the level page), e.g. `5L / 6E` | the list shows "steps not recorded" |
| `number` | index in the list | generated as `001`… in order |
| `diagram` | diagram path (relative to `data/`) | the list shows a ◇ placeholder and the card has no image |
| `note` | hover hint on the level list row | none |
| `tools` | tool restriction: `"straightedge"` or `"compass"` | unrestricted, all tools |
| `keywords` | keywords used by search | search only looks at title and `subtitle` |
| `solutions` | recorded solution diagrams: `[{"file": "answers/<pack id>/…", "star": "5L"}, …]` (`file` relative to `data/`) | no recorded answers ("View answers" greyed out) |

> The `subtitle` of the `ewp` and `xmath` packs has already been filled in bulk (taken from the problem statements in the source archive); to change one, just edit that level's `subtitle`.

Example (one entry of `data/levels.json`):

```json
{
    "id": "ewp11",
    "pack": "ewp",
    "title": "EWP11",
    "subtitle": "A point A lies inside the circle; draw a chord through A whose length equals the radius.",
    "targetSteps": "5L / 6E",
    "diagram": "diagrams/ewp/ewp11.png",
    "file": "levels/ewp/ewp11.gmt",
    "keywords": ["EWP", "chord", "radius", "multi-solution"],
    "solutions": [
        {"file": "answers/ewp/ewp11/5L.png", "star": "5L"},
        {"file": "answers/ewp/ewp11/6E.png", "star": "6E"},
        {"file": "answers/ewp/ewp11/2V.png", "star": "2V"}
    ]
}
```

**Adding a pack / level**: put the `.gmt` and its diagram into `data/levels` and `data/diagrams`, then add a pack to `levelpacks.json` and a level to `levels.json`. If you generate them with a script, keep the display fields (`name` / `description` / `icon` / `title` / `subtitle` / `number` / `note`) instead of overwriting them.

There are currently **47 levels** with a tool restriction (43 straightedge-only and 4 compass-only); the whole `extra-straightedge-only-pzls` pack (36 levels) is straightedge-only.

> `data/diagrams/ewp/` still holds 5 old problem images that were never used (`EWP021__Def.png` / `EWP049__Def.png` / `EWP066__Def.png` / `EWP088__Def.png` / `EWP091__Def.png`; these levels are not in `levels.json`), they are referenced by nothing and were never renamed — delete them if you like.

### About the source material

The problems and solution diagrams come from material collected by the "Geommunity Blueprint" authoring project: one folder per level, containing the problem image, the best solution known at the time and the gmt code (solutions of unofficial problems live in a separate `Solutions` folder so players can think first). To use a gmt file, open the game's apk and overwrite the matching level file under `res/raw` as text; install and play.

That material has been organised into `data/` as described above: gmt under `data/levels/`, problem images under `data/diagrams/`, solution diagrams under `data/answers/`, with file and directory names replaced by the level's short id; the `source` field of `levelpacks.json` keeps the original directory name as a reference. Copyright of the material and the solution diagrams belongs to their original authors.

> `solutions` was compiled from the levels' original directories: answer images come from the level folder, a `Solutions` subfolder, or the pack-level `Solutions/<same-named directory>`, sorted by star label (5L / 6E / 2V), and problem images (`Def`) or explanatory images don't count. When imported into `data/answers/` they are reorganised as "one folder per level" (`answers/<pack id>/<level id>/5L.png`), and levels that shared one original answer directory (such as `SprFes`'s `Solutions/`, several XEP groups) each got their own copy — so **every image inside a level folder now belongs to that level**; when one star label shares an image, two `solutions` entries pointing at the same file are kept. Follow the same rule after adding levels.

### How GMT maps onto the board

Levels and the board's "Import gmt" share one parser. For the syntax see ggb2gmt's "ggb and gmt file structure and syntax".

**Pre-drawn commands**

| gmt | Base on the board | Notes |
| --- | --- | --- |
| `A=[x,y]` | free point | coordinates match gmt (y axis points down) |
| `Line[A,B]` / `Segment[A,B]` / `Ray[A,B]` | line / segment / ray | the order of the defining points is the direction of the line |
| `Circle[A,B]` | circle (two-point base) | A is the centre, B lies on it |
| `Compass[A,B,C]` | circle (compass base) | centre C, radius AB |
| `Circle3[A,B,C]` | circle (three-point base) | through A, B, C |
| `EdgePoint[s,x]` | point at infinity | the imaginary point on line s in the negative (`x=0`) / positive (`x=1`) direction. Constructions use its exact direction (`Line[A,E]` is the parallel through A, `Segment[E,H]` is the half-line from H, `CopyAngle` treats E as one side), and the point itself is **never drawn** |
| `PolarPoint[s,c]` | pole | the pole of line s with respect to circle c (inverse of the polar line) |
| `Intersect[object1,object2,x]` | intersection | see "Intersection indexing" below |
| `Linepoint[object,x]` | point on an object | see "How the parameter is computed" below |
| `Midpoint[A,B]` | midpoint | |
| `Perp[A,s]` / `Parallel[A,s]` | perpendicular / parallel | |
| `PBisect[A,B]` | perpendicular bisector | |
| `ABisect[A,B,C]` | angle bisector | B is the vertex (gmt only has the three-point form) |
| `CenterPoint[c]` | circle centre | case-insensitive (`Centerpoint` works too) |
| `Tangent[A,c,x]` | tangent | tangents to circle c through A; only one when A is on the circle; `x` counts counter-clockwise from the centre towards A |
| `PolarLine[A,c]` | polar line | perpendicular to the centre line, distance r²/｜CP｜ from the centre |
| `CopyAngle[A,B,C,D,E]` | copied-angle ray | vertex E, with D a point on one side |
| `FixAngle[A,B,x]` | fixed-angle ray | vertex A, starting side AB, rotated counter-clockwise by x degrees |

`ShiftSeg`, `ABisect[two lines]`, `Tangent[two circles]` and `rules` (constraints) are not supported yet: those objects are dropped together with everything that depends on them, while the rest parses normally (none of the current 346 level files uses `ShiftSeg` or the two-circle tangent). Trailing comments (`assignment # comment`) and mixed-case command names are recognised; a few files have individual objects that are degenerate at their initial position (three collinear points, a point inside a circle …) and therefore can't be drawn for the moment.

**How the parameter is computed (`Linepoint[object,x]`)**

Points on a circle use radians from the positive x axis (clockwise positive, matching the canvas); points on a line use multiples of the defining points' distance, per line type:

| Line type | Meaning of `x` |
| --- | --- |
| line / ray / segment | the first defining point is the origin, one unit = the distance between the two defining points |
| parallel | the defining point is the origin (`x=0` is the defining point) |
| perpendicular | the parameter starts one unit before the defining point (`x=1` is the defining point `A`, `x=0` is one unit back from `A` along the perpendicular) |
| perpendicular bisector | centred at the midpoint M of AB, starting from A rotated 90° clockwise |
| angle bisector | starts at the vertex, and one unit changes with the figure — see below |
| tangent | one unit = the radius of the tangent circle |

**How long one unit of an angle bisector is**: not a fixed 100. Draw the perpendicular to the bisector through the vertex and take the **smallest** of "the distances from the defining points on the two sides of the angle to that perpendicular" and "50 canvas units"; **twice** that value is one unit.

| Distance from a side point to the perpendicular through the vertex | One unit |
| --- | --- |
| both above 50 | 100 |
| one of them 40 | 80 |
| very wide angle, both sides close to the perpendicular | shrinks accordingly, so the distance from the vertex for the same `x` gets shorter |

Write `x` in gmt following that convention; points clicked on the board use the same conversion, so "what you draw" and "what a loaded level contains" agree.

**Intersection indexing (`index`)**

The third argument of `Intersect` is the intersection's identity, and the board computes and stores it with the same convention (so an intersection never jumps to the other candidate when the figure moves):

* line and line: a single intersection, `x=0`;
* line and circle: candidates are ordered along the **direction of the line** (first defining point → second defining point) and numbered as measured in the original game:
  * **the first `Intersect` on the same pair of bases always takes the "non-defining" candidate** — writing `x` as 0 or 1 makes no difference (with `c1=Circle[A,B]`, `s1=Line[B,A]`, both `E=Intersect[c1,s1,0]` and `F=Intersect[c1,s1,1]` land on A);
  * **the second and later ones** take `x` literally (same example with `s1=Line[A,B]`: `E=Intersect[c1,s1,0]` is A and `F=Intersect[c1,s1,1]` is B);
  * "defining point" means **the radius endpoint of the circle** (`B` in `Circle[A,B]`); a line's own defining points don't count — so when a line is drawn through a point on the circle that known point is still an eligible candidate;
* circle and circle: candidates are ordered counter-clockwise starting from **centre of object 1 → centre of object 2**, with the same numbering rules as line/circle (the first `Intersect` takes the non-defining candidate, later ones take `x`). With `a=Circle[A,B]`, `b=Circle[C,B]` (B is a defining point of both circles, hence one of the intersections): `D=Intersect[a,b,0]` and `E=Intersect[a,b,1]` give `D=not B, E=B` when B lies on one side of the centre line and `D=E=not B` on the other; writing the two lines the other way round (1 first, then 0) gives exactly the mirrored result. With only one line, both 0 and 1 give the "not B" point;
* **the chosen candidate's identity is remembered** (it never jumps): once an intersection is computed, its identity — "the one coinciding with a defining point" or "the other one" — is recorded and preferred on every recomputation. So dragging a figure, or even dragging B across the centre line, never makes the intersection suddenly switch;
* a line's own **direction** must match the table above, otherwise the numbering is inverted: lines / segments / rays use first defining point → second defining point; perpendiculars and perpendicular bisectors use "the reference line's direction rotated 90° clockwise"; angle bisectors use the opening direction of the angle; parallels share the direction of the line they are parallel to; tangents start from the tangent point;
* **candidates are filtered by range before numbering**: an intersection on a segment / ray can only be the one inside its range, and candidates outside it must not consume an index (`Intersect[ray,circle,0]` means the intersection in the ray's direction). When no candidate is in range the original list is kept, the index is used as usual and the result is marked "invalid but not deleted", so an intersection that temporarily leaves the line while dragging doesn't jump to the other point;
* the fourth argument (such as the `F` in `Intersect[s3,c2,1,F]`) is **the intersection already known**, excluded before applying `x` (it may be omitted or written as `-`); that exclusion survives undo and save/load.

Once an `index` is configured the intersection is "remembered": when the range of a segment or ray changes so that the intersection leaves it (or the two objects stop intersecting) the point becomes **invalid but is not deleted** (not drawn, not used in constructions) and recovers automatically when they intersect again. Intersections created with the intersection tool pick the candidate nearest the click.

**Setting lines**

| gmt | Purpose |
| --- | --- |
| `initial` | objects shown initially (black, unlabelled) |
| `named` | labelled initial conditions (also shown initially). In `named=A.M`, `A` is the variable name and `M` is the label to display; with just `A` the label is `A` |
| `hidden` | objects hidden while solving (never drawn on the board) |
| `movepoints` | movable points: they appear when the move tool is selected (and can be dragged), and are hidden again when you switch tools |
| `result` | the goal; several lines are allowed (multiple solutions). In `a:b,c,d` the part before the colon is what is **judged** and after the colon what is **shown once it is solved** (used when a line is judged but a segment shown); without a colon the judged objects are shown themselves. After every figure is produced a check runs: as soon as all judged objects of any single `result` line exist the level is cleared and the corresponding figures are shown (gold); producing several counts as multiple solutions. Only figures the player drew count — objects pre-drawn in the level file don't |
| `explore` | what is highlighted in gold in the explore view, independent of the display part after `result`'s colon |
| `rules`, `ver`, `check_level` | skipped by the parser (`rules` constraints are not implemented yet) |

**Multiple-solution marks**: solution 1 uses `result`, solution k uses `result k` (`result2`, `resultShown2` …); when importing / exporting, each `result=` line is one solution. The exported format is fixed at "one `result=judged:shown` line per solution", **with an empty line kept for an empty solution** (the line number is the solution number); the setting lines `initial=` / `named=` / `movepoints=` / `result=` / `explore=` are always written whether or not anything is marked, left empty when there is nothing, which makes them easy to compare and edit by hand.

**A few display rules that match the files**

* only `initial` and `named` objects are shown at first; "solutions" pre-drawn in the gmt are hidden (the board's "Import gmt" does the opposite and shows everything, which is convenient for editing);
* labels go only to `named` objects; objects in `initial` show their figure but no label;
* after a level loads, the initial figure is centred automatically (the canvas origin is at the top left, gmt coordinates are centred on the figure);
* point objects are drawn above lines and circles; among line objects segments sit above rays which sit above lines, regardless of the order they were drawn in;
* in the maker / solver an object's "style colour" and "mark colour" are separate: marking it as given / goal switches it to black / gold, and unmarking returns it to its own style colour (free points red, other points and lines / circles grey);
* coordinate-defined points and points on an object listed in `initial` / `named` can be dragged just like movepoints (they are shown in blue while the move tool is selected and return to normal when it is deselected).
