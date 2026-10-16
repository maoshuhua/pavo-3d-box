# Pavo 3D BOX

本地运行的 3D 动画预演编辑器：React、Three.js、SQLite 与 LangChain Deep Agents。

## 功能

- 项目首页与编辑器、GLB 导入、场景资产和属性编辑。
- 时间轴、相机片段、关键帧、运动预设、监视器和成片预演。
- Agent 对话、节点引用、图片／文档／GLB 参考上传、运镜标注。
- 七个 Agent 工具：`x_list`、`x_read`、`x_write`、`x_edit`、`x_grep`、`build_3D_scene`、`preview_3D_scene`。
- 本地 SQLite 项目与运行记录、GLB／JSON 自动保存、浏览器本地恢复。
- 帧截图与导出；“去画布生成”尚未接入。

模型服务由使用者自行配置，通过 OpenAI 兼容接口调用。本仓库不提供模型服务、密钥或模型权重，也不包含原作者的实际供应商地址和模型名称。

## 本地启动

需要 Node.js 22.13 或更新版本（建议 Node.js 24 LTS）、npm，以及可供无头渲染使用的 Chromium／Chrome／Edge。

```sh
git clone https://github.com/maoshuhua/pavo-3d-box.git
cd pavo-3d-box
npm ci
```

将 `.env.example` 复制为 `.env`，填写自己的配置：

```dotenv
AGENT_BASE_URL=
AGENT_API_KEY=
AGENT_MODEL=
```

模型需要支持工具调用；图片参考和预览检查需要图像输入能力。可选的 `AGENT_MODEL_G6`、`AGENT_MODEL_DV4` 只是界面模式到实际模型的映射，不填写时均使用 `AGENT_MODEL`。

Windows 默认尝试使用已安装的 Edge／Chrome；其他环境或没有本机浏览器时安装 Playwright Chromium：

```sh
npx playwright install chromium
npm start
```

Linux 缺少浏览器系统依赖时，可按 Playwright 的提示安装所需依赖。

访问：

- 首页：<http://127.0.0.1:5173/3d-box>
- 本地 API：<http://127.0.0.1:8787/api/agent/health>

`npm start` 同时启动 Vite 和 Node 服务。也可分别运行 `npm run dev`、`npm run agent`。

更改 `AGENT_PORT` 时，需同步修改 `VITE_AGENT_URL`。Agent 默认总时限为 30 分钟，单次模型请求时限为 3 分钟；修改 `.env` 后需重启服务。

## 验证

```sh
npm run build
npm test
```

测试不需要真实模型密钥；包含浏览器渲染的测试需要可用的 Chromium／Chrome／Edge。真实模型生成的质量和耗时取决于自行配置的服务。

## 项目结构

```text
src/             编辑器、首页、Agent UI、Three.js 场景与本地保存
server/          SQLite API、Deep Agents、七个工具与无头渲染
public/          品牌图片、示例场景与 Draco 解码器
scripts/         本地启动脚本
tests/           自动测试
AGENT_API.md     Agent 流程、工具参数及接口说明
```

## 本地数据与配置

`.env`、`.agent-data/`、SQLite、附件、聊天记录、模型检查点、生成产物、测试截图和日志均不随源码发布，并已加入 `.gitignore`。示例配置只保留变量名和通用默认值。

运行时数据默认写入 `.agent-data/`；前端还使用当前浏览器的 IndexedDB 保存本地项目。提交代码前请确认 `git status` 中没有私人素材或配置文件。请勿将密钥放进任何 `VITE_*` 变量，因为这些变量会进入浏览器代码。

项目在本机保存数据，但执行 Agent 时会将本轮文本、引用上下文、提取的文档正文、参考图和预览检查帧发送给你配置的模型服务。

## 来源与授权状态

本项目部分布局、交互、算法及静态示例来自 libtv 公开前端的研究和移植；代码中的来源注释已保留。后端 Agent 工具与本地接口是本项目的实现，不是 libtv 私有后端源码。

当前提供源码公开仓库，尚未为整个项目授予统一的开源许可证。不能因源码可访问就推定第三方代码、品牌和素材可自由再许可。各项来源与授权边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
