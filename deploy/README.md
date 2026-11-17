# Aliyun 部署说明（Nginx 反向代理）

> 线上地址：**https://grandviewgarden.wentaox.cn/**
> 服务器：`aliyun`（root@47.116.203.177，Ubuntu + Nginx 1.18）
> 本项目为纯静态单文件（`index.html`，全部资源内联），因此采用「本机静态后端 + Nginx 反向代理」的方式部署（与服务器上 `my-blog` / `wentaox.cn` 的架构一致）。

## 一、站点文件

| 项目 | 路径 |
|---|---|
| 站点根目录 | `/srv/grandviewgarden` |
| 入口文件 | `/srv/grandviewgarden/index.html` |
| Nginx 配置 | `/etc/nginx/sites-available/grandviewgarden.wentaox.cn.conf`（已软链到 `sites-enabled/`） |
| 静态后端监听 | `127.0.0.1:1236`（只监听回环，不暴露公网） |
| 公网入口 | `80/443`，`server_name grandviewgarden.wentaox.cn`，`proxy_pass http://127.0.0.1:1236` |
| TLS 证书 | `/etc/letsencrypt/live/grandviewgarden.wentaox.cn/`（Certbot 自动续期，`certbot.timer`） |
| 日志 | `/var/log/nginx/grandviewgarden.access.log` / `.error.log` |

## 二、首次部署（已完成，留档备查）

```bash
# 1) 目录与文件
ssh aliyun "mkdir -p /srv/grandviewgarden"
scp index.html aliyun:/srv/grandviewgarden/index.html

# 2) Nginx 站点配置（HTTP 反向代理）
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

```bash
npm run build
scp index.html aliyun:/srv/grandviewgarden/index.html
```

静态文件替换即时生效，无需 reload Nginx（若改了 Nginx 配置才需 `nginx -t && systemctl reload nginx`）。

## 四、验证

```bash
curl -I https://grandviewgarden.wentaox.cn/          # 期望 200
node tools/live-check.mjs https://grandviewgarden.wentaox.cn/   # 浏览器级：加载/功能/0 console error
ssh aliyun "certbot certificates | grep -A3 grandviewgarden"    # 证书有效期
```

> 说明：站点是纯前端静态资源，Nginx 的「反代」只是把公网请求转给回环上的静态后端（`127.0.0.1:1236`）。若以后要接后端接口，可在该静态后端或新增 upstream 中扩展。
