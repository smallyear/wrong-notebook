/**
 * 免登录模式开关。
 * 设置环境变量 AUTH_DISABLED=true 后，所有访问者自动使用默认管理员账户（admin@localhost），
 * 无需登录。仅建议在单机或可信内网环境开启，公网部署请保持关闭。
 */
export function isAuthDisabled(): boolean {
    return process.env.AUTH_DISABLED === "true";
}
