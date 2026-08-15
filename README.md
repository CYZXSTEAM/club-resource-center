# CYZX社团资源库 V2.5

- Github Pages 托管静态前端导航页

- Koofr云盘作为文件存储

- 浏览器直连 Koofr REST API 完成上传、下载

## 功能

- 邮箱账户+应用密码，刷新即失效（无法查看）

- 上传/下载

- 强大搜索：文件(夹)名，类型名，拼音，模糊搜索

- 多样下载：单文件，多文件，文件夹(两次点击 防误触)

- 教学引导，不怕不会用

- 60s缓存，登录自动预加载，进入文件夹更快

- Koofr 10GB 免费空间

- 网页端+移动端 都适配

## 如何使用

1. 登录，使用邮箱和应用密码

2. 下载：点击两次下载（防误触）

3. 上传：专用上传模式，清晰上传状态

4. 搜索，顶部搜索框可自由搜索

5. 教学：10步引导，随时Esc退出，进度自动保存，退出恢复原页面

## 拓展使用

可以通过 HTTPS 访问的文件 API，得到账户和应用密码

包含：

| 技术       | 一些服务商                       | 另需                     |
| -------- | --------------------------- | ---------------------- |
| WebDAV   | 坚果云、Koofr、Nextcloud、Seafile | 需要 Cloudflare Worker翻译 |
| S3兼容API  | Cloudflare R2、阿里OSS、MinIO   | 需签名，由 Worker处理         |
| REST API | Koofr                       | 甚至不需Worker翻译           |

PS：无法使用浏览器直连 WebDAV（CORS 被拒），必须经 Worker 中转；

REST API可直连

## 版权来源

- 拼音能力来自 [pinyin-pro](https://github.com/zh-lx/pinyin-pro)（MIT 协议），本地打包、离线可用
- 界面布局灵感源自 [xiaoxuehua20.github.io](https://github.com/xiaoxuehua20/xiaoxuehua20.github.io) 学习资料库的浏览模式
