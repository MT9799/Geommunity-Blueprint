/**
 * 关卡包总览
 * 数据来自 levels-data.js（levelpacks.json + levels.json）
 * 展示字段：pack.name 名称、pack.description 说明、
 * pack.cover 封面（留空则找 data/packcovers/<包id>.png / .jpg / .webp，再回落到 pack.icon / 首个有图的关卡）
 */
const root = document.getElementById('level-packs');
const searchBox = document.getElementById('search-box');

document.title = t('levels.title');
applyI18n();
// 点击搜索框进入搜索页
if (searchBox) searchBox.addEventListener('click', () => { location.href = './search.html'; });

loadLevelsData().then(async ({ packs }) => {
    // 把「包 id → 名称」记在会话里：关卡包页面要等同一份数据到位才知道包名，
    // 有了这份缓存就能在解析阶段先把标题填上，不会先闪一下占位文字
    try {
        const names = {};
        packs.forEach(pack => { names[pack.id] = pack.name; });
        sessionStorage.setItem('packNames', JSON.stringify(names));
    } catch (error) {
        // 隐私模式等环境下 sessionStorage 不可用，忽略即可
    }
    const covers = await Promise.all(packs.map(pack => resolvePackCover(pack)));
    root.innerHTML = packs.map((pack, index) => {
        const icon = covers[index];
        const description = pack.description || t('pack.lede', {count: pack.levels.length});
        const href = `./pack.html?pack=${encodeURIComponent(pack.id)}`;
        // 封面只写 data-src：滚到跟前才取（封面常常回落到某关的示意图，动辄上百 KB）
        const iconHTML = icon
            ? `<div class="pack-icon" data-src="../data/${icon}"><span>⌁</span></div>`
            : '<div class="pack-icon"><span>⌁</span></div>';
        return `<a class="pack-card" href="${href}">${iconHTML}<div class="pack-info"><h2>${pack.name}</h2><strong>${t('pack.levels', {count: pack.levels.length})}</strong><p>${description}</p></div><span class="card-action">→</span></a>`;
    }).join('');
    observeLevelThumbs();
    // 从关卡包返回时停在第几行就是第几行，而不是回到顶部
    restoreListScroll();
}).catch(error => {
    console.error(error);
    root.innerHTML = `<p>${t('pack.failed')}</p>`;
});
