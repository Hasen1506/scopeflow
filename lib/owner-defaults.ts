import {db} from './server';
import {fromRow, type SettingsRow} from './settings';
import {draftDefaults, profileFromRow, type OwnerDefaults, type ProfileRow} from './profile';

/** The owner's standard clauses (account settings) and commercial defaults (business profile). */
export async function ownerDefaults(owner: string): Promise<OwnerDefaults> {
  const [settings, profile] = await Promise.all([
    db().prepare('SELECT * FROM account_settings WHERE owner=?').bind(owner).first<SettingsRow>(),
    db().prepare('SELECT * FROM business_profiles WHERE owner=?').bind(owner).first<ProfileRow>(),
  ]);
  const s = fromRow(settings);
  return {exclusions: s.default_exclusions, notes: s.default_terms, ...draftDefaults(profileFromRow(profile))};
}
