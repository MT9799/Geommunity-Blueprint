# TODO

后续要做的事情。条目里的关卡数据清单来自 `data/levels.json` / `data/levels/*.gmt` 的现状盘点。

## 1. 补全关卡信息

### 1.1 缺答案图

- `straightedge-only-pzls`：circumcenter-isosceles150、point-on-radical-axis、isosceles-double-circle

### 1.3 缺步数 targetSteps

- `straightedge-only-pzls`：circumcenter-isosceles150、point-on-radical-axis、isosceles-double-circle

### 1.4 缺说明 subtitle

除 `ewp`（99）、`xmath`（25）之外的 7 个包整包都没有：`c-s-pzls-other`（59）、`xeuclidea-puzzle`（56）、`straightedge-only-pzls`（36）、`from-baidu-tieba`（34）、`mingjing-forum`（16）、`euc-addit`（10）、`sprfes`（10）。逐关的 id 清单需要时再列。

### 1.5 其它

- `keywords`：每关都有，但都只有最基本的关键词，需要补全。
- 由于关卡信息是ai批量自动读取的，可能有一部分关卡的信息有误（比如L/E数不对，题目/答案图片不对，等等），仍需要仔细检查一遍。
- 有一部分关卡还能压缩步数。

## 2. 求解器

### 2.1 求解器优化

- 依然存在搜不出来解的情况（比如一些单尺关卡），需要收集具体关卡、分析搜索策略（剪枝 / 工具集 / 目标判定）。

### 2.2 把关系雷达接进启发式打分（还没做）

关系雷达本身已经做完（判定内核 `solver/bs-relations.js`）。下一步是把同一套判定喂给启发式（`solver/bs-heuristic.js`），按性价比分三步，**一步步加、每步做 A/B**：

1. **静态提示 → 打分**：搜索开始时对给定图形跑一遍轻量扫描，在 `bridge` 上加一项 `relationScore`
   （建议权重 60~150：比目标 10000 低一个量级、比邻近 8 高）——候选线命中共线组加分、
   与已知线平行 / 垂直 / 成定点角加到 `direction`、候选圆半径等于某个已知圆半径（= 紧圆规）加分、
   新点落在已知圆上 / 到某中心等距加到 `supports`。**只加权、不剪枝**。
2. **状态内增量维护**：给每个 beam 条目挂一个小的 `relationCache`，只在新点 / 新圆出现时局部更新
   （新点查共线、查半径表、查等距中心；新圆把半径塞进半径表）。每个候选 O(P²)，用 `generated` 做预算保护，
   超预算退回第 1 步。
3. **把关系变成探针**：紧圆规命中 → 新的「半径搬移」探针（与切线 / 直径探针同档）；
   共线组 → 会合的反向地标候选；等距中心 / 共圆 → 给 `structuralCompletion` 一个目标圆心候选。
   探针只提案 + 重放验证，失败不动 beam 条目。

验证：同一题关 / 开关系提示比解质量与耗时；构造「必须拷贝半径」的单规题看新探针能不能命中。
内核自检见 `src/solver/relations-test.js`（`npm run test:relations`）。

### 2.3 启发式的其它优化

- C++ v12 启发式的移植已经做完（`solver/bs-heuristic.js`，见 CHANGELOG 1.2.2）：家族池 / 新颖度池、四个探针、两条会合、目标收尾、点会合、单圆圆心收尾、反向地标、目标点对缓存都已接入。
  只剩**并行调度**没做：coverage threads 那一支要 `threads > 1` 才会触发，本构建的启发式是单线程（勾选开关时线程数按 1 算）。

## 3. gmt 解析

### 3.1 存在失效图形的 5 关（已实测确认）

把关卡装进几何引擎后，下列对象在运行时是 `valid === false`（点了不生效 / 画不出来）：

| 关卡 | 失效对象 |
| --- | --- |
| `ewp/ewp150` | F、I、J、K |
| `xeuclidea-puzzle/xep17` | T、U、V、W |
| `xeuclidea-puzzle/xep18` | D1、E1 |
| `xeuclidea-puzzle/xep18-2` | B1、C1、E1、G1、B2、C2 |
| `xeuclidea-puzzle/xep19` | G、H、N、O |

（复现方式：对每关的 gmt 执行 `parseGmt` 后 `geometryManager.loadStorage(...)`，再筛 `!element.getValid()`。）

### 3.2 预作图结果与预期对不上

有一部分关卡的 gmt 预作图结果和预期不一致，需要逐关核对（先确认是哪几关、再改 gmt 或解析器）。

## 4. 网页完善

### 4.1 网页交互

可能还存在一些bug，需要在使用过程中发现并修复。

### 4.2 网页样式

网页样式需要进一步美化。手机版适配也需要优化。

## 5. 其它

### 近期TODO()：

- 进一步优化 bs 内核
- 交点判定逻辑完善（应该做完了，有待测试）
- 继续补全关卡信息
- gmt 兼容性和正确性检查

### 远期：

- 圆弧工具
- 两线角平分线、线圆/圆圆切线、复制圆工具等的gmt支持
- 关系判断工具
- 显示轨迹工具
- 支持 gmt 的 `rules` 设定
- 夜间模式
- 账号系统
- 锈规作图模式
- bs L星 及 其他限制性作图
