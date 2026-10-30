/**
 * 关卡搜索页
 * 搜索范围：标题 / 说明 / 关键词 / L、E 步数；空格分隔的多个条件是「与」关系
 * 地址栏参数：q 关键词、pack 只在某个关卡包内搜索、page 页码，方便收藏与分享
 */
// 推荐搜索：q 是真正拿去搜的中文关键词（关卡说明是中文），labelKey 是界面上显示的名字。
// 条目大致按「题干 + 关键词」的词频排（高频在前）；「最值」「正多边形」这类出现不多但常用的也保留。
const RECOMMENDED_SEARCHES = [
    {q: '三角形', labelKey: 'search.chipTriangle'},
    {q: '直线', labelKey: 'search.chipLine'},
    {q: '多解', labelKey: 'search.chipMultiSolution'},
    {q: '线段', labelKey: 'search.chipSegment'},
    {q: '弦', labelKey: 'search.chipChord'},
    {q: '切线', labelKey: 'search.chipTangent'},
    {q: '正方形', labelKey: 'search.chipSquare'},
    {q: '圆心', labelKey: 'search.chipCenter'},
    {q: '平行线', labelKey: 'search.chipParallel'},
    {q: '直径', labelKey: 'search.chipDiameter'},
    {q: '单尺', labelKey: 'search.chipStraightedge'},
    {q: '中点', labelKey: 'search.chipMidpoint'},
    {q: '内接', labelKey: 'search.chipInscribed'},
    {q: '平分', labelKey: 'search.chipBisect'},
    {q: '直角三角形', labelKey: 'search.chipRightTriangle'},
    {q: '正三角形', labelKey: 'search.chipEquilateral'},
    {q: '垂直', labelKey: 'search.chipPerpendicular'},
    {q: '内切圆', labelKey: 'search.chipIncircle'},
    {q: '外接圆', labelKey: 'search.chipCircumcircle'},
    {q: '面积', labelKey: 'search.chipArea'},
    {q: '等长', labelKey: 'search.chipEqualLength'},
    {q: '网格', labelKey: 'search.chipGrid'},
    {q: '角平分线', labelKey: 'search.chipAngleBisector'},
    {q: '内心', labelKey: 'search.chipIncenter'},
    {q: '半径', labelKey: 'search.chipRadius'},
    {q: '菱形', labelKey: 'search.chipRhombus'},
    {q: '等腰三角形', labelKey: 'search.chipIsosceles'},
    {q: '半圆', labelKey: 'search.chipSemicircle'},
    {q: '共圆', labelKey: 'search.chipConcyclic'},
    {q: '最值', labelKey: 'search.chipExtremum'},
    {q: '正多边形', labelKey: 'search.chipRegularPolygon'},
    {q: '5L', labelKey: 'search.chip5L'},
    {q: '6E', labelKey: 'search.chip6E'},
];

const params = new URLSearchParams(location.search);
const input = document.getElementById('search-input');
const scopeBox = document.getElementById('search-scope');

// 进入搜索页自动聚焦输入框：autofocus 在 nav-pending（visibility:hidden）期间不生效，
// 而且跨文档 View Transition 切入后焦点会被带回 body，所以这里在过渡结束后再聚焦一次，
// 这样不用再点一下就能直接输入
window.addEventListener('pagereveal', event => {
    const focusInput = () => input.focus({preventScroll: true});
    if (event.viewTransition?.finished) event.viewTransition.finished.finally(focusInput);
    else requestAnimationFrame(focusInput);
});
const chipsBox = document.getElementById('search-chips');
const summary = document.getElementById('search-summary');
// 跨文档页面过渡：等搜索结果渲染完再让新页面切入
// （head 里已经先挂了 promise；这里不要覆盖）
if (!window.__pageReady) {
    window.__pageReady = new Promise(resolve => { window.__resolvePageReady = resolve; });
}
const results = document.getElementById('search-results');
const pager = document.getElementById('search-pager');
const pagerTop = document.getElementById('search-pager-top');
let packScope = params.get('pack') || '';
let currentPage = Math.max(Number(params.get('page')) || 1, 1);
// 翻页用 pushState，滚动位置统一由脚本控制，关掉浏览器自带的历史滚动恢复
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// 返回键：落点按「上一级」定 —— 从某个关卡包的关卡列表（pack.html?pack=…）进来的就回那个包，
// 从关卡包总览（levels.html）进来的就回总览。不用 history.back()：直达才有确定的落点，
// 刷新 / 直接打开搜索页时也不会退到站点外面去
const backLink = document.getElementById('search-back');
if (backLink) {
    backLink.href = packScope ? `./pack.html?pack=${encodeURIComponent(packScope)}` : './levels.html';
}

/**
 * 搜索页地址 过程函数
 * @param {{q: string, pack: string, page: number}} state
 * @returns {string}
 */
function searchURL(state) {
    const search = new URLSearchParams();
    if (state.q) search.set('q', state.q);
    if (state.pack) search.set('pack', state.pack);
    if (state.page > 1) search.set('page', String(state.page));
    const text = search.toString();
    return `./search.html${text ? '?' + text : ''}`;
}

loadLevelsData().then(({ packs, levels }) => {
    const packNames = new Map(packs.map(pack => [pack.id, pack.name]));
    const packOf = id => packNames.get(id) || id;
    // 输入搜索词的防抖计时器（翻页时先清掉，避免它把页码拉回第 1 页）
    let timer = null;

    /** 当前搜索词命中的关卡 */
    const matchesOf = words => levels.filter(level =>
        (!packScope || level.pack === packScope) && matchLevelSearch(level, words, packOf(level.pack)));

    /** 渲染结果列表与分页 过程函数
     * @param {boolean} animate 翻页时让条目逐条进入
     * @param {'replace'|'push'} historyMode 页码翻页用 push，输入 / 筛选仍用 replace
     */
    const render = (animate = false, historyMode = 'replace') => {
        const terms = input.value.trim().split(/\s+/).filter(Boolean);
        const matched = matchesOf(terms);
        const totalPages = Math.max(Math.ceil(matched.length / LEVELS_PAGE_SIZE), 1);
        const page = Math.min(currentPage, totalPages);
        currentPage = page;
        const start = (page - 1) * LEVELS_PAGE_SIZE;
        // 先摘掉动画类：输入搜索词等非翻页重绘不要误播
        results.classList.remove('list-enter');
        results.innerHTML = matched
            .slice(start, start + LEVELS_PAGE_SIZE)
            .map((level, index) => levelRowHTML(level, {
                index: start + index,
                packName: packOf(level.pack),
                levelFrom: searchURL({q: input.value.trim(), pack: packScope, page: page}),
                // 高亮这些词，并在命中题干 / 关键词时于标题下方显示来源
                terms,
            }))
            .join('');
        const pagerHtml = pagerHTML(page, matched.length, target =>
            searchURL({q: input.value.trim(), pack: packScope, page: target}), true);
        pager.innerHTML = pagerHtml;
        if (pagerTop) pagerTop.innerHTML = pagerHtml;
        observeLevelThumbs();
        if (terms.length || packScope) summary.textContent = t('search.found', {count: matched.length});
        else summary.textContent = t('search.all', {count: levels.length});
        // 页码翻页 push 一条历史；输入 / 筛选仍只替换当前地址
        const url = searchURL({q: input.value.trim(), pack: packScope, page: page});
        if (historyMode === 'push') history.pushState(null, '', url);
        else history.replaceState(null, '', url);
        if (animate) animateListItems(results);
    };

    /** 渲染推荐搜索（带命中数量） */
    const renderChips = () => {
        chipsBox.innerHTML = RECOMMENDED_SEARCHES.map(item => {
            const word = item.q;
            const label = t(item.labelKey);
            const count = matchesOf([word]).length;
            return `<button type="button" class="search-chip" data-word="${word}"${count ? '' : ' disabled'}>${label}<span>${count}</span></button>`;
        }).join('');
    };

    /** 渲染搜索范围（从关卡包页进来时只搜该包） */
    const renderScope = () => {
        if (!packScope) {
            scopeBox.innerHTML = '';
            return;
        }
        scopeBox.innerHTML = `<button type="button" class="search-scope-chip" id="scope-clear">${t('search.scope', {name: packOf(packScope)})}<span>✕</span></button>`;
    };

    /** 客户端翻页 过程函数：只重绘条目，不重新加载页面 / 头图 */
    const goToPage = target => {
        if (target === currentPage) return;
        currentPage = target;
        render(true, 'push');
    };

    const handlePagerClick = event => {
        // Ctrl / Cmd / Shift 点击仍交给浏览器（可在新标签打开）
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a.pager-item');
        if (!link) return;
        event.preventDefault();
        clearTimeout(timer);
        const url = new URL(link.href, location.href);
        goToPage(Math.max(Number(url.searchParams.get('page')) || 1, 1));
    };
    pager.addEventListener('click', handlePagerClick);
    if (pagerTop) pagerTop.addEventListener('click', handlePagerClick);
    // 浏览器前进 / 后退：从地址栏恢复搜索词、范围和页码，只重绘条目
    window.addEventListener('popstate', () => {
        clearTimeout(timer);
        const state = new URLSearchParams(location.search);
        currentPage = Math.max(Number(state.get('page')) || 1, 1);
        input.value = state.get('q') || '';
        packScope = state.get('pack') || '';
        if (backLink) {
            backLink.href = packScope ? `./pack.html?pack=${encodeURIComponent(packScope)}` : './levels.html';
        }
        renderScope();
        renderChips();
        render(true, 'replace');
    });

    document.title = t('search.title');
    applyI18n();
    input.value = params.get('q') || '';
    renderScope();
    renderChips();
    render();
    // 从关卡返回时停在原来那一屏（只在首次渲染后还原；改搜索词时不跳）
    restoreListScroll();

    // 手机端：点到搜索框就把它顶到最上面。
    // subpage-header 是 sticky，滚到顶时它仍会吸在顶部，所以减掉它的高度再滚，免得把搜索框挡住。
    // 监听 click 而不只是 focus：页面带 autofocus，输入框可能已经是聚焦状态，那时再 focus() 不会再触发事件
    const bringInputToTop = () => {
        if (window.innerWidth > 700) return;
        const header = document.querySelector('.subpage-header');
        const headerHeight = header ? header.getBoundingClientRect().height : 0;
        const top = input.getBoundingClientRect().top + window.scrollY - headerHeight - 6;
        window.scrollTo({top: Math.max(0, top), behavior: 'smooth'});
    };
    input.addEventListener('click', bringInputToTop);
    input.addEventListener('focus', bringInputToTop);

    chipsBox.addEventListener('click', event => {
        const button = event.target.closest('.search-chip');
        if (!button || button.disabled) return;
        const word = button.dataset.word;
        // 再次点击同一个推荐词就取消它
        const terms = input.value.trim().split(/\s+/).filter(Boolean);
        const index = terms.indexOf(word);
        if (index >= 0) terms.splice(index, 1);
        else terms.push(word);
        input.value = terms.join(' ');
        currentPage = 1;
        render();
        input.focus();
    });

    scopeBox.addEventListener('click', event => {
        if (!event.target.closest('#scope-clear')) return;
        packScope = '';
        renderScope();
        renderChips();
        currentPage = 1;
        render();
    });

    input.addEventListener('input', () => {
        clearTimeout(timer);
        // 输入停顿后再搜索，避免每敲一个字都重排
        timer = setTimeout(() => { currentPage = 1; render(); }, 150);
    });
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        clearTimeout(timer);
        currentPage = 1;
        render();
    });
    window.__resolvePageReady?.();
    // 异步渲染完、页面可见后再聚焦一次（兜底，确保不用再点一下就能输入）
    input.focus({preventScroll: true});
}).catch(error => {
    console.error(error);
    summary.textContent = t('search.failed');
    window.__resolvePageReady?.();
    input.focus({preventScroll: true});
});
