# 3D-BOX Agent 实现方案与运行说明

本项目使用 LangChain 官方 `deepagents` JavaScript SDK（锁文件当前为 1.15.0），由 `createDeepAgent` 创建真正的工具调用循环。模型通过 OpenAI 兼容接口接入。没有配置模型时返回明确错误，不使用模拟回复。

libtv 可确认的部分：工具执行状态、渐进式场景交付、completed 产物描述、GLB/协作 JSON 下载、稳定实体 ID、相机/时间轴恢复。libtv 私有服务端工具 Schema 未公开。下列八个工具的参数是本项目定义，不声称逐字复刻原站私有接口。

## 启动

1. 编辑 `F:\3D_BOX\.env`，设置 `AGENT_BASE_URL`（通常以 /v1 结尾）、`AGENT_API_KEY`、`AGENT_MODEL`。多个模型可写 `AGENT_MODELS=model-a,model-b,Provider/Model-C`，或直接在 `AGENT_MODEL` 中用逗号分隔；`AGENT_MODELS` 优先，首个模型为默认模型。首页和编辑器显示真实模型名，共用同一组 URL/Key，选择后将完整模型名原样发送给模型服务。修改 .env 后重启 Agent 服务。模型须支持工具调用；视觉检查与图片附件须支持图像输入。
2. 在项目目录运行 `npm start`，同时启动 Vite 和本地 Agent。已有 Vite 时，只运行 `npm run agent`。
3. 使用现有页面底部输入框发送。停止按钮取消本轮，不增加配置、生成、轨迹等新入口。

服务默认只监听 `127.0.0.1:8787`。`GET /api/agent/health` 显示是否配置；不返回密钥。端口可在 .env 的 AGENT_PORT 配置，改变后前端需设置 VITE_AGENT_URL 为同一地址。

程序优先使用本机 Edge/Chrome 的独立无头渲染进程，不使用用户登录配置。也可设置 AGENT_BROWSER_EXECUTABLE，或安装 Playwright Chromium。测试与编译不需要模型密钥。

## 数据与职责

```text
现有 React 输入框、引用、上传、运镜标注 PNG
  → localAgentAdapter：multipart POST + SSE
  → 本机 Node/Express 服务
  → createDeepAgent + ChatOpenAI + 本地持久化 LangGraph checkpointer
  → x_list / x_read / x_grep：检查项目上下文与场景源程序
  → x_write / x_edit：写入或修改项目工作区场景程序
  → QuickJS：运行 build(ctx)，得到受校验的场景规格
  → Three.js + GLTFLoader / GLTFExporter：本机无头浏览器生成产物
  → build_3D_scene：返回 GLB / JSON URL + SHA-256
  → preview_3D_scene：按机位与时间渲染 PNG，图像进入下一次模型请求
  → 现有 loadAgentArtifacts + 独立 staging viewport
  → IndexedDB 原子保存 GLB/JSON → 主视窗与时间轴更新
```

生成程序不直接获得 Node、网络、DOM、shell、密钥或主机文件系统。QuickJS 有内存和执行时间限制。渲染器只加载本机服务中的运行代码和素材。Deep Agents 自带虚拟文件上下文/总结能力保留；暴露给模型的工具恰为 x_list、x_read、x_write、x_edit、x_grep、coding_todo_write、preview_3D_scene、build_3D_scene，没有通用 shell 或委派入口。前端复用现有工具执行状态展示，不增加按钮或入口。

模型请求会把本轮文本、实体上下文、文档正文、参考图及渲染检查图发送至配置的模型供应商。GLB、JSON、源程序、附件原文件、预览图、消息检查点和运行记录保存在本机 `.agent-data`；不接入 libtv、云存储或 LangSmith tracing。密钥仅由 Node 服务读取。

## 会话、引用和附件

- 前端沿用本地 projectId/sessionId；后端以 projectId 隔离目录、sessionId 隔离检查点。LangGraph 检查点以二进制原子写入，进程重启后可继续同一会话。
- 每轮发送之前刷新未提交编辑与自动保存，并上传当前 GLB 和 JSON 给本机服务。它们是本轮的权威基线，覆盖历史会话中可能过时的场景认知。
- 元素引用含稳定实体 id、运行时 uuid、名称、kind；相机片段额外含 start/end，发送前补齐相机稳定 entityId。模型通过 `/context.json` 查找真实对象，不猜节点 ID。
- 运镜轨迹仍是现有标注功能生成的 PNG，作为图片参考进入同一个附件通道。模型据图编写/更新相机轨迹，标注本身不直接生成关键帧。
- 图片：PNG/JPG/JPEG/WebP/GIF；文档：PDF、DOC、DOCX、XLS/XLSX、TXT、MD、JSON、CSV；GLB 可作为 asset 节点插入。单附件 20 MiB，每轮最多 12 个。历史对话显示附件名，原文件留本机项目目录。
- 旧版二进制 DOC 使用 WordExtractor 解析；PDF、DOCX、XLS/XLSX 各自提取文本。文档提取有长度限制，不执行宏或文档脚本。

## 工具契约

所有工具先发 TOOL_CALL_START/ARGS，结束发 END/RESULT；错误返回 status:error 和 error 文本，供模型修复后重试。同一轮工具串行执行，避免并行写入与构建竞争。

导演 skill 位于 `server/skills/studio-director/SKILL.md`，每轮自动加载。通过 `coding_todo_write` 提交通用计划、任务和审查，状态保存在只读 `/agent-state.json`。审查已执行可以同时判为 fail，失败证据不会因为后续任务更新失败而丢失。最终 accepted 要求当前交付版本的必需标准通过及各镜头采样完整。没有最低构建次数；成功一次即可通过，构建次数仅控制成本。

源码先 `preview_3D_scene({target:"draft",frames:[{camera_id,time}]})` 检查，省去临时 GLB 导出/导入，不发布 RESULT、不覆盖主场景；修正后 build 导出，再 `target:"build"` 检查实际交付件。每批1–12帧共享场景加载；显式无效机位报错。源码始终作用于本轮上传的不可变基线，避免 patch 反复作用于自己的输出。结构检查与模型视觉判断分开，accepted 不是自动视觉质量保证。

`AGENT_RECURSION_LIMIT` 默认 500，接受 50–5000 的整数，无效值回退到默认值。该值计算 LangGraph 执行步数，不是工具调用次数。接近上限时预留收尾步数：已有成功构建则关闭工具并要求如实总结尚未完成的修改与检查；没有成功构建则返回中文错误并保留原场景。步数按本轮首个模型节点计算，不累计历史会话的 checkpoint 步数。供应商忽略 `tool_choice:none` 时中止执行，避免继续循环。`AGENT_GENERATION_TIMEOUT_MS` 默认12分钟，覆盖模型等待与工具；`AGENT_MODEL_TIMEOUT_MS` 覆盖单次模型完整流式响应。`AGENT_RUN_TIMEOUT_MS` 是服务外层截止时间。

文件工具只访问当前项目 workspace 下的 js/json/txt/md 文件。`/scene.js`、`/context.json` 等以 `/` 开头的路径是项目虚拟路径，不是磁盘绝对路径；拒绝 Windows 盘符、UNC 路径、`..` 越界与符号链接。`/context.json`、`/scene-api.txt`、`/agent-state.json` 与 `/skills/` 由服务更新，工具只能读取，不能写入或编辑。目录工具不会列出上传原文件、构建产物、检查点、环境变量或项目目录外的文件。

单个文本文件读取上限为 32 MiB。x_read、x_grep 的文本输出上限为 64000 字符；目录扫描最多检查 10000 项、深入 64 层。输出或扫描触限时返回 truncated，调用方应缩小目录、分段读取或缩小搜索范围，不应把部分结果当作完整文件或完整搜索。

### x_list

输入：`{path?:string="/", recursive?:boolean=false, max_entries?:number=200}`；max_entries 为 1–1000 的整数。

流程：校验项目虚拟目录 → 枚举该目录；recursive 为 true 时递归 → 只返回允许访问的文件与目录 → 按 max_entries 截断。

输出：`{status:"completed", path, entries:[{path,type:"file"|"directory",bytes?:number}], truncated:boolean}`。文件条目提供 bytes；truncated 表示尚有条目未返回。用于先定位当前项目源文件。

### x_read

输入：`{path:string, offset?:number=0, column?:number=0, limit?:number=300}`。offset 为从 0 开始的行偏移，column 为本次第一行从 0 开始的字符偏移，limit 为 1–1000 的整数。

流程：校验文件路径 → 读取文本 → 按 offset/column/limit 截取 → 添加从 1 开始的原始行号。

输出：`{status:"completed", path, totalLines:number, offset:number, content:string, truncated:boolean, next?:{offset:number,column:number}}`。content 的行号始终对应原文件。仅在 truncated 为 true 时返回 next，可将其中的 offset、column 直接作为下一次读取的游标；完整结果不含 next。这样也能继续读取单行超过 64000 字符的内容。用于读取 `/context.json`、`/scene-api.txt`、`/scene.js` 等。

### x_write

输入：`{path:string, content:string, overwrite?:boolean=false}`。

path 为 `/scene.js` 等项目虚拟路径，仅允许 js/json/txt/md；不接受磁盘路径和上级目录。已有文件默认拒绝覆盖。写入上限 1 MiB，同时校验 UTF-8 编码后的实际字节数。

流程：校验路径 → 检查是否存在 → 原子写入。

输出：`{status:"completed", path, bytes, sha256}`。

### x_edit

输入：`{path:string, old_string:string, new_string:string, replace_all?:boolean=false}`。

流程：读取 → 精确匹配旧文本 → 默认要求唯一匹配 → 替换 → 原子写入。空匹配、不存在、多重歧义均返回错误，不做模糊替换。

输出：`{status:"completed", path, replacements, sha256}`。

### x_grep

输入：`{pattern:string, path?:string="/", case_sensitive?:boolean=true, max_results?:number=100}`；pattern 是非空字面量文本，max_results 为 1–1000 的整数。path 可以指定文件或目录。

流程：校验路径 → 在允许的文件中逐行查找字面量；目录搜索涵盖其子目录 → 按 case_sensitive 决定是否区分大小写 → 按 max_results 截断。pattern 不作为正则表达式执行。

输出：`{status:"completed", pattern, path, matches:[{path,line:number,text:string,textOffset?:number,textTruncated?:true}], truncated:boolean}`。line 为从 1 开始的原始行号；无匹配时 matches 为空。长行的 text 只返回包含命中词的附近片段，并附 textOffset（片段起点在原行中的 0 基字符位置）与 textTruncated:true；普通短行不含这两个字段。用于查找实体 ID、动画名称或待修改代码，再用 x_read 确认上下文。

### build_3D_scene

输入：`{source?:string="/scene.js"}`。

流程：
1. 读取程序，在 QuickJS 内执行 `function build(ctx)`。
2. ctx 提供当前 JSON、选中元素/片段、上传素材目录；程序只返回 scene spec。
3. Zod 校验 spec、节点 ID、动画数组、时间范围及协作操作。
4. patch 模式载入本轮基线 GLB，保留未涉及的节点和动画；replace 仅在明确创建整个新场景时使用。
5. 按稳定 id 增改节点、层级、几何体、材质、机位、灯光和动画；更新 timeline，回放经过校验的 libtv 场景操作。
6. 使用与前端相同的 viewport/相机轨迹逻辑重新序列化 GLB 和 JSON。
7. 两个文件及结果描述全部写好后才发布 RESULT，前端可在 Agent 继续运行时载入中间版本。

输出：

```ts
{
 status:"completed", task_id:string, source:string,
 source_hash:string, source_sha256:string,
 glb_url:string, collaboration_url:string,
 glb_size:number, glb_sha256:string, triangles:number
}
```

每个构建使用新的不可变 task_id 目录；校验失败不覆盖上一版产物。GLB 上限 100 MiB。

### preview_3D_scene

输入：`{camera_id?:string, time?:number=0}`。camera_id 为稳定 hf_id，省略时取首个相机；time 为秒，不能超出时间轴。

流程：读取最近成功构建 → 用同一 viewport 恢复 → 定位相机 → seek(time) 评价真实动画 → 隐藏编辑辅助控件并渲染 PNG → 保存图片。

返回文字元数据：`{status:"completed",task_id,camera_id,time,width,height,image_url}`；ToolMessage.artifact 保存图像数据。下一次模型调用通过 middleware 将图像投影为 user image_url 内容，以兼容不接受 tool 消息内图片的 OpenAI 兼容接口。URL 只用于本地记录，模型看到的是内联像素，不要求供应商访问 localhost。

## Agent 执行顺序

1. 通过 x_list 定位工作文件，用 x_read 读取 `/context.json`、`/scene-api.txt` 和已有程序，按需用 x_grep 查找引用实体或具体代码。当前 GLB/JSON 和引用中的稳定 ID 是修改依据。
2. 新程序使用 x_write；局部修改使用 x_edit。保留无关对象、机位和动画，只有明确新建整个场景时使用 replace 模式。
3. 调用 build_3D_scene 生成一组不可变 GLB/JSON 产物。失败时读取错误、修改程序并重新构建；不能把源程序写入成功当作场景交付成功。
4. 调用 preview_3D_scene 检查开始、关键动作和结尾。检查结果有问题时回到 x_read/x_grep → x_edit → build → preview，直到本轮目标完成或遇到明确错误。
5. 前端接收 RESULT 后沿用原有 staging 校验、场景替换、机位/时间轴联动和本地 GLB/JSON 原子保存。之后手动编辑与恢复仍走原有自动保存流程。工具状态沿用原对话展示。

## 场景程序

完整可执行规格在 `server/scene-api.txt`。程序定义 `build(ctx)`，返回：

```js
{
 version:1,
 mode:"patch", // 或 replace
 objects:[/* 稳定 id、类型、层级、变换、几何、材质等 */],
 remove:[],
 world:{type:"solid",color:[0.22,0.24,0.27],strength:2},
 timeline:{version:1,duration:15,shots:[{cameraId:"camera",start:0,end:15}]},
 animations:[/* 针对实体的 position/quaternion/scale 采样 */],
 operations:[/* libtv 协作操作 */]
}
```

支持组装几何体、任意 buffer 网格、已有 GLB 素材、父子节点动画、机位跟拍和多镜头时间轴。相机轨迹也可通过 camera.rig.set 接入既有关键帧/轨迹编辑器。四元数为 XYZW，长度与时间数组严格校验。

## GLB 和 JSON

GLB 保存几何、材质、节点层级、相机、灯光、动画和 extras.hf_id。协作 JSON 使用原有 entities/operations/checkpoint 契约；最终快照带世界、节点状态和时间轴，operations 为空。相机、时间轴、JSON 实体之间通过稳定 hf_id 关联，运行时 uuid 不作为跨构建身份。

产物载入继续经过原有 resultSchema、GLB 文件头、大小、SHA-256、JSON 操作校验及 checkpoint 重放。只有 staging viewport 能成功恢复和重新导出，才会成对提交本地 SQLite 文件索引、GLB/JSON 快照及浏览器恢复缓存，再替换主场景。后续手动编辑继续使用两秒自动保存与崩溃恢复；项目管理和持久化需本机服务启动，不依赖远端项目存储。

## HTTP / SSE

- `GET /api/agent/health`：运行与配置状态。
- `POST /api/agent/run`：multipart；payload 是 projectId/sessionId/runId/prompt/reference/messages/sceneJson，scene 是 GLB，attachments 为素材文件。
- `DELETE /api/agent/runs/:runId?projectId=...`：取消。
- `/artifacts/:projectId/:taskId/...`：本地不可变产物。
- `/uploads/:projectId/...`：本地上传素材。

## SQLite 首页与项目接口

访问 `http://127.0.0.1:5173/3d-box`（`/` 同样进入首页），编辑器为 `/animation-preview?projectId=<uuid>`。`npm start` 同时启动前后端。

SQLite 文件为 `.agent-data/studio.sqlite`，使用 WAL；项目、草稿、上传素材索引、上传会话、Agent 会话、消息、运行状态和事件存入数据库。`.agent-data/studio-files/<projectId>/snapshots/<immutableId>/` 保存配对的 `studio.glb` / `studio-collaboration.json`。先写不可变文件，再在 SQL 事务中切换当前版本，失败不会改动上一对文件。浏览器 IndexedDB/journal 按 projectId 隔离，作为快速恢复和崩溃保护。旧单项目数据只迁移一次，保留原缓存。

接口返回 `{code:0,msg:"",data:...}`，失败含非零 code/msg，同时保留既有 error 字段。接口仅由本机服务提供，无 LibTV 登录、会员计费或云端内容审核；图片 verify 仅检查本地素材引用，不代表远端审核。

| 方法 / 路径 | 入参 / 用途 |
| --- | --- |
| GET /api/task/agent-task/modes | agentName；modes 为环境配置的真实模型名称，key/name 都是模型名；不返回 Key/URL。旧 G6/DV4 项目兼容旧模型别名，已移除的模型回退到列表首项。 |
| GET /api/task/free-quota/remaining | scene/model；本地不匹配 LibTV 免费额度，不收费、不伪造余额 |
| GET /api/www/landing-activities/getById | id=318；推荐文字和本地示例图片；另支持 listByIds |
| POST /api/studio/list | page/pageSize/name；返回 studioMetaList/total |
| POST /api/studio/create | name/config/description/coverUrl；Idempotency-Key 防止同一新建入口重复创建 |
| GET /api/studio/detail | uuid；返回 studioMeta/config |
| POST /api/studio/update | studioUuid + name/config/coverUrl |
| POST /api/studio/delete | studioUuid；逻辑删除，保留原始文件；生成过程中先停止再删除 |
| POST /api/studio/draft | prompt/promptParts/generationSettings；30 分钟有效；GET/DELETE /api/studio/draft/:id |
| GET /api/studio/snapshot | projectId；返回 revision/glbUrl/jsonUrl，空项目返回 null |
| POST /api/studio/snapshot | multipart projectId/revision/scene/sceneJson，可带 cover/generation/promptHandled；拒绝版本倒退 |
| POST /api/studio/import-local | 旧浏览器项目幂等迁移，已有服务器快照不会覆盖 |
| POST /gateway/oss-server-api/oss-service/api/oss/pre-sign/4 | path/contentType；返回本地 PUT 地址和 cdnUrl/assetId |
| POST /gateway/oss-server-api/oss-service/api/oss/pre-sign/multipart/init/4 | path/contentType/fileSize/partSize；返回 uploadId/parts |
| POST /gateway/oss-server-api/oss-service/api/oss/pre-sign/multipart/complete/4 | path/uploadId；返回本地素材地址 |
| POST /api/community/image/verify | urlList；仅接受本机素材地址 |
| POST /api/task/artifact/list | mediaType/page/pageSize；本地上传图片和 Agent 实际预览图历史 |
| POST /api/v1/project/session/create | projectId/canvasId/nodeKey/agentName/name/sessionType；返回 sessionId |
| GET /api/v1/project/session/list | projectId；返回 sessions |
| GET /api/v1/project/message/list | projectId/sessionId/afterSeq；返回 messages/latestSeq/runStatus |
| POST /api/v1/project/session/stop | sessionId；取消对应真实任务 |
| POST /api/v1/project/session/update-title | sessionId/title |
| POST /api/v1/project/session/update-meta | sessionId/libtvMeta |
| GET /api/canvas/project/get_title_by_message | message；本地提取标题，不额外请求模型 |

本地图片历史另提供 editor/img/history、image/history、comfy/img/history、sd3/image/history、team/images 的路径兼容封装，均查询本地素材，不连接外部平台。UI 中外部来源保持禁用。

新增 WebSocket `/ws?project_id=...&agent_name=libtv_coding_agent`，接受 LibTV 风格的 `{threadId:sessionId,messages:[{id,role:"user",content:JSON.stringify(parts)}],forwardedProps:{extra:{aspect_ratio,duration_seconds,agent_mode}}}`。会话必须属于当前项目；从 SQLite 当前快照读取场景，复用 `/api/agent/run` 的真实执行链路和七个工具，输出 RUN_STARTED、工具/文本/产物事件、RUN_FINISHED/RUN_ERROR。现有编辑器默认继续使用 SSE，保持取消和分阶段场景载入行为。

SSE 每条为 `id: seq` 和 `data: JSON`：SESSION、RUN_STARTED、TEXT_MESSAGE_CONTENT、TOOL_CALL_START、TOOL_CALL_ARGS、TOOL_CALL_END、TOOL_CALL_RESULT、RESULT、PREVIEW、RUN_FINISHED、RUN_ERROR。事件与消息更新在同一 SQLite 事务内保存。浏览器刷新、离开或断开事件流只取消观察订阅，后台任务继续执行；只有已有的停止按钮或 session/stop-run 接口会取消任务。前端仍支持显式 `globalThis.__3D_BOX_AGENT_ADAPTER__` 覆盖，默认接本机服务。

恢复按 libtv 会话逻辑读取消息与 runStatus/latestRun，保留运行中的工具状态，通过事件 seq 去重补发。GET `/api/agent/runs/:runId?projectId=...` 返回任务状态、最新结果和事件游标；GET `/api/agent/runs/:runId/events?projectId=...&afterSeq=...` 补发并订阅后续事件。重复提交相同 runId 会附着原任务，不重复调用模型。短暂断连会自动重连；重新打开项目时直接恢复运行状态与原有停止按钮，不增加入口。

每次成功构建由后端先原子保存 GLB／JSON 并提交 SQLite 快照指针，再发布带 snapshotRevision 的 RESULT。没有任何页面连接时也会保存结果；前端只接纳该版本到本地缓存，避免再次保存同一生成结果造成版本冲突。已完成任务重新打开时直接加载快照和完整对话。WebSocket 断开同样不取消后台任务，重连可通过 run_id/after_seq 补发事件。本地 Node 服务本身重启会将未完成任务标记为 interrupted，并保留最近成功结果；此实现不会假称进程重启后仍有模型请求在运行。

## 目录和验证

```text
.agent-data/projects/<projectId>/
  workspace/scene.js, context.json, scene-api.txt
  uploads/<assetId>.<ext>
  artifacts/<taskId>/model.glb, collaboration.json, result.json, preview-*.png
  sessions/<sessionId>/checkpoint.bin
  sessions/<sessionId>/runs/<runId>.ndjson
```

`npm test`：程序隔离/超时、路径限制、持久化、真实 Deep Agents 与兼容模型协议测试、七个工具、GLB/JSON/PNG、视觉输入、patch 保留、取消、附件提取。集成测试使用确定性的本地模型服务验证协议；不代表已验证某个付费模型的生成质量。

`npm run build`：前端生产构建。测试渲染产物位于 test-output，均为可丢弃测试数据。未配置真实供应商时，不发起真实模型调用。

参考：
- https://docs.langchain.com/oss/javascript/deepagents/overview
- https://docs.langchain.com/oss/javascript/deepagents/customization
- https://docs.langchain.com/oss/javascript/deepagents/streaming


## 导演工具与恢复

`coding_todo_write` 的 op 是 `read / set_plan / update_tasks / record_reviews`。写操作需要唯一 requestId，可带 expectedRevision；相同请求重复提交不重复应用。具体 JSON Schema 由工具及 `server/scene-api.txt` 提供。工具公开 object 根节点，内部按 op 严格验证。

- 计划包含 subjects、constraints、shots、criteria；不能在同一轮删除/降级必需标准或移除约束。新一轮保留 priorPlan 供编辑参考，不自动复用通过结论。
- task kind 为 plan/implement/review/deliver；status 为 pending/in_progress/completed/blocked/cancelled。审查任务 completed 仅表示已检查，verdict 独立为 pass/fail/unverified。
- 最终验收不能跳过任务清单：至少一项已完成 implement 任务有当前版本证据，且已完成 review 任务覆盖全部必需标准。当前真实帧可证明实现已执行；过期帧不能完成新任务，草稿帧不能证明最终交付合格。任务更新失败会给出具体任务、缺少的标准及恢复方法。
- draft/build/frame 证据由服务端产生 ID，绑定源码哈希、基线/素材身份、planRevision、产物及机位时间。模型不能创建证据或指定文件路径。
- 每镜头起点、中点和出镜前一帧（最后镜头为终点）是交付采样要求；运动标准至少两个不同时间点。仅 build 证据可支持最终交付验收。
- DIRECTOR_STATE、MODEL_STATUS 事件保存并重放；模型状态只显示耗时和阶段，不输出推理正文。RUN_FINISHED.outcome 区分 accepted/partial/not_generated，取消/错误保留状态。
- 图像只在发起视觉请求前临时加载；checkpoint 保存引用。DiskSaver 按 namespace 保留最近4个及 delta 恢复必需的祖先、pending writes，避免恢复损坏。

## 运行策略

默认成功构建6次、构建失败3次、草稿48帧、交付36帧、工具100次、连续错误3次。预算耗尽时保留最后成功产物并明确部分完成，不把“预算用完”视为“验收通过”。

模型能力按 exact model 配置。当前已验证的 DeepSeek V4.1 使用 modelKwargs.reasoning_effort；其他模型不自动附带扩展。可设置 AGENT_MODEL_PROFILE=fast/balanced/quality、AGENT_REASONING_EFFORT 和 AGENT_MODEL_CAPABILITIES；供应商实际支持能力需验证，不能从 OpenAI 兼容性推断。默认输出上限32768、自动重试0次；更长输出可显式调整。

## 分阶段提交与回退

基线：9155bdd。阶段一：fd28d46（源码预览）；阶段二：fa876c8（导演与todo）；阶段三：543cda2（当前版本交付验收）；运行恢复阶段见其后的 runtime 提交。

各阶段独立提交。回退采用 git revert，按依赖从后往前撤销，不使用 reset --hard；保留 .agent-data 和 output 产物。新增状态文件对旧运行代码是旁路数据，不应删除生成项目以回退代码。服务重启后生效。

验证：node --test --test-concurrency=2 tests/*.test.js；npm run build。测试不需要实际模型密钥，真实平台对比另行记录。
