/**
 * 关卡包详情（关卡列表）
 * 数据来自 levels-data.js（levels.json + levelpacks.json 合并结果）
 * 展示字段：pack.name 名称、pack.description 说明；
 * 每关：level.title 标题、level.diagram 缩略图、
 * level.targetSteps 步数、level.note 悬停提示
 * 每页显示 LEVELS_PAGE_SIZE 关，页码写在地址栏的 page 参数里
 */
const query = new URLSearchParams(location.search);
const packId = query.get('pack');
const queryPage = Math.max(Number(query.get('page')) || 1, 1);
const title = document.getElementById('pack-title');
const description = document.getElementById('pack-description');
const list = document.getElementById('pack-levels');
const pager = document.getElementById('pack-pager');
const pagerTop = document.getElementById('pack-pager-top');
const searchBox = document.getElementById('search-box');
const backgroundImageContainer = document.getElementById("background-image-container");
const heroBanner = document.querySelector('.hero-banner');
// 翻页用 pushState，滚动位置统一由脚本控制，关掉浏览器自带的历史滚动恢复
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// 跨文档页面过渡：等关卡列表渲染完再让新页面切入
// （head 里已经先挂了 promise；这里不要覆盖）
if (!window.__pageReady) {
    window.__pageReady = new Promise(resolve => { window.__resolvePageReady = resolve; });
}

document.title = t('pack.title');
applyI18n();

/**
 * 让头图上沿叠到 sticky header 后面 过程函数
 * 头图靠负上边距折上去，大小必须等于 header 的实际高度；
 * 高度会随语言 / 字体变化，所以量出来写进 CSS 变量，并在尺寸变化时再量一次
 */
function syncPackHeaderHeight() {
    const header = document.querySelector('.subpage-header-pack');
    if (!header) return;
    const height = header.offsetHeight;
    if (height) document.documentElement.style.setProperty('--pack-header-height', `${height}px`);
}
syncPackHeaderHeight();
window.addEventListener('resize', syncPackHeaderHeight);
if (typeof ResizeObserver === 'function') {
    const header = document.querySelector('.subpage-header-pack');
    if (header) new ResizeObserver(syncPackHeaderHeight).observe(header);
}

/**
 * 量头图平均色，写到 .hero-banner 的 CSS 变量上 过程函数
 * 底板与上方淡出都用这个颜色；再按它的相对亮度决定标题 / 简介等文字用黑还是白
 * @param {HTMLImageElement} image
 */
function applyHeroAverageColor(image) {
    try {
        // 缩到 32×32 再统计：足够代表整体色调，也避免大图逐像素的开销
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', {willReadFrequently: true});
        if (!context) return;
        context.drawImage(image, 0, 0, size, size);
        const {data} = context.getImageData(0, 0, size, size);
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < data.length; index += 4) {
            if (data[index + 3] < 8) continue;
            red += data[index];
            green += data[index + 1];
            blue += data[index + 2];
            count++;
        }
        if (!count) return;
        const average = [Math.round(red / count), Math.round(green / count), Math.round(blue / count)];
        // WCAG 相对亮度：比 0.18 亮（浅底）→ 黑字，更暗 → 白字
        const linear = value => {
            const channel = value / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        };
        const luminance = 0.2126 * linear(average[0])
            + 0.7152 * linear(average[1])
            + 0.0722 * linear(average[2]);
        const root = heroBanner || document.documentElement;
        root.style.setProperty('--hero-avg-rgb', average.join(', '));
        root.style.setProperty('--hero-ink', luminance > 0.18 ? '#172321' : '#ffffff');
    } catch (error) {
        // 用 file:// 打开时 canvas 可能被当作跨域、读不出像素：保留 CSS 里的兜底色即可
        console.warn('无法读取头图平均色：', error);
    }
}

loadLevelsData().then(({ packs }) => {
    const pack = packs.find(item => item.id === packId);
    if (!pack) throw new Error('pack not found');
    title.textContent = pack.name;
    description.textContent = pack.description || t('pack.lede', {count: pack.levels.length});
    // 桌面端左侧封面：优先用关卡包 cover，没有就回落到首关示意图 / 包图标
    const coverPath = pack.cover || (typeof packIcon === 'function' ? packIcon(pack) : '');
    const coverImage = document.getElementById('pack-cover');
    if (coverImage && coverPath) {
        coverImage.alt = pack.name;
        coverImage.hidden = false;
        coverImage.addEventListener('error', () => { coverImage.hidden = true; }, {once: true});
        coverImage.src = `../data/${coverPath}`;
    }
    const backgroundImage = document.createElement("img");
    backgroundImage.alt = pack.name;
    backgroundImage.className = "pack-backgroundImage";
    // 监听要在设 src 之前挂：缓存的图片也可能在同一次任务之后就触发 load
    backgroundImage.addEventListener('load', () => applyHeroAverageColor(backgroundImage), {once: true});
    backgroundImage.src = `../data/${pack.cover || coverPath}`;
    backgroundImageContainer.appendChild(backgroundImage);
    // 分页：翻页只重绘条目和上下翻页条，不重新加载页面 / 头图
    const levels = pack.levels;
    const totalPages = Math.max(Math.ceil(levels.length / LEVELS_PAGE_SIZE), 1);
    let currentPage = Math.min(queryPage, totalPages);

    /** 重绘当前页的条目与上下翻页条 过程函数 */
    const renderPage = (page, animate) => {
        const start = (page - 1) * LEVELS_PAGE_SIZE;
        // 先摘掉动画类：首次渲染重新塞条目时不要误播
        list.classList.remove('list-enter');
        list.innerHTML = levels
            .slice(start, start + LEVELS_PAGE_SIZE)
            .map((level, index) => levelRowHTML(level, {index: start + index, page: page}))
            .join('');
        const pagerHtml = pagerHTML(page, levels.length, target =>
            `./pack.html?pack=${encodeURIComponent(packId)}&page=${target}`, true);
        pager.innerHTML = pagerHtml;
        if (pagerTop) pagerTop.innerHTML = pagerHtml;
        observeLevelThumbs();
        if (animate) animateListItems(list);
    };

    /** 客户端翻页 过程函数 */
    const goToPage = (target, url) => {
        if (target === currentPage) return;
        currentPage = target;
        history.pushState(null, '', url || `./pack.html?pack=${encodeURIComponent(packId)}&page=${target}`);
        renderPage(currentPage, true);
    };

    const handlePagerClick = event => {
        // Ctrl / Cmd / Shift 点击仍交给浏览器（可在新标签打开）
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a.pager-item');
        if (!link) return;
        event.preventDefault();
        const url = new URL(link.href, location.href);
        const target = Math.min(Math.max(Number(url.searchParams.get('page')) || 1, 1), totalPages);
        goToPage(target, url.href);
    };
    pager.addEventListener('click', handlePagerClick);
    if (pagerTop) pagerTop.addEventListener('click', handlePagerClick);
    // 浏览器前进 / 后退：同样只换条目
    window.addEventListener('popstate', () => {
        const params = new URLSearchParams(location.search);
        const target = Math.min(Math.max(Number(params.get('page')) || 1, 1), totalPages);
        if (target === currentPage) return;
        currentPage = target;
        renderPage(currentPage, true);
    });

    renderPage(currentPage, false);
    // 从关卡返回时停在原来那一屏，而不是回到列表顶部
    restoreListScroll();
    // 关卡行已经进 DOM，可以切入；缩略图继续按需加载
    window.__resolvePageReady?.();
    // 搜索：点击搜索框进入搜索页，默认只搜这个包
    if (searchBox) {
        searchBox.placeholder = t('pack.searchIn', {name: pack.name});
        searchBox.addEventListener('click', () => {
            location.href = `./search.html?pack=${encodeURIComponent(packId)}`;
        });
    }
}).catch(error => {
    console.error(error);
    description.textContent = t('pack.failed');
    window.__resolvePageReady?.();
});
