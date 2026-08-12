/* 社团资源库 配置文件
 * 部署时一般只需要修改这个文件。修改后推送到 GitHub 即可生效。
 */
window.CLUB_CONFIG = {
  /* Koofr API 地址，一般不需要改 */
  koofrBase: "https://app.koofr.net",

  /* Koofr 挂载点 ID：主存储固定为 "primary"（也可填 GET /api/v2.1/mounts
   * 返回的某个挂载点 UUID）。注意不是 WebDAV 路径里的 "Koofr"。 */
  mountId: "primary",

  /* 资源库在 Koofr 中的根文件夹路径（必须以 / 开头） */
  rootPath: "/社团资源库",

  /* 页面标题（显示在浏览器标签和页面顶部） */
  siteTitle: "社团资源库",

  /* 顶栏搜索框占位文案 */
  searchPlaceholder: "搜索文件名…",

  /* 首页分类卡片：folder 是 Koofr 中对应分类子文件夹的名字
   * 需要先在 Koofr 网页端创建这些文件夹（见 README 部署步骤） */
  categories: [
    { name: "学科资料", icon: "📚", folder: "01-学科资料" },
    { name: "竞赛真题", icon: "🏆", folder: "02-竞赛真题" },
    { name: "活动照片", icon: "📷", folder: "03-活动照片" },
    { name: "会议记录", icon: "📝", folder: "04-会议记录" },
    { name: "其他", icon: "📁", folder: "05-其他" }
  ]
};
