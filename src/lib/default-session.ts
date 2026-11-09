import "server-only";

import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { hash } from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAuthDisabled } from "@/lib/auth-mode";
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from "@/lib/default-admin";

/** 默认管理员会话的有效期（30 天，仅用于展示，免登录会话每次请求重新生成） */
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 免登录模式下所有访问者共用的默认管理员会话。
 * 账户不存在时自动创建（使用默认管理员密码与 admin 角色）。
 */
export async function getDefaultAdminSession(): Promise<Session> {
    let user = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                email: DEFAULT_ADMIN_EMAIL,
                password: await hash(DEFAULT_ADMIN_PASSWORD, 10),
                name: "Admin",
                role: "admin",
                isActive: true,
            },
        });
    }

    return {
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            // 免登录模式不做强制改密，否则每次访问都会被拦到安装向导
            mustChangePassword: false,
        },
        expires: new Date(Date.now() + DEFAULT_SESSION_TTL_MS).toISOString(),
    };
}

/** 统一的会话入口：免登录模式返回默认管理员会话，否则走 NextAuth 正常鉴权 */
export async function getAuthSession(): Promise<Session | null> {
    if (isAuthDisabled()) {
        return getDefaultAdminSession();
    }
    return getServerSession(authOptions);
}
