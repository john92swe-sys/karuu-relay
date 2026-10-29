# KARUU Relay

**把自己的模型接口集中到一个本地入口，并看清每次请求的切换结果。**

[English](README.md) · [接口说明](docs/API.md) · [验证状态](docs/RELEASE_STATUS.md)

KARUU Relay 是一个使用自有 API 密钥的轻量模型网关。它适合已有研究助手、
获客工作台或内部工具的个人开发者，通过统一接口调用多个兼容的模型服务。

第一版提供统一聊天接口、自动备用切换、每日请求尝试上限、本地管理界面，
以及“公司资料摘要”和“开发信草稿”两个工作流。

这是 **v0.1.0 早期版本**。本次交付验证本地模拟服务与程序行为，尚未验证真实
云端供应商账户，也没有对接任何公司的实际获客系统。演示结果会清楚标注 DEMO。

## 先看演示：不需要 API 密钥

安装 Node.js 22 或更新版本后，在项目文件夹运行：

```sh
npm run demo
```

Windows 也可以双击 `start-demo.cmd`。

打开 **http://127.0.0.1:4319**，点击 Connect，载入示例并提交。
演示密钥是 `demo-token-not-for-production`，演示界面会自动填写。

演示会让第一个模拟接口返回限流，再由第二个模拟接口返回测试内容。
整个过程不调用云端模型、不消耗真实供应商额度。

## 接入自己的 API

```sh
node scripts/init.mjs
```

程序会创建本地 `.env` 和 `config.json`，已有文件不会覆盖。

1. 在 `.env` 中填写自己申请的供应商 API 密钥。
2. 在 `config.json` 核对所用模型、供应商顺序和请求上限。
3. 运行 `npm start`，或在 Windows 双击 `start.cmd`。
4. 打开本地页面，把自己 `.env` 中的 `KARUU_GATEWAY_KEY` 填入界面的令牌栏。

`.env`、真实 `config.json` 和运行数据均被 `.gitignore` 排除，不应上传 GitHub。
网关令牌用于访问这个本地程序；供应商密钥用于访问上游，两者用途不同。

## 两个外贸工作流

**Company brief / 公司摘要：**粘贴已获取的公司网页文字，填写来源网址，生成
业务摘要、产品匹配理由与待核实事项。系统不会自行访问网址，也不能把推理
当作已经核实的采购需求。

**Outreach draft / 开发信草稿：**根据来源文字、品牌及产品介绍生成简短开发信。
结果标注 `DRAFT_UNSENT`。程序没有邮件发送、社媒私信或 CRM 写入功能。

不要把未知价格、MOQ、交期、认证等信息写成确定承诺。工作流提示词要求模型
保留未知项，但生成内容仍需要使用者审阅。

## 接入 Jarvis 或其他程序

如果客户端支持 OpenAI 风格的 **Chat Completions**：

- Base URL：`http://127.0.0.1:4319/v1`
- API Key：本地 `KARUU_GATEWAY_KEY`
- Model：`/v1/models` 返回的配置名称，例如 `auto`、`research`、`writing`

本版没有实现 Anthropic Messages 或 OpenAI Responses 协议；不能直接宣称
兼容所有 Claude Code、Codex 或其他客户端。包括 DeepSeek Harness 在内的
特定客户端连接仍需单独验证。

## 费用和适用范围

软件采用 MIT 开源许可证。使用者自己申请上游账户和额度，实际费用取决于
供应商、模型和账户。示例配置不代表永久免费承诺。每日请求上限统计请求尝试，
包含失败尝试，不等于 token 上限或金额上限。

本版把供应商密钥放在环境变量或本地 `.env` 文件中，未实现加密密钥库。
请只在可信任的本机使用。内容会发送到实际选中的供应商，使用前应确认其
数据处理和业务使用条件。

## 继续开发

```sh
npm run check
npm test
```

测试使用本地 HTTP 模拟接口，不需要真实密钥。真实 API 连通、特定客户端接入
和长期稳定性是不同验收事项，详见[验证状态](docs/RELEASE_STATUS.md)。

本项目由 KARUU AB 独立实现，受到 FreeLLMAPI 的公开思路启发。
没有复制其源码、模型目录，也没有与其开发者或模型供应商建立官方关联。

