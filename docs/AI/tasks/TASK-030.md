# TASK-030: 项目全量重命名为 easy-oidc-provider (含 GitHub 仓库、本地目录、配置及文档)

## 状态: COMPLETED
**负责人**: AI Pair Programmer
**依赖**: TASK-029

---

## 1. 任务背景与目标
项目原名称为 `easy-oauth-worker`。然而：
1. 原名称容易让用户误解为“第三方 OAuth 客户端”或简单的代理 Worker，而实际上本项目是一个功能完备的自托管 **OpenID Connect & OAuth 2.0 Provider (身份认证与授权服务器 / IdP)**；
2. 为消除误解并提升项目品牌定位专业度，经用户确认选择新名称 **`easy-oidc-provider`**；
3. 本次任务的目标是将 GitHub 远程仓库、本地文件夹目录、工程配置 (`package.json`、`wrangler.toml`)、代码服务标识、部署脚本、测试用例以及架构文档全部同步更名为 `easy-oidc-provider`。

---

## 2. 变更实施范围

### 2.1 源码与配置变更
- `package.json`: 变更 `"name": "easy-oidc-provider"`;
- `wrangler.toml`: 变更 `name = "easy-oidc-provider"`, `SITE_NAME = "easy-oidc-provider"`;
- `src/index.ts`: 错误日志前缀与 `/health` 服务标识变更为 `easy-oidc-provider`;
- `src/views/layout.tsx`: 页脚徽标变更为 `Powered by easy-oidc-provider`;
- `src/views/admin/settings.tsx`: 默认站点名降级变更为 `easy-oidc-provider`;
- `src/services/oidc.service.ts`: 默认 Issuer 降级域名变更为 `https://easy-oidc-provider.pages.dev`;
- `scripts/deploy-pages.sh`: 默认项目名称变更为 `easy-oidc-provider`;
- `scripts/live-e2e-test.js`: 默认域名更新与健康检查双兼容断言;
- `scripts/seed.sql` & `scripts/generate-keys.ts`: 更新注释和工具说明;
- `.env`, `.env.example`, `.dev.vars`, `.dev.vars.example`: 更新 `SITE_NAME="easy-oidc-provider"`.

### 2.2 测试套件更新
- `test/health.test.ts`: 更新健康检查 `service` 字段断言与根路径响应文本断言为 `easy-oidc-provider`.

### 2.3 文档更新
- `README.md`: 全文替换项目标题、简介、架构图示、目录树及安装克隆指令;
- `AGENTS.md`: 更新文档链接;
- `docs/AI/GOAL.md`: 更新愿景与定位标题;
- `docs/AI/ARCHITECTURE.md`: 更新架构规范标题;
- `docs/AI/DECISIONS.md`: 更新架构决策记录;
- `docs/VISUAL_TEST_REPORT.md`: 更新视觉走查报告说明.

### 2.4 GitHub 仓库与本地目录变更
- GitHub CLI 远程仓库更名: `gh repo rename easy-oidc-provider --repo xzsean666/easy-oauth-worker --yes`;
- Git Remote URL 更新: `https://github.com/xzsean666/easy-oidc-provider.git`;
- 本地目录 `/ssd0/git/easy-oidc-provider` 重命名与软链接双向兼容建立.

---

## 3. 验收标准
- [x] 代码与配置文件中的 `easy-oauth-worker` 已更新为 `easy-oidc-provider`;
- [x] 全量测试套件 (17 文件, 140 测试) 100% 通过;
- [x] TypeScript 类型检查 0 错误;
- [x] GitHub 远程仓库名称成功变更为 `xzsean666/easy-oidc-provider`;
- [x] Git 远程源更新并能正常通信;
- [x] 本地目录重命名并支持双向访问.
