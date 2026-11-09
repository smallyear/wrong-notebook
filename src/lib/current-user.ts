import "server-only";

import { getAuthSession } from "@/lib/default-session";
import { prisma } from "@/lib/prisma";

/** 获取当前登录用户；免登录模式下为默认管理员，未登录或用户不存在时返回 null */
export async function getCurrentUser() {
    const session = await getAuthSession();
    if (!session?.user?.email) {
        return null;
    }
    return prisma.user.findUnique({ where: { email: session.user.email } });
}
