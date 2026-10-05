/**
 * 关卡搜索页
 * 搜索范围：标题 / 说明 / 关键词 / L、E 步数；空格分隔的多个条件是「与」关系
 * 地址栏参数：q 关键词、pack 只在某个关卡包内搜索、page 页码，方便收藏与分享
 */
const RECOMMENDED_SEARCHES = [
    '中点', '垂直平分线', '角平分线', '垂线', '平行线', '切线', '内切圆', '外接圆',
    '正三角形', '正方形', '正多边形', '黄金比例', '弦', '最值', '多解', '5L', '6E', '单尺',
];

const params = new URLSearchParams(location.search);
const input = document.getElementById('search-input');
const scopeBox = document.getElementById('search-scope');
const chipsBox = document.getElementById('search-chips');
const summary = document.getElementById('search-summary');
const results = document.getElementById('search-results');
const pager = document.getElementById('search-pager');
let packScope = params.get('pack') || '';
let currentPage = Math.max(Number(params.get('page')) || 1, 1);

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

    /** 当前搜索词命中的关卡 */
    const matchesOf = words => levels.filter(level =>
        (!packScope || level.pack === packScope) && matchLevelSearch(level, words, packOf(level.pack)));

    /** 渲染结果列表与分页 */
    const render = () => {
        const terms = input.value.trim().split(/\s+/).filter(Boolean);
        const matched = matchesOf(terms);
        const totalPages = Math.max(Math.ceil(matched.length / LEVELS_PAGE_SIZE), 1);
        const page = Math.min(currentPage, totalPages);
        const start = (page - 1) * LEVELS_PAGE_SIZE;
        results.innerHTML = matched
            .slice(start, start + LEVELS_PAGE_SIZE)
            .map((level, index) => levelRowHTML(level, {index: start + index, packName: packOf(level.pack), levelFrom: searchURL({q: input.value.trim(), pack: packScope, page: page})}))
            .join('');
        pager.innerHTML = pagerHTML(page, matched.length, target =>
            searchURL({q: input.value.trim(), pack: packScope, page: target}));
        observeLevelThumbs();
        if (terms.length || packScope) summary.textContent = t('search.found', {count: matched.length});
        else summary.textContent = t('search.all', {count: levels.length});
        // 搜索条件写进地址栏
        history.replaceState(null, '', searchURL({q: input.value.trim(), pack: packScope, page: page}));
    };

    /** 渲染推荐搜索（带命中数量） */
    const renderChips = () => {
        chipsBox.innerHTML = RECOMMENDED_SEARCHES.map(word => {
            const count = matchesOf([word]).length;
            return `<button type="button" class="search-chip" data-word="${word}"${count ? '' : ' disabled'}>${word}<span>${count}</span></button>`;
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

    let timer = null;
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
}).catch(error => {
    console.error(error);
    summary.textContent = t('search.failed');
});
