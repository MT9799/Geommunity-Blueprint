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

- 依然存在搜不出来解的情况（比如一些单尺关卡），需要收集具体关卡、分析搜索策略（剪枝 / 工具集 / 目标判定）。

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
- 切线工具
- 交点判定逻辑完善
- 继续补全关卡信息
- gmt 兼容性和正确性检查
- 支持 gmt 的 `rules` 设定

### 远期：
- 夜间模式
- 网格模式
- 账号系统
- 锈规作图模式
- bs L星 及 其他限制性作图
