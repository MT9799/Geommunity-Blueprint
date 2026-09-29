/* levels-data.js */
/**
 * 关卡数据模块
 * 读 data/levelpacks.json（关卡包）与 data/levels.json（关卡，扁平列表），
 * 在内存里按 pack 字段把关卡归到对应包下，供 levels.html / pack.html / level.html 使用。
 *
 * 两个文件各管一件事：
 *   data/levelpacks.json —— 关卡包：id / name / description / icon / source
 *   data/levels.json     —— 关卡：id / pack / file / title / subtitle / targetSteps / diagram / note
 * 显示用字段（name / description / icon / title / subtitle / note）都直接写在这两个文件里，
 * 留空或不写就用页面默认值（序号自动生成、图标取该包第一个有示意图的关卡等）。
 */

/**
 * 读取关卡数据 过程函数
 * @returns {Promise<{packs: Array, levels: Array}>} packs 每一项带 levels 数组
 */
async function loadLevelsData() {
    const [packList, levelList] = await Promise.all([
        fetch('../data/levelpacks.json').then(response => response.json()),
        fetch('../data/levels.json').then(response => response.json()),
    ]);
    const packs = packList.map(pack => Object.assign({}, pack, { levels: levelList.filter(level => level.pack === pack.id) }));
    return { packs: packs, levels: levelList };
}

// 关卡列表每页显示多少关（避免一次加载几百张图片）
const LEVELS_PAGE_SIZE = 20;

/**
 * 页面层级 过程变量
 * 站点从浅到深：首页(-1) → 关卡包总览(0) → 关卡列表 / 搜索(1) → 关卡游玩(2)。
 * 只按文件名判断，站点挂在子路径下（GitHub Pages）也算得对；站点根目录（访问 / 或 …/）按首页算
 */
const LIST_PAGE_DEPTH = {'index.html': -1, 'levels.html': 0, 'pack.html': 1, 'search.html': 1, 'level.html': 2};

/**
 * 清掉比当前页更深的所有翻页 / 滚动位置 过程函数
 * 回到更上一层（例如从关卡列表退回关卡包总览）之后，下一层记住的页码与滚动位置就该作废：
 * 下次再点进去是从头开始，而不是停在上一次的半路。
 * 当前页自己的位置留着，返回上一层的记忆（「回到列表还停在原处」）照常生效
 */
function clearDeeperListState() {
    try {
        // 站点根目录（访问 / 或 …/）没有文件名，按首页算
        const fileName = location.pathname.split('/').pop() || 'index.html';
        const currentDepth = LIST_PAGE_DEPTH[fileName];
        if (currentDepth === undefined) return;
        const doomed = [];
        for (let index = 0; index < sessionStorage.length; index++) {
            const key = sessionStorage.key(index);
            if (!key || !key.startsWith('listScroll:')) continue;
            // 键形如 listScroll:<pathname><query>，取出其中的文件名比层级
            const name = key.slice('listScroll:'.length).split('?')[0].split('/').pop();
            const depth = LIST_PAGE_DEPTH[name];
            if (depth !== undefined && depth > currentDepth) doomed.push(key);
        }
        doomed.forEach(key => sessionStorage.removeItem(key));
    } catch (error) {
        // 隐私模式下 sessionStorage 可能不可用，忽略即可
    }
}

// 一进页面就先清一遍：此刻能读到的都是「上一次浏览」留下的、比本页更深的记录
clearDeeperListState();

/**
 * 列表页滚动位置的键 过程函数
 * 按地址区分（包 / 搜索条件 / 页码不同就是不同的位置），但把 page=1 归一化掉：
 * 关卡页的「返回关卡包」会带上 page=1，而进来时的地址一般没有这个参数，不归一化就对不上了
 * @returns {string}
 */
function listScrollKey() {
    const params = new URLSearchParams(location.search);
    const page = Number(params.get('page')) || 1;
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    const text = params.toString();
    return 'listScroll:' + location.pathname + (text ? '?' + text : '');
}

/**
 * 记下列表页的滚动位置 过程函数
 * 点进关卡之前调一次，
 * 回到列表页时再滚回去 —— 列表是异步渲染的，浏览器自带的恢复会赶在内容出来之前，等于回到顶部
 */
function saveListScroll() {
    try {
        sessionStorage.setItem(listScrollKey(), String(Math.round(window.scrollY)));
    } catch (error) {
        // 隐私模式下 sessionStorage 可能不可用，忽略即可
    }
}

/**
 * 还原列表页的滚动位置 过程函数
 * 在列表渲染完之后调用（内容要先把页面撑高，才滚得到那个位置）
 */
function restoreListScroll() {
    try {
        const saved = Number(sessionStorage.getItem(listScrollKey()));
        if (!saved) return;
        // 等两帧，让刚塞进去的列表完成布局再滚
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved)));
    } catch (error) {
        // 同上
    }
}

// 点关卡行 / 关卡包卡片跳转之前先记下滚动位置（捕获阶段，赶在默认跳转之前）
document.addEventListener('click', event => {
    if (event.target.closest('a[href*="level.html"], a[href*="pack.html"]')) saveListScroll();
}, true);

/**
 * 目标步数 HTML 过程函数
 * 本机记录里这一关已经达标的那个（L / E）标金，不用打开关卡就知道达标了；
 * 上色沿用关卡页缩略图那套 .goal-part.active
 * @param {string} steps 形如 "5L / 6E"
 * @param {Object} level
 * @returns {string}
 */
function markTargetSteps(steps, level) {
    const text = String(steps || '');
    if (typeof recordStore === 'undefined' || !level || !level.id) return text;
    const reached = recordStore.reachedTargetOf(level.id, recordStore.targetStepsFromText(text));
    if (!reached.done) return text;
    // 作出了所求就带上 .reached（正文色，与「没作出」的灰区分开），其中达标的那一项再加 .active 标金
    return text
        .replace(/(\d+\s*L)/i, match => `<span class="goal-part reached${reached.l ? ' active' : ''}">${match}</span>`)
        .replace(/(\d+\s*E)/i, match => `<span class="goal-part reached${reached.e ? ' active' : ''}">${match}</span>`);
}

/**
 * 关卡行 HTML 过程函数
 * 关卡包页与搜索页共用；搜索页传入 packName 以标注关卡来自哪个包
 * @param {Object} level 关卡数据
 * @param {{index: number, packName: string}} [options]
 * @returns {string}
 */
function levelRowHTML(level, options) {
    const setting = options || {};
    // 序号一律按它在包里的位次生成，不从 levels.json 里取（那个字段已去掉）
    const number = String((setting.index || 0) + 1).padStart(3, '0');
    const thumb = level.diagram ? `<img src="../data/${level.diagram}" alt="" loading="lazy">` : '◇';
    const steps = markTargetSteps(level.targetSteps || (typeof t === 'function' ? t('pack.stepsUnknown') : '步数未标注'), level);
    const note = level.note ? ` title="${level.note}"` : '';
    const packTag = setting.packName ? `<em class="level-pack">${setting.packName}</em>` : '';
    // page：带上关卡包里的页码，关卡页的「返回关卡包」据此回到这一页而不是第一页
    const pageParam = setting.page ? `&page=${encodeURIComponent(setting.page)}` : '';
    // from：从搜索页进来的关卡，返回时回到原来那个搜索页（含查询条件）
    const fromParam = setting.levelFrom ? `&from=${encodeURIComponent(setting.levelFrom)}` : '';
    const href = `./level.html?pack=${encodeURIComponent(level.pack)}&id=${encodeURIComponent(level.id)}${pageParam}${fromParam}`;
    // 标题与步数放同一格（.level-main）：窄屏时步数排在标题下面，不会被挤到新的一行
    return `<a class="level-row" href="${href}"${note}><span>${number}</span><span class="level-thumb">${thumb}</span>` +
        `<span class="level-main"><strong>${level.title}${packTag}</strong><small>${steps}　→</small></span></a>`;
}

/**
 * 分页控件 HTML 过程函数
 * @param {number} page 当前页（从 1 开始）
 * @param {number} total 总条数
 * @param {(page: number) => string} hrefOf 生成某页链接
 * @returns {string}
 */
function pagerHTML(page, total, hrefOf) {
    const totalPages = Math.max(Math.ceil(total / LEVELS_PAGE_SIZE), 1);
    if (totalPages < 2) return '';
    const items = [];
    const addPage = (label, target, active, disable) => {
        const className = `pager-item${active ? ' active' : ''}${disable ? ' disable' : ''}`;
        items.push(disable ? `<span class="${className}">${label}</span>` : `<a class="${className}" href="${hrefOf(target)}">${label}</a>`);
    };
    addPage(t('pack.prev'), Math.max(page - 1, 1), false, page <= 1);
    // 当前页附近最多显示 7 个页码；被跳过的部分用省略号，并且始终保留首页与末页
    const start = Math.max(Math.min(page - 2, totalPages - 4), 1);
    const end = Math.min(start + 4, totalPages);
    const gap = () => items.push('<span class="pager-item disable">…</span>');
    if (start > 1) {
        addPage('1', 1, page === 1, false);
        if (start > 2) gap();
    }
    for (let index = start; index <= end; index++) addPage(String(index), index, index === page, false);
    if (end < totalPages) {
        if (end < totalPages - 1) gap();
        addPage(String(totalPages), totalPages, page === totalPages, false);
    }
    addPage(t('pack.next'), Math.min(page + 1, totalPages), false, page >= totalPages);
    return `<nav class="level-pager">${items.join('')}</nav>`;
}

/**
 * 关卡是否命中搜索词 过程函数
 * 空格分隔的多个词之间是「与」关系，每个词都要命中：
 * 标题、说明、关键词、步数（L / E 数，支持 5L、6E、5 这类写法）
 * @param {Object} level
 * @param {string[]} terms
 * @param {string} [packName]
 * @returns {boolean}
 */
function matchLevelSearch(level, terms, packName) {
    const title = String(level.title || '').toLowerCase();
    const body = [level.subtitle || '', (level.keywords || []).join(' '), packName || ''].join(' ').toLowerCase();
    const steps = String(level.targetSteps || '');
    return terms.every(term => {
        const word = term.toLowerCase();
        if (!word) return true;
        if (title.includes(word) || body.includes(word)) return true;
        // 步数写法：5L（L 星步数）、6E（E 星步数）、5（L 或 E 的步数）
        const stepMatch = word.match(/^(\d*)([le])$/);
        if (stepMatch) {
            const pattern = stepMatch[2] === 'l' ? /(\d+)\s*L/i : /(\d+)\s*E/i;
            const target = pattern.exec(steps);
            if (!target) return false;
            return stepMatch[1] ? Number(target[1]) === Number(stepMatch[1]) : true;
        }
        if (/^\d+$/.test(word)) return (steps.match(/\d+/g) || []).includes(word);
        return false;
    });
}

/**
 * 关卡包卡片图标 过程函数
 * @param {Object} pack
 * @returns {string} 展示用图标路径（相对 data/）
 */
function packIcon(pack) {
    const fallback = (pack.levels || []).find(level => level.diagram);
    return pack.icon || (fallback && fallback.diagram) || '';
}

// 封面默认按 data/packcovers/<包id>.<扩展名> 找，依次尝试这些扩展名
const PACK_COVER_EXTENSIONS = ['png', 'jpg', 'webp'];

/**
 * 关卡包封面候选路径 过程函数
 * 优先用 levelpacks.json 里的 cover，其次按包 id 到 data/packcovers 找同名图片
 * @param {Object} pack
 * @returns {string[]} 相对 data/ 的候选路径
 */
function packCoverCandidates(pack) {
    if (pack.cover) return [pack.cover];
    return PACK_COVER_EXTENSIONS.map(extension => `packcovers/${pack.id}.${extension}`);
}

/**
 * 解析关卡包封面 过程函数
 * 依次加载候选路径，取第一个能加载出来的；都没有则回落到 icon / 该包第一个示意图
 * @param {Object} pack
 * @returns {Promise<string>} 相对 data/ 的图片路径，找不到返回空串
 */
function resolvePackCover(pack) {
    const candidates = packCoverCandidates(pack).concat(packIcon(pack));
    return new Promise(resolve => {
        const tryNext = index => {
            if (index >= candidates.length) return resolve('');
            const path = candidates[index];
            const image = new Image();
            image.onload = () => resolve(path);
            image.onerror = () => tryNext(index + 1);
            image.src = `../data/${path}`;
        };
        tryNext(0);
    });
}
