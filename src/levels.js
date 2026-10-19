/**
 * 关卡包总览
 * 数据来自 levels-data.js（levelpacks.json + levels.json）
 * 展示字段：pack.name 名称、pack.description 说明、
 * pack.cover 封面（留空则找 data/packcovers/<包id>.png / .jpg / .webp，再回落到 pack.icon / 首个有图的关卡）
 */
const root = document.getElementById('level-packs');
const searchBox = document.getElementById('search-box');
// 跨文档页面过渡：等关卡包列表渲染完再让新页面切入
// （head 里已经先挂了 promise；这里不要覆盖）
if (!window.__pageReady) {
    window.__pageReady = new Promise(resolve => { window.__resolvePageReady = resolve; });
}

document.title = t('levels.title');
applyI18n();
// 点击搜索框进入搜索页
if (searchBox) searchBox.addEventListener('click', () => { location.href = './search.html'; });

loadLevelsData().then(({ packs }) => {
    // 把「包 id → 名称」记在会话里：关卡包页面要等同一份数据到位才知道包名，
    // 有了这份缓存就能在解析阶段先把标题填上，不会先闪一下占位文字
    try {
        const names = {};
        packs.forEach(pack => { names[pack.id] = pack.name; });
        sessionStorage.setItem('packNames', JSON.stringify(names));
    } catch (error) {
        // 隐私模式等环境下 sessionStorage 不可用，忽略即可
    }
    // 先渲染条目，不等封面探测：探测要真的把图下下来，慢网下整页会一直空着。
    // 这里只用数据里现成的 cover / icon 作为 data-src，真正的下载交给 observeLevelThumbs 按需加载
    root.innerHTML = packs.map((pack, index) => {
        const icon = pack.cover || packIcon(pack);
        // 卡片图标用压缩图；原图留作兜底（新包还没跑 npm run thumbs 时）
        const iconThumb = compressedThumbPath(icon);
        const description = pack.description || t('pack.lede', {count: pack.levels.length});
        const href = `./pack.html?pack=${encodeURIComponent(pack.id)}`;
        // 封面只写 data-src：滚到跟前才取（封面常常回落到某关的示意图，动辄上百 KB）
        const iconHTML = icon
            ? `<div class="pack-icon" data-src="../data/${iconThumb}" data-fallback="../data/${icon}"><span>⌁</span></div>`
            : '<div class="pack-icon"><span>⌁</span></div>';
        return `<a class="pack-card" href="${href}">${iconHTML}<div class="pack-info"><h2>${pack.name}</h2><strong>${t('pack.levels', {count: pack.levels.length})}</strong><p>${description}</p></div><span class="card-action">→</span></a>`;
    }).join('');
    observeLevelThumbs();
    // 从关卡包返回时停在第几行就是第几行，而不是回到顶部
    restoreListScroll();
    // 条目已经进 DOM，可以切入；封面继续按需加载
    window.__resolvePageReady?.();
    // 没有 cover 字段的包：再异步按候选路径探测一次（有 cover 的直接用，不必白等网络）
    const pending = packs.map((pack, index) => {
        if (pack.cover) return null;
        return resolvePackCover(pack).then(icon => {
            if (!icon) return;
            const cell = root.querySelectorAll('.pack-card .pack-icon')[index];
            // 只补还没开始加载的格子；已经在加载 / 已显示的不动
            if (cell && cell.hasAttribute('data-src')) {
                cell.dataset.src = `../data/${compressedThumbPath(icon)}`;
                cell.dataset.fallback = `../data/${icon}`;
            }
        });
    }).filter(Boolean);
    if (pending.length) Promise.all(pending).then(() => observeLevelThumbs());
}).catch(error => {
    console.error(error);
    root.innerHTML = `<p>${t('pack.failed')}</p>`;
    window.__resolvePageReady?.();
});
