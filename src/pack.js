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
const searchBox = document.getElementById('search-box');

document.title = t('pack.title');
applyI18n();

loadLevelsData().then(({ packs }) => {
    const pack = packs.find(item => item.id === packId);
    if (!pack) throw new Error('pack not found');
    title.textContent = pack.name;
    description.textContent = pack.description || t('pack.lede', {count: pack.levels.length});
    // 分页
    const levels = pack.levels;
    const totalPages = Math.max(Math.ceil(levels.length / LEVELS_PAGE_SIZE), 1);
    const page = Math.min(queryPage, totalPages);
    const start = (page - 1) * LEVELS_PAGE_SIZE;
    list.innerHTML = levels
        .slice(start, start + LEVELS_PAGE_SIZE)
        .map((level, index) => levelRowHTML(level, {index: start + index, page: page}))
        .join('');
    pager.innerHTML = pagerHTML(page, levels.length, target =>
        `./pack.html?pack=${encodeURIComponent(packId)}&page=${target}`);
    // 从关卡返回时停在原来那一屏，而不是回到列表顶部
    restoreListScroll();
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
});
