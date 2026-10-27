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

生成程序不直接获得 Node、网络、DOM、shell、密钥或主机文件系统。QuickJS 有内存和执行时间限制。渲染器只加载本机服务中的运行代码和素材。Deep Agents 自带虚拟文件上下文/总结能力保留；暴露给模型的工具恰为 x_list、x_read、x_write、x_edit、x_grep、x_copy、preview_3D_scene、build_3D_scene，没有通用 shell 或委派入口。前端复用现有工具执行状态展示，不增加按钮或入口。

模型请求会把本轮文本、实体上下文、文档正文、参考图及渲染检查图发送至配置的模型供应商。GLB、JSON、源程序、附件原文件、预览图、消息检查点和运行记录保存在本机 `.agent-data`；不接入 libtv、云存储或 LangSmith tracing。密钥仅由 Node 服务读取。

系统指令、八个工具的说明和参数描述、`/scene-api.txt` 及摘要指令使用中文；替换框架默认英文基础提示，并在每次模型调用时重新应用中文系统指令。执行进度、检查反馈和最终总结均要求使用简体中文；工具名、字段、路径与代码保持协议原样。历史消息不改写，模型生成仍受其指令遵循能力影响。

商品效果扩展：场景规格支持 `lighting:{preset:"product",subjectIds:[...]}` 与物理材质 `transmission/thickness/ior/clearcoat/clearcoatRoughness/attenuationColor/attenuationDistance`，运行时生成可编辑灯光。

相机运动统一使用编辑器路径能力。`cameraMotion` 以 `presetId` 选择公共目录中的 18 种预设，或 `presetId:"custom"` 加 `path.points` 自行构建控制点。支持向心/弦长/Catmull-Rom 曲线、闭合、缓动、反向、往返、固定/切线/目标注视，以及 `follow` 动态跟拍。全部使用同一逐帧采样和父坐标转换器；无独立 Agent 运镜算法。旧的两种 `type` 协议已彻底移除，旧输入校验失败，不作兼容映射。

每个机位可有多段不重叠、接点连续的路径。路径元数据、烘焙动画与全部片段通过 GLB 和 `camera.rig.set` 保存，编辑器可选段、改控制点、改预设并撤销。直接编辑相机关键帧后解除该机位路径控制。每次更新某机位须提交完整分段序列，主体动画更新会重新烘焙跟拍。冲突、缺失引用、重叠及不连续接点会阻止构建；取景包围范围警告通过 `diagnostics` 返回。工具仍为八个，不新增独立运动工具。

预设唯一来源是 `src/cameraPathPresets.js`，编辑器、场景校验和 Agent 接口目录共用；编辑器保留六张常用卡片并提供全部预设入口。协议详见 `server/scene-api.txt`。

## 会话、引用和附件

- 前端沿用本地 projectId/sessionId；后端以 projectId 隔离目录、sessionId 隔离检查点。LangGraph 检查点增量写入会话目录的 `checkpoint.sqlite`，使用事务和内容哈希分块去重，按需读取单个检查点。旧 `checkpoint.bin` 首次打开时由隔离子进程迁移，成功后才发布 SQLite；原二进制文件保留不动。内存不足、超时、取消或文件损坏时迁移明确失败并允许重试，不创建空会话代替旧历史。
- 每轮发送之前刷新未提交编辑与自动保存，并上传当前 GLB 和 JSON 给本机服务。它们是本轮的权威基线，覆盖历史会话中可能过时的场景认知。
- 元素引用含稳定实体 id、运行时 uuid、名称、kind；相机片段额外含 start/end，发送前补齐相机稳定 entityId。模型通过 `/context.json` 查找真实对象，不猜节点 ID。
- 运镜轨迹仍是现有标注功能生成的 PNG，作为图片参考进入同一个附件通道。模型据图编写/更新相机轨迹，标注本身不直接生成关键帧。
- 图片：PNG/JPG/JPEG/WebP/GIF；文档：PDF、DOC、DOCX、XLS/XLSX、TXT、MD、JSON、CSV；GLB 可作为 asset 节点插入。单附件 20 MiB，每轮最多 12 个。历史对话显示附件名，原文件留本机项目目录。
- 旧版二进制 DOC 使用 WordExtractor 解析；PDF、DOCX、XLS/XLSX 各自提取文本。文档提取有长度限制，不执行宏或文档脚本。

## 工具契约

所有工具先发 TOOL_CALL_START/ARGS，结束发 END/RESULT；错误返回 status:error 和 error 文本，供模型修复后重试。不同文件可并行，同文件串行；构建与预览使用顺序屏障，避免写入与构建竞争。

首次 `x_list` 通过 `task_intent:"chat"|"scene"` 声明本轮语义意图；开始写入或构建后不可降级为问答。场景交付前用同一工具提交 `task_review:{task_id,status:"ready"|"partial",issues:[]}`，不增加工具数量。服务端核对本轮最新构建已保存、没有待构建修改、有效机位与完整时间轴、指定时长画幅、每镜头起中尾预览已进入后续模型请求，以及未解决问题和严重诊断。结构与检查覆盖通过不代表艺术质量自动合格。

`RUN_FINISHED` 保留原事件名，并增加 `status:"completed"|"partial"` 和 `outcome`。部分完成仍保留成功产物及未完成原因，状态接口和历史恢复保留相同结论。正常问答无需构建；场景任务无有效产物、提前停止或缺少交付检查时不能标成完成。

为避免视觉检查无限打磨导致整轮超时，默认在达到 3 次成功构建且最新产物已有起点、中段与结尾检查帧后，仅开放一次 `x_list` 交付检查回合，再以 `tool_choice:none` 结束工具调用。多机位按时间轴各镜头的有效时间范围判断，验收要求每个镜头的起点、中段和结尾均有实际检查帧，不能用其它机位图片替代。模型仍可在此之前自行结束；缺少必要检查时返回部分完成。达到检查次数不代表画面或功能验收通过，最终说明需如实列出剩余问题。`AGENT_MAX_BUILD_PASSES` 可设置为 1–10；失败构建和旧版本检查帧不计入覆盖。

`AGENT_RECURSION_LIMIT` 默认 500，接受 50–5000 的整数，无效值回退到默认值。该值计算 LangGraph 执行步数，不是工具调用次数。接近上限时预留收尾步数：已有成功构建则关闭工具并要求如实总结尚未完成的修改与检查；没有成功构建则返回中文错误并保留原场景。步数按本轮首个模型节点计算，不累计历史会话的 checkpoint 步数。供应商忽略 `tool_choice:none` 时中止执行，避免继续循环。整轮超时限制仍由 `AGENT_RUN_TIMEOUT_MS` 控制。

文件工具只访问当前项目 workspace 下的 js/json/txt/md 文件。`/scene.js`、`/context.json` 等以 `/` 开头的路径是项目虚拟路径，不是磁盘绝对路径；拒绝 Windows 盘符、UNC 路径、`..` 越界与符号链接。`/context.json`、`/scene-api.txt` 由服务更新，工具只能读取，不能写入或编辑。目录工具不会列出上传原文件、构建产物、检查点、环境变量或项目目录外的文件。

单个文本文件读取上限为 32 MiB。x_read、x_grep 的文本输出上限为 64000 字符；目录扫描最多检查 10000 项、深入 64 层。输出或扫描触限时返回 truncated，调用方应缩小目录、分段读取或缩小搜索范围，不应把部分结果当作完整文件或完整搜索。

### x_list

输入：`{path?:string="/", recursive?:boolean=false, max_entries?:number=200}`；max_entries 为 1–1000 的整数。

可选元数据：`task_intent:"chat"|"scene"`；`task_review:{task_id:string,status:"ready"|"partial",issues:string[]}`。检查只对最新成功构建有效；响应附带 `task_intent`，提交检查时另附 `acceptance`。元数据不会修改场景文件。

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

### x_copy

输入：`{source:string,destination:string,overwrite?:boolean=false}`。复制当前项目工作区中的单个 js/json/txt/md 文件，保留原始字节及 SHA-256，最大 1 MiB；自动创建父目录。目标存在时须显式 overwrite。上下文与 API 文档只读，复制不会构建场景。

输出：`{status:"completed",source,destination,bytes,sha256}`。

### build_3D_scene

输入：`{source?:string="/scene.js"}`。

流程：
1. 无 `/manifest.json` 时读取单文件并在 QuickJS 内执行 `function build(ctx)`；有清单时，先按 `dependsOn` 拓扑排序加载模块，再调用入口 `build(ctx,modules)`。
2. ctx 提供当前 JSON、选中元素/片段、上传素材目录；程序只返回 scene spec。
3. Zod 校验 spec、节点 ID、动画数组、时间范围及协作操作。
4. patch 模式载入本轮基线 GLB，保留未涉及的节点和动画；replace 仅在明确创建整个新场景时使用。
5. 按稳定 id 增改节点、层级、几何体、材质、机位、灯光和动画；更新 timeline，回放经过校验的 libtv 场景操作。
6. 使用与前端相同的 viewport/相机轨迹逻辑重新序列化 GLB 和 JSON。
7. 两个文件及结果描述全部写好后才发布 RESULT，前端可在 Agent 继续运行时载入中间版本。

多文件清单格式为 `{version:1,entry:"/scene.js",modules:[{path:"/shared/constants.js",dependsOn:[]}]}`。每个模块在独立函数作用域内定义 `create(ctx,deps)`，返回公开数据或函数；deps 以完整虚拟路径索引声明的依赖，入口 modules 索引所有模块。禁止原生 import/export/require；全部代码仍运行于原 QuickJS 沙箱。清单最多 100 个模块，全部源文件合计及组装后的代码各限 1 MiB。缺失依赖、循环、重复路径（含大小写别名）、非法路径和入口不一致均拒绝构建。

新建场景按 `shared/`、`definitions/`、`content/`、`behavior/`、`presentation/`、`assembly/` 分层，由 `/scene.js` 组装。只创建实际需要的模块。文件操作按路径调度：不同文件可并行，同一文件串行，copy 占用源和目标路径；build、preview、list 和 grep 为全局顺序屏障，等待先前的文件操作并阻止后续写入越过屏障。多文件构建附带 `sources:[{path,sha256}]`，整体 source_hash 为完整组装代码的哈希。

输出：

```ts
{
 status:"completed", task_id:string, source:string,
 source_hash:string, source_sha256:string,
 glb_url:string, collaboration_url:string,
 glb_size:number, glb_sha256:string, triangles:number,
 diagnostics:Array<{kind:string,time:number,entityId:string,pathId:string}>
}
```

每个构建使用新的不可变 task_id 目录；校验失败不覆盖上一版产物。GLB 上限 100 MiB。

### preview_3D_scene

输入：`{camera_id?:string, time?:number=0}`。camera_id 为稳定 hf_id，省略时取首个相机；time 为秒，不能超出时间轴。

验收首选输入：`{check:"missing"}`。服务端按每镜头的精确起点、中点、终点生成计划，每次最多 12 帧，重复调用直到 remaining 为空。构建结果和 x_list 也会返回 preview_plan。生成计划与交付验收使用同一函数，不用邻近时间替代端点。

额外排查输入：`{frames:[{camera_id?:string,time:number},...]}`，每次 1–12 帧，不能与 check 或顶层 camera_id/time 混用。全部机位和时间先校验，明确指定但不存在的机位返回错误，不静默换机位。工具自动拆成最多 2 帧的小批，每批恢复一次 GLB。单帧旧参数及返回格式保持兼容。

流程：读取最近成功构建 → 用同一 viewport 恢复 → 定位相机 → seek(time) 评价真实动画 → 隐藏编辑辅助控件并渲染 PNG → 保存图片。

返回文字元数据：`{status:"completed",task_id,camera_id,time,width,height,image_url}`；ToolMessage.artifact 保存图像数据。下一次模型调用通过 middleware 将图像投影为 user image_url 内容，以兼容不接受 tool 消息内图片的 OpenAI 兼容接口。URL 只用于本地记录，模型看到的是内联像素，不要求供应商访问 localhost。

批量返回 `{status:"completed"|"partial",task_id,frame_count,frames:[单帧元数据...],remaining,unrendered,error?}`。每帧完成即保存并发布 PREVIEW，不等待整批完成。超时只对尚缺帧单帧重试一次，仍失败则保留已完成图片并返回 partial；下次复用缓存继续。图片按机位与时间进入下一次模型请求，只有模型实际收到像素后才计为已检查。旧产物、无效帧和未提供给模型的缓存不能通过验收。

## 耗时、事件保存和重复错误

每轮 `RUN_FINISHED` / `RUN_ERROR` 附带 `metrics`；状态接口也返回该摘要，同一 runs 目录保存 `<runId>.metrics.json`。记录上传与附件准备、模型调用与首次输出、供应商实际报告的 token 用量、工具排队和执行、源码加载、沙箱运行、渲染准备/恢复/绘制/编码、产物写入与提交、checkpoint 读写及事件保存耗时。阶段为计数、累计和最大毫秒数；并行阶段有重叠，不能将所有阶段简单相加。未报告 token 时为 null，不推算价格，不记录提示词、参数正文、回复或图片内容。

TEXT_MESSAGE_CONTENT 与 TOOL_CALL_ARGS 按 50 ms、32 KiB 或 128 组窗口合并保存。仅合并相邻且类型及消息/工具 ID 相同的 delta；状态、工具结果、场景结果及结束事件立即冲刷此前增量。SQLite 批量事务提交后才分配发布序号并推送；NDJSON 按批追加，结束前排空日志并保存指标，保留断线续传、去重和取消恢复语义。

前端文字即时更新显示，localStorage 历史每 100 ms 合并保存；正常结束、失败或分离时强制保存当前文字及事件游标，避免每个增量都序列化整个会话。

构建与预览错误附带 `repeat:{fingerprint,count,identicalInputCount,stop,hint}`。同类错误第二次出现提示改变修复方案；相同输入连续失败三次才停止重复工具调用并以部分完成收尾，保留最近成功产物。源码内容变化会重置相同输入计数，成功执行会清除该工具的连续错误记录。指纹不含随机日志 ID。

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

正式本地后端的产物只接受显式 RESULT、已提交 snapshotRevision 及当前项目的本地 URL，模型文本中的 JSON 不触发场景替换。产物先在 staging viewport 验证，主视窗在 GLB 解析成功前保留旧对象；应用成功后才采纳浏览器恢复快照。应用或本地保存失败时恢复旧场景并保留原快照和 journal；服务端版本已前进时暂停写入，允许返回首页重开同步，避免旧场景覆盖成功结果。兼容适配器仍经过文件与 JSON 操作校验、staging 和安全提交。正常手动编辑继续使用两秒自动保存与崩溃恢复。

渲染浏览器断开时清除失效实例。compile/preview 在产物发布前可受控重建并重试一次；场景程序或校验错误不自动重试。取消和时限覆盖浏览器启动、创建上下文及渲染，取消后迟到的上下文会自动关闭。

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

新增 WebSocket `/ws?project_id=...&agent_name=libtv_coding_agent`，接受 LibTV 风格的 `{threadId:sessionId,messages:[{id,role:"user",content:JSON.stringify(parts)}],forwardedProps:{extra:{aspect_ratio,duration_seconds,agent_mode}}}`。会话必须属于当前项目；从 SQLite 当前快照读取场景，复用 `/api/agent/run` 的真实执行链路和八个工具，输出 RUN_STARTED、工具/文本/产物事件、RUN_FINISHED/RUN_ERROR。现有编辑器默认继续使用 SSE，保持取消和分阶段场景载入行为。

SSE 每条为 `id: seq` 和 `data: JSON`：SESSION、RUN_STARTED、TEXT_MESSAGE_CONTENT、TOOL_CALL_START、TOOL_CALL_ARGS、TOOL_CALL_END、TOOL_CALL_RESULT、RESULT、PREVIEW、RUN_FINISHED、RUN_ERROR。事件与消息更新在同一 SQLite 事务内保存。浏览器刷新、离开或断开事件流只取消观察订阅，后台任务继续执行；只有已有的停止按钮或 session/stop-run 接口会取消任务。前端仍支持显式 `globalThis.__3D_BOX_AGENT_ADAPTER__` 覆盖，默认接本机服务。

恢复按 libtv 会话逻辑读取消息与 runStatus/latestRun，保留运行中的工具状态，通过事件 seq 去重补发。GET `/api/agent/runs/:runId?projectId=...` 返回任务状态、最新结果和事件游标；GET `/api/agent/runs/:runId/events?projectId=...&afterSeq=...` 补发并订阅后续事件。重复提交相同 runId 会附着原任务，不重复调用模型。短暂断连会自动重连；重新打开项目时直接恢复运行状态与原有停止按钮，不增加入口。

显式取消以 `RUN_FINISHED {status:"cancelled",message}` 结束，数据库和前端保留 cancelled 状态，正在执行的工具显示“已取消”，最近成功产物和已保存预览保留。运行超时及真实异常仍为 RUN_ERROR/failed。读取和重放旧版 `Cancelled by user` 记录时兼容显示为已取消，原始日志保留。

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

`npm test`：程序隔离/超时、路径限制、持久化、真实 Deep Agents 与兼容模型协议测试、八个工具、GLB/JSON/PNG、视觉输入、patch 保留、取消、附件提取。集成测试使用确定性的本地模型服务验证协议；不代表已验证某个付费模型的生成质量。

`npm run build`：前端生产构建。测试渲染产物位于 test-output，均为可丢弃测试数据。未配置真实供应商时，不发起真实模型调用。

参考：
- https://docs.langchain.com/oss/javascript/deepagents/overview
- https://docs.langchain.com/oss/javascript/deepagents/customization
- https://docs.langchain.com/oss/javascript/deepagents/streaming


## 通用灯光

`lighting` 支持布光组数组，与 `cameraMotion` 共用“预设目录 + custom”的调用方式。完整字段、实时预设目录和示例位于 `server/scene-api.txt`；验证位于 `src/lightingSchema.js`，生成、动画及持久化位于 `src/lightingRuntime.js`。

灯光设置仅由 Agent 提供；前端不显示专门的灯光设置面板。底层仍保留布光组创建、预设调整、参考方向、跟随、锁定和自定义能力，供 Agent 与内部运行时调用。布光组修改产生 `lighting.rig.set` 操作，携带精确状态以支持撤销、重做、崩溃恢复与协作快照。环境光、半球光、面积光通过 GLB 节点 extras 保留；第三方查看器可能不识别，3D-BOX 导入会恢复。旧版 product 配方保持兼容。
