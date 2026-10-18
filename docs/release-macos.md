# Tabby {{VERSION}}：原生 SFTP 表头排序，撤回 Cyberduck 集成

## 本次改动

- 保留 Tabby 原生配色、字体、图标、文件行样式与操作，仅为现有 SFTP 列增加表头。
- 单击名称、大小、修改时间设为主排序，再次单击主排序列切换升降序。
- Shift+单击添加或切换次级排序；箭头和数字显示方向及优先级。支持 Enter/空格及 Shift 组合。
- 上级目录固定首行，文件夹优先，记住排序；原多字段编辑器（含类型）默认折叠在高级排序中。
- 撤回 Cyberduck 菜单、启动、密码共享、全局/连接级开关及原生钥匙串桥接。
  **不会自动删除用户已有钥匙串记录或重置 SSH 配置。**
- 更新中英文 README，保留上游信息并明确本分支的验证范围。

## 下载与验证范围

本次仅提供已验证的 **macOS Apple Silicon（arm64）** ZIP 和 DMG；用户自行下载安装更新。
产物通过 Developer ID 严格签名、Apple 公证票据、Gatekeeper、ZIP/DMG 完整性和 SHA-256 校验。
Windows、Linux、Intel Mac 不在本次产物验证范围。未使用真实 SSH 凭据做登录/传输验收。

- 源码：`{{SHA}}`（最终 master 合并提交）
- 构建：[GitHub Actions]({{RUN_URL}})
- `SHA256SUMS.txt`：安装包校验值
- `BUILD_INFO.json`：版本、源码和构建信息
- `SIGNATURE_INFO.txt`：签名、公证和 Gatekeeper 验证记录

上游项目：[Eugeny/tabby](https://github.com/Eugeny/tabby)。这是个人分支的发布，不是上游官方安装包。
