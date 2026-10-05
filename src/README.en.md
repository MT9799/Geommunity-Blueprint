# Geommunity Blueprint

[中文](../README.md) | [English](#)

A geometry-construction playground that runs entirely in the browser: solve the bundled levels, draw freely on the board, build your own problems, and let the built-in solver work out a construction for you. No dependencies, no install — **just open the page**.

> Live site: <https://mt9799.github.io/Geommunity-Blueprint/>

---

## The four workspaces

| Workspace | What it is for |
| --- | --- |
| **Board** | Free drawing with every tool unlocked — sketch and study constructions. |
| **Levels** | Play the bundled levels; match the `L / E` step limits to clear a level. |
| **Maker** | Create your own problem: mark the givens and the goal, then test-play it. |
| **Solver** | Give a few figures and let the program find a construction that meets the goal. |

---

## Interface and gameplay

### Level list and search

- The pack pages and the search page search titles / subtitles / keywords / steps (`5L`, `6E`, `5` all work); space-separated terms are ANDed, and entering from a pack searches that pack by default.
- Lists show 20 levels per page; going back from a level returns you to where you were.

### Playing a level

- **Goal**: produce the level's `result` (it lights up in gold) to solve the level. The target (e.g. `5L 6E`) shows on the thumbnail — black while unmet, gold once met: **L** counts tool uses (advanced tools count 1L), **E** counts basic figures (lines and two-point circles), and multi-solution levels also need every solution (V). **L / E only light up once you have produced a solution**; if the goal leaves the canvas (undone, cleared) the ticks go out and reset.
- **Completion card**: slides in each time you genuinely produce another solution (your steps against the target, e.g. `L 1 / 5 ✓　E 1 / 6 ✓`), and retracts after 5 seconds or when you undo back to an unsolved state. "View answers" lists the recorded solution diagrams for the level: **tap one to open it full screen** (the same viewer as the level diagram — click anywhere to close). In the dialog the thumbnails run three to a row (also on phones) and **Close** stays pinned to the bottom of the dialog, which only scrolls the gallery.
- **Tool restrictions**: some levels are straightedge-only (move, point, line, intersection), compass-only (move, point, circle, intersection) or **grid** (move, point, line, intersection — the problem ships a grid, i.e. straightedge construction on squared paper, and the grid itself costs no steps).
- **Undo** while a tool is half-way through only cancels that half-finished construction. The menu also has **clear canvas / restart** (back to the initial figures, progress reset), the **explore view** (the other content from `explore=`; figures you draw there are kept), **design mode** (reveals every hidden figure and marks the given / goal for you) and **open the solver** (needs at least one solution first).
- **On phones** the thumbnail moves under the top-right buttons, and the panels and L / E counters shrink with the screen.

### Maker and solver

- **Marking tools** live in the top menu bar: "Mark given" offers given / labelled given (a naming dialog appears) / movepoints, and "Mark goal" offers goal (judged) / goal (shown) / explore (shown); they export to `initial=` / `named=` / `movepoints=` / `result=` (judged before the colon, shown after) / `explore=`. Click an object on the canvas to add or remove its mark (picking favours a **point** within the snap range, otherwise the nearest line / circle — a point often lies right on top of one); the mark panel groups them, and its ✕ clears everything. **Marks are mutually exclusive** (the same rule applies when you add one from the element list): given / labelled given / movepoints — at most one of the three; goal (judged) / goal (shown) / explore (shown) may coexist with each other, but not with the given group — marking a given figure as a goal drops its given mark, and vice versa. **When reading**, an object listed in both `initial=` and `named=` counts as `named` (labelled given) — it shows its label and does not also appear among plain given figures.
- **Only draggable free points can be movepoints** (points that follow other objects are refused with a notice). Maker / solver points are unlabelled by default (turn labels on in "Point style"), while labelled givens keep their labels.
- **Multiple solutions**: with "Mark goal" or "goal (shown)" selected the switch bar shows a selector — `1`, `+`, `−` switch, add and remove solution groups.
- **Import / export gmt**: "Export gmt" views the code, downloads a file or files an issue; "Import gmt" takes pasted code or a file. **A load can be undone step by step** — the loaded figures count as constructed one by one, so undo peels them off down to an empty canvas (a grid counts as a single block, i.e. one step).
- The **solver** only needs the "given" and "goal (judged)" marks. Only objects marked "given" count as known (figures the level hides or pre-draws never slip in as conditions, which would produce fake solutions using points the problem never gave); with no given marks at all, everything except the goal counts.
- The **solver panel** sets the step limit, the tools (compass & straightedge / straightedge only / compass only / grid), the time limit and how many solutions to look for, then "Start" (the button turns into "Stop"). **The step limit is what you ask for**: the search returns as soon as it finds something, so ask for fewer steps to get shorter solutions. Solutions are **streamed in as they are found**: the list grows while the search runs (the status line says "Found n solution(s) (searching)") and those rows can be opened step by step right away; a parallel search stops the moment it has collected enough, without waiting for the tasks in flight. The panel also carries a **progress bar with a percentage** on its right (the percentage is simply the bar's fill ratio). The bar is **situations searched / estimated total situations** — a "situation" is one node of the search tree, dead ends included; the denominator is calibrated as the search goes (the average size of the situations finished so far) and the bar only ever moves forward. It fills to 100% once the solution quota is reached or the tree is exhausted, and stays where it got to on a timeout / manual stop; hovering shows the situations searched, the estimated total, the solutions found and the time used. The threads label shows a **recommended** count (from the device's logical cores).
- **Grid construction**: the board / maker / solver toolbar has "Grid" just right of the menu (2–20 columns and rows, unit length defaults to 50; pressing it again on an existing grid resizes it). The grid is *constructed* from a gmt template (the auxiliary objects used along the way are hidden automatically, and the grid lines are thin black dashed ones); the view then fits the grid. On screen it counts as **one block**: tapping any grid line selects them all, it cannot be deleted, re-typed, hidden or repainted by the brushes, and the element list and the mark panel show a single "grid" row — and it cannot be marked at all. In the maker generating one counts as a given and exports as the `#grid=` / `#gridstyle=` lines (plus the grid lines in `initial=`); undo / redo bring the whole grid back together with its size.
- **Solver "grid" mode** (mode 3 of the search core): when the canvas has a grid it is selected automatically, the step limit drops to 4, and the panel shows the grid size. The request is converted into core coordinates (lattice points are integers, the point domain is `[0,m]×[0,n]` — canvas +y points down, so y is negated), and the grid lines are not sent as givens (the core lays them down from m / n itself, and neither they nor the lattice points count towards E). A level can ask for it with `"tools": "grid"`.
- **Advanced** (the collapsed section in the panel): symmetry pruning / goal first / low memory / transposition table size / dedup capacity / **parallel threads** / tolerance / **solution genericity check** — all of them are parameters the search core already had (except the check), and your choices are remembered. Their defaults are the core's defaults, so leaving them alone behaves exactly as before. **Parallel** splits the search tree into prefix tasks (the same division of labour as the reference C++ `bs_v8`): worker #1 cuts the tree into prefixes, the others search one prefix each, and the page merges and de-duplicates the results, shortest first. Threads = 1 keeps the original single-worker search; parallel tasks never use the transposition table (same as C++, since failed states are not shared between tasks). Leaving **tolerance** empty takes `1e-11 ×` the figure's **length** scale automatically, and the field's hint shows the value that was actually used. The **solution self-check** (off by default) nudges every movable point by **0.1%** of the figure (two perpendicular, non-axis directions, and each point is put back afterwards), lets the canvas recompute the goal, and then re-evaluates the construction: solutions that only hold for the current numbers are dropped — the core searches a numeric instance, so such coincidental constructions are invisible without this switch. The panel also carries a **progress bar** (the bar is **situations searched / estimated total situations**, where a "situation" is one node of the search tree, dead ends included; the denominator is recalibrated as it goes from the average size of the situations already finished, and the bar only ever moves forward. It fills to 100% once the requested number of solutions is collected, and stays where it is when the search is exhausted, times out or is stopped — hover it to see the count searched, the estimate, the solutions found and the elapsed time) and the threads label shows a **recommended** count (from the device's logical cores). **Solutions found are not guaranteed to be correct** — check them yourself or turn on the self-check; **Stepwise search** in the same section searches for 1 step, then 2, ... up to the limit so short solutions show up first — each round is a full search with its own time limit, which is what you want when shorter solutions would otherwise be squeezed out by same-length ones.
- **Solutions are drawn on the canvas** in semi-transparent magenta, step by step (which line, circle or intersection came at which step). With several solutions the right-hand list switches between them, "previous / next step" walks through one, "Clear solution" removes them; a solution that uses a given **segment or ray** is drawn as the whole line. The solution is only an overlay: not selectable, not exported, and it never touches your own drawing — and it **follows the figure** when you drag a given (a step that can no longer be built disappears for the moment and grows back). A given **segment or ray** is only used within its own range: the solver clips intersections to its endpoints, so extending one costs you an extra step just as it does in play. Each solution also has a "Text steps" button explaining how it was built.
- **Test-play** behaves exactly like playing a level: only the givens show until you produce the goal, and going back restores the editing state. Figure-heavy levels still open (less history is carried over when the browser's storage can't hold it, but the figures and marks always go across). When the problem carries a **grid**, test play restricts the tools to the grid straightedge set (move / point / line / intersection), just like `"tools": "grid"` does for a level — test play has no level file, so the presence of a grid decides it.
- **On phones** the panels move into a bottom sheet opened from the round buttons in the top-left; on desktop they stay floating over the canvas.
- **Credits**: the solver's search core was developed by [Ander](https://github.com/Aricler-Ander) and zzzzzz; this project uses its JavaScript port.

### Tools and styles

- The top bar is split into general / point / line / circle / construct; the badge on the construct button always shows the advanced tool currently selected in that category.
- **Identical figures are never drawn twice** (only the figure itself is compared, not how it was built): connecting AB again, dropping a point on `a` to draw a parallel to `a`, or using the three-point compass with centre A and radius AB never create a second copy; lines, rays and segments don't duplicate each other. **Hidden or invalid figures don't count as duplicates** and are never snapped to or picked; with the point tool, landing (after snapping) on an existing point does nothing — no overlapping point, no step.
- **Style brush** (maker / solver): pick a figure as the source, then every figure you pick copies its colour / width / label visibility (when the source is a **marked** figure — given / movable point / goal — it copies the figure's **own** style colour rather than the black / gold mark colour). **Switch line type**: click a line, ray or segment to cycle its type (points and circles are not its targets — with the cursor over one it does nothing instead of switching the line underneath).
- **Dragging figures directly**: if a figure's defining points are all free points, dragging it translates the whole figure (figures built on it follow); otherwise dragging pans the canvas. The move tool supports **multi-select**: `Ctrl/Cmd+A` selects everything, `Ctrl/Cmd`-click adds to the selection (clicking an already selected object again removes it); all selected points / figures move together, and **"Adjust object style" and "Delete selected" act on the whole selection**.
- **Desktop shortcuts**: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo, `Ctrl/Cmd+S` save a record (the panel's plus button), `Delete` / `Backspace` delete the selected figures (the whole selection, through the same path as "Delete selected" — figures a level provides still can't be removed); while typing in an input they step aside. In play mode the move tool shows **no** "name · type" hover tip (maker and solver still do), and the selection outline (ring / dashed pair) scales with the figure's own width.
- **Element list** (menu): small cells, 15 per row (index / name / thumbnail), with the ✕ at the top right closing the panel. **All** — a click opens that figure's details; **Hidden** — a black outline on the invisible figures, a click toggles visibility (read-only in play and test play); **Given / Movable points / Goal / Explore** show marks with a **red** outline, and a click only adds a mark, never removes one.
- **Preview and snapping**: the preview point snaps first to existing points and intersections (including hidden intersections that have no point object yet), then to the nearest line / circle — the figure is drawn wherever it snapped. **Picking is points first, then everything else by distance**: a point inside the snap range wins (nearest point first; when a drawing tool takes a point it also considers a hidden point under the cursor and bare intersection positions, and only the point tool really uses a hidden point), otherwise the nearest figure wins (ties fall back to the segment → ray → line → circle order, then to reverse construction order; draggable free points win among several points). Move, eraser, style brush, hide brush, switch-line-type and the marking tools all share this rule; the grid is a background and always yields to your own figures. **Touch has two extra rules** (a fingertip is much coarser than a mouse): clicking a crossing whose snap range already holds another point takes that point instead of creating an intersection; with a mouse there is no such rule — pressing on a crossing creates the intersection there. Everything else is identical.
- **Clicking a hidden intersection reveals it**: whatever tool is active (the point tool, the intersection tool, or any tool taking a point and clicking one off the cuff), one click turns it into a real intersection object on the canvas; with any tool other than the point / intersection tools the click still carries on with that tool's own step (land the first point here, then pick the second). Whose undo step it takes depends on the action: with the **point / intersection tool** the revealed (or created) point takes its **own step** (undoing it removes just that point), while with **any other tool** the point it picks off the cuff is undone **together with that step's figure** (undo the line and the intersection goes with it). Either way it costs no L / E. The point tool also reveals a **hidden point object** instead of dropping a new point next to it; the grid's own helper points (the tiny black dots at lattice positions) and **hidden points in play mode** are excluded from this rule — in play mode hidden is the level's own semantics (a hidden given object, a figure's internal definition points), so the click simply creates a new point instead.
- **The grid is a background**: grid lines are always drawn at the very bottom (segments / lines / rays coinciding with a grid line show above the grid, and **picking prefers your own figure** — grid objects sort last in the line family; **overlapping figures pick a point first, otherwise the one nearest the cursor**, falling back to the segment → ray → line → circle ordering and then to reverse construction order); grid lines also snap over a **halved range** (7.5px vs 15px for ordinary figures, while lattice-corner snapping keeps the full 15px); in the element list the grid is inserted as one block **where it was created** (figures drawn before the grid come first) instead of always sitting on the first row; marking mode ignores the grid when looking for the nearest figure; and in grid play mode nothing can be **created** outside the grid (points, points on an element, intersections, and the lines / circles built from them are all refused) — only the move tool and **explore mode** (whose canvas is not bound by the level's field) are exempt. In the maker and the solver a figure lying **entirely** outside the grid cannot be marked (one that crosses the grid still can). "Hidden" is a style only (recorded in the record's styles), so the exported `hidden=` line is always left empty; it is still honoured when importing someone else's gmt.
- **Copy compass** picks a circle first and then follows the cursor with that radius; the **angle bisector** previews both bisectors only after the second line is picked. Notices and confirmations use the site's own styling.

### Records (saved constructions)

- A record keeps **the construction (gmt text) + the list of figures that can be undone + a style table + an info table** (mode, level id, whether the goal was satisfied, moves), stored on this device; loading it gives back exactly what was on the canvas, and you can keep undoing / redoing from there. The level's name and target are looked up by level id instead of being stored.
- **Menu → Records** opens the panel (test play has no such entry). It only lists the **current context** (in level play, that level), each row showing index / name (the save time by default, renameable) / moves — grey when the goal was not satisfied, black when it was, gold for the reach within the target. The plus saves manually (something drawn, no identical construction yet), while in level play a record is **saved automatically once the goal is satisfied** (drawing further doesn't save again; if the goal leaves the canvas and comes back, one more is saved). "Select" turns the panel into a batch mode with export / delete. **Test play (maker-play) has neither the menu entry nor the automatic save** — it only previews the level you built, so a goal you satisfy there never lands in the records.
- **Import / export**: import takes gmt code or a file (several records at once); export shows the code or saves a file (several merge into one `.gmts`, a single record stays `.gmt`) — see "What a record file carries" under Advanced for what the exported text looks like. The homepage footer's **Clear cache** groups every record on the device by mode (level play by pack → level) with the same actions.
- **Marks, styles, moves, deletions and parameter edits never go into a record**: the marks are read back from the gmt's own lines (`initial=` / `named=` / `movepoints=` / `hidden=` / `result=` / `explore=` — play and maker read them all, the solver only the given / labelled given / first goal's judged part, the free board ignores them), and the other adjustments vanish together with the figure they belong to. They can all be redone afterwards, and the space saved is considerable.
- A record stores each figure's **own** colour / width / label / hidden state / dash — the given black and goal gold are the **marks' display colours**, re-applied from the marks on load, so undo / redo keeps the colours and an object that has been undone is never left in the mark panel.
- Every list reads the local records too: on the level page and in the level lists / pack pages / search, a level whose goal you have produced shows its target steps in the body colour (instead of the grey used for unsolved ones), and the L (or E) that is within the target is shown in gold.
- Closing the records panel: play mode restores the tool you had before opening it; the board / maker / solver end up on Move, like the element list panel.

### Other

- **Help**: "Menu → Help" in each workspace explains the current screen, and hovering the menu and buttons fills the information bar with a description.
- **Project notes**: the top-right button on the home page fetches and renders this file as a dialog. **Chinese / English**: switchable from the home page, and the choice is remembered.

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
| `diagram` | diagram path (relative to `data/`) | the list shows a ◇ placeholder and the card has no image |
| `note` | hover hint on the level list row | none |
| `tools` | tool restriction: `"straightedge"`, `"compass"` or `"grid"` (grid straightedge) | unrestricted, all tools |
| `keywords` | keywords used by search | search only looks at title and `subtitle` |
| `solutions` | recorded solution diagrams: `[{"file": "answers/<pack id>/…", "star": "5L"}, …]` (`file` relative to `data/`) | no recorded answers ("View answers" greyed out) |

> The `subtitle` of the `ewp` and `xmath` packs has already been filled in bulk (taken from the problem statements in the source archive); to change one, just edit that level's `subtitle`.

Example (one entry of `data/levels.json`):

```json
{
    "id": "ewp11",
    "pack": "ewp",
    "file": "levels/ewp/ewp11.gmt",
    "title": "EWP11",
    "subtitle": "A point A lies inside the circle; draw a chord through A whose length equals the radius.",
    "targetSteps": "5L / 6E",
    "diagram": "diagrams/ewp/ewp11.png",
    "note": "",
    "tools": "",
    "keywords": ["EWP", "chord", "radius", "multi-solution"],
    "solutions": [
        {"file": "answers/ewp/ewp11/5L.png", "star": "5L"},
        {"file": "answers/ewp/ewp11/6E.png", "star": "6E"},
        {"file": "answers/ewp/ewp11/2V.png", "star": "2V"}
    ]
}
```

The field order is the order given in the two tables above; fields that don't apply are written as an empty string / empty array (the page treats them as "not written", i.e. the default) — except switch-like fields such as `tools`, which are simply left out instead of being written as an empty string. File and directory names never contain underscores — always a hyphen `-`.

**Adding a pack / level**: put the `.gmt` and its diagram into `data/levels` and `data/diagrams`, then add a pack to `levelpacks.json` and a level to `levels.json`. If you generate them with a script, keep the display fields (`name` / `description` / `icon` / `title` / `subtitle` / `note`) instead of overwriting them.

There are currently **47 levels** with a tool restriction (43 straightedge-only and 4 compass-only); the whole `extra-straightedge-only-pzls` pack (36 levels) is straightedge-only.

> `data/diagrams/ewp/` still holds 5 old problem images that were never used (`EWP021--Def.png` / `EWP049--Def.png` / `EWP066--Def.png` / `EWP088--Def.png` / `EWP091--Def.png`; these levels are not in `levels.json`), they are referenced by nothing and their underscores were turned into hyphens as well — delete them if you like.

### About the source material

The problems and solution diagrams come from material collected by the "Geommunity Blueprint" authoring project: one folder per level, containing the problem image, the best solution known at the time and the gmt code (solutions of unofficial problems live in a separate `Solutions` folder so players can think first). To use a gmt file, open the game's apk and overwrite the matching level file under `res/raw` as text; install and play.

That material has been organised into `data/` as described above: gmt under `data/levels/`, problem images under `data/diagrams/`, solution diagrams under `data/answers/`, with file and directory names replaced by the level's short id; the `source` field of `levelpacks.json` keeps the original directory name as a reference. Copyright of the material and the solution diagrams belongs to their original authors.

> `solutions` was compiled from the levels' original directories: answer images come from the level folder, a `Solutions` subfolder, or the pack-level `Solutions/<same-named directory>`, sorted by star label (5L / 6E / 2V), and problem images (`Def`) or explanatory images don't count. When imported into `data/answers/` they are reorganised as "one folder per level" (`answers/<pack id>/<level id>/5L.png`), and levels that shared one original answer directory (such as `SprFes`'s `Solutions/`, several XEP groups) each got their own copy — so **every image inside a level folder now belongs to that level**; when one star label shares an image, two `solutions` entries pointing at the same file are kept. Follow the same rule after adding levels.

### How GMT maps onto the board

Levels and the board's "Import gmt" share one parser. For the syntax see ggb2gmt's "ggb and gmt file structure and syntax".

**Pre-drawn commands**

| gmt | Base on the board | Notes |
| --- | --- | --- |
| `#grid=m,n,unit` | grid (one block of grid lines) | a comment directive in the file header: lays down an m×n grid, unit length defaults to 50; it **counts as no construction step** (in the solver neither the grid nor the lattice points count towards E). The next line may be `#gridstyle=…` to style the grid lines (same syntax as `styles`, with the `g` prefix) |
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

`ShiftSeg`, `ABisect[two lines]`, `Tangent[two circles]` and `rules` (constraints) are not supported yet: those objects are dropped together with everything that depends on them, while the rest parses normally (none of the current level files uses `ShiftSeg` or the two-circle tangent). Trailing comments (`assignment # comment`) and mixed-case command names are recognised; a few files have individual objects that are degenerate at their initial position (three collinear points, a point inside a circle …) and therefore can't be drawn for the moment.

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

**Intersection arguments (`Intersect[object1,object2,x,known point]`)**

The third argument `x` of `Intersect` is the intersection's identity; the board computes and stores it with the same convention, so an intersection never jumps to the other candidate when the figure moves:

* line and line: a single intersection, `x=0`;
* line and circle: candidates are numbered along the **direction of the line** (first defining point → second defining point); which one is picked follows the rules below (as measured in the original game):
  * **the first `Intersect` on the same pair of bases always takes the "non-defining" candidate** — writing `x` as 0 or 1 makes no difference (with `c1=Circle[A,B]`, `s1=Line[B,A]`, both `E=Intersect[c1,s1,0]` and `F=Intersect[c1,s1,1]` pick the point on the circle that is not B);
  * **the second and later ones** take `x` literally (same example with `s1=Line[A,B]`: number 0 is B and number 1 is the other point);
  * the "defining point" is **the radius endpoint of the circle** (`B` in `Circle[A,B]`) — the point you clicked when drawing that circle, i.e. the point the circle already has on it;
  * when a candidate position **already carries another point** (that radius endpoint being crossed by this line, a point `C` the circle already has, a defining point shared by two circles …) — in other words, **the intersection the pair already has** — it is best to write that point as the **fourth argument** (see below): without it the numbering can only be worked out from rules such as "the first one takes the non-defining candidate", which is easy to get wrong and may land on the other candidate;
* circle and circle: candidates run counter-clockwise starting from **centre of object 1 → centre of object 2**, picked the same way as line/circle (the first takes the non-defining candidate, later ones take `x`). With `a=Circle[A,B]`, `b=Circle[C,B]` (B is the radius endpoint of both circles, hence one of the intersections): `D=Intersect[a,b,0]` and `E=Intersect[a,b,1]` give `D=not B, E=B` when B lies on one side of the centre line and `D=E=not B` on the other; writing the two lines the other way round (1 first, then 0) gives exactly the mirrored result; with a single line, both 0 and 1 give the "not B" point;
* **the chosen candidate's identity is remembered (it never jumps)**: once an intersection is computed, its identity — "the one coinciding with a defining point" or "the other one" — is kept and preferred on every recomputation. So dragging a figure, or even dragging B across the centre line, never makes the intersection switch to the other point;
* a line's own **direction** must match the table above, otherwise the numbering is inverted: lines / segments / rays use first defining point → second defining point; perpendiculars and perpendicular bisectors use "the reference line's direction rotated 90° clockwise"; angle bisectors use the opening direction of the angle; parallels share the direction of the line they are parallel to; tangents start from the tangent point;
* **segments / rays are only range-filtered, never renumbered**: `x` still follows the candidate order of the underlying line, so a single in-range intersection is never treated as number 0. When no candidate is in range the original list is kept, the index is used as usual and the result is marked "invalid but not deleted" — an intersection that temporarily leaves the line while dragging never jumps to the other point;

The fourth argument of `Intersect` (such as the `F` in `Intersect[s3,c2,1,F]`) is **the intersection already known**: it is excluded before `x` is applied (it may be omitted or written as `-`), and that exclusion survives undo and save/load. When the intersection tool is used at a crossing — and likewise when the point tool snaps to an intersection, or a construction picks one up on the way — and one of the candidate positions already carries another point (a given point, a point on the circle, another intersection …), that point is recorded as the known one — so "the other intersection" gets a fixed identity and never slides onto the known point while dragging. Since the identity is settled, the third argument no longer matters, and the export writes `Intersect[figure1,figure2,-,known point]` (with a circle `AB` carrying `C` and a line `DC` through it, the other intersection comes out as `Intersect[s1,c1,-,C]`).

Once the intersection arguments are set the intersection is "remembered": when the range of a segment or ray changes so that the intersection leaves it (or the two objects stop intersecting) the point becomes **invalid but not deleted** (not drawn, not used in constructions) and recovers automatically once they intersect again. 

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

### What a record file carries

The text the records panel exports is a readable gmt: after the object lines and mark lines come a blank line and a block of `recordname=` / `time=` / `saved=` / `mode=` / `pack=` / `levelid=` / `reached=` / `steps=5:6` / `undolist=3,5,7` / `styles=a#ff0000,a~1,a$`. Several records merged into one `.gmts` are separated by a `# ===== record N =====` line above each. The old layout (v1.1.3 and earlier: three JSON lines `# undolist=` / `# styles=` / `# info=`) still reads.

- A **grid** travels in the header's `#grid=m,n,unit` / `#gridstyle=…` lines rather than being repeated in `styles`: they carry its size, unit and line style, and loading a record / level / test play turns them back into one whole grid block.
- **`undolist` is what can be undone**, written as the object line numbers inside that gmt: in level play it only lists the figures you drew yourself (the level's own figures cannot be undone away, matching how undo works while playing), while every other mode lists all of them — importing a level-play record into the board ignores the list, so every figure can be undone one by one, and redo puts them back.
- The **style table only writes what differs from the defaults** (black, width 1, points labelled / lines and circles not, solid, visible): `a#ff0000` colour, `a~1` … `a~5` point & line width (**grade number**, 1 smallest to 5 largest, matching the style panel's width bar; bare widths written by older records, like `a~0.5`, are still read as widths), `a$` label on / `a^` label off, `a&` dashed (lines and circles), `a@` hidden / `a!` visible, `a%a1` the display name `a1`. In the free board the labels points have by default are written out too, and in level play and the maker every non-given object gets its visibility written explicitly.
- A hidden figure is written **only as the style table's `a@`**: the gmt `hidden=` line is always left empty on export (it is read-only, so importing someone else's gmt still honours it).
