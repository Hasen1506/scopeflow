export type AccountSaveTarget = 'settings' | 'profile' | 'both' | 'none';

export interface AccountSaveContext {
  inWording: boolean;
  inBusiness: boolean;
  wordingDirty: boolean;
  businessDirty: boolean;
  hasSettings: boolean;
  hasProfile: boolean;
  profileBlocked: boolean;
}

/**
 * Resolves which section(s) Cmd+S / Ctrl+S on /account should save:
 * 1. If focus is inside "Your wording", save settings.
 * 2. If focus is inside "Business details", save profile (unless blocked by validation).
 * 3. Otherwise save whichever section has unsaved edits (or both if both were edited).
 * 4. If nothing is marked dirty yet, default to the available section so the shortcut always feels responsive.
 */
export function resolveAccountSaveTarget(ctx: AccountSaveContext): AccountSaveTarget {
  const canSettings = ctx.hasSettings;
  const canProfile = ctx.hasProfile && !ctx.profileBlocked;

  if (ctx.inWording) return canSettings ? 'settings' : 'none';
  if (ctx.inBusiness) return canProfile ? 'profile' : 'none';

  if (ctx.wordingDirty && ctx.businessDirty) {
    if (canSettings && canProfile) return 'both';
    if (canSettings) return 'settings';
    if (canProfile) return 'profile';
    return 'none';
  }
  if (ctx.wordingDirty) return canSettings ? 'settings' : 'none';
  if (ctx.businessDirty) return canProfile ? 'profile' : 'none';

  if (canSettings) return 'settings';
  if (canProfile) return 'profile';
  return 'none';
}
