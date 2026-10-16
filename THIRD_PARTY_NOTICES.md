# 来源与第三方声明

## libtv 前端参考与移植

若干模块明确标注参考、适配或直接移植了 libtv 已发布的前端 JavaScript／CSS，包括相机轨迹、网格、监视器、标注、浮动布局和编辑器交互。相关 `libtv*` 标识亦用于文件格式及逻辑兼容，保留在源码中。

公开前端可访问不等于已取得开源许可。本次发布未找到覆盖这些移植部分的许可证文件，因此不对它们宣称 MIT、Apache 或其他再许可。原有来源注释保持不变。

`public/assets/studio/` 中的示例、封面和展示素材也不因本仓库公开而获得新的授权。

本项目不提供 libtv 私有后端代码、模型服务或官方身份。

## Pavo 品牌

`public/assets/logo-dark.png` 是本项目使用的 Pavo 品牌图片；品牌和商标权利仍属于各自权利人，本仓库不授予商标使用权。

## Draco

`public/draco/` 包含 Google Draco 解码器，由 Three.js 分发版本提供。Draco 使用 Apache License 2.0，许可证见同目录 `LICENSE`，来源说明见 `README.md`。

## npm 依赖

Three.js、React、Motion、LangChain、Deep Agents、Playwright 等依赖保持各自许可证；版本与来源记录在 `package-lock.json` 中，安装后许可证随对应 npm 包提供。本仓库不包含 `node_modules`。

## 项目整体许可

当前未添加覆盖整个仓库的统一许可证，避免对未核实授权的第三方代码和素材作出再许可声明。正式选择整体开源许可证前，应先确认上述第三方部分的再分发和许可条件。
