import { afterEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
    user: {
        findUnique: vi.fn(),
        create: vi.fn(),
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(),
}));

import { getAuthSession } from '@/lib/default-session';
import { isAuthDisabled } from '@/lib/auth-mode';

describe('免登录模式（AUTH_DISABLED）', () => {
    const ORIGINAL = process.env.AUTH_DISABLED;

    afterEach(() => {
        if (ORIGINAL === undefined) {
            delete process.env.AUTH_DISABLED;
        } else {
            process.env.AUTH_DISABLED = ORIGINAL;
        }
        vi.clearAllMocks();
    });

    it('isAuthDisabled 仅在 AUTH_DISABLED="true" 时开启', () => {
        process.env.AUTH_DISABLED = 'true';
        expect(isAuthDisabled()).toBe(true);

        process.env.AUTH_DISABLED = 'false';
        expect(isAuthDisabled()).toBe(false);

        delete process.env.AUTH_DISABLED;
        expect(isAuthDisabled()).toBe(false);
    });

    it('免登录开启时 getAuthSession 返回默认管理员会话，账户不存在时自动创建', async () => {
        process.env.AUTH_DISABLED = 'true';
        prismaMock.user.findUnique.mockResolvedValue(null);
        prismaMock.user.create.mockResolvedValue({
            id: 'user-1',
            email: 'admin@localhost',
            name: 'Admin',
            role: 'admin',
        });

        const session = await getAuthSession();

        expect(session?.user.id).toBe('user-1');
        expect(session?.user.role).toBe('admin');
        expect(session?.user.email).toBe('admin@localhost');
        expect(session?.user.mustChangePassword).toBe(false);
        expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    });

    it('默认管理员已存在时直接复用，不重复创建', async () => {
        process.env.AUTH_DISABLED = 'true';
        prismaMock.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: 'admin@localhost',
            name: null,
            role: 'admin',
        });

        const session = await getAuthSession();

        expect(prismaMock.user.create).not.toHaveBeenCalled();
        expect(session?.user.id).toBe('user-1');
    });

    it('免登录关闭时走 NextAuth 正常鉴权', async () => {
        delete process.env.AUTH_DISABLED;
        const { getServerSession } = await import('next-auth');
        vi.mocked(getServerSession).mockResolvedValue(null as never);

        expect(await getAuthSession()).toBeNull();
        expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
});
