# Aliyun 部署说明（Nginx 反向代理）

> 线上地址：**https://grandviewgarden.wentaox.cn/**
> 服务器：`aliyun`（root@47.116.203.177，Ubuntu + Nginx 1.18）
> 本项目为纯静态单文件（`index.html`，全部资源内联），采用「本机静态后端 + Nginx 反向代理」方式部署（与服务器上 `my-blog` / `wentaox.cn` 的架构一致）。

## 一、站点文件（全部在 /srv/grandviewgarden，别处不放项目文件）

`/srv/grandviewgarden` 是**完整项目仓库**（git clone，含 `index.html` 构建产物、`src/`、`docs/`、`tools/`、`scripts/`、`deploy/`、README 等）：

| 项目 | 路径 |
|---|---|
| 项目 / 站点根目录 | `/srv/grandviewgarden`（完整仓库，9MB 左右） |
| 站点入口 | `/srv/grandviewgarden/index.html` |
| 源码/文档/工具 | `/srv/grandviewgarden/{src,docs,tools,scripts,deploy}` |
| Nginx 配置 | `/etc/nginx/sites-available/grandviewgarden.wentaox.cn.conf`（系统路径，软链到 `sites-enabled/`） |
| 静态后端监听 | `127.0.0.1:1236`（只监听回环，不暴露公网） |
| 公网入口 | `80/443`，`server_name grandviewgarden.wentaox.cn`，`proxy_pass http://127.0.0.1:1236` |
| TLS 证书 | `/etc/letsencrypt/live/grandviewgarden.wentaox.cn/`（Certbot 自动续期，`certbot.timer`） |
| 日志 | `/var/log/nginx/grandviewgarden.access.log` / `.error.log` |

> Web 端只公开 `index.html`；`/src/`、`/docs/`、`/tools/`、`/scripts/`、`/deploy/`、`.git`、`package*.json`、README 等均已在 Nginx 中 deny，不会通过域名对外暴露。项目文件本身只存放在 `/srv/grandviewgarden`。
> Nginx 配置、TLS 证书、访问日志是运行站点必需的系统级文件，必须位于 `/etc`、`/var/log` 等系统路径，不属于「项目文件」。

## 二、首次部署（已完成，留档备查）

```bash
# 1) 目录与完整仓库（项目文件只放这里）
ssh aliyun "cd /srv/grandviewgarden && \
  git clone --depth 1 https://github.com/wentao1176/GrandViewGarden.git .clone-tmp && \
  rsync -a .clone-tmp/ ./ && rm -rf .clone-tmp"

# 2) Nginx 站点配置（HTTP 反向代理；源码目录 deny）
scp deploy/grandviewgarden.wentaox.cn.conf \
    aliyun:/etc/nginx/sites-available/grandviewgarden.wentaox.cn.conf
ssh aliyun "ln -sf /etc/nginx/sites-available/grandviewgarden.wentaox.cn.conf \
    /etc/nginx/sites-enabled/grandviewgarden.wentaox.cn.conf && \
    nginx -t && systemctl reload nginx"

# 3) HTTPS（Certbot 自动改配置并加 80→443 跳转）
ssh aliyun "certbot --nginx -d grandviewgarden.wentaox.cn \
    --non-interactive --agree-tos --redirect --keep-until-expiring"
```

DNS：`grandviewgarden.wentaox.cn` 的 **A 记录已指向 47.116.203.177**。

## 三、更新站点（以后每次）

推荐在服务器上直接 `git pull`（`index.html` 已是仓库构建产物，拉取后即生效）：

```bash
ssh aliyun "cd /srv/grandviewgarden && git pull --ff-only"
```

或者本地构建后上传：

```bash
npm run build
scp index.html aliyun:/srv/grandviewgarden/index.html
```

静态文件替换即时生效，无需 reload Nginx（只有改 Nginx 配置才需要 `nginx -t && systemctl reload nginx`）。

## 四、验证

```bash
curl -I https://grandviewgarden.wentaox.cn/                          # 期望 200
curl -o /dev/null -s -w '%{http_code}\n' https://grandviewgarden.wentaox.cn/src/main.js   # 期望 403（源码不公开）
node tools/live-check.mjs https://grandviewgarden.wentaox.cn/          # 浏览器级：加载/功能/0 console error
ssh aliyun "certbot certificates | grep -A3 grandviewgarden"           # 证书有效期
```
