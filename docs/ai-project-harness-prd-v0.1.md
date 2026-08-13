# AI Project Harness 脚手架 PRD v0.1

## 1. 文档信息

- 产品名称：AI Project Harness
- 文档版本：v0.1
- 文档状态：初稿，待技术评审和试点验证
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

> Plugin 负责交付，Kernel 负责治理；Standard 规定什么结果可接受，Workflow 规定过程，Skill 规定 agent 如何工作，Connector 规定 agent 能连接什么。

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

### 4.2 非目标

- 不在 v0.1 中实现新的 LLM 或 agent runtime。
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

### 6.1 四类贡献

| 类型 | 定义 | 典型内容 | 主要验证方式 |
|---|---|---|---|
| Standard | 项目必须满足的约束 | 提交规范、文档规范、测试门禁、安全策略 | 静态检查、CI Gate、策略检查 |
| Workflow | 任务完成所遵循的过程 | Spec → Plan → Implement → Verify、Issue → PR | 状态机、阶段检查 |
| Skill | agent 完成某类任务的能力说明 | 原型复刻、代码审查、迁移生成 | Skill eval、产出检查 |
| Connector | 访问外部系统的能力 | GitHub MCP、浏览器、Figma、Jira | 权限检查、健康检查、调用结果 |

插件是安装和升级单元，一个插件可以同时贡献四类内容。例如 `github-development` 插件可以同时贡献 GitHub PR Standard、Issue-to-PR Workflow、GitHub 操作 Skill 和 GitHub MCP Connector。

### 6.2 依赖方向

```text
Workflow → Skill → Connector
Workflow → Standard
Skill → Standard
Connector 不依赖 Workflow 或 Skill
Standard 不依赖具体执行过程
```

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

`audit` 不修改项目；`plan` 输出证据、建议、预计变更文件和风险；`apply` 只执行用户确认的计划，并在执行前创建恢复点。

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
- 插件发现、安装、启用、禁用和卸载；
- 依赖、版本和冲突解析；
- 模板渲染、结构化合并和文件归属管理；
- 生命周期 Hook 调度；
- 权限声明和审批状态；
- `doctor`、`diff`、`sync`、`verify`；
- 更新事务、状态持久化和回滚。

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
├─ templates/
├─ schemas/
├─ migrations/
├─ hooks/
├─ standards/
├─ workflows/
├─ skills/
├─ connectors/
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

permissions:
  filesystem: {}
  network: {}
  secrets: []
  commands: []
```

### 8.4 文件归属和升级

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

### 8.5 内置模块

v0.1 至少提供以下官方模块：

- Git：Conventional Commits、分支策略、PR 模板、变更日志；
- Spec：需求澄清、验收条件、计划、实现和验证流程；
- Docs：架构文档、ADR、API 文档、文档漂移检查；
- Testing：快速验证、全量验证、测试生成和覆盖率门禁；
- GitHub：Issue、Branch、PR、Review、CI 状态和 GitHub MCP；
- Prototype：浏览器采集、本地实现、响应式截图和视觉对比。

### 8.6 Existing Project Adoption

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

1. Kernel/CLI 基础命令；
2. `harness.yaml`、lockfile 和插件 Manifest；
3. 现有项目 `adopt/audit/plan/apply` 流程；
4. 技术栈、工具链、文档、CI、Git 和 agent 配置扫描；
5. 差距报告、P0-P3 建议和集成计划；
6. 本地/Git 插件来源；
7. 依赖、冲突和版本解析；
8. 三种文件归属模式；
9. `install/sync/verify/migrate` 生命周期；
10. `update --plan`、事务更新和回滚；
11. 权限声明和 `doctor`；
12. Git、Spec、Docs、GitHub、Prototype 五个官方插件。

### 暂不包含

- 公共插件市场和在线评分；
- 多租户组织管理；
- 复杂的多 agent 运行时编排；
- 自动批准生产操作；
- 跨语言全自动代码重写。

## 13. 验收标准

一个全新的 Node Web 项目满足以下条件时，认为 MVP 可交付：

1. 执行一次 `harness init` 可以完成基础初始化；
2. 可以启用或关闭 Git、Spec、Docs、GitHub、Prototype 模块；
3. 所有生成文件有明确插件归属；
4. 修改受管理文件后，`harness update --plan` 能识别并展示冲突；
5. 插件新增权限时，CLI 会阻止静默安装并要求确认；
6. `harness verify` 与 CI 使用同一套检查入口；
7. 更新迁移失败时可以恢复到更新前状态；
8. Codex、Claude Code 至少有两个 agent adapter，能读取同一份项目事实来源；
9. 五个官方插件均有最小安装测试和至少一个 eval；
10. 一个已有 Node Web 项目执行 `harness audit` 不修改工作区，并输出可读的项目画像和差距报告；
11. `harness plan` 能把至少三条建议转换为包含文件、风险和验证命令的集成计划；
12. `harness apply --only ...` 只修改用户选择的模块，并支持失败恢复；
13. 文档、配置 Schema 和 CLI 帮助可独立阅读，不依赖模型记忆。

## 14. 版本路线

### v0.1：核心闭环与现有项目接入

完成 Kernel、CLI、插件协议、文件状态、锁定版本、更新计划、回滚、现有项目审计/集成闭环和五个官方插件。

### v0.2：组织化使用

增加组织级 preset、私有 registry、插件签名、allowlist、审计导出和更多 agent adapter。

### v0.3：生态能力

增加插件搜索、发布、版本评分、兼容性测试矩阵和社区插件审核流程。

## 15. 主要风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 插件 API 过早固化 | 后续难以演进 | v0.1 使用 `apiVersion`，限制 API 面，提供兼容层 |
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
├─ Configuration and lockfile
├─ Dependency/conflict resolver
├─ File ownership and migration
├─ Permission and audit
├─ Sync/verify/update/rollback
└─ Agent adapters
```

所有项目规范、开发流程、任务能力和外部连接都通过插件贡献给 Kernel。这样可以持续集成新的规范和 Skill，同时保持项目可审查、可验证、可升级和可回滚。
