import type { LocalProfile } from "@/client/types";
import { PROFILE_COLORS } from "@/lib/profile-stats";

export function ProfileAvatar({ profile, initials, large = false }: { profile: LocalProfile; initials: string; large?: boolean }) {
  return <span aria-hidden="true" className={`profile-avatar ui-title${large ? " profile-avatar-large" : ""}`} data-color={profile.avatarColor} style={{ backgroundColor: PROFILE_COLORS[profile.avatarColor] }}>
    {profile.avatarImage ? <img src={profile.avatarImage} alt="" /> : initials}
  </span>;
}
