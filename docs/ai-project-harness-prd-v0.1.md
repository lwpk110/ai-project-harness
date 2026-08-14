# AI Project Harness 脚手架 PRD v0.1

## 1. 文档信息

- 产品名称：AI Project Harness
- 文档版本：v0.1
- 文档状态：M1/M2/M3/M3.1 已实现，待 M3 试点验证
- 目标读者：产品负责人、平台工程师、AI Agent 开发者、研发团队负责人

## 2. 背景与问题

AI agent 已经能够参与需求分析、代码修改、测试和代码审查，但在不同项目中，agent 的工作质量高度依赖隐含的团队知识和临时提示词。常见问题包括：

- agent 不知道项目结构、关键约束和正确的验证命令；
- Git 提交、文档、测试和安全规范只存在于口头约定或长篇文档中；
- Spec 驱动开发、Issue 到 PR 等流程缺少统一的机器可执行状态；
- Skill、MCP 和外部工具配置分散，换项目或换 agent 平台需要重新配置；
- 模板一旦生成，后续规范、Skill 和连接器很难安全升级；
- 多个 agent 之间缺乏统一的权限、文件归属、审计和验证机制。

因此需要一个可组合、可升级、与具体 agent 平台解耦的项目级 Harness 脚手架。

## 3. 产品定位

AI Project Harness 是一个面向 AI agent 驱动开发项目的初始化、治理和升级工具。

它通过声明式配置和插件系统，将项目规范、开发流程、任务能力和外部系统连接统一安装到代码仓库中，并提供诊断、同步、验证、升级和回滚能力。

产品同时支持两种项目模式：

- `init`：为新项目生成基础 Harness；
- `adopt`：分析现有项目，提出改进建议，并以增量、可审查、可回滚的方式接入 Harness。

核心原则：

> Kernel 只负责机制和不变量；所有项目相关的产品能力都由 Plugin 交付。

“一切皆插件”不包括 Kernel 自身。配置、插件解析、权限、审计、不可变计划、事务执行、文件归属、验证和回滚构成不可替换的信任根；技术栈检测、审计规则、改进配方、Standard、Workflow、Skill、Connector 和 Agent Adapter 均由插件贡献。

## 4. 目标与非目标

### 4.1 产品目标

1. 新项目可以通过一条命令初始化可供 agent 使用的开发 harness。
2. 现有项目可以通过只读扫描获得技术栈、规范、工具和风险画像。
3. 团队可以查看有证据的差距报告和集成计划，再决定分阶段接入哪些能力。
4. 团队可以按开关和配置启用 Git、Spec、文档、测试、安全等规范。
5. 团队可以安装常用 Skill，例如原型复刻、代码审查、测试生成和依赖升级。
6. 团队可以以受控方式接入 GitHub MCP、浏览器、Figma、Jira 等 Connector。
7. Harness、插件和生成文件可以独立升级，并能识别用户定制、展示 diff、执行迁移和回滚。
8. 规范和流程不仅被写进提示词，还能被 CI、脚本和自动化检查执行。
9. 新增技术栈、规则、项目变换或 agent runtime 时，无需在 Kernel 中增加产品专用条件分支。

### 4.2 非目标

- 不在 v0.1 中实现新的 LLM 或 agent runtime。
- 不复制或 fork DeepSeek Harness；运行时通过可选 Connector/Agent Adapter 接入。
- 不替代 GitHub、Jira、Figma、CI 等外部系统。
- 不要求所有项目采用同一种 Git 流程、文档框架或测试框架。
- 不在 v0.1 中建设开放的商业插件市场。
- 不允许插件默认获得生产环境或任意文件系统权限。

## 5. 目标用户

### 5.1 项目研发团队

希望让 Codex、Claude Code、Cursor 或其他 coding agent 遵循同一套项目约束。

### 5.2 平台工程团队

希望维护组织级标准、插件、权限策略和 CI 模板，并向多个项目分发。

### 5.3 AI Agent/Skill 开发者

希望以统一协议发布可复用的 Skill、Workflow 和 Connector，而不修改 Harness Kernel。

## 6. 产品概念模型

### 6.1 两个贡献平面

插件是统一的安装、授权和升级单元，可以同时向项目平面和引擎平面贡献能力。

#### 项目平面

| 类型 | 定义 | 典型内容 | 主要验证方式 |
|---|---|---|---|
| Standard | 项目必须满足的约束 | 提交规范、文档规范、测试门禁、安全策略 | 静态检查、CI Gate、策略检查 |
| Workflow | 任务完成所遵循的过程 | Spec → Plan → Implement → Verify、Issue → PR | 状态机、阶段检查 |
| Skill | agent 完成某类任务的能力说明 | 原型复刻、代码审查、迁移生成 | Skill eval、产出检查 |
| Connector | 访问外部系统的能力 | GitHub MCP、浏览器、Figma、Jira | 权限检查、健康检查、调用结果 |

插件是安装和升级单元，一个插件可以同时贡献四类内容。例如 `github-development` 插件可以同时贡献 GitHub PR Standard、Issue-to-PR Workflow、GitHub 操作 Skill 和 GitHub MCP Connector。

#### 引擎平面

| 类型 | 输入 | 输出 | 是否允许副作用 |
|---|---|---|---|
| Detector | 只读 ProjectView | 带证据的 Fact | 否 |
| Rule | Fact 和策略配置 | Finding | 否 |
| Recipe | Fact、Finding 和配置 | 类型化 Operation 提案 | 否 |
| Verifier | 只读项目视图或已批准命令 | CheckResult | 仅允许声明的检查 |
| Adapter | 受治理的项目上下文和任务 | 外部 runtime 事件与结果 | 仅允许已授权的进程外能力 |

项目平面描述“项目获得什么”，引擎平面描述“Harness 如何观察、规划、验证和连接”。现有 `detect()`、`audit()`、`plan()` 和 agent 平台适配最终都由引擎平面贡献替代。

### 6.2 依赖方向

```text
Workflow → Skill → Connector
Workflow → Standard
Skill → Standard
Connector 不依赖 Workflow 或 Skill
Standard 不依赖具体执行过程

Detector → Fact
Rule: Fact → Finding
Recipe: Fact + Finding → Operation[]
Verifier: ProjectView → CheckResult[]
Adapter: GovernedContext → RuntimeResult
```

依赖关系只决定激活的拓扑顺序；独占 Provider、同名贡献和 Operation 冲突必须显式报错，不允许由文件扫描顺序或 import 顺序隐式决定。

### 6.3 Capability Seam

每项可替换能力由三种角色构成：

- Definition：由 Kernel 协议定义的版本化接口和数据结构；
- Provider：实现能力的插件贡献；
- Consumer：通过接口使用能力的 Kernel pipeline 或其他插件。

每项能力必须同时声明基数（单例、有序多项或按 key 多项）、选择和排序规则、失败与取消语义、权限、生命周期以及契约测试。Provider 不能导入其他 Provider 的内部实现。

### 6.4 Agent Runtime Adapter

Agent Runtime Adapter 是引擎平面贡献，也是 Kernel 与具体 agent runtime 之间的进程或协议边界。Connector 声明外部能力、健康检查和权限，Adapter 负责把项目事实、策略、工作目录和验证入口交给 runtime，并把执行结果、权限请求和审计事件映射回 Kernel。两者通常由同一个插件交付，但不能混为同一接口。

首个适配目标为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：

- AI Project Harness 继续负责现有项目接入、文件归属、策略、升级、回滚和统一验证；
- DeepSeek Harness 负责 agent loop、模型适配、工具、会话、上下文压缩、沙箱与执行；
- 首阶段通过 `dsh --profile headless` 提供一次性任务执行；
- 后续通过 ACP stdio 提供结构化会话、取消和权限请求；
- DeepSeek Harness 始终作为可选的进程外依赖，不进入 Kernel 的 runtime dependencies。

可借鉴其“一切皆插件”、能力 Definition/Provider/Consumer 分离、可逆生命周期，以及“模型可见信息可从日志重建”等原则；不引入 Cordis，也不把特定模型或 runtime 的配置固化到核心协议。

## 7. 典型用户流程

### 7.1 初始化项目

```bash
harness init \
  --preset startup-web \
  --agents codex,claude \
  --ci github
```

CLI 检测技术栈，生成 `AGENTS.md`、`.harness/`、验证脚本、CI 配置和已选插件的文件。

### 7.2 接入现有项目

现有项目采用只读分析开始的三阶段流程：

```text
audit → plan → apply
```

对应 CLI：

```bash
harness adopt
harness audit --format markdown
harness plan --preset backend-service
harness apply --only docs,git
```

`audit` 不修改项目；`plan` 输出证据、建议、预计变更文件和风险，并生成包含输入摘要、权限审查和不可变 ID 的 Plan；`apply` 只执行已批准且未过期的文件类 Operation，并在执行前创建恢复点，失败时回滚。命令和连接器 Operation 在执行 broker 完成前保持 review-required。

### 7.3 启用规范

```bash
harness add standard conventional-commits
harness add workflow spec-driven
harness add standard documentation-diataxis
```

启用后生成配置、agent 指令、检查脚本和 CI Gate。强约束以机器检查和 CI 为准，`AGENTS.md` 只提供上下文和操作说明。

### 7.4 安装 Skill 和 Connector

```bash
harness add skill prototype-replication
harness add connector github-mcp
harness doctor
```

CLI 展示权限需求。高风险权限需要用户确认；缺失凭据或能力时，`doctor` 给出可操作的修复建议。

### 7.5 更新和回滚

```bash
harness update --check
harness update --plan
harness update
harness rollback
```

更新前解析依赖、检查权限变化、生成 diff 和恢复点；迁移或验证失败时回滚到更新前状态。

## 8. 核心功能需求

### 8.1 Kernel 与 CLI

Kernel 必须负责：

- 解析和校验 `harness.yaml`；
- 插件发现、安装、启用、禁用、卸载和确定性生命周期；
- 依赖、版本、Provider 选择、排序和冲突解析；
- Manifest、Fact、Finding、Plan、Operation 和 CheckResult 的结构化校验；
- 权限审批和仅追加审计记录；
- 不可变计划、过期输入检测和类型化 Operation 执行；
- 模板渲染、结构化合并、文件归属和迁移；
- 更新事务、状态持久化、验证和回滚；
- 进程外插件的协议协商、超时、取消、输出限制和清理。

Kernel 不得包含 Node、Python、GitHub、文档标准、原型复刻或具体 agent runtime 的业务判断。`audit`、`plan`、`apply` 和 `verify` 是 Kernel pipeline，但其中的 Detector、Rule、Recipe、Verifier 和 Adapter 来自插件。

首版 CLI 命令：

```text
harness init
harness add <plugin>
harness remove <plugin>
harness enable <plugin>
harness disable <plugin>
harness plugin list|info|validate|pack
harness doctor
harness diff
harness sync
harness verify [--quick]
harness update --check|--plan|--dry-run
harness update
harness rollback
harness self update
```

### 8.2 声明式项目配置

```yaml
schema: 1

preset: startup-web

plugins:
  git-conventions:
    version: "^1.0"
    enabled: true
  spec-driven:
    version: "^1.0"
    enabled: true
  github-development:
    version: "^1.0"
    enabled: true
    contributions:
      connectors:
        github-mcp: true
      workflows:
        issue-to-pr: true

commands:
  bootstrap: ./scripts/bootstrap
  verify: ./scripts/verify

policies:
  production_access: approval
  require_tests: true
```

### 8.3 插件协议

插件目录：

```text
plugin/
├─ harness-plugin.yaml
├─ contributions/
│  ├─ standards/
│  ├─ workflows/
│  ├─ skills/
│  ├─ connectors/
│  ├─ detectors/
│  ├─ rules/
│  ├─ recipes/
│  ├─ verifiers/
│  └─ adapters/
├─ templates/
├─ schemas/
├─ migrations/
├─ runtime/          # 可选，官方 bundled 或第三方 hosted 入口
├─ tests/
└─ README.md
```

Manifest 最小字段：

```yaml
apiVersion: harness.dev/v1
kind: Plugin

metadata:
  name: github-development
  version: 1.0.0

compatibility:
  harness: ">=0.1 <1.0"

dependencies:
  plugins:
    git-conventions: "^1.0"

contributes:
  standards: []
  workflows: []
  skills: []
  connectors: []
  detectors: []
  rules: []
  recipes: []
  verifiers: []
  adapters: []

runtime:
  mode: declarative

permissions:
  filesystem: {}
  network: {}
  secrets: []
  commands: []
```

Manifest 是可静态检查的控制平面；可执行入口是单独声明的数据平面。安全相关的未知字段必须拒绝，不能静默忽略。`harness.lock` 必须记录 Manifest 摘要、包完整性、来源、精确依赖、已批准权限、runtime 模式和迁移版本。

不得继续使用正则字段匹配或未文档化的 YAML 子集解析配置和 Manifest。Kernel 必须完整解析文档，再按 `apiVersion` 做结构化校验。为避免自行实现 YAML 和安全关键 Schema 校验，v0.1 允许在评估后引入范围严格、固定版本、经过审计的 YAML parser 和 schema validator 作为 Kernel 基础依赖；这是对“runtime dependency-free”偏好的明确例外。技术栈框架、平台 SDK、agent runtime 和插件自身依赖不得因此进入 Kernel。

### 8.4 组合与变更流水线

```text
discover → resolve → inspect permissions → lock → activate
                                                │
audit: ProjectView → Detector[] → Fact[] → Rule[] → Finding[]
plan:  Fact[] + Finding[] → Recipe[] → Operation[] → 冲突/权限审查
apply: 已批准不可变 Plan → snapshot → Kernel executor → verify → commit/rollback
```

流水线必须满足：

- Fact 是观察结果，必须包含 evidence、Provider 和输入哈希；
- Finding 是由 Rule 基于 Fact 得出的结论，不得伪装成事实；
- Recipe 只能生成封闭且版本化的 Operation，不得直接写文件；
- 首批 Operation 包括 `file.create`、`file.replace`、`structured.merge`、`directory.ensure`、`command.run` 和 `connector.configure`；
- 路径必须是规范化的项目相对路径，Secret 只能以引用出现；
- 相同项目哈希、配置、插件 lock 和协议版本必须产生相同 Plan；
- `apply` 必须拒绝输入哈希过期、权限未批准或 Operation 类型未知的 Plan。

### 8.5 文件归属和升级

生成文件必须标注归属模式：

- `managed`：由插件管理，更新时替换但必须展示 diff；
- `structured-merge`：通过 YAML、JSON、AST 或标记区块合并；
- `seeded`：只初始化一次，后续由项目自行维护。

状态文件：

```text
harness.yaml       用户声明的版本范围和开关
harness.lock       精确插件版本、来源和完整性校验
.harness/state/    文件归属、基线哈希、迁移记录和审批记录
```

若用户修改过受管理文件，更新不得静默覆盖。

### 8.6 内置模块

v0.1 至少提供以下官方模块：

- Git：Conventional Commits、分支策略、PR 模板、变更日志；
- Spec：需求澄清、验收条件、计划、实现和验证流程；
- Docs：架构文档、ADR、API 文档、文档漂移检查；
- Testing：快速验证、全量验证、测试生成和覆盖率门禁；
- GitHub：Issue、Branch、PR、Review、CI 状态和 GitHub MCP；
- Prototype：浏览器采集、本地实现、响应式截图和视觉对比。
- Runtime：DeepSeek Harness headless/ACP Connector 的声明式插件。

### 8.7 Existing Project Adoption

现有项目接入是 v0.1 的一级能力。Harness 必须能够在不修改项目的前提下完成基线扫描，并生成结构化的项目画像和改进建议。

#### 扫描范围

- 编程语言、框架、包管理器和 lockfile；
- 单仓库/多包结构和主要目录边界；
- lint、format、typecheck、test、build 和迁移命令；
- CI 平台、工作流和本地/CI 命令差异；
- Git 分支策略、提交信息、PR 模板和变更日志；
- `AGENTS.md`、`CLAUDE.md`、`.cursor/rules` 等 agent 指令；
- API 文档、架构文档、ADR、数据库 schema 和迁移；
- Secret、危险脚本、生产连接和明显的安全配置风险；
- 已有 MCP、Skill 和外部工具配置。

#### 差距报告

每条建议必须包含：问题、证据、影响、建议动作、预计修改文件、风险、是否可以自动修复和优先级（P0/P1/P2/P3）。

- `P0`：安全、数据丢失或凭据泄露风险；
- `P1`：阻碍 agent 可靠工作的关键缺口，例如没有可重复的验证入口；
- `P2`：明显提升一致性、可维护性或协作效率的改进；
- `P3`：可选优化，例如补充 ADR 或增强变更日志。

#### 集成策略

现有文件默认遵循“保留现状、增量接入”原则：

- 已有 README、CI、lint、测试和 agent 指令优先使用 `structured-merge`；
- 新增架构文档、验证脚本和 Spec 目录可使用 `seeded`；
- 只有明确声明且用户确认的文件才使用 `managed`；
- 任何自动修改都必须进入 `harness diff`，并记录文件归属和基线哈希；
- `apply` 失败时恢复到集成前状态。

#### 现有项目配置

```yaml
project:
  mode: adopted
  detected:
    stack: node
    framework: nextjs
    ci: github-actions

integration:
  baseline: detected
  policy: preserve-existing
  auto_fix_max_priority: P2
```

v0.1 可以自动应用低风险、可逆的 P2/P3 改进；P0/P1 建议默认只生成计划并要求人工确认，生产凭据、权限和外部系统操作始终需要审批。

### 8.8 DeepSeek Harness Connector

内置 `deepseek-harness` 插件声明两个 Connector：

- `deepseek-harness-headless`：面向一次性、无人值守任务；
- `deepseek-harness-acp`：面向结构化会话、取消和权限请求。

v0.1 只交付声明式 manifest、启用/禁用、校验和权限展示所需的元数据，不安装或执行 DeepSeek Harness，不读取 `DEEPSEEK_API_KEY`。可执行桥接依赖插件 Hook、lockfile 和权限审批能力，应在这些 Kernel 能力完成后实现。

未来执行连接器必须满足：

- 外部包版本及完整性写入 `harness.lock`；
- 启动前展示命令、工作区写权限、网络域名和 Secret 名称；
- 只传递 Secret 引用，不把凭据写入项目或状态文件；
- 将项目根目录、生成的 agent 指令和统一验证命令显式交给 runtime；
- headless 进程非零退出、ACP 协议错误、取消和权限拒绝均形成可审计结果；
- 外部 runtime 不得绕过 `harness verify` 和项目策略。

### 8.9 本地前后端联调面

M3.1 提供 `harness serve`，在 `127.0.0.1` 启动同源静态控制台和 `harness.dev/http/v1` HTTP API。首个联调闭环包括：

- 浏览器读取项目摘要和只读 audit 报告；
- 浏览器请求生成不可变 Plan，并查看 Operation 范围、Provider、前置条件和 review 状态；
- 浏览器请求 apply，仍由现有 CLI/Kernel 执行权限校验、stale 检测、验证和回滚；
- API 不返回 Operation 内容或 Secret-like settings，避免控制台成为内容泄露通道。

该适配器只绑定 loopback，当前通过子进程调用 CLI，不提供认证、公共网络监听、多用户会话或远程执行能力。后续需要先完成 hosted lifecycle、身份认证和授权协议，才能替换为可部署的后端服务。

## 9. Skill 规范

每个 Skill 必须声明：

- 触发条件；
- 输入和前置条件；
- 可使用的工具和 Connector；
- 执行步骤；
- 产出格式；
- 完成标准；
- 失败和降级方式；
- 至少一个可重复 eval。

原型复刻 Skill 的最小产出：实现代码、目标视口截图、交互检查结果和视觉对比报告。

## 10. 安全与权限

插件和 Connector 视为供应链代码，必须声明：

- 可写文件路径；
- 可执行命令；
- 允许访问的网络域名；
- 需要的 Secret 名称；
- 是否需要高风险审批。

默认策略：

- 本地项目文件和测试命令可在沙箱内执行；
- 生产环境、合并 PR、发布、删除资源必须审批；
- CI 使用锁定版本和完整性哈希；
- 不允许插件读取任意环境变量；
- 记录安装、更新、权限变化和外部操作审计日志。

插件分为三种信任和执行等级：

| 等级 | 执行方式 | 约束 |
|---|---|---|
| Declarative | Kernel 解析数据并执行 | 默认等级，无插件代码执行 |
| Bundled | 官方插件通过公开 capability context 在进程内执行 | 使用与外部插件相同的协议和契约测试，不得导入 Kernel 私有模块 |
| Hosted | 第三方插件或 runtime 在进程外执行 | 需要 lock、权限审批、协议协商、超时、取消、输出限制和进程树清理 |

安装不等于激活。fetch、inspect、approve、install 和 activate 必须分离；新增可执行入口、扩大权限或改变文件归属模式时必须重新审批。任意阶段失败或取消都必须按相反顺序释放已注册的生命周期 effect。

## 11. 验证与评测

### 11.1 项目验证

`harness verify` 应统一执行项目已有的格式、lint、类型、测试、构建和安全检查。`verify --quick` 用于 agent 快速反馈。

### 11.2 Harness 自身评测

首版建立 5 至 10 个真实任务，覆盖：

- 新增接口并补测试；
- 按 Spec 流程实现功能；
- 修改文档并保持 API 文档同步；
- 创建 PR 并处理 CI 失败；
- 复刻一个页面并通过视觉检查。

指标包括：完成率、验证通过率、无关文件修改数、人工返工次数、权限越界次数、平均耗时和成本。

## 12. MVP 范围

### 必须包含

1. Kernel/CLI 基础命令和公开的 contribution protocol；
2. 插件 Manifest 的结构化解析、Schema 校验和由 Manifest 生成的 bundled catalog；
3. 删除手工维护的内置插件名称列表，官方插件走相同的发现、校验和启用路径；
4. `harness.yaml`、最小 lock 信息、插件状态和兼容性检查；
5. 只读 ProjectView、Fact、Detector、Rule 和 Finding contract；
6. 由官方插件提供技术栈、工具链、文档、CI、Git 和 agent 配置扫描；
7. 带 evidence 和 Provider provenance 的 P0-P3 差距报告；
8. Recipe、不可变 Plan 和首批类型化文件 Operation；
9. 保留现有文件的 `audit → plan → apply`，包含输入哈希、recovery snapshot 和文件归属；
10. Verifier contract、`doctor` 和统一 `verify`；
11. 权限元数据校验和 Plan 级权限审查，不执行未批准命令、网络或 Secret 操作；
12. Project Baseline、Git、Spec、Docs、GitHub、Prototype、DeepSeek Harness 七个官方声明式插件及其契约测试。

### 暂不包含

- 公共插件市场和在线评分；
- 任意第三方代码的进程内加载；
- Hosted executable plugin protocol 和进程监督器；
- 完整的远程 registry、签名、SemVer 求解和供应链策略；
- 插件迁移和跨版本事务更新；
- DeepSeek Harness headless/ACP 的实际执行；
- 多租户组织管理；
- 复杂的多 agent 运行时编排；
- 自动批准生产操作；
- 跨语言全自动代码重写。

## 13. 验收标准

v0.1 满足以下条件时可交付：

1. 新增 bundled declarative plugin 不需要修改 `src/cli.js`；
2. 官方插件与项目插件使用相同 Manifest、贡献协议、校验器和 catalog；
3. 新增技术栈检测或审计规则只需要新增 Detector/Rule contribution 和契约测试；
4. `harness audit` 使用只读 ProjectView，不修改工作区，并为 Fact 和 Finding 输出 evidence 与 Provider；
5. 相同项目哈希、配置和插件 lock 产生内容一致的 Plan；
6. Recipe 只能产生已知 Operation，插件不能在 `plan` 阶段直接写文件；
7. `apply` 只执行已批准且未过期的 Plan，保留现有文件，并记录 recovery、ownership 和 provenance；
8. 未声明或未批准的 filesystem、command、network 和 secret 能力被拒绝；
9. `harness verify` 与 CI 使用同一验证入口，Verifier 结果包含 Provider；
10. DeepSeek Harness 插件可被发现、校验、启用和禁用，但不会安装外部包、读取凭据或执行 runtime；
11. 核心 capability contract、七个官方插件和 adopt 流程均有自动化测试；
12. 架构、协议、配置 Schema、CLI 帮助和当前实现差距可独立阅读。

## 14. 版本路线

### v0.1：插件内核与安全接入闭环

规划完成 M0-M3：统一术语和 ADR、Manifest/catalog、Detector/Rule 只读组合、Recipe/Operation 受治理变更，以及七个官方声明式插件。当前已完成 M1：结构化 YAML、Manifest/catalog、兼容性、依赖拓扑和贡献 ID 唯一性；已完成 M2：不可变 ProjectView、声明式 Detector/Rule 组合和带 Provider 溯源的审计结果；已完成 M3：Recipe、不可变 Plan、Typed Operation、权限审查、stale 检测和文件类事务执行。M3 尚不执行命令或外部连接器，v0.1 也不执行第三方插件代码。

### v0.2：生命周期、升级与 Hosted Plugin

完成 M4：完整 lockfile、依赖求解、权限差异、迁移、事务更新/回滚、进程外协议和进程监督器。增加组织 preset、私有 registry、签名和 allowlist。

### v0.3：Agent Runtime Adapter

完成 M5：先交付 DeepSeek Harness headless，再交付 ACP；Codex 和 Claude Code 使用同一个 GovernedContext、审计结果和验证策略。

### v0.4：生态能力

增加插件搜索、发布、版本评分、兼容性测试矩阵、审计导出和社区插件审核流程。

## 15. 主要风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 插件 API 过早固化 | 后续难以演进 | v0.1 使用 `apiVersion`，限制 API 面，提供兼容层 |
| “一切皆插件”削弱治理 | 插件绕过权限、计划或回滚 | Kernel 作为不可替换信任根；插件只能提议 Operation，副作用由 Kernel 执行 |
| 官方插件拥有隐式特权 | 外部生态无法复用真实能力 | built-in parity；官方插件使用公开协议、catalog 和契约测试 |
| Provider 顺序不确定 | 相同配置产生不同结果 | 依赖拓扑、显式 priority、独占 Provider 冲突和 lockfile |
| 第三方代码在进程内执行 | 凭据泄露或任意文件修改 | 默认 declarative；第三方可执行能力仅允许 hosted process |
| 生成文件覆盖用户修改 | 数据丢失和信任下降 | 文件归属、基线哈希、diff、事务和回滚 |
| 插件供应链风险 | 密钥泄露或越权操作 | 权限声明、签名、锁定版本、allowlist |
| 配置选项过多 | 初始化和接入复杂 | preset + 分层覆盖 + `doctor` + 审计报告 |
| Skill 质量不稳定 | agent 行为不可预测 | 统一 Skill Schema、eval 和版本化 |
| 过度绑定某个 agent 平台 | 迁移成本高 | Agent adapter 与核心协议分离 |

## 16. 产品决策总结

AI Project Harness 的最小稳定内核不是一套 Prompt，而是：

```text
Kernel
├─ Plugin protocol
├─ Configuration, catalog and lockfile
├─ Dependency/provider resolver
├─ Capability registry and lifecycle
├─ Permission broker and audit log
├─ Fact/finding and immutable plan protocols
├─ Typed-operation transaction executor
├─ File ownership and migration
└─ Verify/update/rollback

Plugins
├─ Detectors, rules, recipes and verifiers
├─ Standards, workflows, skills and connectors
├─ Templates and structured merges
└─ Agent runtime adapters
```

Kernel 只定义机制、数据 contract 和不可绕过的不变量。所有项目知识、策略和平台行为都通过插件贡献；官方插件与外部插件使用相同协议。这样可以持续接入新的技术栈、规范、Skill 和 runtime，同时保持项目可审查、可验证、可升级和可回滚。
