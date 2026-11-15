/**
 * SOURCE OF TRUTH KEYWORDS: isDesktopInstall, STUDIO_DESKTOP, desktop mode,
 *   local install, offline sign up
 *
 * WHAT:  True when the app runs inside the desktop installer (the desktop
 *        runtime sets STUDIO_DESKTOP="true").
 * WHY:   A desktop install has one machine, its own database, no email
 *        service and no social sign-in, so email verification can never
 *        complete and protects nothing (the account-linking risk it closes
 *        needs a social provider). Everything else behaves as on the web.
 * WHERE: Better Auth config (requireEmailVerification);
 *        desktop/runtime/main.mjs sets the variable.
 */
export function isDesktopInstall(): boolean {
  return process.env['STUDIO_DESKTOP'] === 'true'
}
