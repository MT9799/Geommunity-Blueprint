/* recordStore.js */
/**
 * 历史记录（作图存档）数据层 模块
 *
 * 一条记录由几块拼成，每块都只放必要的东西：
 *
 *   id / name / time          —— 清单用的最基本项（name 默认就是保存时间，可重命名）
 *   info                      —— 存档基本信息表：mode（哪个模式）、pack / levelId（哪一关）、
 *                                reached（保存时作出所求没有）、steps（保存时的步数）。
 *                                关卡名与目标步数都按 levelId 反查，不再另存
 *   gmt                       —— 作图本身（gmt 文本）
 *   undolist                  —— 可撤回的图形：**gmt 里对象行的序号**（1 起数，只数对象行，
 *                                与 geometryManager.getAllByOrder() 一一对应）。
 *                                游玩模式只列玩家自己画的，其它模式列全部
 *   styles                    —— 各图形的样式表：{id: {color, width, showName, visible}}，只记与默认不同的项
 *   thumbnail                 —— 关卡游玩的题目文本与缩略图（只有游玩模式有，不写进导出文本）
 *
 * 导出格式 = **gmt 文本**（对象行 + 标记行）+ 空一行 + 一段 `key=value` 的附加信息：
 *
 *   recordname=2026-09-29 12:00:00     记录名（默认就是保存时间）
 *   time=1759123456789                 保存时间戳
 *   saved=auto                         自动 / 手动 / 导入
 *   mode=level                         记录来自哪个模式
 *   pack=ewp / levelid=ewp11           哪一关（自由作图时 levelid 写 null）
 *   reached=1                          作出所求没有（非游玩模式留空）
 *   steps=5:6                          5L 6E（非游玩模式留空）
 *   undolist=3,5,7                     可撤回的图形：gmt 里对象行的序号
 *   styles=a#ff0000,a~1,a$             非默认样式，见下面的符号表
 *
 * 附加信息段会和对象行撞名字（玩家完全可以把图形叫 mode），所以解析时**只认末尾空行之后那一段**，
 * 而且那一段的每一行都得是 META_KEYS 里的键，否则当没有附加信息（裸 gmt）。
 *
 * styles 的符号（一个图形有多项就逐个写，用逗号隔开；值里有逗号就写成 `\,`）：
 *   a%名称 显示名（与 id 不同的那个；改名是样式方向的事，不是标记）；
 *   a#ff0000 颜色；a~1 / a~3 点线径（1 小、3 大）；
 *   a$ 显示标签 / a^ 不显示；a& 虚线（线 / 圆，实线是默认所以不写）；a@ 隐藏 / a! 可见
 * 显示名和 `named=` 是两套规则：named= 只表示「带标签给定」那个标记（读了它会强制显示标签、
 * 按给定上色），改了名字但没标成带标签给定的对象归 styles 这边。
 * 默认样式不写，另有两条例外：
 *   · 自由模式导出时，点默认就显示标签也要写 a$（导入到别的模式也保持一样的外观）
 *   · 游玩模式与制题器导出时，所有非给定对象都要写出 a@ / a!（显式记下显隐）
 *
 * 标记行（initial / named / movepoints / hidden / result / explore）就是 gmt 原本那几行，
 * 载入时一并读出来（游玩模式与制题器读全部，求解器只读给定 / 带标签给定 / 第一个所求的判定部分，
 * 自由模式忽略）—— 于是切换样式、标记图形、移动图形、删除图形、改参数这些**都不进记录**，
 * 它们的结果随对应图形的撤回一起消失（要留就自己再调一次）。
 * 其中 `hidden=` 在记录里**留空**（`hidden=`）：隐藏只记在 styles 的 `a@`（见 recordPanel 的
 * canvasGmt / applyStyles），换个地方存一份就够了；关卡文件那边的 hidden= 照旧要写。
 *
 * 批量导出会把多条拼在一份里，每条前面加一行 `# ===== 记录 N =====` 分隔（老文件那行还带名称，
 * 也照样能读）；v1.1.3 及以前的老格式（`# undolist=` / `# styles=` / `# info=` 三行 JSON）仍能读。
 */
(function (global) {
    // 记录 id 清单（按保存顺序）
    const KEY_MANIFEST = 'recordStorage';
    // v1.1.2 以前关卡游玩另用一份清单，第一次读到就并进主清单
    const KEY_LEGACY_MANIFEST = 'recordStorage-play';
    const KEY_MERGED = 'recordStorage-merged';
    // 导出时携带附加信息的注释行（v1.1.3 及以前的老格式，仍能读）
    const COMMENT = {
        undolist: '# undolist=',
        styles: '# styles=',
        info: '# info=',
    };
    // 现在这套附加信息（导出文本末尾那一段）的键
    const META_KEYS = ['recordname', 'time', 'saved', 'mode', 'pack', 'levelid', 'reached', 'steps', 'undolist', 'styles'];
    // styles 的符号表（% 是显示名：改了名字的图形靠它记，与 gmt 的 named= 行是两回事 ——
    // named= 只表示「带标签给定」那个标记，显示名归样式这边）
    const STYLE_MARKS = {
        name: '%',
        color: '#',
        width: '~',
        showNameOn: '$',
        showNameOff: '^',
        // 虚线（只有线 / 圆有，默认关闭所以只写「开」这一面）
        dashed: '&',
        hidden: '@',
        visible: '!',
    };
    const STYLE_MARK_PATTERN = /[%#~$^@!&]/;
    // styles 一行里各项用逗号隔开，显示名里可能有逗号：转义后再写，读回来按未转义的逗号切
    const escapeStyleValue = value => String(value).replace(/\\/g, '\\\\').replace(/,/g, '\\,');
    const unescapeStyleValue = value => String(value).replace(/\\(.)/g, '$1');
    const splitStyleItems = text => (String(text || '').match(/(?:\\.|[^,])+/g) || []);
    // 批量导出的分隔行：# ===== 记录 1 =====（老文件是 `# ===== 记录 1：名称 =====`，都认）
    const SPLIT_PATTERN = /^#\s*=+\s*记录\s*(\d+)\s*(?:[：:]\s*(.*?))?\s*=+\s*$/;

    /**
     * 读 JSON 过程函数
     * @param {string} key
     * @param {*} fallback
     */
    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const value = JSON.parse(raw);
            return value === null || value === undefined ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    /**
     * 写 JSON 过程函数
     * @param {string} key
     * @param {*} value
     * @returns {boolean} 是否写入成功（超配额等失败时返回 false）
     */
    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 把 v1.1.2 的关卡清单并进主清单 过程函数
     * 只在第一次调用时做一次（做过的标记写在 localStorage 里）
     */
    function mergeLegacyManifest() {
        if (localStorage.getItem(KEY_MERGED)) return;
        const legacy = readJSON(KEY_LEGACY_MANIFEST, []);
        const merged = manifest();
        if (Array.isArray(legacy)) {
            legacy.forEach(id => {
                if (typeof id === 'string' && !merged.includes(id)) merged.push(id);
            });
        }
        writeJSON(KEY_MANIFEST, merged);
        localStorage.setItem(KEY_MERGED, '1');
    }

    /**
     * 记录 id 清单 过程函数
     * @returns {string[]}
     */
    function manifest() {
        const list = readJSON(KEY_MANIFEST, []);
        if (!Array.isArray(list)) return [];
        return list.filter(id => typeof id === 'string');
    }

    /**
     * 写回记录 id 清单 过程函数
     * @param {string[]} list
     */
    function setManifest(list) {
        writeJSON(KEY_MANIFEST, list);
    }

    /**
     * 取一条记录 过程函数
     * @param {string} id
     * @returns {Object|null}
     */
    function getRecord(id) {
        const dict = readJSON(id, null);
        if (!dict || typeof dict !== 'object') return null;
        if (!dict.id) dict.id = id;
        // v1.1.2 的记录把基本信息散在顶层，读的时候统一成 info，免得每条调用方都要判两次
        if (!dict.info) {
            dict.info = {
                mode: dict.mode || 'normal',
                pack: dict.pack || null,
                levelId: dict.levelId || null,
                levelName: dict.levelName || null,
                reached: !!dict.reached,
                steps: dict.steps || null,
                target: dict.target || null,
            };
        }
        return dict;
    }

    /**
     * 存档基本信息表（老记录读顶层字段）过程函数
     * @param {Object} dict
     * @returns {Object}
     */
    function infoOf(dict) {
        if (!dict) return {};
        if (dict.info) return dict.info;
        return {mode: dict.mode || 'normal', reached: !!dict.reached, steps: dict.steps || null, target: dict.target || null};
    }

    /**
     * 全部记录（按清单顺序） 过程函数
     * @param {{mode?: string, levelId?: string}} [filter] 只取某个模式 / 某一关的记录
     * @returns {Object[]}
     */
    function listRecords(filter) {
        mergeLegacyManifest();
        const list = manifest().map(getRecord).filter(dict => !!dict);
        if (!filter) return list;
        return list.filter(dict => {
            const info = infoOf(dict);
            if (filter.mode && info.mode !== filter.mode) return false;
            if (filter.levelId && info.levelId !== filter.levelId) return false;
            return true;
        });
    }

    /**
     * 保存一条记录 过程函数
     * 已经在清单里的只更新内容、不改变它在列表里的位次
     * @param {Object} dict
     * @returns {boolean}
     */
    function putRecord(dict) {
        if (!dict || !dict.id) return false;
        if (!writeJSON(dict.id, dict)) return false;
        const list = manifest();
        if (!list.includes(dict.id)) {
            list.push(dict.id);
            setManifest(list);
        }
        return true;
    }

    /**
     * 删除记录 过程函数
     * @param {string[]} ids
     */
    function removeRecords(ids) {
        const drop = new Set(ids);
        drop.forEach(id => localStorage.removeItem(id));
        setManifest(manifest().filter(id => !drop.has(id)));
    }

    /**
     * 下一条记录的 id 过程函数
     * 取最小的空闲编号（各模式共用一份清单，id 不会撞）
     * @returns {string}
     */
    function nextRecordId() {
        const used = new Set(manifest());
        for (let i = 0; ; i++) {
            const id = `record-${i}`;
            if (!used.has(id) && !localStorage.getItem(id)) return id;
        }
    }

    /**
     * 当前时间 过程函数
     * @returns {{name: string, time: number}}
     */
    function now() {
        const date = new Date();
        const pad = value => String(value).padStart(2, '0');
        const name = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        return {name: name, time: date.getTime()};
    }

    /**
     * 记录里的作图文本 过程函数
     * @param {Object} dict
     * @returns {string}
     */
    function gmtOf(dict) {
        return dict && typeof dict.gmt === 'string' ? dict.gmt : '';
    }

    /**
     * 比较用的作图文本 过程函数
     * 去掉注释行（附加信息那几行也在内）与行尾空白，并把「与构造无关的量」抹平：
     *   · 自由点的坐标（`A=[12.3,45.6]`）——只是坐标不同仍是同一个构造
     *   · 对象上的点参数（`Linepoint[c1,0.48]`、`EdgePoint[s,0]`）——只是参数不同也算同一个构造
     * 于是同一条作图凭手感点的位置不同、拖完再存，都不会被当成新的记录
     * @param {string} gmt
     * @returns {string}
     */
    function compareKey(gmt) {
        return String(gmt || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            // 网格那两行不是普通注释：它决定网格的大小与单位，得参与「是不是同一条作图」的比较
            // （否则同一张网格改成不同大小时会被当成重复记录挡住）
            .filter(line => line && (!line.startsWith('#') || /^#grid(?:style)?=/.test(line)))
            .map(line => line
                // 自由点：只留 id
                .replace(/^([A-Za-z_]\w*)\s*=\s*\[[^\]]*\]\s*$/, '$1=[*]')
                // 线上的点 / 无穷远点：只留它挂在哪个对象上，参数抹平
                .replace(/\b(Linepoint|EdgePoint)\[([^,\]]+)\s*,\s*[^\]]+\]/g, '$1[$2,*]'))
            .join('\n');
    }

    /**
     * 找一条作图一致的记录 过程函数
     * @param {string} gmt 要比较的作图文本
     * @param {{mode?: string, levelId?: string}} [filter] 限定范围（不传就在全部记录里找）
     * @returns {Object|null} 已经存在的那条记录
     */
    function findSameRecord(gmt, filter) {
        const key = compareKey(gmt);
        if (!key) return null;
        const found = listRecords(filter).find(dict => compareKey(gmtOf(dict)) === key);
        return found || null;
    }

    /**
     * 解析一份 JSON 过程函数
     * 存储类（StorageManager / MovesStorageManager）的 serialization 给的是 JSON 字符串，
     * 这里两种形式都认（字符串解析，对象直接用），解析不出来返回 null
     * @param {*} value
     * @returns {Object|null}
     */
    function parseJSON(value) {
        if (!value) return null;
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch (error) {
            return null;
        }
    }

    /**
     * 一个对象的基底签名 过程函数
     * [类型, 基底类型, 基底 id 表, 参数, 已知交点 id, 线型]
     * @param {Object} element
     * @returns {Array}
     */
    function baseSignature(element) {
        const base = element.base || {};
        return [
            element.type || 'point',
            base.type || 'none',
            Array.isArray(base.basesId) ? base.basesId : [],
            base.value === undefined ? 0 : base.value,
            base.excludeId || null,
            element.drawType || 'line',
        ];
    }

    /**
     * 坐标压一下 过程函数
     * 只去掉多余的尾数（1e-6 以内），不会把吸附出来的位置改掉
     * @param {number} value
     * @returns {number}
     */
    function tidyNumber(value) {
        return Number(Number(value).toFixed(6));
    }

    /**
     * 撤销清单从简 过程函数
     * 只留「载入时真正用得上的」信息，重复的一大堆样式字段全部不提。
     * v2（当前）：每格只记**与上一格的差异**，因为步与步之间绝大部分内容是一样的：
     *
     *   {
     *     v: 2,
     *     b: {id: 基底签名},                    // 各格都一样的基底（绝大多数对象都在这儿）
     *     r: [{                                 // 每格（第 1 格是相对空画布的差异）
     *       a: [新增的 id], r: [移除的 id],      // 对象：只记增删（顺序 = 上一格去掉删掉的 + 新增的）
     *       p: {点: [x,y]},                      // 自由点坐标：只记与上一格不同的
     *       l: {栏: [id…]},                      // 标记表：只记与上一格不同的（空数组 = 清空那一栏）
     *       b: {id: 基底签名}                    // 该格特有的基底
     *     }],
     *     p: 指针, st: 状态,
     *     m: {r: [[E,L]…], p, st}               // 游玩模式：步数清单
     *   }
     *
     * v1（旧记录，仍能读）：每格的 `ids` / `p` / `l` 都写全量。
     *
     * 样式（颜色 / 粗细 / 标签 / 隐藏）不进撤销清单 —— 记录本来就有 styles 表，
     * 载入时统一按它上色（见 recordPanel.js 的 applyStyles）；线 / 圆 / 线上点的坐标也不必存，
     * 基底定完会自己重算。载入用 expandUndolist 还原。
     * @param {Object} undolist
     * @returns {Object|null}
     */
    function slimUndolist(undolist) {
        if (!undolist) return null;
        const slim = {};
        const construct = parseJSON(undolist.construct);
        if (construct && Array.isArray(construct.repository)) {
            const snapshots = construct.repository.map(snapshot => (snapshot && Array.isArray(snapshot.elements)) ? snapshot : {elements: []});
            // 各格签名一致的对象提到外面，只有个别格不同的才逐格写
            const signatures = new Map();
            snapshots.forEach(snapshot => {
                snapshot.elements.forEach(element => {
                    if (!element || !element.id) return;
                    const signature = JSON.stringify(baseSignature(element));
                    if (!signatures.has(element.id)) signatures.set(element.id, signature);
                    else if (signatures.get(element.id) !== signature) signatures.set(element.id, null);
                });
            });
            const common = {};
            signatures.forEach((signature, id) => { if (signature) common[id] = JSON.parse(signature); });

            slim.b = common;
            // 步与步之间绝大部分是一样的（载入关卡时，每一步只是往画布上多放一个对象），
            // 所以每格只记**与上一格的差异**：id 记增删、自由点坐标与标记表只记变化的那些。
            // 原样重复的话，一条 76 步的记录能写到 40KB 以上（id 表 / 标记表 / 坐标各重复 76 遍）
            let previousIds = [];
            let previousPoints = {};
            let previousLists = {};
            let previousOwn = {};
            slim.r = snapshots.map(snapshot => {
                const row = {};
                const ids = [];
                const points = {};
                const own = {};
                snapshot.elements.forEach(element => {
                    if (!element || !element.id) return;
                    ids.push(element.id);
                    const base = element.base || {};
                    // 只有自由点（坐标定的点）需要存坐标，其它点由基底重算
                    if (base.type === 'none' && typeof element.x === 'number' && typeof element.y === 'number') {
                        points[element.id] = [tidyNumber(element.x), tidyNumber(element.y)];
                    }
                    if (!common[element.id]) own[element.id] = baseSignature(element);
                });
                // id：只记相对上一格新增 / 移除的（顺序 = 上一格（去掉删掉的）+ 新增的，与原顺序一致）
                const previousIdSet = new Set(previousIds);
                const currentIdSet = new Set(ids);
                const added = ids.filter(id => !previousIdSet.has(id));
                const removed = previousIds.filter(id => !currentIdSet.has(id));
                if (added.length) row.a = added;
                if (removed.length) row.r = removed;
                // 自由点坐标：只记与上一格不同的
                const changedPoints = {};
                Object.entries(points).forEach(([id, value]) => {
                    const before = previousPoints[id];
                    if (!before || before[0] !== value[0] || before[1] !== value[1]) changedPoints[id] = value;
                });
                if (Object.keys(changedPoints).length) row.p = changedPoints;
                // 该格特有的基底：同样只记与上一格不同的（后面出现的对象会一直带在
                // 每格里，不比较的话又是逐格重复一大片）
                const changedOwn = {};
                Object.entries(own).forEach(([id, signature]) => {
                    if (JSON.stringify(previousOwn[id]) !== JSON.stringify(signature)) changedOwn[id] = signature;
                });
                if (Object.keys(changedOwn).length) row.b = changedOwn;
                // 标记表：只记与上一格不同的（写成空数组表示这一步把那一栏清空了）
                const lists = snapshot.lists || {};
                const nowLists = {};
                const changedLists = {};
                const keys = new Set([...Object.keys(lists), ...Object.keys(previousLists)]);
                keys.forEach(key => {
                    const now = Array.isArray(lists[key]) ? lists[key] : [];
                    nowLists[key] = now;
                    const before = previousLists[key] || [];
                    if (now.length !== before.length || now.some((id, index) => id !== before[index])) {
                        changedLists[key] = now;
                    }
                });
                if (Object.keys(changedLists).length) row.l = changedLists;
                previousIds = ids;
                previousPoints = points;
                previousLists = nowLists;
                previousOwn = Object.assign({}, previousOwn, own);
                return row;
            });
            slim.v = 2;
            if (construct.pointer !== undefined) slim.p = construct.pointer;
            if (construct.status !== undefined) slim.st = construct.status;
        }
        const moves = parseJSON(undolist.moves);
        if (moves && Array.isArray(moves.repository)) {
            const compact = {r: moves.repository.map(item => [item?.e || 0, item?.l || 0])};
            if (moves.pointer !== undefined) compact.p = moves.pointer;
            if (moves.status !== undefined) compact.st = moves.status;
            slim.m = compact;
        }
        return Object.keys(slim).length ? slim : null;
    }

    /**
     * 还原撤销清单 过程函数
     * 把 slimUndolist 的紧凑格式展开成存储类（StorageManager / MovesStorageManager）认的 JSON 字符串；
     * 旧记录里已经是字符串的话原样返回
     * @param {Object} undolist
     * @returns {{construct: string|null, moves: string|null}}
     */
    function expandUndolist(undolist) {
        const empty = {construct: null, moves: null};
        if (!undolist) return empty;
        if (typeof undolist.construct === 'string' || typeof undolist.moves === 'string') {
            return {
                construct: typeof undolist.construct === 'string' ? undolist.construct : null,
                moves: typeof undolist.moves === 'string' ? undolist.moves : null,
            };
        }
        const result = {construct: null, moves: null};
        if (Array.isArray(undolist.r)) {
            const common = undolist.b || {};
            // v2 的每格只有与上一格的差异，边展开边把上一格的完整状态攒起来
            const differential = undolist.v === 2;
            let previousIds = [];
            let previousPoints = {};
            let previousLists = {};
            let previousOwn = {};
            const repository = undolist.r.map(row => {
                let ids;
                let points;
                let lists;
                let own;
                if (differential) {
                    const removed = new Set(row.r || []);
                    ids = previousIds.filter(id => !removed.has(id)).concat(row.a || []);
                    points = Object.assign({}, previousPoints, row.p || {});
                    lists = Object.assign({}, previousLists);
                    Object.entries(row.l || {}).forEach(([key, value]) => { lists[key] = value; });
                    own = Object.assign({}, previousOwn, row.b || {});
                }else{
                    ids = row.ids || [];
                    points = row.p || {};
                    lists = row.l || {};
                    own = row.b || {};
                }
                previousIds = ids;
                previousPoints = points;
                previousLists = lists;
                previousOwn = own;
                const elements = ids.map(id => {
                    const signature = own[id] || common[id] || ['point', 'none', [], 0, null, 'line'];
                    const [type, baseType, bases, value, excludeId, drawType] = signature;
                    const element = {
                        id: id,
                        name: id,
                        type: type,
                        valid: true,
                        color: '#191919',
                        width: 1,
                        showName: false,
                        visible: true,
                        base: {type: baseType, basesId: bases, value: value},
                    };
                    if (type === 'point') {
                        const point = points[id] || [0, 0];
                        element.x = point[0];
                        element.y = point[1];
                        if (excludeId) element.base.excludeId = excludeId;
                    }else if (type === 'line') {
                        element.drawType = drawType || 'line';
                    }
                    return element;
                });
                const snapshot = {elements: elements};
                // 标记表整份给过去：里面可能是空数组，那是「这一步把那一栏清空了」，
                // 恢复时会连同「快照里没有的栏」一起处理（见 board-tools 的 loadStorageSnapshot）
                if (Object.keys(lists).length) snapshot.lists = lists;
                return snapshot;
            });
            result.construct = JSON.stringify({repository: repository, pointer: undolist.p, status: undolist.st});
        }
        if (undolist.m && Array.isArray(undolist.m.r)) {
            const repository = undolist.m.r.map(item => ({e: item[0] || 0, l: item[1] || 0}));
            result.moves = JSON.stringify({repository: repository, pointer: undolist.m.p, status: undolist.m.st});
        }
        return result;
    }

    /**
     * 样式表 → 紧凑文本 过程函数
     * 只写传进来的键 —— 哪些算「非默认」由调用方定（见 recordPanel 的 stylesOfCanvas）
     * @param {Object} styles {id: {color, width, showName, visible, dashed}}
     * @returns {string} 形如 a#ff0000,a~1,a$,b@
     */
    function stylesToText(styles) {
        const parts = [];
        Object.keys(styles || {}).forEach(id => {
            const entry = styles[id] || {};
            if (entry.name) parts.push(id + STYLE_MARKS.name + escapeStyleValue(entry.name));
            // 颜色按 `a#ff0000` 写：值里的 `#` 省掉（画布上的颜色本来就是 # 开头的十六进制）
            if (entry.color) parts.push(id + STYLE_MARKS.color + String(entry.color).replace(/^#/, ''));
            if (typeof entry.width === 'number') parts.push(id + STYLE_MARKS.width + entry.width);
            if (entry.showName === true) parts.push(id + STYLE_MARKS.showNameOn);
            if (entry.showName === false) parts.push(id + STYLE_MARKS.showNameOff);
            if (entry.dashed === true) parts.push(id + STYLE_MARKS.dashed);
            if (entry.visible === false) parts.push(id + STYLE_MARKS.hidden);
            if (entry.visible === true) parts.push(id + STYLE_MARKS.visible);
        });
        return parts.join(',');
    }

    /**
     * 按前缀解析样式文本 过程函数
     * gmt 的 `#gridstyle=` 用前缀当键（如 `gS` 表示所有 gS* 对象），符号与 styles 完全同一套
     * @param {string} text 形如 gS#000000,gS~1,gS^,gS&
     * @param {string[]} ids 目标对象的 id 列表
     * @returns {Object} {id: {name?, color?, width?, showName?, visible?, dashed?}}
     */
    function stylesByPrefix(text, ids) {
        const styles = {};
        // 先把每项拆成「前缀 + 符号 + 值」，再按前缀匹配 id
        const items = splitStyleItems(text).map(item => item.trim()).filter(Boolean).map(item => {
            const at = item.search(STYLE_MARK_PATTERN);
            if (at <= 0) return null;
            return {prefix: item.slice(0, at), mark: item[at], value: item.slice(at + 1).trim()};
        }).filter(Boolean);
        (ids || []).forEach(id => {
            const entry = {};
            items.forEach(item => {
                if (!id.startsWith(item.prefix)) return;
                if (item.mark === STYLE_MARKS.name) entry.name = unescapeStyleValue(item.value);
                else if (item.mark === STYLE_MARKS.color) {
                    entry.color = !item.value ? null : (/^[0-9a-f]{3,8}$/i.test(item.value) ? '#' + item.value : item.value);
                }
                else if (item.mark === STYLE_MARKS.width) {
                    const width = Number(item.value);
                    if (Number.isFinite(width)) entry.width = width;
                }
                else if (item.mark === STYLE_MARKS.showNameOn) entry.showName = true;
                else if (item.mark === STYLE_MARKS.showNameOff) entry.showName = false;
                else if (item.mark === STYLE_MARKS.dashed) entry.dashed = true;
                else if (item.mark === STYLE_MARKS.hidden) entry.visible = false;
                else if (item.mark === STYLE_MARKS.visible) entry.visible = true;
            });
            if (Object.keys(entry).length) styles[id] = entry;
        });
        return styles;
    }

    /**
     * 紧凑文本 → 样式表 过程函数
     * @param {string} text 形如 a#ff0000,a~1,a$,a&
     * @returns {Object} {id: {color?, width?, showName?, visible?, dashed?}}
     */
    function stylesFromText(text) {
        const styles = {};
        splitStyleItems(text).map(item => item.trim()).filter(Boolean).forEach(item => {
            const at = item.search(STYLE_MARK_PATTERN);
            // 名字后面必须跟一个符号：`a` 这种只有名字的项直接跳过
            if (at <= 0) return;
            const id = item.slice(0, at);
            const mark = item[at];
            const value = item.slice(at + 1).trim();
            const entry = styles[id] || (styles[id] = {});
            if (mark === STYLE_MARKS.name) entry.name = unescapeStyleValue(value);
            else if (mark === STYLE_MARKS.color) {
                // `a#ff0000` 里的值是省掉 `#` 的十六进制，读回来补上；其它写法（如颜色名）原样留着
                if (!value) entry.color = null;
                else entry.color = /^[0-9a-f]{3,8}$/i.test(value) ? '#' + value : value;
            }
            else if (mark === STYLE_MARKS.width) {
                const width = Number(value);
                if (Number.isFinite(width)) entry.width = width;
            }
            else if (mark === STYLE_MARKS.showNameOn) entry.showName = true;
            else if (mark === STYLE_MARKS.showNameOff) entry.showName = false;
            else if (mark === STYLE_MARKS.dashed) entry.dashed = true;
            else if (mark === STYLE_MARKS.hidden) entry.visible = false;
            else if (mark === STYLE_MARKS.visible) entry.visible = true;
        });
        Object.keys(styles).forEach(id => { if (!Object.keys(styles[id]).length) delete styles[id]; });
        return styles;
    }

    /**
     * 步数 → 文本 过程函数
     * @param {{l?: number, e?: number}|null} steps
     * @returns {string} 形如 "5:6"（就是 5L 6E）
     */
    function stepsToText(steps) {
        if (!steps) return '';
        const stepsL = typeof steps.l === 'number' ? steps.l : null;
        const stepsE = typeof steps.e === 'number' ? steps.e : null;
        if (stepsL === null && stepsE === null) return '';
        return `${stepsL || 0}:${stepsE || 0}`;
    }

    /**
     * 文本 → 步数 过程函数
     * @param {string} text
     * @returns {{l: number, e: number}|null}
     */
    function stepsFromText(text) {
        if (!String(text || '').trim()) return null;
        const [l, e] = String(text).split(':');
        const stepsL = Number(l);
        const stepsE = Number(e);
        if (!Number.isFinite(stepsL) && !Number.isFinite(stepsE)) return null;
        return {l: Number.isFinite(stepsL) ? stepsL : 0, e: Number.isFinite(stepsE) ? stepsE : 0};
    }

    /**
     * 附加信息 → 若干行 过程函数
     * @param {Object} dict
     * @returns {string[]}
     */
    function metaLinesOf(dict) {
        const info = infoOf(dict);
        const oneLine = value => String(value === null || value === undefined ? '' : value).replace(/[\r\n]+/g, ' ').trim();
        return [
            `recordname=${oneLine(dict.name)}`,
            `time=${typeof dict.time === 'number' ? dict.time : ''}`,
            `saved=${oneLine(dict.saved)}`,
            `mode=${oneLine(info.mode)}`,
            `pack=${oneLine(info.pack)}`,
            `levelid=${oneLine(info.levelId) || 'null'}`,
            // 达到目标与步数只有游玩模式才谈得上，别的模式留空
            `reached=${info.mode === 'level' ? (info.reached ? '1' : '0') : ''}`,
            `steps=${info.mode === 'level' ? stepsToText(info.steps) : ''}`,
            `undolist=${(Array.isArray(dict.undolist) ? dict.undolist : []).join(',')}`,
            `styles=${stylesToText(dict.styles)}`,
        ];
    }

    /**
     * 一条记录的导出文本 过程函数
     * gmt 文本 + 空一行 + 一段附加信息（名称 / 时间 / 模式 / 关卡 / 步数 / 可撤回的图形 / 样式）
     * @param {Object} dict
     * @returns {string}
     */
    function exportTextOf(dict) {
        return [gmtOf(dict), '', metaLinesOf(dict).join('\n')].join('\n');
    }

    /**
     * 批量导出：多条记录合并成一份文本 过程函数
     * 分隔行不带名称：记录名里可能有 `=====`，带上去会把拆分弄乱
     * @param {Object[]} records
     * @returns {string}
     */
    function mergedExportText(records) {
        return (records || []).map((dict, index) => {
            return `# ===== 记录 ${index + 1} =====\n` + exportTextOf(dict);
        }).join('\n\n');
    }

    /**
     * 把一段文本拆成「gmt + 附加信息」过程函数
     * 附加信息只认末尾空行之后那一段，且要求那一段每一行都是 META_KEYS 里的键 ——
     * 否则当没有附加信息（裸 gmt：末尾那一段是 initial / explore 这些标记行）
     * @param {string[]} lines
     * @returns {{gmt: string, meta: Object|null}}
     */
    function splitMeta(lines) {
        let start = 0;
        for (let index = lines.length - 1; index >= 0; index--) {
            start = index;
            if (!lines[index].trim()) { start = index + 1; break; }
        }
        const tail = lines.slice(start).filter(line => line.trim());
        const meta = {};
        const allMeta = tail.length > 0 && tail.every(line => {
            const match = line.match(/^\s*([A-Za-z]+)\s*=\s?([\s\S]*)$/);
            if (!match || !META_KEYS.includes(match[1].toLowerCase())) return false;
            meta[match[1].toLowerCase()] = match[2].trim();
            return true;
        });
        if (!allMeta) return {gmt: lines.join('\n').trim(), meta: null};
        return {gmt: lines.slice(0, start).join('\n').trim(), meta: meta};
    }

    /**
     * 从导入的文本里取一条注释里的 JSON 过程函数
     * @param {string} text
     * @param {string} prefix
     * @returns {Object|null}
     */
    function commentValue(text, prefix) {
        const line = String(text || '').split(/\r?\n/).find(item => item.trim().startsWith(prefix));
        if (!line) return null;
        try {
            const value = JSON.parse(line.trim().slice(prefix.length));
            return value && typeof value === 'object' ? value : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * 把一份导入文本拆成若干条记录的内容 过程函数
     * 支持整份批量导出的文件（按 `# ===== 记录 N：名称 =====` 拆），也支持单条 / 裸 gmt
     * @param {string} text
     * @returns {{name: string|null, gmt: string, undolist: Object|null, styles: Object|null, info: Object|null}[]}
     */
    function parseImportText(text) {
        const lines = String(text || '').split(/\r?\n/);
        const blocks = [];
        let current = null;
        const push = () => {
            if (current && current.lines.join('\n').trim()) blocks.push(current);
            current = null;
        };
        lines.forEach(line => {
            const match = line.trim().match(SPLIT_PATTERN);
            if (match) {
                push();
                current = {name: match[2] || null, lines: []};
                return;
            }
            if (!current) current = {name: null, lines: []};
            current.lines.push(line);
        });
        push();
        return blocks.map(block => {
            const content = block.lines.join('\n');
            const split = splitMeta(block.lines);
            if (split.meta) {
                const meta = split.meta;
                return {
                    name: meta.recordname || block.name,
                    time: meta.time ? Number(meta.time) : null,
                    saved: meta.saved || null,
                    gmt: split.gmt,
                    // 可撤回的图形：gmt 里对象行的序号
                    undolist: String(meta.undolist || '').split(',')
                        .map(item => Number(item.trim()))
                        .filter(value => Number.isFinite(value) && value > 0),
                    styles: stylesFromText(meta.styles || ''),
                    info: {
                        mode: meta.mode || null,
                        pack: meta.pack || null,
                        levelId: meta.levelid && meta.levelid !== 'null' ? meta.levelid : null,
                        levelName: null,
                        reached: meta.reached === '1',
                        steps: stepsFromText(meta.steps),
                        target: null,
                    },
                };
            }
            // 老格式（v1.1.3 及以前）：附加信息在 `# undolist=` / `# styles=` / `# info=` 三行注释里
            const gmt = content.split(/\r?\n/)
                .filter(line => !Object.values(COMMENT).some(prefix => line.trim().startsWith(prefix)))
                .join('\n')
                .trim();
            return {
                name: block.name,
                time: null,
                saved: null,
                gmt: gmt,
                undolist: commentValue(content, COMMENT.undolist),
                styles: commentValue(content, COMMENT.styles),
                info: commentValue(content, COMMENT.info),
            };
        }).filter(block => !!block.gmt);
    }

    /**
     * 记录的一条摘要（列表里显示步数用） 过程函数
     * （记录里不再有目标步数，target 由调用方按 levelId 反查后传进来）
     * 只有**作出过所求**的记录才谈得上「达到目标」，没作出的不标金。
     * reached 交给列表决定底色：没作出所求 → 灰、作出所求 → 黑、其中达标的那个 L / E → 金
     * @param {Object} dict
     * @param {{l?: number, e?: number}|null} [target] 本关目标步数（记录里不再存，由调用方按 levelId 反查）
     * @returns {{parts: {text: string, gold: boolean}[], gold: boolean, reached: boolean}|null}
     */
    function stepsSummary(dict, target) {
        const info = infoOf(dict);
        const steps = info.steps;
        if (!steps || (typeof steps.l !== 'number' && typeof steps.e !== 'number')) return null;
        const limits = target || info.target || {};
        const reached = !!info.reached;
        const parts = [];
        let gold = false;
        if (typeof steps.l === 'number') {
            const ok = reached && typeof limits.l === 'number' && steps.l <= limits.l;
            gold = gold || ok;
            parts.push({text: `${steps.l}L`, gold: ok});
        }
        if (typeof steps.e === 'number') {
            const ok = reached && typeof limits.e === 'number' && steps.e <= limits.e;
            gold = gold || ok;
            parts.push({text: `${steps.e}E`, gold: ok});
        }
        if (!parts.length) return null;
        return {parts: parts, gold: gold, reached: reached};
    }

    /**
     * 从目标步数文本里取 L / E 数 过程函数
     * @param {string} text 形如 "5L / 6E"
     * @returns {{l: number|null, e: number|null}}
     */
    function targetStepsFromText(text) {
        const pick = pattern => {
            const match = String(text || '').match(pattern);
            return match ? Number(match[1]) : null;
        };
        return {l: pick(/(\d+)\s*L/i), e: pick(/(\d+)\s*E/i)};
    }

    /**
     * 某一关的达标情况 过程函数
     * 关卡列表 / 关卡页用它给目标步数标金：本机记录里这一关有「作出过所求、且步数不超过目标」的记录
     * @param {string} levelId
     * @param {{l?: number|null, e?: number|null}} [target] 关卡目标（不传就用记录里存的目标）
     * @returns {{done: boolean, l: boolean, e: boolean}}
     */
    function reachedTargetOf(levelId, target) {
        const result = {done: false, l: false, e: false};
        if (!levelId) return result;
        listRecords({mode: 'level', levelId: levelId}).forEach(dict => {
            const info = infoOf(dict);
            if (!info.reached || !info.steps) return;
            const limits = target || info.target || {};
            result.done = true;
            if (typeof limits.l === 'number' && typeof info.steps.l === 'number' && info.steps.l <= limits.l) result.l = true;
            if (typeof limits.e === 'number' && typeof info.steps.e === 'number' && info.steps.e <= limits.e) result.e = true;
        });
        return result;
    }

    global.recordStore = {
        KEY_MANIFEST: KEY_MANIFEST,
        mergeLegacyManifest: mergeLegacyManifest,
        manifest: manifest,
        listRecords: listRecords,
        getRecord: getRecord,
        putRecord: putRecord,
        removeRecords: removeRecords,
        nextRecordId: nextRecordId,
        now: now,
        gmtOf: gmtOf,
        infoOf: infoOf,
        compareKey: compareKey,
        findSameRecord: findSameRecord,
        slimUndolist: slimUndolist,
        expandUndolist: expandUndolist,
        exportTextOf: exportTextOf,
        mergedExportText: mergedExportText,
        parseImportText: parseImportText,
        stylesToText: stylesToText,
        stylesFromText: stylesFromText,
        stylesByPrefix: stylesByPrefix,
        stepsToText: stepsToText,
        stepsFromText: stepsFromText,
        stepsSummary: stepsSummary,
        targetStepsFromText: targetStepsFromText,
        reachedTargetOf: reachedTargetOf,
    };
})(window);
