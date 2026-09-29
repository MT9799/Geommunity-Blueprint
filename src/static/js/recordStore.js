/* recordStore.js */
/**
 * 历史记录（作图存档）数据层 模块
 *
 * 一条记录由几块拼成，每块都只放必要的东西：
 *
 *   id / name / time          —— 清单用的最基本项（name 默认就是保存时间，可重命名）
 *   info                      —— 存档基本信息表：mode（哪个模式）、pack / levelId / levelName（哪一关）、
 *                                reached（保存时作出所求没有）、steps（保存时的步数）、target（本关目标步数）
 *   gmt                       —— 作图本身（gmt 文本）
 *   undolist                  —— 撤销清单：{construct, moves}，每格快照只留必要字段（见 slimUndolist）
 *   styles                    —— 各图形的样式表：{id: {color, width, showName, visible}}，只记与默认不同的项
 *   thumbnail                 —— 关卡游玩的题目文本与缩略图（只有游玩模式有）
 *
 * 导出格式就是 **gmt 文本 + 末尾的 `# undolist=`、`# styles=`、`# info=` 三行注释**
 * （gmt 解析会把 `#` 行当注释跳过），导入时按这三种注释还原；批量导出会把多条拼在一份里，
 * 每条前面加一行 `# ===== 记录 N：名称 =====` 分隔 —— 导入时按这行拆回多条。
 */
(function (global) {
    // 记录 id 清单（按保存顺序）
    const KEY_MANIFEST = 'recordStorage';
    // v1.1.2 以前关卡游玩另用一份清单，第一次读到就并进主清单
    const KEY_LEGACY_MANIFEST = 'recordStorage-play';
    const KEY_MERGED = 'recordStorage-merged';
    // 导出时携带附加信息的注释行
    const COMMENT = {
        undolist: '# undolist=',
        styles: '# styles=',
        info: '# info=',
    };
    // 批量导出的分隔行：# ===== 记录 1：2026-09-29 12:00:00 =====
    const SPLIT_PATTERN = /^#\s*=+\s*记录\s*(\d+)\s*[：:]\s*(.*?)\s*=+\s*$/;

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
            .filter(line => line && !line.startsWith('#'))
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
     * 一条记录的导出文本 过程函数
     * gmt 文本 + 末尾三行注释（撤销清单 / 样式表 / 基本信息），随文件一起走
     * @param {Object} dict
     * @returns {string}
     */
    function exportTextOf(dict) {
        const lines = [gmtOf(dict)];
        if (dict && dict.undolist) lines.push(COMMENT.undolist + JSON.stringify(dict.undolist));
        if (dict && dict.styles && Object.keys(dict.styles).length) lines.push(COMMENT.styles + JSON.stringify(dict.styles));
        if (dict && dict.info) lines.push(COMMENT.info + JSON.stringify(dict.info));
        return lines.join('\n');
    }

    /**
     * 批量导出：多条记录合并成一份文本 过程函数
     * @param {Object[]} records
     * @returns {string}
     */
    function mergedExportText(records) {
        return (records || []).map((dict, index) => {
            return `# ===== 记录 ${index + 1}：${dict.name || dict.id} =====\n` + exportTextOf(dict);
        }).join('\n\n');
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
            const gmt = content.split(/\r?\n/)
                .filter(line => !Object.values(COMMENT).some(prefix => line.trim().startsWith(prefix)))
                .join('\n')
                .trim();
            return {
                name: block.name,
                gmt: gmt,
                undolist: commentValue(content, COMMENT.undolist),
                styles: commentValue(content, COMMENT.styles),
                info: commentValue(content, COMMENT.info),
            };
        }).filter(block => !!block.gmt);
    }

    /**
     * 记录的一条摘要（列表里显示步数用） 过程函数
     * 只有**作出过所求**的记录才谈得上「达到目标」，没作出的不标金。
     * reached 交给列表决定底色：没作出所求 → 灰、作出所求 → 黑、其中达标的那个 L / E → 金
     * @param {Object} dict
     * @returns {{parts: {text: string, gold: boolean}[], gold: boolean, reached: boolean}|null}
     */
    function stepsSummary(dict) {
        const info = infoOf(dict);
        const steps = info.steps;
        if (!steps || (typeof steps.l !== 'number' && typeof steps.e !== 'number')) return null;
        const target = info.target || {};
        const reached = !!info.reached;
        const parts = [];
        let gold = false;
        if (typeof steps.l === 'number') {
            const ok = reached && typeof target.l === 'number' && steps.l <= target.l;
            gold = gold || ok;
            parts.push({text: `${steps.l}L`, gold: ok});
        }
        if (typeof steps.e === 'number') {
            const ok = reached && typeof target.e === 'number' && steps.e <= target.e;
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
        stepsSummary: stepsSummary,
        targetStepsFromText: targetStepsFromText,
        reachedTargetOf: reachedTargetOf,
    };
})(window);
