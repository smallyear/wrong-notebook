"use client";

import { useEffect } from "react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TimeZoneProvider } from "@/contexts/TimeZoneContext";
import { AiConsentDialog } from "@/components/ai-consent-dialog";
import { AppShell } from "@/components/app-shell";
import { BackgroundTasksButton } from "@/components/background-tasks-button";
import { OutdatedBrowserNotice } from "@/components/outdated-browser-notice";
import { FeedbackHost } from "@/components/ui/feedback-host";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { installGlobalErrorLogging } from "@/lib/frontend-logger";

export function Providers({
    children,
    timeZone,
    authDisabledSession,
}: {
    children: React.ReactNode;
    timeZone?: string;
    /** 免登录模式下由服务端注入的默认管理员会话 */
    authDisabledSession?: Session;
}) {
    // 未捕获的前端异常上报到服务端日志，调试模式下可随调试日志导出
    useEffect(() => installGlobalErrorLogging(), []);

    return (
        // 免登录模式下使用注入的固定会话，并禁用窗口聚焦时的会话刷新（刷新会得到空会话导致跳回登录页）
        <SessionProvider session={authDisabledSession} refetchOnWindowFocus={!authDisabledSession}>
            <ThemeProvider>
                <LanguageProvider>
                    <TimeZoneProvider initialTimeZone={timeZone}>
                        <OutdatedBrowserNotice />
                        <AppShell authDisabled={!!authDisabledSession}>{children}</AppShell>
                        <BackgroundTasksButton />
                        <AiConsentDialog />
                        <FeedbackHost />
                        <ServiceWorkerRegister />
                    </TimeZoneProvider>
                </LanguageProvider>
            </ThemeProvider>
        </SessionProvider>
    );
}
