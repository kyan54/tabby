# Tabby {{VERSION}}：SFTP 排序增加取消状态

## 本次改动

- 单列排序循环为 **升序 → 降序 → 取消排序**。
- Shift 多字段排序时，第三次操作只移除该列，其余规则和方向保留，优先级重新编号。
- 最后一列取消后持久化空规则；刷新、重进目录及重开面板仍保持取消，不恢复默认名称排序。
- 取消时保留服务器返回顺序；若目录优先开启，仅稳定分组，组内不隐式按名称排序。
- 高级排序可移除最后一项并应用空选择，与表头状态一致。
- 保持已验收的 Tabby 原生配色、字体、文件图标、行样式和文件操作。
- 延续 Cyberduck 集成回退：不包含其菜单、启动、密码共享、全局/连接设置或原生钥匙串桥接；
  不自动清理用户已有钥匙串记录或重置 SSH 配置。

## 版本与下载

标签严格为 **v{{VERSION}}**，应用版本及附件名称均为 **{{VERSION}}**。
这是正式 Release（非草稿、非预发布），并显式设为 Latest。
版本号低于 `1.0.239`，已安装该版的用户请手动下载更新；旧 `1.0.239` 不删除或修改。

本次仅提供已验证的 **macOS Apple Silicon（arm64）** ZIP/DMG，使用 Developer ID 签名并经 Apple 公证。
Windows、Linux、Intel Mac 不在本次产物验证范围。交互验证使用真实隔离 Tabby 的假目录，未使用真实 SSH 凭据。

- 源码：`{{SHA}}`（最终 master 合并提交）
- 构建：[GitHub Actions]({{RUN_URL}})
- `SHA256SUMS.txt`：安装包 SHA-256
- `BUILD_INFO.json`：版本、源码及构建信息
- `SIGNATURE_INFO.txt`：签名、公证票据及 Gatekeeper 验证记录

上游：[Eugeny/tabby](https://github.com/Eugeny/tabby)。这是个人分支发布，不是上游官方安装包。
