# CI跨平台测试修复 v55

日期：2026-10-14；应用仍0.4.11。用户要求先保存0.5计划，再判断CI是否需要修复并执行。0.5草案已保存至规划目录并接入索引／TODO／路线，仅规划，不启动成长代码。

## 一、需要修复的确认问题

GitHub运行`38575110709`对应be67ed7：文档检查成功，测试1352通过／13失败／15默认报告跳过；3个测试文件失败，未进入后续交付步骤。完整release-vitest.log已下载留存，公开运行见[CI运行](https://github.com/MiraCeo/The-Bidding-of-Isaac-Rush-Restraint/actions/runs/38575110709)。

| 失败组 | 数量 | 原因 |
| --- | --- | --- |
| deployment.test.mjs | 7 | 合成fixture提交为40个a，但部分调用继承CI的真实BIDDING_EXPECTED_SHA，提前被真实提交守卫拒绝 |
| client-classic-regression.test.ts | 5 | Windows冻结原始状态hash直接用于Linux；AI诊断权重浮点尾数不同 |
| noise-ecology-research.test.ts | 1 | Eden完整过程指纹包含相同的诊断权重尾数差异 |

这次不是5秒超时或文档目录／JSON缺失。需要修复测试隔离与跨运行时基线，不需要修改游戏规则、AI算法、计分或保存恢复逻辑。

## 二、部署测试隔离

修改仅在测试：beforeEach为合成fixture设置预期提交与根路径，afterEach恢复原环境。新增用例故意让环境预期提交与fixture不一致，确认不传覆盖参数时生产默认守卫仍拒绝。没有删除工作流BIDDING_EXPECTED_SHA、取消require-clean或修改生产prepareDeployment。

Windows携带CI真实SHA和路径已复现7个失败，修复后同条件定向通过。真实Linux环境复验过程中另发现npm脚本的未加引号ignore glob被Bash展开成依赖／临时目录列表，误扩大lint范围；给两个glob加双引号，保留原lint规则与范围。build-release原direct-spawn已经传原字面量，不把该额外问题算成原13个失败之一。

## 三、逐字段与旧源码对照

从Node官方v24.15.0发行目录取得Linux x64包，并按同目录SHASUMS256验证：`472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6`。Windows／WSL Ubuntu24.04都为Node24.15.0、V8 13.6.233.17-node.48，比较10局／780状态：

- 18个状态有差异，共18处数值；仅revealedAiDecisions中的finalWeights：high_bid、disrupt_high、disrupt_cooperate、withdraw。
- 最大绝对差约`7.105427357601002e-15`。
- 行动选择、报价、资金、库存／奖励、权威积分、随机状态和其余字段完整相同；不能从raw hash变化推定正式玩法改变。

进一步从不可变旧Git提交独立执行，而不是从待审新实现生成期望值：

1. 经典旧功能提交`8ea001f40d6476c7e75e9bf99a5c538e79f447e4`：原780个Windows冻结hash全部复现；Windows旧／当前780状态全等，Linux旧／当前780状态全等。
2. 研究旧引擎提交`1db86bae1e499855d71d3861ae0e5a30f33628ff`，使用固定pace_bid输入脚本：Windows五角色原指纹全部复现；Linux仅Eden为f0c669eb，其余相同，与CI失败完全对应。

旧源码经git archive提取，probe以同一bundle在两种真实运行时执行，原数据保留。研究输入脚本用于规定输入，不修改旧引擎；没有把当前游戏结果当旧golden。临时旧TS／Linux源码副本移到本机Temp的独立任务目录，避免被现有宽范围tsconfig当正式源码；最初研究副本触发的类型错误属于临时路径问题，移出后检查通过，不放宽tsconfig。

## 四、修复方式与边界

原classic-0.2.13-baseline.json及Windows原golden不动。新增固定classic-cross-runtime-baseline.json，包含旧提交、运行时、原基线canonical摘要和18个Linux完整状态hash；仅在Linux读取对应旧捕获值，其余762个状态仍原值。所有断言仍完整SHA256相等，不做toBeCloseTo、统一舍入或允许任意数值误差。

研究指纹同样按已独立捕获的Linux值比较；应用算法、数据文件、规则兼容身份与原始事实没有改写。新增基线锚定回归，校验原canonical摘要、旧源码身份、18个合法结果／榜单阶段键，不允许新增未知阶段覆盖。

这些捕获已验证Windows24.15与Linux24.15，不冒称覆盖全部运行时；未来发生新差异仍需定位，不能自动更新fixture。此修复不是把所有hash失败归类为“只是浮点”。

## 五、验证与留存

Windows与真实Linux携带CI预期SHA／base的三个原失败文件定向均66项通过；最终Windows全量1367通过／15默认报告跳过、105文件通过／120总文件，4 workers105.78秒。真实Linux隔离源码／独立npm ci／同版Node全量同为1367通过／15默认报告跳过，2 workers324.64秒；两端类型、lint、普通网页构建及离线内存构建通过。WSL／挂载目录耗时不当CI耗时或优化指标。

两端离线内存结果完全一致：0.4.11，buildId5505eaa6af58，1,212,007字节，SHA256 `bef86169a69b31fd58c5d37e39a44764ac9763501d175f50b87a28fc07d0cd45`。这里只验证bundle与standalone契约，没有写入dist-offline、覆盖旧包／manifest或回填release门禁；原固定74d46875feeb的SHA仍b67c632920104b160ea3dd0c18f7ed41ddae63bbbef6419c92411ec374d1fb9e。新的工程指纹来自npm命令引用修正，不是玩法升级，应用仍0.4.11。

新增2项回归：旧基线／Linux变体锚定，以及环境默认提交守卫仍有效。原CI13个失败已在相同预期SHA条件和实际Linux运行时消除，不关测试、不跳过Linux、不加全局数值容差。原React测试act提示属于已有日志，不从全量通过推断所有环境问题已经消除。

runtime-diff.json SHA256 `fc954291911688d125fa4c75680f39cee58223e2db4aeb68ab2ab0913078c04b`；capture-proof.json SHA256 `91d9628e660b2655943588a303344089cb4e1e5f6089701c7f4cab6adb33439e`。Windows原classic-0.2.13-baseline.json字节SHA仍d655a6c21bcf207ba6edebcc9d9b0a9b6df66b63508ccbad6f78e74993589f38。

本机证据在web/work/ci-38575110709：原日志、Windows环境串入复现、官方Node清单／包、旧Git源码archive、双运行时780状态／研究指纹、runtime-diff、capture-proof及定向／全量日志。源码副本留在C:/Users/12782/AppData/Local/Temp/isaac-ci-38575110709-sources；不删除原用户资料，不修改系统Node、WSL设置或依赖锁版本。

本轮未commit／push／触发远端重跑；旧失败run的状态不会因本地测试通过自动变绿。0.5角色条件仍未定稿，现有五角色和最高AI不变，直接file／真实下载未验收范围保留。
