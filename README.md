# 社团资源库 v1

一个纯静态的社团资源管理导航页：托管在 GitHub Pages（免费），文件存储在 Koofr 云盘（免费 10GB）。

## 功能

- 密码门禁：没有密码看不到任何文件，未登录直接请求 API 会被 Koofr 拒绝（401）
- 分类卡片首页：学科资料、竞赛真题、活动照片、会议记录、其他
- 文件夹浏览：面包屑导航、文件大小与修改时间
- 上传：拖拽 / 点击多选、实时进度条、同名文件可选覆盖或重命名
- 下载：点击即下载
- 预览：图片与 PDF 在线预览
- 退出登录：关闭页面即自动失效（凭据只存在当前会话）

## 技术说明

- 纯原生 HTML/CSS/JS，无框架、无构建步骤，只有一个网页 + 一个配置文件
- 浏览器直接调用 Koofr REST API（`app.koofr.net/api/v2.1`），已实测支持跨域
- 不使用 WebDAV：Koofr 的 WebDAV 端点不支持浏览器跨域直连

## 目录结构

```
index.html     页面结构
style.css      样式
app.js         逻辑（登录/浏览/上传/下载/预览）
config.js      配置（分类、根路径、账号挂载点）
README.md      本文档
```

## 部署步骤

### 1. 准备 Koofr 云盘

1. 使用**专门用于社团的 Koofr 账号**登录 [app.koofr.net](https://app.koofr.net)。
2. 在网盘根目录（`/Koofr/`）下创建文件夹 `社团资源库`。
3. 在 `社团资源库` 内创建分类子文件夹（名字与 `config.js` 中的 `folder` 一致）：
   `01-学科资料`、`02-竞赛真题`、`03-活动照片`、`04-会议记录`、`05-其他`。
4. 生成应用密码：右上角头像 → Preferences（偏好设置）→ Password（密码）→ App passwords → Generate new password，命名如 `社团资源库`。
   - 若生成时可以选择权限，请勾选 `files.read`（浏览/下载）和 `files.edit`（上传）。
   - 生成的密码只显示一次，请记好。**不要发给别人之前先收好。**

### 2. 修改配置（可选）

如需调整分类或根路径，编辑 `config.js` 后重新推送即可。

### 3. 部署到 GitHub Pages

1. 在 GitHub 上创建一个公开仓库，例如 `club-resource-center`（公开仓库才能免费使用 Pages）。

2. 在本地这个项目目录执行：
   
   ```bash
   git init
   git add .
   git commit -m "社团资源库 v1"
   git branch -M main
   git remote add origin git@github.com:xiaoxuehua20/club-resource-center.git
   git push -u origin main
   ```

3. 打开仓库 Settings → Pages → Build and deployment → Source 选 "Deploy from a branch" → Branch 选 `main` / `(root)` → Save。

4. 等 1–2 分钟后访问 `https://<你的用户名>.github.io/club-resource-center/`。

## 使用方法

1. 打开页面 → 输入社团 Koofr 邮箱和应用密码 → 进入资源库。
2. 点击分类卡片进入文件夹；点文件夹名继续下钻，点面包屑返回。
3. 上传：把文件拖到上传区，或点击上传区选择文件；同名文件会询问覆盖 / 重命名 / 取消。
4. 下载：点文件名或"下载"按钮。
5. 预览：图片和 PDF 有"预览"按钮，弹窗内可直接下载。
6. 用完点右上角"退出登录"；直接关闭页面也会自动清除密码。

## 保密与安全说明

- 密码门禁由 Koofr 服务端强制：没有密码，任何文件列表/下载请求都会返回 401。
- 密码只存在当前浏览器会话（sessionStorage），关闭页面即失效，不写入任何文件。
- **不要把应用密码写进代码、仓库或群聊**，只在线下告知社团成员。
- 传输全程 HTTPS 加密；文件在 Koofr 服务端加密存储。
- 已知风险：因为要支持上传，应用密码具备写权限，任何持有密码的人理论上都能通过 API 修改或删除文件。v1 页面不提供删除入口，但风险客观存在，请只把密码给可信成员。

## 机房部署与排障

- 若学校机房有上网白名单，需放行：
  
  - `app.koofr.net`（页面调用 API 的服务器，必须）
  - `*.github.io`（加载页面本身）

- 本地测试建议用本地服务器（直接双击打开 `index.html` 可能因浏览器策略无法请求）：
  
  ```bash
  python -m http.server 8000
  ```
  
  然后浏览器打开 `http://localhost:8000`。

- 微信内置浏览器可能限制大文件上传/下载，建议用 Chrome/Edge 或手机系统浏览器打开。

- 免费版单文件大小上限请在机房实测，结果记录到本文件下方。

### 实测记录

- 若报错 `mountId: invalid mountable (expected primary or UUID)`：检查 `config.js` 里的 `mountId`，主存储应填 `"primary"`，不要填 `"Koofr"`。

| 项目                    | 结果  |
| --------------------- | --- |
| 单文件上限（请实测）            | 待填写 |
| 校园网到 app.koofr.net 速度 | 待填写 |
| 微信内置浏览器兼容性            | 待填写 |

## 测试清单

- [ ] 密码错误时提示且看不到任何数据
- [ ] 未登录直接访问页面只显示登录界面
- [ ] 登录后可浏览各分类文件夹
- [ ] 上传单个/多个文件，进度条正常
- [ ] 同名文件覆盖 / 重命名 / 取消均正常
- [ ] 下载的文件内容与大小正确
- [ ] 图片和 PDF 预览正常
- [ ] 退出登录后刷新页面回到登录界面
- [ ] 断网时给出明确提示

## 后续（v2 候选）

- 删除、重命名、移动、搜索
- 文件夹打包下载、分享链接
- 每个成员用自己的 Koofr 账号登录（OAuth），按用户设置只读/可写
- 端到端加密（即使账号泄露也读不了文件）
- Cloudflare Pages / Worker 中转，解决机房直连不稳定问题
