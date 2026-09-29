# 模型配置增强与性能设计

## 目标与使用方式

保留现有 DeepSeek 和第三方兼容服务，增加 OpenAI 官方及中转服务的 Chat Completions / Responses 文本问答能力。仅覆盖文本问答，不增加工具调用、图像、服务端会话链或自动协议降级。

设置页依次配置接口协议、Base URL、地址拼接、Key 和模型。模型可直接手填，也可点击“获取模型”后搜索选择。推理强度默认“服务默认”，不向服务发送推理字段；具体档位是否支持，以目标服务和模型为准。

例如 OpenAI 官方填 `https://api.openai.com`，使用自动地址模式；选择 Responses 后最终地址为 `https://api.openai.com/v1/responses`。中转如已有 `/proxy/v1` 前缀，填完整前缀即可。Chat 中转若拒绝 `max_tokens`，可在高级设置选择 `max_completion_tokens`。

## 模块与接口

- `AiModelSettings.vue`：设置界面、最终端点展示、模型列表获取/取消/搜索/分批展示。独立组件避免将网络列表状态耦合到会话逻辑。
- `aiClient.ts`：配置归一化与存储、地址解析、两种协议请求构造、连接测试、模型列表请求和 SSE 解码。
- `useAiWorkspace.ts`：内部保留统一 `ChatMessage[]`，发送时适配协议；冻结回答的服务配置；管理证据缓存、流式批次和历史保存队列。

`AiSettings` 新增字段：

| 字段 | 可选值 | 新配置默认 |
| --- | --- | --- |
| `protocol` | `chat`、`responses` | `chat` |
| `addressMode` | `auto`、`v1`、`preserve` | `auto` |
| `reasoningEffort` | `default`、`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` | `default` |
| `chatTokenMode` | `auto`、`max_tokens`、`max_completion_tokens` | `auto` |

`prepareAiRequest` 返回 `{ body, json, bytes }`；请求预览与发送使用同一构造器，每次实际发送的预算校验与 `fetch` 共用已序列化字符串。会话内部消息独立于协议请求体，避免 Responses 被错误要求提供 `body.messages`。

### 地址与迁移

1. 去掉末尾斜杠及完整接口后缀 `/chat/completions` 或 `/responses`。
2. 自动模式仅为纯域名补 `/v1`，DeepSeek 官方除外；已有非根路径保持不变。
3. 补充模式在末尾缺少 `/v1` 时追加，保留路径前缀；按原路径模式不追加版本。
4. 按所选协议追加端点；模型列表始终在同一根路径追加 `/models`。
5. 保留 HTTPS、本机 HTTP、禁止地址内凭据/查询参数/片段、禁止重定向的限制。

旧配置没有新字段时，第三方地址与 `max_tokens` 保留原行为；OpenAI 官方迁移到自动模式，修复纯域名缺少 `/v1` 的问题。旧配置仍默认 Chat、服务默认推理强度。Key 的 local/session 保存规则不变。

### 请求和响应契约

| 行为 | Chat Completions | Responses |
| --- | --- | --- |
| 消息 | `messages` | `input`，保留 system/user/assistant 顺序 |
| 推理 | `reasoning_effort` | `reasoning.effort` |
| token 上限 | 自动：官方使用 `max_completion_tokens`，其他使用 `max_tokens`；可覆盖 | `max_output_tokens` |
| 存储 | 沿用现有请求行为 | 显式 `store: false`，不发送 `previous_response_id` |
| 文本流 | `choices[0].delta.content` | `response.output_text.delta` |
| 完成 | `finish_reason: stop` 或 `[DONE]`，且收到文本 | `response.completed`，且收到文本 |
| token 截断 | `finish_reason: length` | `response.incomplete` 且原因为 `max_output_tokens` |

SSE 按事件边界处理，兼容跨网络分块 UTF-8、CRLF 和多行 `data:`；不把思考增量当作最终答案，不重复追加文本 done 事件。异常、拒绝、断流及其他未完成原因不报成功。截断映射为现有“继续生成”；切换协议、地址、模型、推理或输出参数后拒绝旧回答续写。

模型测试发送固定简短问题，使用用户选定协议及推理字段，仅覆盖 `stream: false` 和 128 tokens 上限。达到上限只提示连通，不宣称完整回答成功。模型列表和测试均有 20 秒超时，正式生成保持现有 120 秒总超时；不自动重试或切换协议。

## 性能与生命周期

- 模型列表只在用户点击时获取，不随输入联网；并发点击去重；地址、地址模式或 Key 变化取消旧请求并清空列表。返回 ID 去重排序，列表仅驻留当前面板，首次显示 50 项，按需再显示 50 项。
- 请求预览仅在活动证据页或当前发送内容抽屉打开时构造；普通对话输入和设置页不构造隐藏预览。
- 每个会话使用 WeakMap + computed 缓存脱敏证据和证据 JSON。问题与模型配置变化不重新脱敏大对象；证据值、包含/原值选项、引用选择或会话替换会使缓存失效。实际发送仍先刷新单据数据。
- 大文本邮箱脱敏先检查 `@`，并限定邮箱匹配起点，避免长串普通字母或残缺邮箱反复回溯；保留原值时仍清除凭据。
- 流式文本在 50ms 内合并为一次状态更新，减少 Markdown 全文解析和滚动布局频率。结束、异常、停止及卸载时提交剩余文本；卸载必须先 stop 再置 disposed。
- 历史保持 1.5 秒节流。同一会话最多一个正在写入的版本和一个最新待写版本，慢存储不积压中间回答；保留失败重试及删除标记机制。
- 技术详情只在展开时格式化大 JSON；复制时按需格式化。未引入新依赖、Worker 或虚拟列表。

## 验证与边界

自动化测试位于 `packages/core/test/aiClient.test.ts`、`aiWorkspace.test.ts`，覆盖：

- 地址组合、协议切换、旧配置迁移、Key 存储策略、两种请求体与模型列表异常。
- SSE 分块、UTF-8、多行事件、末帧文本、截断/拒绝/空回答、停止后迟到增量。
- 150 KB / 2 MB 数据的字节一致性与证据缓存；1000 个模型排序去重；1000 次增量在一个 50ms 窗口合并一次。
- 改变推理参数使旧测试与续写失效；慢存储期间只保留最新待写快照。

本地 Chrome 模拟组件检查涵盖模型列表首次 50 项、搜索不联网、模型选择、显示更多、地址变更保留手填模型、Key 变更取消请求、协议切换及 380px 面板控件布局。网络响应为模拟数据，不能作为真实服务连通或扩展宿主权限验证。

尚未验证：真实 DeepSeek / OpenAI / 中转 API、安装扩展后的端到端调用，以及真实业务场景的 Performance 基准。当前性能证据是减少计算/渲染/写入次数的测试，不声称具体耗时降幅。

协议参考：[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Responses 迁移](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[SSE 流式事件](https://developers.openai.com/api/docs/guides/streaming-responses)。

### 本次验证记录（2026-09-28）

使用 Node 22.23.2：目标文件 ESLint 通过；全仓 Vitest 15 个测试文件、124 项测试通过（本次新增 50 项）；`pnpm typecheck` 通过；扩展 Vite 构建通过；`git diff --check` 通过。独立临时 Chrome 的 9 项模拟交互及 380px 布局断言通过，并检查了截图。临时预览文件和服务已清理，未提交、推送或发布。
